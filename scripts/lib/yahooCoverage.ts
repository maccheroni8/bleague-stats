// シーズン文字列から、Yahoo!スポーツplay-by-play（追加データ源）の対応可否を判定する。
// sports.yahoo.co.jpのゲームテキストウィジェットは2023-24シーズン以降のScheduleKeyのみ存在し、
// それ以前は500エラーになる（2026-08-21実機確認、DESIGN.md参照）。bleague.jp本体データの
// SeasonCoverage（scripts/lib/seasonCoverage.ts）とは別軸のフラグなので独立させている。

export function yahooPbpCoverage(season: string): boolean {
  const startYear = Number(season.split("-")[0]);
  return startYear >= 2023;
}

/**
 * ゲームテキストウィジェットURLのリーグ部分（/basket/widget/ds/pc/{ここ}/games/...）。
 * 2026-27のB.PREMIER移行で"b1"から"premier"に変わった（2026-09-24実機確認: 2026-27の試合は
 * b1のURLだと500、premierなら200。2025-26以前の試合はb1のまま取得できる。DESIGN.md 129章）
 */
export function yahooWidgetLeaguePath(season: string): "b1" | "premier" {
  return Number(season.split("-")[0]) >= 2026 ? "premier" : "b1";
}
