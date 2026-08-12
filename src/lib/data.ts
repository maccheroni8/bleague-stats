// data/{season}/*.json を取得する薄いラッパー。public/data がリポジトリ直下のdata/への
// シンボリックリンクになっているため、ビルド後は dist/data 配下にそのまま含まれる。
// GitHub Pagesのサブパス配信（vite.config.tsのbase）に対応するため、BASE_URLを起点にする。

import type {
  HeadToHeadTeamRow,
  PlayerGameLog,
  PlayerSummary,
  StandingsSnapshot,
  StoredGame,
  TeamGameLog,
  TeamSummary,
} from "../../shared/types";

const dataBase = `${import.meta.env.BASE_URL}data`;

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} の取得に失敗しました (status: ${res.status})`);
  }
  return (await res.json()) as T;
}

export function fetchTeams(season: string): Promise<TeamSummary[]> {
  return fetchJson<TeamSummary[]>(`${dataBase}/${season}/teams.json`);
}

export function fetchPlayers(season: string): Promise<PlayerSummary[]> {
  return fetchJson<PlayerSummary[]>(`${dataBase}/${season}/players.json`);
}

export function fetchPlayerGameLogs(season: string, playerId: string): Promise<PlayerGameLog[]> {
  return fetchJson<PlayerGameLog[]>(`${dataBase}/${season}/player-games/${playerId}.json`);
}

export function fetchGame(season: string, scheduleKey: string): Promise<StoredGame> {
  return fetchJson<StoredGame>(`${dataBase}/${season}/games/${scheduleKey}.json`);
}

export function fetchTeamGameLogs(season: string, teamId: string): Promise<TeamGameLog[]> {
  return fetchJson<TeamGameLog[]>(`${dataBase}/${season}/team-games/${teamId}.json`);
}

export function fetchStandingsHistory(season: string): Promise<StandingsSnapshot[]> {
  return fetchJson<StandingsSnapshot[]>(`${dataBase}/${season}/standings-history.json`);
}

export function fetchHeadToHead(season: string): Promise<HeadToHeadTeamRow[]> {
  return fetchJson<HeadToHeadTeamRow[]>(`${dataBase}/${season}/head-to-head.json`);
}
