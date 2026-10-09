// 1試合行の索引を作る（DESIGN.md 219章。形式は shared/gameIndex.ts）。
// そのシーズンの games-summary.json・player-games/・team-games/・players.json と、シーズンをまたいで読む元データ（選手マスタ・地区の履歴）から作る。
// 対象は、試合の要約にあるレギュラーシーズン・ポストシーズンの試合（オールスター等は要約に無い）。B.ONE は対象外。
// 選手の行は出場した試合（min>0）だけ。ルーキーは入れない（所属履歴から作る別の導出データ rookie-eligibility.json と、読むときに突き合わせる。219章）。
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./storage.ts";
import { teamDivisionForSeason } from "./divisions.ts";
import { classKeyOf } from "../../shared/classificationKey.ts";
import {
  GAME_FLAG_PLAYOFF,
  GAME_FLAG_SHORT,
  GAME_INDEX_VERSION,
  INDEX_UNAVAILABLE_COLUMNS,
  PLAYER_INDEX_STAT_COLUMNS,
  ROW_FLAG_HOME,
  ROW_FLAG_STARTER,
  TEAM_INDEX_PERIOD_COLUMNS,
  TEAM_INDEX_STAT_COLUMNS,
  type IndexGames,
  type IndexPlayer,
  type IndexTeam,
  type PlayerGameIndexFile,
  type TeamGameIndexFile,
} from "../../shared/gameIndex.ts";
import type { DivisionHistoryFile, GameSummary, PlayerGameLog, PlayerMasterEntry, PlayerSummary, TeamGameLog } from "../../shared/types.ts";

type PlayerStatColumn = (typeof PLAYER_INDEX_STAT_COLUMNS)[number];
type TeamStatColumn = (typeof TEAM_INDEX_STAT_COLUMNS)[number] | (typeof TEAM_INDEX_PERIOD_COLUMNS)[number];

function isIndexedGame(s: GameSummary): boolean {
  return s.gameType === "regular" || s.gameType === "playoff";
}

function filesIn(dir: string): string[] {
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json.gz")).sort() : [];
}

function numberOrThrow(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`${what} が数値ではありません: ${String(v)}`);
  return v;
}

/** 選手の統計の列の値。minSec は出場時間（分）を秒に直す（分は秒÷60の値なので、四捨五入で元に戻る。確認は validate:game-index） */
function playerStat(g: PlayerGameLog, col: PlayerStatColumn): number {
  if (col === "minSec") return Math.round(numberOrThrow(g.min, "min") * 60);
  return numberOrThrow(g[col] ?? 0, col);
}

function teamStat(g: TeamGameLog, col: (typeof TEAM_INDEX_STAT_COLUMNS)[number]): number {
  if (col === "attendance") return g.attendance === undefined ? -1 : g.attendance;
  return numberOrThrow(g[col] ?? 0, col);
}

interface SeasonInputs {
  summaries: GameSummary[];
  teamLogs: Map<string, { home?: TeamGameLog; away?: TeamGameLog }>;
  teams: IndexTeam[];
  teamIndex: Map<string, number>;
  games: IndexGames;
  gameIndex: Map<string, number>;
}

function loadInputs(season: string, divisionHistory: DivisionHistoryFile | null, summaries: GameSummary[], teamLogsByTeam: Map<string, TeamGameLog[]>): SeasonInputs {
  const indexed = summaries.filter(isIndexedGame);
  const names = new Map<string, string>();
  for (const s of indexed) {
    names.set(s.homeTeamId, s.homeTeamName);
    names.set(s.awayTeamId, s.awayTeamName);
  }
  const teamIds = [...names.keys()].sort();
  const teams: IndexTeam[] = teamIds.map((id) => [id, names.get(id)!, teamDivisionForSeason(divisionHistory, id, season) ?? ""]);
  const teamIndex = new Map(teamIds.map((id, i) => [id, i]));

  // 試合ごとのホーム・アウェイのチーム試合ログ（チームの試合ログの isHome で振り分ける）
  const teamLogs = new Map<string, { home?: TeamGameLog; away?: TeamGameLog }>();
  for (const logs of teamLogsByTeam.values()) {
    for (const g of logs) {
      if (g.gameType !== "regular" && g.gameType !== "playoff") continue;
      const entry = teamLogs.get(g.scheduleKey) ?? {};
      if (g.isHome) entry.home = g;
      else entry.away = g;
      teamLogs.set(g.scheduleKey, entry);
    }
  }

  // 試合の表は、要約の並び（日付→試合番号）のまま。ホーム・アウェイのチーム試合ログが両方そろう試合だけ（そろわない試合は、終了前など）
  const games: IndexGames = { key: [], date: [], flags: [], home: [], away: [], homeScore: [], awayScore: [], overtimes: [], homeMaxLead: [], awayMaxLead: [] };
  const gameIndex = new Map<string, number>();
  for (const s of indexed) {
    const logs = teamLogs.get(s.scheduleKey);
    if (!logs?.home && !logs?.away) continue;
    if (!logs.home || !logs.away) throw new Error(`${season} ${s.scheduleKey}: チームの試合ログがホームかアウェイの片方しかありません`);
    if (logs.home.teamScore !== s.homeScore || logs.away.teamScore !== s.awayScore) {
      throw new Error(`${season} ${s.scheduleKey}: チームの試合ログの得点が試合の要約と合いません`);
    }
    gameIndex.set(s.scheduleKey, games.key.length);
    games.key.push(s.scheduleKey);
    games.date.push(s.date);
    // 前後半5分の特別な試合は、1Q〜4Qの得点（periodPoints）を持たない（shared/periodPoints.ts）
    games.flags.push((s.gameType === "playoff" ? GAME_FLAG_PLAYOFF : 0) | (logs.home.periodPoints === undefined ? GAME_FLAG_SHORT : 0));
    games.home.push(teamIndex.get(s.homeTeamId)!);
    games.away.push(teamIndex.get(s.awayTeamId)!);
    games.homeScore.push(s.homeScore);
    games.awayScore.push(s.awayScore);
    games.overtimes.push(numberOrThrow(s.overtimes, `${season} ${s.scheduleKey} の overtimes`));
    games.homeMaxLead.push(logs.home.maxLead ?? -1);
    games.awayMaxLead.push(logs.away.maxLead ?? -1);
  }
  return { summaries: indexed, teamLogs, teams, teamIndex, games, gameIndex };
}

/** そのシーズンの索引（選手・チーム）。試合の要約が無いシーズンは null */
export async function buildGameIndex(season: string): Promise<{ player: PlayerGameIndexFile; team: TeamGameIndexFile } | null> {
  const seasonDir = path.join(DATA_DIR, season);
  const summaries = await readJson<GameSummary[]>(path.join(seasonDir, "games-summary.json"));
  if (!summaries || summaries.length === 0) return null;
  const divisionHistory = await readJson<DivisionHistoryFile>(path.join(DATA_DIR, "division-history.json"));
  const generatedAt = new Date().toISOString();

  const teamLogsByTeam = new Map<string, TeamGameLog[]>();
  for (const f of filesIn(path.join(seasonDir, "team-games"))) {
    const teamId = f.replace(/\.json\.gz$/, "");
    teamLogsByTeam.set(teamId, (await readJson<TeamGameLog[]>(path.join(seasonDir, "team-games", `${teamId}.json`))) ?? []);
  }
  const inputs = loadInputs(season, divisionHistory, summaries, teamLogsByTeam);
  if (inputs.games.key.length === 0) return null;
  const { games, teams, gameIndex, teamLogs } = inputs;

  // ---- チーム ----
  const teamStats = {} as Record<TeamStatColumn, number[]>;
  for (const c of [...TEAM_INDEX_STAT_COLUMNS, ...TEAM_INDEX_PERIOD_COLUMNS]) teamStats[c] = [];
  const periodsFromPbp: [number, number[]][] = [];
  for (let gi = 0; gi < games.key.length; gi += 1) {
    const logs = teamLogs.get(games.key[gi]!)!;
    for (const [side, own] of [
      [0, logs.home!],
      [1, logs.away!],
    ] as const) {
      for (const c of TEAM_INDEX_STAT_COLUMNS) teamStats[c].push(teamStat(own, c));
      for (let i = 0; i < 4; i += 1) {
        teamStats[TEAM_INDEX_PERIOD_COLUMNS[i]!].push(own.periodPoints?.[i] ?? -1);
        teamStats[TEAM_INDEX_PERIOD_COLUMNS[4 + i]!].push(own.opponentPeriodPoints?.[i] ?? -1);
      }
      if (own.periodPointsFromPbp?.length) periodsFromPbp.push([gi * 2 + side, own.periodPointsFromPbp]);
    }
  }
  const unavailable = INDEX_UNAVAILABLE_COLUMNS[season];
  const team: TeamGameIndexFile = {
    version: GAME_INDEX_VERSION,
    generatedAt,
    season,
    unavailable: unavailable?.team ?? [],
    teams,
    games,
    rows: { stats: teamStats, periodsFromPbp },
  };

  // ---- 選手 ----
  const playersJson = (await readJson<PlayerSummary[]>(path.join(seasonDir, "players.json"))) ?? [];
  const summaryById = new Map(playersJson.map((p) => [p.playerId, p]));
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const masterById = new Map(master.map((p) => [p.playerId, p]));

  const playerIds = filesIn(path.join(seasonDir, "player-games")).map((f) => f.replace(/\.json\.gz$/, "")).sort();
  const playerRows: { playerId: string; gi: number; g: PlayerGameLog }[] = [];
  for (const playerId of playerIds) {
    const logs = (await readJson<PlayerGameLog[]>(path.join(seasonDir, "player-games", `${playerId}.json`))) ?? [];
    for (const g of logs) {
      if (g.min <= 0 || (g.gameType !== "regular" && g.gameType !== "playoff")) continue;
      const gi = gameIndex.get(g.scheduleKey);
      if (gi === undefined) continue;
      // 自チームは試合ログの isHome で決める。相手のチームが試合の表と合うことを確かめる（合わなければデータの食い違い）
      const opponent = g.isHome ? games.away[gi]! : games.home[gi]!;
      if (inputs.teamIndex.get(g.opponentTeamId) !== opponent) {
        throw new Error(`${season} ${g.scheduleKey} 選手${playerId}: 対戦相手が試合の表と合いません`);
      }
      playerRows.push({ playerId, gi, g });
    }
  }
  playerRows.sort((a, b) => (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : a.gi - b.gi));
  const usedIds = [...new Set(playerRows.map((r) => r.playerId))];
  const playerIdx = new Map(usedIds.map((id, i) => [id, i]));
  const players: IndexPlayer[] = usedIds.map((id) => {
    const p = summaryById.get(id);
    const m = masterById.get(id);
    const fallback = p?.profileFallback?.position;
    return [
      id,
      p?.name ?? m?.name ?? id,
      p?.position ?? "",
      fallback === "near" || fallback === "current" ? fallback : "",
      p?.birthDate ?? m?.birthDate ?? "",
      classKeyOf(p?.classification ?? m?.classification) ?? "",
    ];
  });
  const playerStats = {} as Record<PlayerStatColumn, number[]>;
  for (const c of PLAYER_INDEX_STAT_COLUMNS) playerStats[c] = [];
  const rowPlayer: number[] = [];
  const rowGame: number[] = [];
  const rowFlags: number[] = [];
  for (const r of playerRows) {
    rowPlayer.push(playerIdx.get(r.playerId)!);
    rowGame.push(r.gi);
    rowFlags.push((r.g.isStarter ? ROW_FLAG_STARTER : 0) | (r.g.isHome ? ROW_FLAG_HOME : 0));
    for (const c of PLAYER_INDEX_STAT_COLUMNS) playerStats[c].push(playerStat(r.g, c));
  }
  const player: PlayerGameIndexFile = {
    version: GAME_INDEX_VERSION,
    generatedAt,
    season,
    unavailable: unavailable?.player ?? [],
    teams,
    games,
    players,
    rows: { player: rowPlayer, game: rowGame, flags: rowFlags, stats: playerStats },
  };
  return { player, team };
}
