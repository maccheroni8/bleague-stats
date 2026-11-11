// 選手の出場中の割合（Scoring の %PTS〜%FTA・Misc の AST%）を出せるシーズンかどうか（在コート基準の再集計。DESIGN.md 304章）。
// 全選手スタッツ（B.ONE でも見られる）とランキングの両方から読むので、どちらにも依らない小さなファイルに置く

/** 出場中の数え上げがある最初のシーズン（372章で 2016-17〜2019-20 も数えるようになった。B.LEAGUE の最初のシーズン） */
export const ON_COURT_COUNT_FIRST_SEASON = "2016-17";

/** 出場中の数え上げが無いシーズンか（B.LEAGUE の全シーズンで数えるので、今は常に false） */
export function onCourtShareSeasonUnsupported(season: string): boolean {
  return season < ON_COURT_COUNT_FIRST_SEASON;
}
