// PITP（Points in the Paint）/FBPS（Fastbreak Points）/2ND PTS（Second Chance Points）を
// 選手単位で算出する。
//
// 個人単位のBoxscoreRow.PT2IN/PTFB/PT2NDフィールドは「得点」ではなく「該当カテゴリの
// シュート成功本数」であり、チーム単位のSummaries公式フィールド（得点）とスケールが
// 食い違っていた（PITPは常に2倍、FBPS/2ND PTSは3P・FTが混在するため1.0〜2.8倍でばらつく。
// DESIGN.md参照）。
//
// shared/pointsOffTurnovers.ts（PTSOFFTO）と同じ調査手法で、得点イベントのPlayTextに
// 公式の判定タグが埋め込まれていることを確認した:
//   - PITP: 2P成功イベント（ActionCD1∈{3,4}）のシュート種別表記に、コート位置に応じて
//     必ず"インサイドペイント"/"アウトサイドペイント"のいずれかが付与される
//     （例: "#9 エル ダーウィッチ 2Pシュートインサイドペイント○  ダンク  ファストブレイク (10点)"）
//   - FBPS: 得点イベント（ActionCD1∈{1,3,4,7}）のPlayTextに"ファストブレイク"タグが付与される
//   - 2ND PTS: 同上、"セカンドチャンス"タグ
// このタグを持つ得点イベントの得点を選手単位で合算するだけで、公式Summariesの値と完全に
// 一致することを確認済み（全10シーズン・B.ONE込み6,669試合・13,338チーム×試合で3項目とも
// 100%一致、不一致0件。PTSOFFTOと異なり2016-17シーズンでもタグが存在し機能する。詳細はDESIGN.md参照）。

import type { PlayByPlayEvent } from "./types.ts";
import { pointsForMadeShot } from "./pointsOffTurnovers.ts";

const PAINT_TAG = "インサイドペイント";
const FASTBREAK_TAG = "ファストブレイク";
const SECOND_CHANCE_TAG = "セカンドチャンス";

// PITPは2P成功イベントのみが対象（コート位置による分類のため3P/FTには付与されない）
const MADE_2P_CODES = new Set([3, 4]);
// FBPS/2ND PTSは3P/2P/FTいずれの得点にも付与されうる
const MADE_SHOT_CODES = new Set([1, 3, 4, 7]);

export interface PlayTypePointsResult {
  /** playerId -> 該当プレータイプでの得点（試合単位。callerがシーズン集計等にまとめる） */
  byPlayer: Map<string, number>;
  /** teamId -> 該当プレータイプでの得点。公式Summariesの対応フィールドと一致する */
  byTeam: Map<string, number>;
}

function computeTaggedPoints(playByPlays: PlayByPlayEvent[], tag: string, allowedActionCodes: Set<number>): PlayTypePointsResult {
  const byPlayer = new Map<string, number>();
  const byTeam = new Map<string, number>();

  for (const event of playByPlays) {
    if (!allowedActionCodes.has(event.ActionCD1)) continue;
    if (!event.PlayText?.includes(tag)) continue;
    const points = pointsForMadeShot(event.ActionCD1);
    if (points <= 0 || !event.TeamID) continue;

    byTeam.set(event.TeamID, (byTeam.get(event.TeamID) ?? 0) + points);
    if (event.PlayerID1) {
      byPlayer.set(event.PlayerID1, (byPlayer.get(event.PlayerID1) ?? 0) + points);
    }
  }

  return { byPlayer, byTeam };
}

export function computePointsInPaint(playByPlays: PlayByPlayEvent[]): PlayTypePointsResult {
  return computeTaggedPoints(playByPlays, PAINT_TAG, MADE_2P_CODES);
}

export function computeFastbreakPoints(playByPlays: PlayByPlayEvent[]): PlayTypePointsResult {
  return computeTaggedPoints(playByPlays, FASTBREAK_TAG, MADE_SHOT_CODES);
}

export function computeSecondChancePoints(playByPlays: PlayByPlayEvent[]): PlayTypePointsResult {
  return computeTaggedPoints(playByPlays, SECOND_CHANCE_TAG, MADE_SHOT_CODES);
}
