// data/{season}/player-game-records.json（選手一覧「記録」タブの範囲「シーズン」、選手の1試合の記録。DESIGN.md 159章）を生成する。
//
// そのシーズンの全選手の試合ログ（data/{season}/player-games/{playerId}.json.gz）から、shared/playerGameRecords.ts の項目ごとに
// 上位10位（同じ記録はすべて）だけを書き出す。画面が全選手の試合ログ（1シーズン約430ファイル）を読まずに済むようにするため。
// 試合区分はレギュラーシーズン・ポストシーズン・合算。出場した試合（min>0）で、そのシーズンの試合一覧（games-summary.json）にある試合だけが対象
// （オールスター等は含めない）。記録した試合の所属チームは、試合一覧のホーム/アウェイから決める（シーズン途中の移籍にも合う）。
//
// 夜間実行（update-stats.yml のディープrecheck）で、進行中のシーズンについて毎晩作り直す。作った時刻以外が前回と同じならファイルを書き換えない。
//
// 使い方:
//   npm run aggregate:player-game-records -- --season 2025-26
//   npm run aggregate:player-game-records -- --all

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { PLAYER_GAME_RECORD_STATS, PLAYER_GAME_RECORD_TOP_N, type PlayerRecordGame } from "../shared/playerGameRecords.ts";
import type {
  GameSummary,
  LeagueRankingGameType,
  PlayerGameLog,
  PlayerGameRecordEntry,
  PlayerGameRecordsFile,
  PlayerSummary,
} from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;
const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

interface Game extends PlayerRecordGame {
  playerId: string;
}

async function loadSeasonGames(season: string): Promise<Game[]> {
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  const summaryByKey = new Map(summaries.map((s) => [s.scheduleKey, s]));
  const dir = path.join(DATA_DIR, season, "player-games");
  if (!existsSync(dir)) return [];
  const games: Game[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
    const playerId = file.replace(/\.json\.gz$/, "");
    const logs = await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`));
    for (const g of logs ?? []) {
      if (g.min <= 0 || !summaryByKey.has(g.scheduleKey)) continue;
      if (g.gameType !== "regular" && g.gameType !== "playoff") continue;
      games.push({ ...g, season, playerId });
    }
  }
  return games;
}

/** 上位N位（N位と同じ記録はすべて）。同じ記録の中は新しい試合から（チームのクラブレコードと同じ） */
function topEntries(
  games: Game[],
  value: (g: Game) => number,
  summaryByKey: Map<string, GameSummary>,
  nameById: Map<string, string>,
): PlayerGameRecordEntry[] {
  const sorted = games
    .map((g) => ({ g, v: value(g) }))
    .sort((a, b) => b.v - a.v || b.g.date.localeCompare(a.g.date) || a.g.playerId.localeCompare(b.g.playerId));
  const out: PlayerGameRecordEntry[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const { g, v } = sorted[i]!;
    if (i === 0 || v !== sorted[i - 1]!.v) rank = i + 1;
    if (rank > PLAYER_GAME_RECORD_TOP_N) break;
    const s = summaryByKey.get(g.scheduleKey)!;
    out.push({
      rank,
      value: v,
      playerId: g.playerId,
      playerName: nameById.get(g.playerId) ?? g.playerId,
      teamId: g.isHome ? s.homeTeamId : s.awayTeamId,
      teamName: g.isHome ? s.homeTeamName : s.awayTeamName,
      opponentTeamId: g.opponentTeamId,
      opponentTeamName: g.opponentTeamName,
      isHome: g.isHome,
      date: g.date,
      scheduleKey: g.scheduleKey,
    });
  }
  return out;
}

async function buildSeason(season: string): Promise<boolean> {
  const games = await loadSeasonGames(season);
  if (games.length === 0) return false;
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  const summaryByKey = new Map(summaries.map((s) => [s.scheduleKey, s]));
  const players = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"))) ?? [];
  const nameById = new Map(players.map((p) => [p.playerId, p.name]));

  const byGameType = { regular: {}, playoff: {}, both: {} } as PlayerGameRecordsFile["byGameType"];
  for (const gameType of GAME_TYPES) {
    const scoped = filterByGameType(games, gameType);
    for (const def of PLAYER_GAME_RECORD_STATS) {
      const pool = def.filter ? scoped.filter(def.filter) : scoped;
      const entries = topEntries(pool, def.value, summaryByKey, nameById);
      if (entries.length > 0) byGameType[gameType][def.key] = entries;
    }
  }
  const file: PlayerGameRecordsFile = { generatedAt: new Date().toISOString(), season, byGameType };
  return writeJsonIfChanged(path.join(DATA_DIR, season, "player-game-records.json"), file as unknown as Record<string, unknown>);
}

async function main() {
  const args = process.argv.slice(2);
  const seasonArg = args.indexOf("--season");
  const seasons = args.includes("--all")
    ? readdirSync(DATA_DIR, { withFileTypes: true })
        .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
        .map((e) => e.name)
        .sort()
    : seasonArg >= 0 && args[seasonArg + 1]
      ? [args[seasonArg + 1]!]
      : [];
  if (seasons.length === 0) {
    console.error("--season <YYYY-YY> か --all を指定してください");
    process.exit(1);
  }
  for (const season of seasons) {
    const changed = await buildSeason(season);
    console.log(`${season}: ${changed ? "保存しました" : "変化なし（または対象の試合なし）"}`);
  }
}

await main();
