// data/{season}/*.json を取得する薄いラッパー。public/data がリポジトリ直下のdata/への
// シンボリックリンクになっているため、ビルド後は dist/data 配下にそのまま含まれる。
// GitHub Pagesのサブパス配信（vite.config.tsのbase）に対応するため、BASE_URLを起点にする。
//
// 全JSONは`.json.gz`としてgzip圧縮保存されている（DESIGN.md 8-3章）。fetchJson内で
// `.gz`を付けて取得し、DecompressionStream APIでその場展開する（個人利用のフロントエンドのみが
// 読む前提のため、対応ブラウザを限定する前提でポリフィルは用意しない）。
//
// 注意: 開発サーバー（Vite dev server）は`.gz`ファイルを`Content-Encoding: gzip`付きで返し、
// ブラウザのfetch自体が透過的に展開してしまう（この場合`res.body`は既に展開済みの生JSON）。
// 一方GitHub Pages等の素の静的ホスティングはそのような透過展開をしないため、`res.body`は
// gzip圧縮されたバイト列のまま届く。`Content-Encoding`レスポンスヘッダの有無で判定し、
// 両方の環境に対応する

import type {
  ClubHonorsFile,
  GameSummary,
  HeadToHeadTeamRow,
  PlayerGameLog,
  PlayerSummary,
  ScheduleFile,
  SeasonEntry,
  StandingsSnapshot,
  StoredGame,
  TeamColors,
  TeamGameLog,
  TeamHistoryEntry,
  TeamLineupsFile,
  TeamSummary,
} from "../../shared/types";
import { legibleAccentColor } from "./color";

const dataBase = `${import.meta.env.BASE_URL}data`;

async function fetchJson<T>(url: string): Promise<T> {
  const gzUrl = `${url}.gz`;
  const res = await fetch(gzUrl);
  if (!res.ok || !res.body) {
    throw new Error(`${gzUrl} の取得に失敗しました (status: ${res.status})`);
  }
  // サーバーが既にContent-Encoding: gzipで透過展開済みならそのまま読む。
  // そうでなければ（GitHub Pages等）圧縮バイト列のままなのでDecompressionStreamで展開する
  const alreadyDecoded = res.headers.get("content-encoding") === "gzip";
  const text = alreadyDecoded
    ? await res.text()
    : await new Response(res.body.pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(text) as T;
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

export function fetchTeamLineups(season: string, teamId: string): Promise<TeamLineupsFile> {
  return fetchJson<TeamLineupsFile>(`${dataBase}/${season}/lineups/${teamId}.json`);
}

export function fetchSeasons(): Promise<SeasonEntry[]> {
  return fetchJson<SeasonEntry[]>(`${dataBase}/seasons.json`);
}

// 自動抽出した色の中には、ロゴが濃色主体のデザイン等の理由でUIアクセントとしては
// 視認性が低すぎるものが混ざりうる（DESIGN.md参照）。ここで一括して視認性チェックを通し、
// 不合格の色はundefinedにする（呼び出し側は`color ?? デフォルト色`のパターンで
// 既存の配色に自動フォールバックできる）。個々の呼び出し元でチェックする必要が無いよう、
// 取得の時点で一度だけ済ませる。
// primaryが視認性不足の場合はsecondaryを代わりに採用する（例: ロゴの支配色が濃紺一色でも、
// 縁取り等に使われている2番目の色なら視認性を満たすことがある）。両方とも不合格なら
// 空文字のままにし、呼び出し側で既存の配色にフォールバックさせる
export async function fetchTeamColors(): Promise<Record<string, TeamColors>> {
  const raw = await fetchJson<Record<string, TeamColors>>(`${dataBase}/team-colors.json`);
  const sanitized: Record<string, TeamColors> = {};
  for (const [teamId, colors] of Object.entries(raw)) {
    const legibleSecondary = legibleAccentColor(colors.secondary) ?? "";
    sanitized[teamId] = {
      primary: legibleAccentColor(colors.primary) ?? legibleSecondary,
      secondary: legibleSecondary,
    };
  }
  return sanitized;
}

export function fetchTeamHistory(): Promise<TeamHistoryEntry[]> {
  return fetchJson<TeamHistoryEntry[]>(`${dataBase}/team-history.json`);
}

export function fetchClubHonors(): Promise<ClubHonorsFile> {
  return fetchJson<ClubHonorsFile>(`${dataBase}/club-honors.json`);
}

export function fetchSchedule(season: string): Promise<ScheduleFile> {
  return fetchJson<ScheduleFile>(`${dataBase}/${season}/schedule.json`);
}

export function fetchGameSummaries(season: string): Promise<GameSummary[]> {
  return fetchJson<GameSummary[]>(`${dataBase}/${season}/games-summary.json`);
}

// チームロゴ・選手写真は自前保存の生画像（gzip非対応・シーズン非依存）なので、
// fetchJsonを介さずURLを直接組み立てるだけでよい。存在しない場合は呼び出し側の<img onError>で処理する
export function teamLogoUrl(teamId: string): string {
  return `${dataBase}/logos/${teamId}.png`;
}

export function playerPhotoUrl(playerId: string): string {
  return `${dataBase}/player-photos/${playerId}.webp`;
}
