// 画面専用（図解「ベン図」）。選べる項目は、ランキング（チーム・シーズン成績）で選べる Traditional・Advanced・Misc・Scoring の項目。
// 値・向き（higherIsBetter）・表示値は、全チームスタッツ／ランキングと同じ列定義をそのまま使う。
import type { Category, TeamGameLog } from '../../shared/types';
import { filterByGameType, type SeasonGameTypeFilter } from '../../shared/gameType';
import { filterGameLogs, type SituationalRange } from './situational';
import {
  buildAdvancedColumns, buildMiscColumns, buildOppPtsColumn, buildScoringColumns, buildTraditionalColumns, sumTeamGameLogs,
  type AllTeamsRow, type TeamPerspective,
} from './teamStatsColumns';
import { foulColumnsSplit } from './ruleChange';
import { BOX_CATEGORY_TABS, type BoxCategoryKey } from './categoryLabels';
import type { Column } from '../components/SortableTable';
import { computeVenn, DEFAULT_VENN_TOP, displayNumber, thresholdVennRows, VENN_TOP_OPTIONS, type VennCircleSpec, type VennTop } from './figureVenn';
import { averageTotals } from './leagueAverage';

export const VENN_CATEGORIES = BOX_CATEGORY_TABS;
export type VennPerspective = TeamPerspective;
export const VENN_PERSPECTIVES: readonly VennPerspective[] = ['own', 'opp', 'diff'];

/** ランキング（チーム・シーズン成績）と同じ列の組み立て（1試合平均） */
export function vennColumns(category: BoxCategoryKey, perspective: VennPerspective, season: string): Column<AllTeamsRow>[] {
  const foulSplit = foulColumnsSplit([season]);
  switch (category) {
    case 'traditional': {
      const columns = buildTraditionalColumns('perGame', perspective);
      if (perspective !== 'own') return columns;
      const at = columns.findIndex(c => c.key === 'pts');
      return [...columns.slice(0, at + 1), buildOppPtsColumn('perGame'), ...columns.slice(at + 1)];
    }
    case 'advanced': return buildAdvancedColumns('perGame', perspective);
    case 'misc': return buildMiscColumns('perGame', perspective, true, foulSplit);
    case 'scoring': return buildScoringColumns('perGame', perspective, true, true);
  }
}

export interface VennItem { id: string; category: BoxCategoryKey; categoryLabel: string; key: string; label: string }
export const vennItemId = (category: BoxCategoryKey, key: string) => `${category}.${key}`;
const listCache = new Map<string, VennItem[]>();
export function vennItems(season: string): VennItem[] {
  const cacheKey = foulColumnsSplit([season]) ? 'new' : 'old';
  let items = listCache.get(cacheKey);
  if (!items) {
    items = VENN_CATEGORIES.flatMap(tab => vennColumns(tab.key, 'own', season).map(c => ({ id: vennItemId(tab.key, c.key), category: tab.key, categoryLabel: tab.label, key: c.key, label: c.label })));
    listCache.set(cacheKey, items);
  }
  return items;
}
export function vennColumn(item: VennItem, perspective: VennPerspective, season: string): Column<AllTeamsRow> | undefined {
  return vennColumns(item.category, perspective, season).find(c => c.key === item.key);
}
/** 円の名前に使う項目名（opp の視点は「opp ORtg」、+/- は「ORtg +/-」） */
export function vennItemLabel(item: VennItem, perspective: VennPerspective): string {
  return perspective === 'opp' ? `opp ${item.label}` : perspective === 'diff' ? `${item.label} +/-` : item.label;
}

export interface VennSelection { item: string; perspective: VennPerspective }
export const DEFAULT_VENN_SELECTION: readonly [VennSelection, VennSelection, VennSelection] = [
  { item: vennItemId('advanced', 'ortg'), perspective: 'own' },
  { item: vennItemId('advanced', 'drtg'), perspective: 'own' },
  { item: vennItemId('traditional', '3ppct'), perspective: 'own' },
];
export { DEFAULT_VENN_TOP, VENN_TOP_OPTIONS };
export type { VennTop };

/**
 * 選んだ3つを有効な形に直す。存在しない項目・ほかの円と同じ項目は、初期の項目（それも使われていれば、まだ使われていない最初の項目）にする。
 * 自チームとopp で値が変わらない項目は視点を自チームに固定する（hasPerspective が false を返すとき）。
 */
export function resolveVennSelection(input: readonly VennSelection[], season: string, hasPerspective: (itemId: string) => boolean = () => true): [VennSelection, VennSelection, VennSelection] {
  const items = vennItems(season), ids = new Set(items.map(i => i.id));
  const used = new Set<string>();
  const out: VennSelection[] = [];
  for (let i = 0; i < 3; i++) {
    let sel = input[i] ?? DEFAULT_VENN_SELECTION[i]!;
    if (!ids.has(sel.item) || used.has(sel.item)) {
      sel = [DEFAULT_VENN_SELECTION[i]!, ...DEFAULT_VENN_SELECTION, ...items.map(it => ({ item: it.id, perspective: 'own' as const }))].find(s => ids.has(s.item) && !used.has(s.item))!;
    }
    used.add(sel.item);
    out.push(hasPerspective(sel.item) ? sel : { item: sel.item, perspective: 'own' });
  }
  return out as [VennSelection, VennSelection, VennSelection];
}

/** 全チームスタッツと同じ順序: 期間を選び、その後に試合区分を適用して合計する（試合が0のチームは除く）。 */
export function buildVennRows(teams: readonly { teamId: string; teamName: string }[], logsByTeam: ReadonlyMap<string, TeamGameLog[]>, q: { category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter }): AllTeamsRow[] {
  const rows: AllTeamsRow[] = [];
  for (const team of teams) {
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], { range: q.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, q.category);
    const scoped = filterByGameType(ranged, q.gameType);
    if (!scoped.length) continue;
    rows.push({ team, gamesPlayed: scoped.length, wins: scoped.filter(g => g.win).length, losses: scoped.filter(g => !g.win).length, totals: sumTeamGameLogs(scoped) });
  }
  return rows;
}

/** 視点を変えると値が変わる項目か（全チームの表示値が自チームと opp で同じなら、視点は選べない） */
export function itemHasPerspective(item: VennItem, rows: readonly AllTeamsRow[], season: string): boolean {
  const own = vennColumn(item, 'own', season), opp = vennColumn(item, 'opp', season);
  if (!own || !opp) return false;
  return rows.some(r => (own.format ? own.format(r) : String(own.sortValue(r))) !== (opp.format ? opp.format(r) : String(opp.sortValue(r))));
}

export function vennSpec(item: VennItem, perspective: VennPerspective, season: string): VennCircleSpec<AllTeamsRow> {
  const column = vennColumn(item, perspective, season)!;
  return {
    value: r => Number(column.sortValue(r)),
    text: r => column.format ? column.format(r) : String(column.sortValue(r)),
    higherIsBetter: column.higherIsBetter ?? true,
  };
}

export type VennBasis = 'rank' | 'value';

/** リーグ平均の行（各チームの合計の平均。ORtg × DRtg の図のリーグ平均と同じ作り） */
export function vennLeagueRow(rows: readonly AllTeamsRow[]): AllTeamsRow | null {
  if (!rows.length) return null;
  return { team: { teamId: 'league', teamName: 'リーグ平均' }, gamesPlayed: rows.reduce((s, r) => s + r.gamesPlayed, 0) / rows.length, wins: 0, losses: 0, totals: averageTotals(rows.map(r => r.totals)) };
}
/** 値で絞るときの基準の初期値＝その項目のリーグ平均（画面に出す値。良い側に入るチームが円に入る） */
export function defaultVennThreshold(item: VennItem, perspective: VennPerspective, season: string, league: AllTeamsRow | null): number | null {
  const column = vennColumn(item, perspective, season);
  if (!column || !league) return null;
  const v = displayNumber(column.format ? column.format(league) : String(column.sortValue(league)));
  return Number.isFinite(v) ? v : null;
}
/** 基準の値の書き方（その項目の表示値と同じ小数の桁数・%の付き方）。例: 115.00、35.00% */
export function formatVennThreshold(value: number, sampleText: string): string {
  if (/^-?\d+:\d{2}$/.test(sampleText.trim())) { const total = Math.round(Math.abs(value) * 60); return `${value < 0 ? '-' : ''}${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`; }
  const digits = /\.(\d+)/.exec(sampleText)?.[1]?.length ?? 0;
  const signed = sampleText.trim().startsWith('+') && value > 0 ? '+' : '';
  return `${signed}${value.toFixed(digits)}${sampleText.trim().endsWith('%') ? '%' : ''}`;
}

export interface VennBasisInput { basis: VennBasis; top: number; thresholds: readonly (number | null)[] }

export function computeTeamVenn(rows: readonly AllTeamsRow[], selection: readonly VennSelection[], season: string, top: number | VennBasisInput) {
  const byId = new Map(vennItems(season).map(i => [i.id, i]));
  const specs = selection.map(s => vennSpec(byId.get(s.item)!, s.perspective, season)) as [VennCircleSpec<AllTeamsRow>, VennCircleSpec<AllTeamsRow>, VennCircleSpec<AllTeamsRow>];
  if (typeof top === 'number' || top.basis === 'rank') return computeVenn(rows, r => r.team.teamId, specs, typeof top === 'number' ? top : top.top);
  return computeVenn(rows, r => r.team.teamId, specs, (ranked, i) => {
    const t = top.thresholds[i];
    return t === null || t === undefined || !Number.isFinite(t) ? [] : thresholdVennRows(ranked, t, specs[i]!.higherIsBetter);
  });
}
