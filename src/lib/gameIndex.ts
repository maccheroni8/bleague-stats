// 1試合行の索引（data/{season}/player-game-index.json.gz・team-game-index.json.gz。形式は shared/gameIndex.ts、DESIGN.md 219章）の行を読む。
// ランキングの1試合記録の条件・昇順・連続記録などが使う。行をオブジェクトにする部分（playerGameAt・teamGameAt など）は shared/gameIndexRead.ts（集計のコードからも読まれる。221章）。
// ここは画面側の部品（版の確認・年齢・ルーキーの突き合わせ）。集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。ファイルの読み込みは gameIndexLoad.ts。
// ルーキーは索引に無い。ルーキーのシーズンと選手の対応（rookie-eligibility.json）と突き合わせる（rookieOfIndex）。

import { GAME_INDEX_VERSION, type PlayerGameIndexFile } from "../../shared/gameIndex";
import { ageOnDate, type AgeOnDate } from "../../shared/gameAge";
import type { RookieEligibilityFile } from "../../shared/types";
import { type PlayerGameIndexView } from "../../shared/gameIndexRead";

export * from "../../shared/gameIndexRead";

/** 索引ファイルの版が合うか（版が新しい・壊れたファイルは使わない） */
export function isSupportedGameIndex(file: { version?: unknown; rows?: unknown; games?: unknown } | null | undefined): boolean {
  return !!file && file.version === GAME_INDEX_VERSION && !!file.rows && !!file.games;
}

/** 試合当日の年齢（生年月日が無ければ null） */
export function playerAgeAt(view: PlayerGameIndexFile | PlayerGameIndexView, i: number): AgeOnDate | null {
  const file = "file" in view ? view.file : view;
  const p = file.players[file.rows.player[i]!]!;
  return ageOnDate(p[4], file.games.date[file.rows.game[i]!]!);
}

/** そのシーズンにルーキーの選手か（rookie-eligibility.json との突き合わせ。2016-17は判定できないので false） */
export function rookieOfIndex(rookies: RookieEligibilityFile | null | undefined, season: string, playerId: string): boolean {
  return !!rookies?.seasons[season]?.includes(playerId);
}
