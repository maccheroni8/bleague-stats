// B.PREMIER全26クラブの東地区/西地区マスタ。
// GeniusAPIのレスポンス（Game/BoxscoreRow等）には地区情報が含まれていないため確認済み。
// bleague.jp/standings/ の2026-27シーズン表示（東地区13クラブ・西地区13クラブの見出し区切り）を
// 実ブラウザで確認して作成（2026-08-13時点）。地区分けは固定情報の想定だが、シーズンによる
// クラブ入れ替え・再編があれば要更新。TeamIDはbleague.jp/club_detail/?TeamID=... のIDと同一。

import type { Division } from "../../shared/types.ts";

export const TEAM_DIVISIONS: Record<string, Division> = {
  "702": "east", // レバンガ北海道
  "692": "east", // 仙台89ERS
  "693": "east", // 秋田ノーザンハピネッツ
  "712": "east", // 茨城ロボッツ
  "703": "east", // 宇都宮ブレックス
  "713": "east", // 群馬クレインサンダーズ
  "2486": "east", // アルティーリ千葉
  "704": "east", // 千葉ジェッツ
  "706": "east", // アルバルク東京
  "726": "east", // 東京サンロッカーズ
  "727": "east", // 川崎ブレイブサンダース
  "694": "east", // 横浜ビー・コルセアーズ
  "696": "east", // 富山グラウジーズ

  "716": "west", // 信州ブレイブウォリアーズ
  "697": "west", // 三遠ネオフェニックス
  "728": "west", // シーホース三河
  "729": "west", // 名古屋ダイヤモンドドルフィンズ
  "698": "west", // 滋賀レイクス
  "699": "west", // 京都ハンナリーズ
  "700": "west", // 大阪エヴェッサ
  "718": "west", // 神戸ストークス
  "720": "west", // 島根スサノオマジック
  "721": "west", // 広島ドラゴンフライズ
  "1638": "west", // 佐賀バルーナーズ
  "2488": "west", // 長崎ヴェルカ
  "701": "west", // 琉球ゴールデンキングス
};

export function teamDivision(teamId: string): Division | undefined {
  return TEAM_DIVISIONS[teamId];
}
