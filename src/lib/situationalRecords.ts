// 「シチュエーション別勝敗」（チーム詳細）と「条件別順位表」（順位表）で共通に使う、試合の当てはまり方の判定（設計書387章）。
// 2つの画面が同じ関数を通るので、同じ条件は同じ試合を数える。画面だけの部品（保存キーの対象外）。
import type { TeamGameLog } from "../../shared/types";

export type Lead = "lead" | "tie" | "behind";

/** 自チームと相手の得点から、リード／同点／ビハインド */
export function leadStatus(own: number, opp: number): Lead {
  if (own > opp) return "lead";
  if (own < opp) return "behind";
  return "tie";
}

/** 試合ログの 1Q〜4Q の得点（periodPoints）から、第 throughQuarter 終了時点の状況。得点がそろっていない試合は undefined */
export function leadStatusFromLog(g: Pick<TeamGameLog, "periodPoints" | "opponentPeriodPoints">, throughQuarter: number): Lead | undefined {
  const own = g.periodPoints;
  const opp = g.opponentPeriodPoints;
  if (!own || !opp) return undefined;
  let o = 0;
  let p = 0;
  for (let q = 0; q < throughQuarter; q++) {
    const a = own[q];
    const b = opp[q];
    if (a == null || b == null) return undefined;
    o += a;
    p += b;
  }
  return leadStatus(o, p);
}

/** 延長の有無（試合ログから）。延長の本数が無い古いデータは undefined */
export function hasOvertimeLog(g: Pick<TeamGameLog, "overtimes">): boolean | undefined {
  return g.overtimes == null ? undefined : g.overtimes > 0;
}

export type CountMode = "eq" | "le" | "ge";

/** 自チームの外国籍人数（試合ごとの同時出場人数 foreignPlayerCount）が、ちょうど／以下／以上 */
export function matchesForeignCount(g: Pick<TeamGameLog, "foreignPlayerCount">, mode: CountMode, n: number): boolean {
  const c = g.foreignPlayerCount;
  if (c == null) return false;
  return mode === "eq" ? c === n : mode === "le" ? c <= n : c >= n;
}

/** 得点（own）または失点（opp）が、n 点以下／以上 */
export function matchesTeamScore(g: Pick<TeamGameLog, "teamScore" | "opponentScore">, side: "own" | "opp", mode: "le" | "ge", n: number): boolean {
  const v = side === "own" ? g.teamScore : g.opponentScore;
  return mode === "le" ? v <= n : v >= n;
}

/** お互い80点以上（ge）／お互い80点未満（lt） */
export function matchesBothScores(g: Pick<TeamGameLog, "teamScore" | "opponentScore">, mode: "ge" | "lt", n = 80): boolean {
  return mode === "ge" ? g.teamScore >= n && g.opponentScore >= n : g.teamScore < n && g.opponentScore < n;
}

/** 100点ゲーム（どちらかが100点以上） */
export function isCenturyGame(g: Pick<TeamGameLog, "teamScore" | "opponentScore">): boolean {
  return g.teamScore >= 100 || g.opponentScore >= 100;
}

/** 最終点差が n 点以上 */
export function marginAtLeast(g: Pick<TeamGameLog, "teamScore" | "opponentScore">, n: number): boolean {
  return Math.abs(g.teamScore - g.opponentScore) >= n;
}

export const LEAD_LABELS: Record<Lead, string> = { lead: "リード", tie: "同点", behind: "ビハインド" };
