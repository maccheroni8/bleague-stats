// 画面専用（図解「シュート% × 試投数」と「得点 × アシスト」）。値は全チームスタッツ・全選手スタッツと同じ列定義を使う。
import type { Category, Division, DivisionHistoryFile, TeamGameLog } from '../../shared/types';
import { filterByGameType, type SeasonGameTypeFilter } from '../../shared/gameType';
import { filterGameLogs, type SituationalRange } from './situational';
import { buildAdvancedColumns, buildTraditionalColumns, sumTeamGameLogs, type AllTeamsRow, type TeamPerspective } from './teamStatsColumns';
import { averageTotals } from './leagueAverage';
import type { SeasonDisplayMode } from './playerSeasonBoxscore';
import type { AxisBase } from './figureAxis';
import type { Column } from '../components/SortableTable';
import { playerColumnValue, type PlayerFigurePoint } from './figurePlayerPoints';

export const SHOOT_Y = ['fg', '2p', '3p', 'ft', 'efg', 'ts'] as const;
export const SHOOT_X = ['fga', '2pa', '3pa', 'fta'] as const;
export type ShootY = typeof SHOOT_Y[number];
export type ShootX = typeof SHOOT_X[number];
export const SHOOT_Y_LABELS: Record<ShootY, string> = { fg: 'FG%', '2p': '2P%', '3p': '3P%', ft: 'FT%', efg: 'eFG%', ts: 'TS%' };
export const SHOOT_X_LABELS: Record<ShootX, string> = { fga: 'FGA', '2pa': '2PA', '3pa': '3PA', fta: 'FTA' };
export const DEFAULT_SHOOT_Y: ShootY = '3p';
export const DEFAULT_SHOOT_X: ShootX = '3pa';
/** 全チームスタッツ・全選手スタッツの列のキー（チームの表と選手の表で同じ） */
export const SHOOT_Y_COLUMN: Record<ShootY, string> = { fg: 'fgpct', '2p': '2ppct', '3p': '3ppct', ft: 'ftpct', efg: 'efg', ts: 'ts' };
export const SHOOT_X_COLUMN: Record<ShootX, string> = { fga: 'fga', '2pa': '2pa', '3pa': '3pa', fta: 'fta' };

/** 縦軸の基本範囲（%）。チーム: 2016-17〜今季・両リーグ全チームの 1〜99%点が収まる範囲。選手: 出場率85%以上の選手の同じ範囲 */
export const SHOOT_Y_BASE: Record<'team' | 'player', Record<ShootY, AxisBase>> = {
  team: { fg: { lo: 38, hi: 52, step: 2 }, '2p': { lo: 42, hi: 62, step: 2 }, '3p': { lo: 26, hi: 40, step: 2 }, ft: { lo: 60, hi: 82, step: 2 }, efg: { lo: 42, hi: 58, step: 2 }, ts: { lo: 46, hi: 62, step: 2 } },
  player: { fg: { lo: 30, hi: 65, step: 5 }, '2p': { lo: 30, hi: 70, step: 5 }, '3p': { lo: 20, hi: 50, step: 5 }, ft: { lo: 40, hi: 100, step: 5 }, efg: { lo: 35, hi: 70, step: 5 }, ts: { lo: 40, hi: 70, step: 5 } },
};
/** 横軸の基本範囲（1試合平均の試投数）。合計に切り替えたときは、これを試合数倍にする（totalBase） */
export const SHOOT_X_BASE: Record<'team' | 'player', Record<ShootX, AxisBase>> = {
  team: { fga: { lo: 58, hi: 76, step: 2 }, '2pa': { lo: 28, hi: 54, step: 2 }, '3pa': { lo: 14, hi: 36, step: 2 }, fta: { lo: 10, hi: 26, step: 2 } },
  player: { fga: { lo: 0, hi: 20, step: 2 }, '2pa': { lo: 0, hi: 14, step: 2 }, '3pa': { lo: 0, hi: 8, step: 1 }, fta: { lo: 0, hi: 7, step: 1 } },
};
/** +/- の視点（自チームと相手の差）の基本範囲。率はパーセントポイントの差、試投数は数の差。0 を中心にした左右対称（2016-17〜今季・両リーグ全チームの 1〜99%点が収まる） */
export const SHOOT_DIFF_Y_BASE: Record<ShootY, AxisBase> = { fg: { lo: -8, hi: 8, step: 2 }, '2p': { lo: -12, hi: 12, step: 2 }, '3p': { lo: -10, hi: 10, step: 2 }, ft: { lo: -12, hi: 12, step: 2 }, efg: { lo: -10, hi: 10, step: 2 }, ts: { lo: -10, hi: 10, step: 2 } };
export const SHOOT_DIFF_X_BASE: Record<ShootX, AxisBase> = { fga: { lo: -12, hi: 12, step: 2 }, '2pa': { lo: -14, hi: 14, step: 2 }, '3pa': { lo: -12, hi: 12, step: 2 }, fta: { lo: -8, hi: 8, step: 2 } };
/** チームの基本範囲。opp は自チームと同じ範囲（相手の値も同じ範囲に収まる） */
export const shootTeamYBase = (y: ShootY, perspective: TeamPerspective) => perspective === 'diff' ? SHOOT_DIFF_Y_BASE[y] : SHOOT_Y_BASE.team[y];
export const shootTeamXBase = (x: ShootX, perspective: TeamPerspective) => perspective === 'diff' ? SHOOT_DIFF_X_BASE[x] : SHOOT_X_BASE.team[x];
/** 得点・アシストの下限スライダー（1試合平均。初期値0） */
export const PTS_AST_MIN = { pts: { max: 30, step: 0.5 }, ast: { max: 10, step: 0.5 } } as const;
export const PTS_AST_BASE = { pts: { lo: 0, hi: 30, step: 5 }, ast: { lo: 0, hi: 10, step: 1 } } as const satisfies Record<string, AxisBase>;

/** 選手の横軸（1試合平均の試投数）の下限。初期値は出場率85%以上の選手の下位4分の1あたり（極端な率の選手が並ばないように） */
export const SHOOT_MIN_ATTEMPTS: Record<ShootX, { default: number; max: number; step: number }> = {
  fga: { default: 4, max: 15, step: 0.5 },
  '2pa': { default: 2, max: 10, step: 0.5 },
  '3pa': { default: 1.5, max: 6, step: 0.5 },
  fta: { default: 1, max: 6, step: 0.5 },
};

export const isPercentAxis = (axis: string) => (SHOOT_Y as readonly string[]).includes(axis);

// ---- チーム ----

export interface ShootTeamPoint {
  teamId: string; teamName: string; division?: Division; games: number;
  row: AllTeamsRow;
  /** 縦軸（%。0〜100）と横軸 */
  y: Record<ShootY, number | null>; x: Record<ShootX, number | null>;
}
export interface ShootTeamQuery { season: string; category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter; mode: SeasonDisplayMode; perspective?: TeamPerspective }

const columnCache = new Map<string, Map<string, Column<AllTeamsRow>>>();
function columnMap(mode: SeasonDisplayMode, perspective: TeamPerspective) {
  const cacheKey = `${mode}:${perspective}`;
  let map = columnCache.get(cacheKey);
  if (!map) { map = new Map([...buildTraditionalColumns(mode, perspective), ...buildAdvancedColumns(mode, perspective)].map(c => [c.key, c])); columnCache.set(cacheKey, map); }
  return map;
}
/** 全チームスタッツの表と同じ書式の値（視点は自チーム／opp／+/-） */
export function teamColumnText(row: AllTeamsRow, key: string, mode: SeasonDisplayMode, perspective: TeamPerspective = 'own'): string {
  const column = columnMap(mode, perspective).get(key)!;
  return column.format ? column.format(row) : String(column.sortValue(row));
}
function teamValues(row: AllTeamsRow, mode: SeasonDisplayMode, perspective: TeamPerspective) {
  const columns = columnMap(mode, perspective);
  const read = (key: string) => { const v = Number(columns.get(key)!.sortValue(row)); return Number.isFinite(v) ? v : null; };
  const y = Object.fromEntries(SHOOT_Y.map(k => [k, read(SHOOT_Y_COLUMN[k])])) as Record<ShootY, number | null>;
  for (const k of SHOOT_Y) if (y[k] !== null) y[k] = y[k]! * 100;
  const x = Object.fromEntries(SHOOT_X.map(k => [k, read(SHOOT_X_COLUMN[k])])) as Record<ShootX, number | null>;
  return { y, x };
}
/** 全チームスタッツと同じ順序: 期間を選び、その後に試合区分を適用して合計する。 */
export function buildShootTeams(teams: readonly { teamId: string; teamName: string }[], logsByTeam: ReadonlyMap<string, TeamGameLog[]>, divisions: DivisionHistoryFile | null, q: ShootTeamQuery) {
  const points: ShootTeamPoint[] = [];
  for (const team of teams) {
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], { range: q.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, q.category);
    const scoped = filterByGameType(ranged, q.gameType);
    if (!scoped.length) continue;
    const row: AllTeamsRow = { team, gamesPlayed: scoped.length, wins: scoped.filter(g => g.win).length, losses: scoped.filter(g => !g.win).length, totals: sumTeamGameLogs(scoped) };
    points.push({ ...team, division: divisions?.[q.category]?.[q.season]?.[team.teamId], games: scoped.length, row, ...teamValues(row, q.mode, q.perspective ?? 'own') });
  }
  // リーグ平均: ORtg × DRtg の図と同じく、各チームの合計の平均（averageTotals）から同じ列の式で出す
  const leagueRow: AllTeamsRow | null = points.length ? {
    team: { teamId: 'league', teamName: 'リーグ平均' }, gamesPlayed: points.reduce((s, p) => s + p.games, 0) / points.length,
    wins: 0, losses: 0, totals: averageTotals(points.map(p => p.row.totals)),
  } : null;
  return { points, leagueRow, league: leagueRow ? teamValues(leagueRow, q.mode, q.perspective ?? 'own') : null };
}

// ---- 選手 ----

/** 縦軸の分母が0（試投が1本もない）なら率は出せない */
export function shootYDefined(p: Pick<PlayerFigurePoint, 'raw'>, y: ShootY): boolean {
  const r = p.raw;
  switch (y) {
    case 'fg': case 'efg': return r.fga > 0;
    case '2p': return r.fga - r.tpa > 0;
    case '3p': return r.tpa > 0;
    case 'ft': return r.fta > 0;
    case 'ts': return r.fga + 0.44 * r.fta > 0;
  }
}
export interface ShootPlayerPoint { p: PlayerFigurePoint; x: number; y: number; perGameX: number }
/** 試投数の下限は「1試合平均の試投数」で判定する（合計表示のときも同じ。シーズンの進み具合で変わらないように） */
export function shootPlayerPoints(points: readonly PlayerFigurePoint[], season: string, mode: SeasonDisplayMode, xAxis: ShootX, yAxis: ShootY, minPerGame: number): ShootPlayerPoint[] {
  const out: ShootPlayerPoint[] = [];
  for (const p of points) {
    const perGameX = playerColumnValue(p, SHOOT_X_COLUMN[xAxis], 'perGame', season);
    if (perGameX === null || perGameX < minPerGame - 1e-9) continue;
    if (!shootYDefined(p, yAxis)) continue;
    const x = playerColumnValue(p, SHOOT_X_COLUMN[xAxis], mode, season), y = playerColumnValue(p, SHOOT_Y_COLUMN[yAxis], mode, season);
    if (x === null || y === null) continue;
    out.push({ p, x, y: y * 100, perGameX });
  }
  return out;
}
export interface PtsAstPoint { p: PlayerFigurePoint; x: number; y: number }
/** 得点・アシストの下限も「1試合平均」で判定する（合計に切り替えても同じ選手が残る。初期値は0＝絞らない） */
export function ptsAstPoints(points: readonly PlayerFigurePoint[], season: string, mode: SeasonDisplayMode, minPts = 0, minAst = 0): PtsAstPoint[] {
  const out: PtsAstPoint[] = [];
  for (const p of points) {
    if (minPts > 0 || minAst > 0) {
      const pts = playerColumnValue(p, 'pts', 'perGame', season), ast = playerColumnValue(p, 'ast', 'perGame', season);
      if (pts === null || ast === null || pts < minPts - 1e-9 || ast < minAst - 1e-9) continue;
    }
    const ast = playerColumnValue(p, 'ast', mode, season), pts = playerColumnValue(p, 'pts', mode, season);
    if (ast !== null && pts !== null) out.push({ p, x: ast, y: pts });
  }
  return out;
}
export const meanOf = (values: readonly number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
