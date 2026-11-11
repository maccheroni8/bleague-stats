// 試合詳細のキースタッツ「試合の流れ」: 両チームの最大リード・最大ラン（DESIGN.md 364章）。
// プレーバイプレーの得点から数える（試合ログ・索引の保存済みの値と同じ数え方。shared/gameMargins.ts・shared/gameFlow.ts を読むだけ）。
// このファイルを保存キーの対象のファイルから import しないこと。
import { maxRuns, scoringSequence } from "../../shared/gameFlow";
import { gameMaxMargins } from "../../shared/gameMargins";
import type { StoredGame } from "../../shared/types";

export interface GameFlowPair {
  homeLead: number;
  awayLead: number;
  homeRun: number;
  awayRun: number;
}

/** 記録が無い手入力の試合（プレーバイプレーの得点が無い）は null */
export function gameFlowFor(game: StoredGame): GameFlowPair | null {
  const margins = gameMaxMargins(game);
  if (!margins) return null;
  const [homeRun, awayRun] = maxRuns(scoringSequence(game.raw.PlayByPlays).events);
  return { homeLead: margins.homeMaxLead, awayLead: margins.awayMaxLead, homeRun: homeRun?.points ?? 0, awayRun: awayRun?.points ?? 0 };
}
