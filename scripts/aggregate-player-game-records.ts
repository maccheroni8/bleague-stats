// data/{season}/player-game-records.json（選手一覧「記録」タブの範囲「シーズン」、選手の1試合の記録。DESIGN.md 159章）を生成する。
//
// そのシーズンの全選手の試合ログ（data/{season}/player-games/{playerId}.json.gz）から、shared/playerGameRecords.ts の項目ごとに
// 上位20位（同じ記録はすべて）だけを書き出す。画面が全選手の試合ログ（1シーズン約430ファイル）を読まずに済むようにするため。
// 試合区分はレギュラーシーズン・ポストシーズン・合算。出場した試合（min>0）で、そのシーズンの試合一覧（games-summary.json）にある試合だけが対象
// （オールスター等は含めない）。記録した試合の所属チームは、試合一覧のホーム/アウェイから決める（シーズン途中の移籍にも合う）。
//
// 夜間実行（update-stats.yml のディープrecheck）で、進行中のシーズンについて毎晩作り直す。作った時刻以外が前回と同じならファイルを書き換えない。
//
// 使い方:
//   npm run aggregate:player-game-records -- --season 2025-26
//   npm run aggregate:player-game-records -- --all

import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, writeJsonIfChanged } from "./lib/storage.ts";
import { loadSeasonRecordGames, topRecordEntries } from "./lib/playerGameRecordsTop.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { PLAYER_GAME_RECORD_STATS } from "../shared/playerGameRecords.ts";
import type { LeagueRankingGameType, PlayerGameRecordsFile } from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;
const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

async function buildSeason(season: string): Promise<boolean> {
  const games = await loadSeasonRecordGames(season);
  if (games.length === 0) return false;

  const byGameType = { regular: {}, playoff: {}, both: {} } as PlayerGameRecordsFile["byGameType"];
  for (const gameType of GAME_TYPES) {
    const scoped = filterByGameType(games, gameType);
    for (const def of PLAYER_GAME_RECORD_STATS) {
      const pool = def.filter ? scoped.filter(def.filter) : scoped;
      const entries = topRecordEntries(pool, def.value, def.fraction);
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
