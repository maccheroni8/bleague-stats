// リーグ平均の2P内訳が揃っているかの確認（比較ページ）。同じ条件の確認は1回だけ行い、結果を使い回す。
import { leagueCacheKey, type League } from "./league";
import { fetchTeamGameLogs, fetchTeams } from "./data";
import { verifyLeaguePaint } from "./teamPaint2";
import type { TeamTotals } from "./teamStatsColumns";

const leagueChecks = new Map<string, Promise<boolean>>();

export function loadLeaguePaintComplete(season: string, gameType: string, t: TeamTotals, league: League = "premier"): Promise<boolean> {
  const key = JSON.stringify([leagueCacheKey(season, league), gameType, t.paint2m, t.paint2a, t.mid2m, t.mid2a, t.fgm, t.fga, t.tpm, t.tpa]);
  let pending = leagueChecks.get(key);
  if (!pending) {
    pending = verifyLeaguePaint(t, async () => {
      const teams = await fetchTeams(season, league);
      return Promise.all(
        teams.map(async (team) => (await fetchTeamGameLogs(season, team.teamId, league)).filter((g) => gameType === "both" || g.gameType === gameType)),
      );
    });
    leagueChecks.set(key, pending);
    // 失敗は保存しない（次の表示で再試行できるようにする）
    pending.catch(() => leagueChecks.delete(key));
  }
  return pending;
}
