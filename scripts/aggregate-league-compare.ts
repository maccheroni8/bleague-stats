// data/{season}/league-compare.json（比較ページ・チーム詳細の比較タブで選べる「リーグ平均」。DESIGN.md 149章）を生成する。
//
// チームの比較と同じ列定義（試合詳細のボックススコアの列）で比べられるよう、チームの比較の値を作る関数
// （src/lib/playerSeasonBoxscore.ts の buildTeamMultiGameBoxTotals）に、そのシーズンの全試合×両チーム分を渡して、
// 1チーム1試合あたりの平均を出す（割合は合計÷合計、1試合平均は合計÷延べ試合数。NBA準拠）。
// レギュラーシーズン・ポストシーズン・合算の3つ。シチュエーションの絞り込みは無い（シーズン全体）。オールスター等は含めない。
//
// src/lib は拡張子なしの import を使うため Node で直接読めない。esbuild で1ファイルにまとめてから実行する（npm run aggregate:league-compare）
//
// 使い方:
//   npm run aggregate:league-compare -- [--season 2025-26]   （省略時は全シーズン）

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { DATA_DIR, readAllGames, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { classifyGameType } from "./lib/gameType.ts";
import { isExhibitionGame } from "./lib/exhibitionGames.ts";
import { buildTeamMultiGameBoxTotals } from "../src/lib/playerSeasonBoxscore";
import type { LeagueCompareFile, SeasonEntry, StoredGame, YahooGamePbp, YahooTurnoverEvent } from "../shared/types.ts";

async function readYahooTurnovers(season: string, scheduleKey: string): Promise<YahooTurnoverEvent[]> {
  const file = path.join(DATA_DIR, season, "yahoo", `${scheduleKey}.json.gz`);
  if (!existsSync(file)) return [];
  const pbp = JSON.parse(gunzipSync(await readFile(file)).toString("utf-8")) as YahooGamePbp;
  return pbp.turnovers ?? [];
}

async function buildSeason(season: string, entry: SeasonEntry | undefined): Promise<LeagueCompareFile | null> {
  const games = (await readAllGames(season)).filter(
    (g) => g.gameEndedFlg && !isExhibitionGame(g.raw.Game.ConventionNameJ ?? ""),
  );
  if (games.length === 0) return null;
  const shotChartSupported = entry?.coverage === "full";
  const yahooPbpSupported = entry?.yahooPbp ?? false;
  const turnovers = new Map<string, YahooTurnoverEvent[]>();
  if (yahooPbpSupported) for (const g of games) turnovers.set(g.scheduleKey, await readYahooTurnovers(season, g.scheduleKey));

  const typeOf = (g: StoredGame) => classifyGameType(g.raw.Game.ConventionNameJ ?? "");
  const build = (list: StoredGame[]) =>
    buildTeamMultiGameBoxTotals(
      list.flatMap((game) => [
        { game, isHome: true },
        { game, isHome: false },
      ]),
      turnovers,
      shotChartSupported,
      yahooPbpSupported,
    );
  const regular = games.filter((g) => typeOf(g) === "regular");
  const playoff = games.filter((g) => typeOf(g) === "playoff");
  return {
    season,
    games: { regular: regular.length, playoff: playoff.length, both: regular.length + playoff.length },
    totals: { regular: build(regular), playoff: build(playoff), both: build([...regular, ...playoff]) },
  };
}

async function main() {
  const idx = process.argv.indexOf("--season");
  const seasonsFile = (await readJson<SeasonEntry[]>(path.join(DATA_DIR, "seasons.json"))) ?? [];
  const seasons =
    idx >= 0
      ? [process.argv[idx + 1]!]
      : readdirSync(DATA_DIR)
          .filter((d) => /^\d{4}-\d{2}$/.test(d))
          .sort();
  for (const season of seasons) {
    const file = await buildSeason(season, seasonsFile.find((s) => s.season === season));
    if (!file) continue;
    const changed = await writeJsonIfChanged(path.join(DATA_DIR, season, "league-compare.json"), file as unknown as Record<string, unknown>, []);
    console.log(`${season}: レギュラー${file.games.regular}試合・ポストシーズン${file.games.playoff}試合${changed ? "" : "（変化なし）"}`);
  }
}

main();
