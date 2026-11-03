// 画面専用。勝率 × 登録区分別の得失点の散布図（横軸: 区分 ×（得点／失点／得失点差）の1試合平均）。
// 試合の絞り方は ORtg・DRtg／日本人・外国籍の得点の図と同じ（期間を先に、その後に試合区分。区分別得点が揃った試合だけ）。
// 得失点差＝自チームのその区分の得点 − 相手の同じ区分の得点（選手の +/- や出場中の得失点差ではない）。
import type { Category, Division, DivisionHistoryFile, TeamGameLog } from "../../shared/types";
import { filterByGameType, type SeasonGameTypeFilter } from "../../shared/gameType";
import { filterGameLogs, type SituationalRange } from "./situational";
import { hasPoints, scoringDomain } from "./figureScoring";

export type WinPctClass = "intl" | "japanese" | "foreign";
export type WinPctMetric = "pts" | "opp" | "diff";
export const WIN_PCT_CLASS_LABELS: Record<WinPctClass, string> = { intl: "外国籍・帰化・アジア", japanese: "日本人", foreign: "外国籍のみ" };
export const WIN_PCT_METRIC_LABELS: Record<WinPctMetric, string> = { pts: "得点", opp: "失点", diff: "得失点差" };
/** 傾向線の色（横軸の指標ごと）。ライト・ダークとも見分けがつく中間の濃さ */
export const WIN_PCT_METRIC_COLORS: Record<WinPctMetric, string> = { pts: "#2f6fdb", opp: "#e8791d", diff: "#2e9d4e" };

export interface WinPctTeam { teamId: string; teamName: string }
interface Side { japanese: number; foreign: number; intl: number }
export interface WinPctPoint extends WinPctTeam {
  division?: Division;
  games: number; wins: number; firstDate: string; lastDate: string;
  own: Side; opp: Side;
  /** 検証用: チーム全体の得点・失点の合計 */
  ownPts: number; oppPts: number;
}
export interface WinPctQuery { season: string; category: Category; range: SituationalRange; gameType: SeasonGameTypeFilter }

export function buildWinPctScatter(teams: readonly WinPctTeam[], logsByTeam: ReadonlyMap<string, TeamGameLog[]>, divisions: DivisionHistoryFile | null, query: WinPctQuery) {
  const points: WinPctPoint[] = [];
  const omitted: string[] = [];
  for (const team of teams) {
    const ranged = filterGameLogs(logsByTeam.get(team.teamId) ?? [], { range: query.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, query.category);
    const scoped = filterByGameType(ranged, query.gameType).filter(hasPoints);
    if (!scoped.length) { omitted.push(team.teamId); continue; }
    const own: Side = { japanese: 0, foreign: 0, intl: 0 }, opp: Side = { japanese: 0, foreign: 0, intl: 0 };
    let ownPts = 0, oppPts = 0, wins = 0;
    for (const g of scoped) {
      own.japanese += g.japanesePoints; own.foreign += g.foreignPoints; own.intl += g.foreignPoints + g.naturalizedOrAsianPoints!;
      opp.japanese += g.opponentJapanesePoints!; opp.foreign += g.opponentForeignPoints!; opp.intl += g.opponentForeignPoints! + g.opponentNaturalizedOrAsianPoints!;
      ownPts += g.teamScore; oppPts += g.opponentScore; if (g.win) wins++;
    }
    points.push({ ...team, division: divisions?.[query.category]?.[query.season]?.[team.teamId], games: scoped.length, wins, firstDate: scoped[0]!.date, lastDate: scoped.at(-1)!.date, own, opp, ownPts, oppPts });
  }
  return { points, omitted };
}

export const winPctRate = (p: Pick<WinPctPoint, "wins" | "games">) => p.wins / p.games;
/** 横軸の値（1試合平均） */
export function winPctX(p: WinPctPoint, cls: WinPctClass, metric: WinPctMetric) {
  const own = p.own[cls] / p.games, opp = p.opp[cls] / p.games;
  return metric === "pts" ? own : metric === "opp" ? opp : own - opp;
}

/** 表示しているチームの平均。チーム平均の平均ではなく、合計 ÷ 試合数（ほかの図と同じ） */
export function winPctAverages(points: readonly WinPctPoint[], cls: WinPctClass, metric: WinPctMetric) {
  const games = points.reduce((s, p) => s + p.games, 0);
  if (!games) return null;
  const sum = (pick: (p: WinPctPoint) => number) => points.reduce((s, p) => s + pick(p), 0) / games;
  const x = metric === "pts" ? sum(p => p.own[cls]) : metric === "opp" ? sum(p => p.opp[cls]) : sum(p => p.own[cls] - p.opp[cls]);
  return { x, winRate: sum(p => p.wins) };
}

/** 単回帰（y = intercept + slope·x）と Pearson の相関係数。2チーム未満、またはxが全部同じなら null、yが全部同じなら r は null */
export function linearFit(xs: readonly number[], ys: readonly number[]) {
  const n = xs.length;
  if (n < 2 || n !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  if (!(sxx > 0)) return null;
  const slope = sxy / sxx;
  return { n, slope, intercept: my - slope * mx, r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : null };
}

/** 得失点差の基本の範囲は 0 を中心に ±20（全シーズン・両リーグの実測は −17〜+20 程度）。得点・失点は既存の散布図と同じ 10〜60 */
export const WIN_PCT_DIFF_REACH = 20;
/** 横軸の範囲。基本の範囲に収まらない点があるときだけ、5刻みで広げる（点を枠の外に捨てない） */
export function winPctDomain(values: readonly number[], metric: WinPctMetric) {
  if (metric !== "diff") return scoringDomain(values, "own");
  const step = 5, reach = Math.max(WIN_PCT_DIFF_REACH, Math.ceil(Math.max(0, ...values.filter(Number.isFinite).map(Math.abs)) / step - 1e-9) * step);
  return { min: -reach, max: reach, step, ticks: Array.from({ length: (2 * reach) / step + 1 }, (_, i) => -reach + i * step) };
}
/** 縦軸（勝率 %）は 0〜100 で固定 */
export const WIN_PCT_Y_TICKS = Array.from({ length: 11 }, (_, i) => i * 10);
