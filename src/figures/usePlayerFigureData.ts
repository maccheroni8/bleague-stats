import { fetchPlayers, fetchTeams, fetchPlayerGameLogs, fetchTeamGameLogs, fetchDivisionHistory, fetchSeasonRegistrations } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import type { Category } from '../../shared/types';

/** 選手の図解で共通の読み込み（USG% × PPP の図と同じ範囲: 選手・チーム・地区・登録区分と、両方の試合ログ） */
export function usePlayerFigureData(season: string, category: Category) {
  return useJsonData(async () => {
    const [players, teams, divisions, registrations] = await Promise.all([
      fetchPlayers(season, category), fetchTeams(season, category), fetchDivisionHistory(),
      season >= '2026-27' ? fetchSeasonRegistrations(season, category) : Promise.resolve(null),
    ]);
    const [playerLogs, teamLogs] = await Promise.all([
      Promise.all(players.map(async p => [p.playerId, await fetchPlayerGameLogs(season, p.playerId, category)] as const)),
      Promise.all(teams.map(async t => [t.teamId, await fetchTeamGameLogs(season, t.teamId, category)] as const)),
    ]);
    return { players, teams, divisions, registrations, playerLogs: new Map(playerLogs), teamLogs: new Map(teamLogs) };
  }, [season, category]);
}
