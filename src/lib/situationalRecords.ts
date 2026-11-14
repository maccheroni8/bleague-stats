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

/**
 * 外国籍の人数の数え方（設計書392章）。
 * - foreignPlayed: その試合に出場した（出場時間が0秒より長い）外国籍選手の人数（帰化・アジア特別枠は含めない）
 * - intlPlayed: その試合に出場した外国籍・帰化・アジア特別枠の選手の合計人数
 * - longestOnCourt: その試合でいちばん長くコートにいた、外国籍・帰化・アジア特別枠の同時出場人数（foreignPlayerCount）
 * 区分は試合の日の登録区分。値の無い試合（古いデータ・ボックススコアの無い試合）はどの人数にも入らない
 */
export type ForeignMeasure = "foreignPlayed" | "intlPlayed" | "longestOnCourt";
export const FOREIGN_MEASURES: readonly ForeignMeasure[] = ["foreignPlayed", "intlPlayed", "longestOnCourt"];
/** 画面の名前（自チーム。相手は「相手の」を前に付ける） */
export const FOREIGN_MEASURE_LABELS: Record<ForeignMeasure, string> = {
  foreignPlayed: "外国籍の出場人数",
  intlPlayed: "外国籍・帰化・アジアの出場人数",
  longestOnCourt: "最長のオンザコート人数",
};
/** 「●人」の行・選択肢を出す人数の上限（外国籍は3人、外国籍・帰化・アジアと最長のオンザコートは 2026-27 の OC4 があるので4人） */
export const FOREIGN_MEASURE_MAX: Record<ForeignMeasure, number> = { foreignPlayed: 3, intlPlayed: 4, longestOnCourt: 4 };

type ForeignFields = "foreignPlayerCount" | "opponentForeignPlayerCount" | "foreignPlayedCount" | "intlPlayedCount" | "opponentForeignPlayedCount" | "opponentIntlPlayedCount";

/** 試合ログ（チーム・選手どちらも）の人数。side＝own（自チーム）／opp（相手） */
export function foreignMeasureValue(g: Partial<Pick<TeamGameLog, ForeignFields>>, measure: ForeignMeasure, side: "own" | "opp" = "own"): number | undefined {
  switch (measure) {
    case "foreignPlayed": return side === "own" ? g.foreignPlayedCount : g.opponentForeignPlayedCount;
    case "intlPlayed": return side === "own" ? g.intlPlayedCount : g.opponentIntlPlayedCount;
    case "longestOnCourt": return side === "own" ? g.foreignPlayerCount : g.opponentForeignPlayerCount;
  }
}

/** 外国籍の人数（measure の数え方。省略時は最長のオンザコート人数）が、ちょうど／以下／以上 */
export function matchesForeignCount(
  g: Partial<Pick<TeamGameLog, ForeignFields>>,
  mode: CountMode,
  n: number,
  measure: ForeignMeasure = "longestOnCourt",
  side: "own" | "opp" = "own",
): boolean {
  const c = foreignMeasureValue(g, measure, side);
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

const FOREIGN_GROUP_KEYS: Record<"own" | "opp", Record<ForeignMeasure, string>> = {
  // 最長のオンザコート人数のキーは 392章より前と同じ（foreignPlayerCount・opponentForeignPlayerCount）
  own: { foreignPlayed: "foreignPlayedCount", intlPlayed: "intlPlayedCount", longestOnCourt: "foreignPlayerCount" },
  opp: { foreignPlayed: "opponentForeignPlayedCount", intlPlayed: "opponentIntlPlayedCount", longestOnCourt: "opponentForeignPlayerCount" },
};

/**
 * チーム詳細（シチュエーション別勝敗・シチュエーション別成績）・個人詳細（シチュエーション別成績）の外国籍の人数の行（3つの数え方×自チーム／相手）。
 * 行は「0人」〜上限（FOREIGN_MEASURE_MAX）。判定は条件別順位表と同じ matchesForeignCount
 */
export function foreignSituationalGroups<G extends Partial<Pick<TeamGameLog, ForeignFields>>>(
  sides: readonly ("own" | "opp")[],
): { key: string; label: string; rows: { key: string; label: string; predicate: (g: G) => boolean }[] }[] {
  return sides.flatMap((side) =>
    FOREIGN_MEASURES.map((measure) => ({
      key: FOREIGN_GROUP_KEYS[side][measure],
      label: `${side === "opp" ? "相手の" : ""}${FOREIGN_MEASURE_LABELS[measure]}`,
      rows: Array.from({ length: FOREIGN_MEASURE_MAX[measure] + 1 }, (_, n) => ({
        key: `${side}${n}`,
        label: `${n}人`,
        predicate: (g: G) => matchesForeignCount(g, "eq", n, measure, side),
      })),
    })),
  );
}
