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

export interface BigRunMark {
  /** 1=ホーム、2=アウェイ */
  side: 1 | 2;
  points: number;
  fromSec: number;
  toSec: number;
}

/** 試合詳細の画像の2枚目と同じ「大きなラン」（各チームの最大のラン。点数が0なら無し） */
export function bigRunMarks(game: StoredGame): BigRunMark[] {
  const [homeRun, awayRun] = maxRuns(scoringSequence(game.raw.PlayByPlays).events);
  const out: BigRunMark[] = [];
  if (homeRun && homeRun.points > 0) out.push({ side: 1, points: homeRun.points, fromSec: homeRun.fromSec, toSec: homeRun.toSec });
  if (awayRun && awayRun.points > 0) out.push({ side: 2, points: awayRun.points, fromSec: awayRun.fromSec, toSec: awayRun.toSec });
  return out;
}
