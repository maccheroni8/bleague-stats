// 画面専用（図解「散布図（チーム）」）。縦軸・横軸それぞれで「項目」と「視点」を選ぶ。
// 項目は全チームスタッツの列（Traditional・Advanced・Misc・Scoring・Shooting・Forced TOV）。値・書式は全チームスタッツの表と同じ列の定義をそのまま使う。
import type { Category, Division, DivisionHistoryFile, TeamForcedTurnovers, TeamGameLog, TeamSummary } from '../../shared/types';
import { filterByGameType, type SeasonGameTypeFilter } from '../../shared/gameType';
import { filterGameLogs, type SituationalRange } from './situational';
import {
  buildAdvancedColumns, buildMiscColumns, buildScoringColumns, buildTraditionalColumns, sumTeamGameLogs, type AllTeamsRow, type TeamPerspective,
} from './teamStatsColumns';
import { foulColumnsSplit } from './ruleChange';
import { averageTotals } from './leagueAverage';
import { CATEGORY_LABELS, type BoxCategoryKey } from './categoryLabels';
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeDiffColumns, shotTypeEntityColumns } from './shotTypeBreakdown';
import { FORCED_TURNOVER_ITEMS } from './teamSeasonRanking';
import { scopedTurnovers } from './teamTurnoverScoped';
import { formatDecimal, formatSigned, formatWinPct } from './format';
import type { SeasonDisplayMode } from './playerSeasonBoxscore';
import type { Column } from '../components/SortableTable';
import { niceStep, type AxisDomain } from './figureAxis';

export type FreeCategory = BoxCategoryKey | 'shooting' | 'forcedTurnovers' | 'winpct';
export const FREE_CATEGORIES: readonly { key: FreeCategory; label: string }[] = [
  { key: 'traditional', label: CATEGORY_LABELS.traditional },
  { key: 'advanced', label: CATEGORY_LABELS.advanced },
  { key: 'misc', label: CATEGORY_LABELS.misc },
  { key: 'scoring', label: CATEGORY_LABELS.scoring },
  { key: 'shooting', label: CATEGORY_LABELS.shooting },
  { key: 'forcedTurnovers', label: CATEGORY_LABELS.forcedTurnovers },
];
export type FreeMode = 'perGame' | 'total';

/** 1チーム分の行。箱型の列は row、Shooting は summary（teams.json のシーズン通算）、Forced TOV は tov を使う */
export interface FreeRow {
  teamId: string; teamName: string; division?: Division;
  /** 平均の分母（条件に当てはまる試合数） */
  games: number;
  row: AllTeamsRow;
  summary?: TeamSummary;
  /** Shooting の平均の分母（スポーツナビの記録がある試合数。無ければ試合数） */
  shotGames: number;
  tov?: { forced: TeamForcedTurnovers; committed: TeamForcedTurnovers };
}

export interface FreeItem { id: string; category: FreeCategory; categoryLabel: string; key: string; label: string }
export const freeItemId = (category: FreeCategory, key: string) => `${category}.${key}`;
/** 勝率の軸（条件なしの勝率・条件付きの勝率）。値は条件別順位表と同じ部品で数える（figureCondWinPct.ts）ので、箱型の列には入れない */
export const WINPCT_CATEGORY_LABEL = '勝率';
export const WINPCT_ITEM_ID = freeItemId('winpct', 'rate');
export const WINPCT_COND_ITEM_ID = freeItemId('winpct', 'cond');
export const isWinPctItem = (item: Pick<FreeItem, 'category'>) => item.category === 'winpct';
export const DEFAULT_FREE_X = freeItemId('traditional', '3pa');
export const DEFAULT_FREE_Y = freeItemId('traditional', '3ppct');

/** 軸の列。R は行の型（チームは FreeRow、選手の散布図は選手の点）。axis を渡すと、表の書式からの単位の推定をせずにそれを使う */
export interface FreeColumn<R = FreeRow> { key: string; label: string; value: (r: R) => number | null; text: (r: R) => string; axis?: FreeAxisKind;
  /** 吹き出し・表に出す詳しい文字（条件付きの勝率の「.800（4勝1敗）」など。無ければ text） */
  detail?: (r: R) => string }

const finiteOrNull = (v: unknown, text: string) => {
  const n = Number(v);
  return text.trim() === '-' || !Number.isFinite(n) ? null : n;
};
function wrap(column: Column<FreeRow>): FreeColumn {
  const text = (r: FreeRow) => (column.format ? column.format(r) : String(column.sortValue(r)));
  return { key: column.key, label: column.label, text, value: r => finiteOrNull(column.sortValue(r), text(r)) };
}
function boxColumns(category: BoxCategoryKey, perspective: TeamPerspective, mode: FreeMode, foulSplit: boolean): Column<AllTeamsRow>[] {
  switch (category) {
    case 'traditional': return buildTraditionalColumns(mode, perspective);
    case 'advanced': return buildAdvancedColumns(mode, perspective);
    case 'misc': return buildMiscColumns(mode, perspective, true, foulSplit);
    case 'scoring': return buildScoringColumns(mode, perspective, true, true);
  }
}

/** Forced TOV の視点ごとの値（全チームスタッツと同じ。自チーム＝奪った分、opp＝記録した分、+/-＝奪った分−記録した分） */
export function turnoverDataFor(forced: TeamForcedTurnovers | undefined, committed: TeamForcedTurnovers | undefined, perspective: TeamPerspective): TeamForcedTurnovers | undefined {
  if (perspective === 'own') return forced;
  if (perspective === 'opp') return committed;
  if (!forced || !committed) return undefined;
  return {
    gamesWithData: forced.gamesWithData, offensiveFoul: forced.offensiveFoul - committed.offensiveFoul, violation24sec: forced.violation24sec - committed.violation24sec,
    backcourtViolation: forced.backcourtViolation - committed.backcourtViolation, violation5sec: forced.violation5sec - committed.violation5sec,
    violation8sec: forced.violation8sec - committed.violation8sec, otherDead: forced.otherDead - committed.otherDead, live: forced.live - committed.live,
  };
}

const columnCache = new Map<string, FreeColumn[]>();
/** その分類・視点・平均／合計の列の一覧（全チームスタッツと同じ式） */
export function freeColumns(category: FreeCategory, perspective: TeamPerspective, mode: FreeMode, season: string): FreeColumn[] {
  if (category === 'winpct') return [];
  const foulSplit = foulColumnsSplit([season]);
  const cacheKey = `${category}:${perspective}:${mode}:${foulSplit}`;
  const cached = columnCache.get(cacheKey);
  if (cached) return cached;
  let out: FreeColumn[];
  if (category === 'shooting') {
    const get = (r: FreeRow, opp: boolean) => (opp ? r.summary?.opponentShotTypes : r.summary?.shotTypes);
    const games = (r: FreeRow) => r.shotGames;
    const columns = perspective === 'diff'
      ? shotTypeDiffColumns<FreeRow>([...SHOT_TYPE_DISPLAY_ORDER], r => get(r, false), r => get(r, true), mode, games)
      : shotTypeEntityColumns<FreeRow>([...SHOT_TYPE_DISPLAY_ORDER], r => get(r, perspective === 'opp'), mode, games);
    out = columns.map(wrap);
  } else if (category === 'forcedTurnovers') {
    out = FORCED_TURNOVER_ITEMS.map(item => {
      const read = (r: FreeRow) => {
        const data = turnoverDataFor(r.tov?.forced, r.tov?.committed, perspective);
        return data ? (mode === 'total' ? item.value(data) : r.games > 0 ? item.value(data) / r.games : 0) : null;
      };
      const text = (r: FreeRow) => {
        const v = read(r);
        if (v === null) return '-';
        const digits = mode === 'total' ? 0 : 2;
        return perspective === 'diff' ? formatSigned(v, digits) : formatDecimal(v, digits);
      };
      return { key: item.key, label: item.label, value: read, text };
    });
  } else {
    // paint2games は「対象試合数（60/60）」で、数値の項目ではない（ランキングでも外している）
    out = boxColumns(category, perspective, mode, foulSplit).filter(c => c.key !== 'paint2games').map(c => wrap({ key: c.key, label: c.label, sortValue: r => c.sortValue(r.row), format: c.format ? (r => c.format!(r.row)) : undefined }));
  }
  columnCache.set(cacheKey, out);
  return out;
}

const itemCache = new Map<string, FreeItem[]>();
export function freeItems(season: string): FreeItem[] {
  const cacheKey = foulColumnsSplit([season]) ? 'new' : 'old';
  let items = itemCache.get(cacheKey);
  if (!items) {
    const winpct: FreeItem[] = [
      { id: WINPCT_ITEM_ID, category: 'winpct', categoryLabel: WINPCT_CATEGORY_LABEL, key: 'rate', label: '勝率' },
      { id: WINPCT_COND_ITEM_ID, category: 'winpct', categoryLabel: WINPCT_CATEGORY_LABEL, key: 'cond', label: '条件付きの勝率' },
    ];
    items = [...winpct, ...FREE_CATEGORIES.flatMap(cat => freeColumns(cat.key, 'own', 'perGame', season).map(c => ({ id: freeItemId(cat.key, c.key), category: cat.key, categoryLabel: cat.label, key: c.key, label: c.label })))];
    itemCache.set(cacheKey, items);
  }
  return items;
}
export function freeColumn(item: FreeItem, perspective: TeamPerspective, mode: FreeMode, season: string): FreeColumn | undefined {
  if (item.category === 'winpct') return undefined;
  return freeColumns(item.category, perspective, mode, season).find(c => c.key === item.key);
}
/** 軸の名前（opp の視点は「opp ORtg」、+/- は「ORtg +/-」。Forced TOV は「Forced TOV 合計」のように分類名を付ける） */
export function freeItemName(item: FreeItem, perspective: TeamPerspective): string {
  const base = item.category === 'forcedTurnovers' ? `${CATEGORY_LABELS.forcedTurnovers} ${item.label}` : item.label;
  return perspective === 'opp' ? `opp ${base}` : perspective === 'diff' ? `${base} +/-` : base;
}
/** 選べる項目か（URL の値が古い・読めないときは初期の項目にする） */
export function resolveFreeItem(id: string | undefined, season: string, fallback: string): FreeItem {
  const items = freeItems(season);
  return items.find(i => i.id === id) ?? items.find(i => i.id === fallback)!;
}

/** 分類ごとの選べない理由（B.ONE・データの無いシーズン）。選べる分類は undefined */
export function freeCategoryBlock(category: FreeCategory, teams: readonly TeamSummary[] | null, league: Category, reasons: { shooting: string; forcedTurnovers: string; none: string }): string | undefined {
  if (category !== 'shooting' && category !== 'forcedTurnovers') return undefined;
  if (league === 'one') return reasons[category];
  if (!teams) return undefined;
  const has = category === 'shooting' ? teams.some(t => t.shotTypes) : teams.some(t => t.forcedTurnovers && t.turnoversCommitted);
  return has ? undefined : reasons.none;
}

// ---- 行の組み立て ----

export interface FreeQuery {
  season: string; category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter;
  /** Shooting を使うとき: 期間・試合種別は効かず、レギュラーシーズン全体の値（全チームスタッツの Shooting と同じ） */
  seasonTotals: boolean;
}
const ZERO_TOV: TeamForcedTurnovers = { gamesWithData: 0, offensiveFoul: 0, violation24sec: 0, backcourtViolation: 0, violation5sec: 0, violation8sec: 0, otherDead: 0, live: 0 };
const TOV_KEYS = Object.keys(ZERO_TOV) as (keyof TeamForcedTurnovers)[];
const addTov = (a: TeamForcedTurnovers, b: TeamForcedTurnovers) => Object.fromEntries(TOV_KEYS.map(k => [k, a[k] + b[k]])) as unknown as TeamForcedTurnovers;
const scaleTov = (a: TeamForcedTurnovers, f: number) => Object.fromEntries(TOV_KEYS.map(k => [k, a[k] * f])) as unknown as TeamForcedTurnovers;

type Breakdown = NonNullable<TeamSummary['shotTypes']>;
function averageBreakdown(list: readonly (Breakdown | undefined)[]): Breakdown | undefined {
  const present = list.filter((b): b is Breakdown => !!b);
  if (!present.length) return undefined;
  const out: Breakdown = {};
  for (const b of present) for (const [key, split] of Object.entries(b)) {
    const cur = out[key] ?? { twoPoint: { made: 0, attempted: 0 }, threePoint: { made: 0, attempted: 0 } };
    cur.twoPoint = { made: cur.twoPoint.made + (split.twoPoint?.made ?? 0), attempted: cur.twoPoint.attempted + (split.twoPoint?.attempted ?? 0) };
    cur.threePoint = { made: cur.threePoint.made + (split.threePoint?.made ?? 0), attempted: cur.threePoint.attempted + (split.threePoint?.attempted ?? 0) };
    out[key] = cur;
  }
  for (const split of Object.values(out)) {
    split.twoPoint = { made: split.twoPoint.made / present.length, attempted: split.twoPoint.attempted / present.length };
    split.threePoint = { made: split.threePoint.made / present.length, attempted: split.threePoint.attempted / present.length };
  }
  return out;
}

/** 全チームスタッツと同じ順序: 期間を選び、その後に試合区分を適用して合計する。リーグ平均は各チームの合計の平均（ORtg × DRtg の図と同じ作り） */
export function buildFreeRows(teams: readonly TeamSummary[], logsByTeam: ReadonlyMap<string, TeamGameLog[]>, divisions: DivisionHistoryFile | null, q: FreeQuery) {
  const range: SituationalRange = q.seasonTotals ? { kind: 'all' } : q.range;
  const gameType: SeasonGameTypeFilter = q.seasonTotals ? 'regular' : q.gameType;
  const scopedByTeam = new Map<string, TeamGameLog[]>();
  for (const team of teams) {
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], { range, includePlayoffs: true }, undefined, undefined, undefined, undefined, q.category);
    scopedByTeam.set(team.teamId, filterByGameType(ranged, gameType));
  }
  const scopedTov = scopedTurnovers(scopedByTeam);
  const rows: FreeRow[] = [];
  for (const team of teams) {
    const scoped = scopedByTeam.get(team.teamId) ?? [];
    if (!scoped.length) continue;
    const tov = scopedTov
      ? (() => { const r = scopedTov.teams.get(team.teamId); return r ? { forced: r.forced, committed: r.committed } : undefined; })()
      : team.forcedTurnovers && team.turnoversCommitted ? { forced: team.forcedTurnovers, committed: team.turnoversCommitted } : undefined;
    rows.push({
      teamId: team.teamId, teamName: team.teamName, division: divisions?.[q.category]?.[q.season]?.[team.teamId], games: scoped.length,
      row: { team, gamesPlayed: scoped.length, wins: scoped.filter(g => g.win).length, losses: scoped.filter(g => !g.win).length, totals: sumTeamGameLogs(scoped) },
      summary: team.shotTypes ? team : undefined, shotGames: team.shotTypeGames ?? team.gamesPlayed, tov,
    });
  }
  if (!rows.length) return { rows, league: null as FreeRow | null };
  const withTov = rows.filter(r => r.tov);
  const withShots = rows.filter(r => r.summary);
  const sumOf = (pick: (t: NonNullable<FreeRow['tov']>) => TeamForcedTurnovers) => withTov.reduce((s, r) => addTov(s, pick(r.tov!)), ZERO_TOV);
  const league: FreeRow = {
    teamId: 'league', teamName: 'リーグ平均', games: rows.reduce((s, r) => s + r.games, 0) / rows.length,
    row: { team: { teamId: 'league', teamName: 'リーグ平均' }, gamesPlayed: rows.reduce((s, r) => s + r.games, 0) / rows.length, wins: 0, losses: 0, totals: averageTotals(rows.map(r => r.row.totals)) },
    summary: withShots.length ? { shotTypes: averageBreakdown(withShots.map(r => r.summary!.shotTypes)), opponentShotTypes: averageBreakdown(withShots.map(r => r.summary!.opponentShotTypes)) } as unknown as TeamSummary : undefined,
    shotGames: withShots.length ? withShots.reduce((s, r) => s + r.shotGames, 0) / withShots.length : 0,
    tov: withTov.length ? { forced: scaleTov(sumOf(t => t.forced), 1 / withTov.length), committed: scaleTov(sumOf(t => t.committed), 1 / withTov.length) } : undefined,
  };
  return { rows, league };
}

// ---- 軸（目盛りと単位を項目に合わせて整える） ----

export type FreeUnit = 'percent' | 'time' | 'number' | 'rate';
export interface FreeAxisKind {
  unit: FreeUnit;
  /** 表示の値 = 列の値 × scale（率が 0〜1 の列は 100、時間は秒にするため 60） */
  scale: number;
  /** 目盛りに先頭の「+」を付ける（+/- の視点・符号付きの列） */
  signed: boolean;
  /** 値の小数の桁数（表の書式から） */
  digits: number;
}
const TIME_RE = /^[+-]?[\d,]+:\d{2}$/;
const num = (text: string) => Number(text.replace(/[,%+]/g, ''));
/** 表の書式（%・m:ss・小数の桁数・符号）から単位を決める */
export function inferFreeAxis<R = FreeRow>(column: FreeColumn<R>, rows: readonly R[]): FreeAxisKind {
  if (column.axis) return column.axis;
  const texts = rows.map(r => ({ r, t: column.text(r).trim() })).filter(x => x.t !== '-' && x.t !== '');
  if (!texts.length) return { unit: 'number', scale: 1, signed: false, digits: 2 };
  const signed = texts.some(x => x.t.startsWith('+'));
  const digits = Math.max(0, ...texts.map(x => /\.(\d+)/.exec(x.t)?.[1]?.length ?? 0));
  if (texts.some(x => x.t.endsWith('%'))) {
    // 0〜1 の率か 0〜100 の率かは、表の文字と値の比で決める
    const sample = texts.find(x => { const v = column.value(x.r); return v !== null && Math.abs(v) > 1e-6 && Number.isFinite(num(x.t)); });
    const ratio = sample ? Math.abs(num(sample.t)) / Math.abs(column.value(sample.r)!) : 1;
    return { unit: 'percent', scale: ratio > 10 ? 100 : 1, signed, digits };
  }
  if (texts.some(x => TIME_RE.test(x.t))) return { unit: 'time', scale: 60, signed, digits: 0 };
  return { unit: 'number', scale: 1, signed, digits };
}

const TIME_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 3600];
const round6 = (v: number) => Number(v.toFixed(6));
/** 点・平均線が収まる範囲を、きりのよい目盛りで作る（率は 0〜100、個数・時間は 0 を下回らない範囲に収める。0 をまたぐ視点は 0 を含める） */
export function freeAxisDomain(values: readonly (number | null | undefined)[], kind: FreeAxisKind, includeZero: boolean): AxisDomain {
  const valid = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  if (includeZero) valid.push(0);
  if (!valid.length) valid.push(0, 1);
  let lo = Math.min(...valid), hi = Math.max(...valid);
  if (hi - lo < 1e-9) { const pad = Math.max(Math.abs(hi) * 0.05, kind.unit === 'time' ? 5 : 1); lo -= pad; hi += pad; }
  const span = hi - lo;
  const step = kind.unit === 'time' ? TIME_STEPS.find(s => s >= span / 6) ?? 3600 : niceStep(span, 6);
  const nonNegative = Math.min(...valid) >= 0;
  let min = Math.floor((lo - span * 0.06) / step + 1e-9) * step, max = Math.ceil((hi + span * 0.06) / step - 1e-9) * step;
  if (nonNegative && min < 0) min = 0;
  if (kind.unit === 'rate') { min = Math.max(0, min); max = Math.min(1, max); }
  if (kind.unit === 'percent') { if (nonNegative && max > 100) max = Math.max(100, Math.ceil(hi / step - 1e-9) * step); }
  return { min: round6(min), max: round6(max), step, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => round6(min + i * step)) };
}
const decimalsOf = (step: number) => (String(round6(step)).split('.')[1] ?? '').length;
/** 目盛りの文字（% ・ m:ss ・ 個数。+/- は先頭に + を付ける） */
export function freeTickText(v: number, kind: FreeAxisKind, domain: AxisDomain): string {
  if (kind.unit === 'time') {
    const total = Math.round(Math.abs(v));
    const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
    return v < 0 ? `-${text}` : kind.signed && v > 0 ? `+${text}` : text;
  }
  if (kind.unit === 'rate') return formatWinPct(v);
  const digits = decimalsOf(domain.step);
  const body = formatDecimal(v, digits);
  return `${kind.signed && v > 0 ? '+' : ''}${body}${kind.unit === 'percent' ? '%' : ''}`;
}
