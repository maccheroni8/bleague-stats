// 選手の出場中の割合（Scoring の %PTS〜%FTA・Misc の AST%）を出せるシーズンかどうか（在コート基準の再集計。DESIGN.md 304章）。
// 全選手スタッツ（B.ONE でも見られる）とランキングの両方から読むので、どちらにも依らない小さなファイルに置く
/** 2016-17〜2019-20 は出場中の数え上げが無いので、これらの項目を出さない */
export function onCourtShareSeasonUnsupported(season: string): boolean {
  return Number(season.slice(0, 4)) < 2020;
}
