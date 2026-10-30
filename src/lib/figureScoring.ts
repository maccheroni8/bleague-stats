// 画面専用。日本人の得点 × 外国籍の得点の散布図。
// 試合の絞り方は ORtg・DRtg の図と同じ（期間を先に、その後に試合区分）。値は試合ログの区分別得点を合計して試合数で割る。
import type { Category, Division, DivisionHistoryFile, TeamGameLog } from "../../shared/types";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import { filterGameLogs, type SituationalRange } from "./situational";
import { perspectiveValue, type TeamPerspective } from "./teamStatsColumns";
import { splitClassificationSeason } from "./classificationFilter";

/** 縦軸: 外国籍のみ／外国籍・帰化・アジアの合計。合計は foreignPoints + naturalizedOrAsianPoints（internationalPoints と同じ） */
export type ScoringYMode = "foreign" | "intl";
export const SCORING_Y_LABELS: Record<ScoringYMode, string> = { foreign: "外国籍のみ", intl: "外国籍・帰化・アジア合計" };
/** 外国籍だけを分けて見られるのは 2026-27 以降。それより前は合計だけ（現在の登録情報による参考値） */
export const scoringYModes = (season: string): ScoringYMode[] => splitClassificationSeason(season) ? ["foreign", "intl"] : ["intl"];

export interface ScoringTeam { teamId: string; teamName: string }
/** 自チーム側と相手側の区分別得点の合計（対象試合の合計） */
interface SideSums { pts: number; japanese: number; foreign: number; intl: number }
export interface ScoringPoint extends ScoringTeam {
  division?: Division;
  games: number; firstDate: string; lastDate: string;
  own: SideSums; opp: SideSums;
}
export interface ScoringQuery { season: string; category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter }

const finite = (...values: unknown[]) => values.every(value => typeof value === "number" && Number.isFinite(value));
/** 区分別得点が揃っている試合だけ。欠けた値を 0 点として数えない（分母にも入れない）。 */
function hasPoints(g: TeamGameLog) {
  return finite(g.teamScore, g.opponentScore, g.japanesePoints, g.foreignPoints, g.naturalizedOrAsianPoints, g.opponentJapanesePoints, g.opponentForeignPoints, g.opponentNaturalizedOrAsianPoints);
}
const emptySums = (): SideSums => ({ pts: 0, japanese: 0, foreign: 0, intl: 0 });

export function buildScoringScatter(teams: readonly ScoringTeam[], logsByTeam: ReadonlyMap<string, TeamGameLog[]>, divisions: DivisionHistoryFile | null, query: ScoringQuery) {
  const points: ScoringPoint[] = [];
  const omitted: string[] = [];
  for (const team of teams) {
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], { range: query.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, query.category);
    const scoped = filterByGameType(ranged, query.gameType).filter(hasPoints);
    if (!scoped.length) { omitted.push(team.teamId); continue; }
    const own = emptySums(), opp = emptySums();
    for (const g of scoped) {
      own.pts += g.teamScore; own.japanese += g.japanesePoints; own.foreign += g.foreignPoints; own.intl += g.foreignPoints + g.naturalizedOrAsianPoints;
      opp.pts += g.opponentScore; opp.japanese += g.opponentJapanesePoints; opp.foreign += g.opponentForeignPoints; opp.intl += g.opponentForeignPoints + g.opponentNaturalizedOrAsianPoints;
    }
    points.push({ ...team, division: divisions?.[query.category]?.[query.season]?.[team.teamId], games: scoped.length, firstDate: scoped[0]!.date, lastDate: scoped.at(-1)!.date, own, opp });
  }
  return { points, omitted, league: leagueSums(points) };
}

/** リーグ平均は、チーム平均の平均ではなく、全チームの合計 ÷ 全チームの試合数 */
function leagueSums(points: readonly ScoringPoint[]): ScoringPoint | null {
  if (!points.length) return null;
  const own = emptySums(), opp = emptySums();
  for (const p of points) for (const key of ["pts", "japanese", "foreign", "intl"] as const) { own[key] += p.own[key]; opp[key] += p.opp[key]; }
  return { teamId: "league", teamName: "リーグ平均", games: points.reduce((sum, p) => sum + p.games, 0), firstDate: "", lastDate: "", own, opp };
}

/** 横軸に使う区分と、縦軸に使う区分 */
export const scoringAxisKey = (axis: "x" | "y", yMode: ScoringYMode): "japanese" | "foreign" | "intl" => axis === "x" ? "japanese" : yMode;

/** 1試合平均の得点。視点が差のときは「自チーム − 相手」 */
export function scoringPerGame(point: ScoringPoint, key: "japanese" | "foreign" | "intl", perspective: TeamPerspective) {
  return perspectiveValue(point.own[key] / point.games, point.opp[key] / point.games, perspective);
}
/** 総得点に占める割合（%）。視点が差のときは「自チームの割合 − 相手の割合」（ポイント）。総得点が 0 なら null */
export function scoringShare(point: ScoringPoint, key: "japanese" | "foreign" | "intl", perspective: TeamPerspective): number | null {
  if (!(point.own.pts > 0) || !(point.opp.pts > 0)) return null;
  return perspectiveValue(100 * point.own[key] / point.own.pts, 100 * point.opp[key] / point.opp.pts, perspective);
}

/** 線は5刻み（10の倍数は実線、それ以外は点線）。基本の範囲は全シーズン・両リーグ・視点・縦軸の区分で共通。選んだ条件の点が範囲の外に出るときだけ、その表示に限って5刻みで広げる（点を枠の外に捨てない）。 */
export const SCORING_GRID_STEP = 5;
/** 自チーム／相手の基本の範囲（縦横とも） */
export const SCORING_AXIS_MIN = 10, SCORING_AXIS_MAX = 60;
/** +/- の基本の範囲は 0 を中心に ±30 */
export const SCORING_DIFF_REACH = 30;

/** 横・縦とも同じ範囲（正方形）。渡す値は今の表示の横軸・縦軸の値（地区で絞る前の全チーム） */
export function scoringDomain(values: readonly number[], perspective: TeamPerspective) {
  const finiteValues = values.filter(Number.isFinite);
  const up = (value: number) => Math.ceil(value / SCORING_GRID_STEP - 1e-9) * SCORING_GRID_STEP;
  const down = (value: number) => Math.floor(value / SCORING_GRID_STEP + 1e-9) * SCORING_GRID_STEP;
  let min: number, max: number;
  if (perspective === "diff") {
    max = Math.max(SCORING_DIFF_REACH, up(Math.max(0, ...finiteValues.map(Math.abs)))); min = -max;
  } else {
    min = finiteValues.length ? Math.min(SCORING_AXIS_MIN, Math.max(0, down(Math.min(...finiteValues)))) : SCORING_AXIS_MIN;
    max = finiteValues.length ? Math.max(SCORING_AXIS_MAX, up(Math.max(...finiteValues))) : SCORING_AXIS_MAX;
  }
  return { min, max, step: SCORING_GRID_STEP, ticks: Array.from({ length: Math.round((max - min) / SCORING_GRID_STEP) + 1 }, (_, i) => min + i * SCORING_GRID_STEP) };
}

/** 10の倍数の線（実線）か。それ以外の5刻みの線は点線 */
export const isMajorTick = (tick: number) => tick % 10 === 0;

/** 数字のラベルの刻み。10刻みのまま重ならなければ10、重なるときだけ20（さらに重なるなら50） */
export function scoringLabelStep(plotWidth: number, domain: { min: number; max: number }, minGap = 26) {
  for (const step of [10, 20]) if (plotWidth / ((domain.max - domain.min) / step) >= minGap) return step;
  return 50;
}
