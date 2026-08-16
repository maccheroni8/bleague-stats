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
//
// B.ONE（旧B2）はチャンピオンシップ表記を使わず、"りそなグループ B2 PLAYOFFS 2025-26"のように
// "PLAYOFFS"表記かつB.LEAGUE/Bリーグのブランド文字列を伴わない（2026-08-16、実データで確認。
// 対して同シーズンの正規戦は"りそなグループ B.LEAGUE 2025-26 B2リーグ戦"とブランド文字列を含む）。
// そのため上記の「チャンピオンシップ系＋ブランド文字列」の判定とは別に、"PLAYOFFS"を含む場合は
// 単独でプレーオフとみなす（ブランド文字列の有無を問わない。この語自体が他カテゴリの通常戦や
// 国際親善試合の名称に出現する可能性は低いと判断）。DESIGN.md 14章参照
import type { GameType } from "../../shared/types.ts";

export function classifyGameType(conventionNameJ: string): GameType {
  const isChampionship = /チャンピオンシップ|CHAMPIONSHIP/i.test(conventionNameJ);
  const isBleagueBrand = conventionNameJ.includes("B.LEAGUE") || conventionNameJ.includes("Bリーグ");
  const isPlayoffs = /PLAYOFFS/i.test(conventionNameJ);
  return (isChampionship && isBleagueBrand) || isPlayoffs ? "playoff" : "regular";
}
