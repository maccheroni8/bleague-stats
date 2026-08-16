// ショットチャート用のデータ整形。Lead Tracker・出場交代バーと同じ方針で、games/{scheduleKey}.jsonの
// PlayByPlays（GeniusAPI生データ）からフロントエンドでその場構築する（バックエンド集計ファイルは
// 増やさない）。X/Y/AreaCDは2022-23シーズン以降のみ存在（DESIGN.md 2-7章）。
//
// ActionCD1の意味は実データ（2025-26シーズン複数試合）で確認済み:
// - 1: 3Pシュート成功 / 2: 3Pシュート失敗
// - 3, 4: 2Pシュート成功（アウトサイド/インサイドペイント） / 5, 6: 2Pシュート失敗（同）
// フリースロー（成功=7・失敗=8）はX/Y自体が存在しない（常に同じ位置のため座標記録なし）ので対象外。
//
// X/Yは0〜100のフルコート座標（コート全長を0〜100に正規化）で、Side（"left"/"right"）が
// どちらのバスケット方向へのショットかを表す。両チームともハーフごとに攻撃方向が入れ替わるため、
// 同一チームの得点が両方のSideにまたがる（実データで確認済み）。ハーフコート図に描くため、
// Side==="right"のショットはX軸をコート中央(50)で反転し、片方のバスケット基準に正規化する
// （Yは反転不要。コート幅方向の絶対位置はSideに関係なく一貫している）。

import type { BoxscoreRow, PlayByPlayEvent } from "../../shared/types";

const MADE_ACTION_CODES = new Set([1, 3, 4]);
const MISSED_ACTION_CODES = new Set([2, 5, 6]);
const THREE_POINT_ACTION_CODES = new Set([1, 2]);

export interface ShotEvent {
  playerId: string;
  playerName: string;
  teamId: string | null;
  made: boolean;
  isThree: boolean;
  /** ハーフコート正規化済み座標（0〜100、バスケット方向に反転済み） */
  x: number;
  y: number;
}

export function buildShotEvents(events: PlayByPlayEvent[]): ShotEvent[] {
  const shots: ShotEvent[] = [];
  for (const ev of events) {
    const made = MADE_ACTION_CODES.has(ev.ActionCD1);
    const missed = MISSED_ACTION_CODES.has(ev.ActionCD1);
    if (!made && !missed) continue;
    if (ev.X === undefined || ev.Y === undefined || !ev.PlayerID1) continue;
    const mirror = ev.Side === "right";
    shots.push({
      playerId: ev.PlayerID1,
      playerName: ev.PlayerNameJ1,
      teamId: ev.TeamID,
      made,
      isThree: THREE_POINT_ACTION_CODES.has(ev.ActionCD1),
      x: mirror ? 100 - ev.X : ev.X,
      y: ev.Y,
    });
  }
  return shots;
}

/** ショットチャートの選手セレクタ用に、実際にショットを打った選手だけをボックススコア順で抽出する */
export function playersWithShots(players: BoxscoreRow[], shots: ShotEvent[]): BoxscoreRow[] {
  const idsWithShots = new Set(shots.map((s) => s.playerId));
  return players.filter((p) => idsWithShots.has(p.PlayerID));
}
