// data/{season}/*.json を取得する薄いラッパー。public/data がリポジトリ直下のdata/への
// シンボリックリンクになっているため、`/data/...` でそのままfetchできる。

import type { PlayerGameLog, PlayerSummary, StoredGame, TeamGameLog, TeamSummary } from "./types";

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} の取得に失敗しました (status: ${res.status})`);
  }
  return (await res.json()) as T;
}

export function fetchTeams(season: string): Promise<TeamSummary[]> {
  return fetchJson<TeamSummary[]>(`/data/${season}/teams.json`);
}

export function fetchPlayers(season: string): Promise<PlayerSummary[]> {
  return fetchJson<PlayerSummary[]>(`/data/${season}/players.json`);
}

export function fetchPlayerGameLogs(season: string, playerId: string): Promise<PlayerGameLog[]> {
  return fetchJson<PlayerGameLog[]>(`/data/${season}/player-games/${playerId}.json`);
}

export function fetchGame(season: string, scheduleKey: string): Promise<StoredGame> {
  return fetchJson<StoredGame>(`/data/${season}/games/${scheduleKey}.json`);
}

export function fetchTeamGameLogs(season: string, teamId: string): Promise<TeamGameLog[]> {
  return fetchJson<TeamGameLog[]>(`/data/${season}/team-games/${teamId}.json`);
}
