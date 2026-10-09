// 試合ログ・試合の要約の「延長の本数」「最終点差」を読む補助（DESIGN.md 219章）。
// この2項目を足す前に作ったデータ（ブラウザのキャッシュに残った古い版など）には項目が無いので、値が無いときは undefined（不明）を返す。
// 条件に使うときは、不明な試合はどの条件にも当てはまらないものとして扱う（試合中の最大点差〈matchesMargin〉と同じ）。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。

import type { GameSummary, PlayerGameLog, TeamGameLog } from "../../shared/types";

/** 延長の本数（延長なしは 0）。項目が無い古いデータは undefined */
export function gameOvertimes(g: Pick<GameSummary | PlayerGameLog | TeamGameLog, "overtimes">): number | undefined {
  return typeof g.overtimes === "number" ? g.overtimes : undefined;
}

/** 選手の試合ログの最終点差（所属チームから見て。勝てば正）。項目が無い古いデータは undefined */
export function playerFinalMargin(g: Pick<PlayerGameLog, "finalMargin">): number | undefined {
  return typeof g.finalMargin === "number" ? g.finalMargin : undefined;
}

/** チームの試合ログの最終点差（自チームから見て。勝てば正）。得点から出せるので古いデータでも値がある */
export function teamFinalMargin(g: Pick<TeamGameLog, "teamScore" | "opponentScore">): number {
  return g.teamScore - g.opponentScore;
}
