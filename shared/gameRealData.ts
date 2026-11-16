// 試合の生データ（games/）が「本物」か、開催予定の試合が取り込みで作る「空の枠」かを見分ける（DESIGN.md 411章）。
// 空の枠: ティップオフ+2時間の取り込みが、まだ試合が行われていない（または中止になった）試合のボックススコアの枠だけを保存したもの。
//   GameEndedFlg=false・得点 None・PlayByPlays なし・全員 DNP。試合が始まった直後の本物の試合とは、この一瞬だけ区別がつかない。
// 空の枠というだけでは中止にしない。中止にするのは、公式の日程に「試合中止」のカードがある試合だけ（scripts/lib/scheduleCancelled.ts）。
// 取り込み・集計・検証が同じ判定を使えるよう、この1か所に置く。

export interface GameRealDataInput {
  gameEndedFlg?: boolean | null;
  homeScore?: number | null;
  awayScore?: number | null;
}

/** 本物の生データか（試合が終わっている、または得点が入っている）。空の枠は false */
export function hasRealGameData(game: GameRealDataInput): boolean {
  if (game.gameEndedFlg === true) return true;
  return (game.homeScore ?? null) !== null || (game.awayScore ?? null) !== null;
}
