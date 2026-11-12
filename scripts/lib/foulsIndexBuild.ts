// ファウルの導出データ（形式は shared/foulsIndex.ts）を作る部分。入口は scripts/aggregate-fouls-index.ts、検証（validate-fouls-index.ts）も同じ関数を使う。
import type { StoredGame } from "../../shared/types.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../../shared/gameIndex.ts";
import { DISQUALIFYING_FOUL_CODE, PLAYER_TECHNICAL_FOUL_CODES, UNSPORTSMANLIKE_FOUL_CODES } from "../../shared/foulCodes.ts";
import { normalizePlayerName } from "../../shared/playerName.ts";
import { FOULS_INDEX_VERSION, PLAYER_FOUL_COLUMNS, TEAM_FOUL_COLUMNS, type FoulsIndexFile, type PlayerFoulColumn, type TeamFoulColumn } from "../../shared/foulsIndex.ts";

const COACH_TECHNICAL = 20;
const BENCH_TECHNICAL = 21;
const FLAGRANT = 93;
const DISRUPTIVE = 94;

/** 1つのプレーが当たるチームの列・選手の列（当たらなければ空） */
export function foulColumnsOf(code: number): { team: TeamFoulColumn[]; player: PlayerFoulColumn[] } {
  if (code === COACH_TECHNICAL) return { team: ["tfCoach"], player: [] };
  if (code === BENCH_TECHNICAL) return { team: ["tfBench"], player: [] };
  if (PLAYER_TECHNICAL_FOUL_CODES.has(code)) return { team: ["tfPlayer"], player: ["tf"] };
  if (UNSPORTSMANLIKE_FOUL_CODES.has(code)) {
    const extra = code === FLAGRANT ? (["flagrant"] as const) : code === DISRUPTIVE ? (["disruptive"] as const) : [];
    return { team: ["uf", ...extra], player: ["uf", ...extra] };
  }
  if (code === DISQUALIFYING_FOUL_CODE) return { team: ["dq"], player: ["dq"] };
  return { team: [], player: [] };
}

export function buildFoulsIndex(season: string, teamIndex: TeamGameIndexFile, playerIndex: PlayerGameIndexFile | null, games: readonly StoredGame[]): FoulsIndexFile {
  const gameCount = teamIndex.games.key.length;
  const team = Object.fromEntries(TEAM_FOUL_COLUMNS.map((c) => [c, new Array<number>(gameCount * 2).fill(-1)])) as Record<TeamFoulColumn, number[]>;
  const teamNumber = new Map(teamIndex.teams.map(([id], i) => [id, i]));
  const gameNumber = new Map(teamIndex.games.key.map((k, i) => [k, i]));
  const indexNames = new Map((playerIndex?.players ?? []).map(([id, name]) => [id, name]));
  const players: [string, string][] = [];
  const playerNumber = new Map<string, number>();
  // 選手×試合の数（キー: 試合の番号・選手ID・チームの番号）
  const playerRows = new Map<string, { game: number; player: string; team: number; counts: Record<PlayerFoulColumn, number> }>();

  for (const game of games) {
    const g = gameNumber.get(String(game.scheduleKey));
    if (g === undefined) continue;
    const pbp = game.raw.PlayByPlays ?? [];
    if (pbp.length === 0) continue; // プレーバイプレーが無い試合は -1 のまま
    const sides = new Map<string, 0 | 1>([
      [String(game.homeTeam.id), 0],
      [String(game.awayTeam.id), 1],
    ]);
    for (const side of [0, 1]) for (const c of TEAM_FOUL_COLUMNS) team[c][g * 2 + side] = 0;
    const boxNames = new Map<string, string>();
    for (const b of [...(game.raw.HomeBoxscores ?? []), ...(game.raw.AwayBoxscores ?? [])]) {
      if (b.PlayerID && b.PlayerNameJ && !boxNames.has(String(b.PlayerID))) boxNames.set(String(b.PlayerID), b.PlayerNameJ);
    }
    for (const ev of pbp) {
      const cols = foulColumnsOf(ev.ActionCD1);
      if (cols.team.length === 0) continue;
      const side = ev.TeamID == null ? undefined : sides.get(String(ev.TeamID));
      if (side === undefined) continue;
      for (const c of cols.team) team[c][g * 2 + side]! += 1;
      if (cols.player.length === 0 || !ev.PlayerID1) continue;
      const playerId = String(ev.PlayerID1);
      const teamNo = teamNumber.get(String(ev.TeamID))!;
      const key = `${g}:${playerId}:${teamNo}`;
      let row = playerRows.get(key);
      if (!row) {
        row = { game: g, player: playerId, team: teamNo, counts: Object.fromEntries(PLAYER_FOUL_COLUMNS.map((c) => [c, 0])) as Record<PlayerFoulColumn, number> };
        playerRows.set(key, row);
        if (!playerNumber.has(playerId)) {
          playerNumber.set(playerId, players.length);
          players.push([playerId, indexNames.get(playerId) ?? normalizePlayerName(boxNames.get(playerId) ?? playerId)]);
        }
      }
      for (const c of cols.player) row.counts[c] += 1;
    }
  }

  const sorted = [...playerRows.values()].sort((a, b) => a.game - b.game || a.team - b.team || (a.player < b.player ? -1 : a.player > b.player ? 1 : 0));
  const player = {
    player: sorted.map((r) => playerNumber.get(r.player)!),
    game: sorted.map((r) => r.game),
    team: sorted.map((r) => r.team),
    ...Object.fromEntries(PLAYER_FOUL_COLUMNS.map((c) => [c, sorted.map((r) => r.counts[c])])),
  } as FoulsIndexFile["player"];
  return {
    version: FOULS_INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    season,
    teams: teamIndex.teams.map(([id, name]) => [id, name]),
    games: { key: teamIndex.games.key, date: teamIndex.games.date, flags: teamIndex.games.flags, home: teamIndex.games.home, away: teamIndex.games.away },
    players,
    team,
    player,
  };
}
