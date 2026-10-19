// クラブレコード「クォーター別レコード」の先頭の行「試合全体」（設計書272章）。区間の行（shared/teamPeriodRecords.ts）と同じ項目の定義・同じ並べ方・同じ順位の付け方で、
// 値だけを試合の最終スコア（延長を含む）にする。試合ログだけを渡すので、結果だけの試合・不戦勝は入らない。前後半5分の特別な試合も入る。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { periodRecordKindDef, type PeriodRecordKind, type RankedPeriodGame } from "../../shared/teamPeriodRecords";
import type { TeamGameLog } from "../../shared/types";

export const WHOLE_GAME_KEY = "game" as const;
export const WHOLE_GAME_LABEL = "試合全体";

export function rankWholeGames<G extends TeamGameLog>(games: G[], kind: PeriodRecordKind): RankedPeriodGame<G>[] {
  const def = periodRecordKindDef(kind);
  const scored = games.map((game) => {
    const score = { pts: game.teamScore, oppPts: game.opponentScore, fromPbp: false };
    return { game, score, value: def.value(score) };
  });
  scored.sort((a, b) => (def.lowerFirst ? a.value - b.value : b.value - a.value) || a.game.date.localeCompare(b.game.date));
  let rank = 0;
  return scored.map((s, i) => {
    if (i === 0 || s.value !== scored[i - 1]!.value) rank = i + 1;
    return { ...s, rank };
  });
}
