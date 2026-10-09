// data/{season}/player-period-index.json.gz・team-period-index.json.gz（ピリオド別の索引。DESIGN.md 225章）を生成する。
//
// 選手×試合×ピリオド、チーム×試合×ピリオドの成績を、シーズンごとに列ごとにまとめる。値はシーズン成績のQ別・前後半と同じ関数で、試合の生データから出す。
// 1試合行の索引（aggregate-game-index.ts）を先に作っておく。導出データなのでコミットしない（デプロイのときに npm run build:data が作る）。
//
// 使い方:
//   npm run aggregate:period-index -- --season 2025-26
//   npm run aggregate:period-index -- --all

import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, writeJsonIfChanged } from "./lib/storage.ts";
import { buildPeriodIndex } from "./lib/periodIndexBuild.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

async function buildSeason(season: string): Promise<boolean> {
  const built = await buildPeriodIndex(season);
  if (!built) return false;
  // 列ごとに数値を並べるので、字下げなしで書く
  const a = await writeJsonIfChanged(path.join(DATA_DIR, season, "player-period-index.json"), built.player as unknown as Record<string, unknown>, ["generatedAt"], false);
  const b = await writeJsonIfChanged(path.join(DATA_DIR, season, "team-period-index.json"), built.team as unknown as Record<string, unknown>, ["generatedAt"], false);
  return a || b;
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
