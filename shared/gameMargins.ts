// 1試合の最大リード・最大ビハインド（DESIGN.md 150章）。プレーバイプレーの得点イベント（ActionCD1 = 1, 3, 4, 7, 44。
// src/lib/leadTracker.ts と同じ）の Score（その時点の両チームの累計「ホーム-アウェイ」）から、延長戦を含めて出す。
// 最後に公式の最終スコアも1点として加える（プレーバイプレーの得点が欠けている試合でも、最終スコアの点差は必ず反映する）。
// - 2016-17〜2019-20 は公式のクォーター別スコアに延長戦が無いが、プレーバイプレーには延長戦がそろっていて、最終スコアとも一致する
//   （延長戦の欠けはこの値に影響しない）
// - プレーバイプレーの最後のスコアが最終スコアと一致しない試合は 2021-22 の1試合（7652、ホームの2点が欠けている）だけ
// 得点イベントのスコアが1つも無い試合は null
import type { StoredGame } from "./types.ts";

const SCORING_ACTION_CODES = new Set([1, 3, 4, 7, 44]);

export interface GameMaxMargins {
  /** ホームが最も大きくリードした点差（一度もリードしなければ0）。＝アウェイの最大ビハインド */
  homeMaxLead: number;
  /** アウェイが最も大きくリードした点差（一度もリードしなければ0）。＝ホームの最大ビハインド */
  awayMaxLead: number;
}

export function gameMaxMargins(game: StoredGame): GameMaxMargins | null {
  let homeMaxLead = 0;
  let awayMaxLead = 0;
  let found = false;
  for (const ev of game.raw.PlayByPlays ?? []) {
    if (!SCORING_ACTION_CODES.has(ev.ActionCD1)) continue;
    const m = /^(\d+)-(\d+)$/.exec(ev.Score ?? "");
    if (!m) continue;
    found = true;
    const diff = Number(m[1]) - Number(m[2]);
    if (diff > homeMaxLead) homeMaxLead = diff;
    if (-diff > awayMaxLead) awayMaxLead = -diff;
  }
  if (!found) return null;
  const finalDiff = game.homeScore - game.awayScore;
  if (finalDiff > homeMaxLead) homeMaxLead = finalDiff;
  if (-finalDiff > awayMaxLead) awayMaxLead = -finalDiff;
  return { homeMaxLead, awayMaxLead };
}
