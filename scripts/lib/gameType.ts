// ConventionNameJから、レギュラーシーズン戦かプレーオフ（チャンピオンシップ）戦かを判定する。
//
// isExhibitionGame()と同じConventionNameJ判定基盤を使う。オールスター/U18/国際親善試合等は
// aggregate.ts側でisExhibitionGame()によりこの関数を呼ぶ前に除外済みの前提（除外後の残りは
// 「レギュラーシーズン」か「プレーオフ」のどちらか）。
//
// 判定方式: 「チャンピオンシップ」/"CHAMPIONSHIP"を含み、かつB.LEAGUE/Bリーグ表記を伴う場合を
// プレーオフとする（exhibitionGames.tsのisChampionship && isBleagueBrand と対になる条件。
// isExhibitionGame()側はisChampionship && !isBleagueBrandを除外するため、両者は排他的）。
// 2026-27シーズン以降のプレーオフ表記は未確認（DESIGN.md参照、試合が無いため検証不可）。
import type { GameType } from "../../shared/types.ts";

export function classifyGameType(conventionNameJ: string): GameType {
  const isChampionship = /チャンピオンシップ|CHAMPIONSHIP/i.test(conventionNameJ);
  const isBleagueBrand = conventionNameJ.includes("B.LEAGUE") || conventionNameJ.includes("Bリーグ");
  return isChampionship && isBleagueBrand ? "playoff" : "regular";
}
