// USG%・PPP（個人ORtg）・DRtg の分母になるチーム合計（DESIGN.md 333章）。
// 本人が出場した試合（出場時間が0より大きい）だけを、その試合で所属していたチームの試合ログから足す。移籍した選手も特別に扱わない
// （所属期間の合計〔shared/transferredTeamTotals.ts〕は PER の分母にだけ残す）。
// 集計（scripts/aggregate.ts の players.json）と画面（全選手スタッツ・個人詳細・チーム詳細・ランキング・比較・図解）で同じ関数を使い、値をそろえる
import { EMPTY_TEAM_TOTALS, sumTeamGameLogsFor, sumTeamSeasonTotals } from "./teamSeasonTotals.ts";
import type { TeamGameLog, TeamSeasonRawTotals } from "./types.ts";

/**
 * 本人が出場した試合（logs のうち min > 0）の、その試合の所属チーム（ownTeamOf）の合計。
 * teamLogsByTeamId はチームごとの試合ログ（絞り込み前でもよい。本人の試合の ScheduleKey で引く）。所属チームの分からない試合・チームの試合ログに無い試合は足さない
 */
export function teamTotalsForPlayedGames(
  logs: readonly { scheduleKey: string; isHome: boolean; min: number }[],
  ownTeamOf: (g: { scheduleKey: string; isHome: boolean }) => string | undefined,
  teamLogsByTeamId: ReadonlyMap<string, readonly TeamGameLog[]>,
): TeamSeasonRawTotals {
  const keysByTeam = new Map<string, Set<string>>();
  for (const g of logs) {
    if (!(g.min > 0)) continue;
    const teamId = ownTeamOf(g);
    if (!teamId) continue;
    let keys = keysByTeam.get(teamId);
    if (!keys) keysByTeam.set(teamId, (keys = new Set()));
    keys.add(g.scheduleKey);
  }
  let total: TeamSeasonRawTotals = { ...EMPTY_TEAM_TOTALS };
  for (const [teamId, keys] of keysByTeam) {
    const teamLogs = teamLogsByTeamId.get(teamId);
    if (!teamLogs) continue;
    total = sumTeamSeasonTotals(total, sumTeamGameLogsFor([...teamLogs], keys));
  }
  return total;
}
