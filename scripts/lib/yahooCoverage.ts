// シーズン文字列から、Yahoo!スポーツplay-by-play（追加データ源）の対応可否を判定する。
// sports.yahoo.co.jpのゲームテキストウィジェットは2023-24シーズン以降のScheduleKeyのみ存在し、
// それ以前は500エラーになる（2026-08-21実機確認、DESIGN.md参照）。bleague.jp本体データの
// SeasonCoverage（scripts/lib/seasonCoverage.ts）とは別軸のフラグなので独立させている。

export function yahooPbpCoverage(season: string): boolean {
  const startYear = Number(season.split("-")[0]);
  return startYear >= 2023;
}
