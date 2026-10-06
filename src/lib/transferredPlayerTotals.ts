// ランキング（個人）で試合の条件を付けたときの、シーズン途中で移籍した選手のチーム合計（USG%・%-share・個人ORtg/DRtgの分母）。DESIGN.md 213章。
// playerSeasonBoxscore.ts は集計のコード（シーズンごとの集計の保存キーに入る）から読まれるので、画面だけの処理は別のファイルに置く
// （ここを直しても、過去シーズンの導出データの作り直しは起きない）

import { EMPTY_TEAM_TOTALS, sumTeamGameLogsFor, sumTeamSeasonTotals, type TeamSeasonRawTotals } from "./playerSeasonBoxscore";
import type { OwnTeamResolver } from "./situational";
import type { PlayerGameLog, TeamGameLog } from "../../shared/types";

/**
 * シーズンの途中で移籍した選手（そのシーズンの試合ログが2チーム以上にまたがる）の、USG%・%-shareスタッツ・個人ORtg/DRtgの分母になるチーム総計
 * （ランキングで試合の条件を付けたとき。DESIGN.md 213章）。
 * 条件に当てはまる試合（scopedLogs）で所属していたチームごとに、そのチームでの最初の試合から最後の試合まで（所属期間。allLogs＝絞り込み前の全試合で数える）の、
 * 条件に当てはまるチームの試合（scopedTeamLogsByTeamId＝チームごとに、選手と同じ条件で絞り込み済みの試合ログ）を合算し、チームをまたいで足す。
 * 条件に当てはまる試合が無いチームは足さない。1チームだけの選手は null（従来どおり、選手の所属チームの総計を使う）。
 * 所属期間で区切るのは、シーズンの全試合を足すと、移籍前・移籍後の試合まで分母に入って割合が小さくなりすぎるため。
 */
export function teamTotalsForTransferredPlayer(
  allLogs: PlayerGameLog[],
  scopedLogs: PlayerGameLog[],
  ownTeamOf: OwnTeamResolver,
  scopedTeamLogsByTeamId: Map<string, TeamGameLog[]>,
): TeamSeasonRawTotals | null {
  const tenureOf = new Map<string, { first: string; last: string }>();
  for (const g of allLogs) {
    const teamId = ownTeamOf(g);
    if (!teamId) continue;
    const t = tenureOf.get(teamId);
    if (!t) tenureOf.set(teamId, { first: g.date, last: g.date });
    else {
      if (g.date < t.first) t.first = g.date;
      if (g.date > t.last) t.last = g.date;
    }
  }
  if (tenureOf.size < 2) return null;
  const scopedTeamIds = new Set<string>();
  for (const g of scopedLogs) {
    const teamId = ownTeamOf(g);
    if (teamId) scopedTeamIds.add(teamId);
  }
  let total: TeamSeasonRawTotals = { ...EMPTY_TEAM_TOTALS };
  for (const teamId of scopedTeamIds) {
    const tenure = tenureOf.get(teamId);
    if (!tenure) continue;
    const inTenure = (scopedTeamLogsByTeamId.get(teamId) ?? []).filter((g) => g.date >= tenure.first && g.date <= tenure.last);
    total = sumTeamSeasonTotals(total, sumTeamGameLogsFor(inTenure, new Set(inTenure.map((g) => g.scheduleKey))));
  }
  return total;
}
