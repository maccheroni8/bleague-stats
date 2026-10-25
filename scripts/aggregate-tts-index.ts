// data/{season}/team-tts.json.gz（Time to Shot の導出データ）を生成する。
// 1試合行の索引（aggregate-game-index.ts）を先に作っておく。導出データなのでコミットしない（デプロイのときに npm run build:data が作る）。
// 2020-21 より前のシーズンは作らない。
//
// 使い方:
//   npm run aggregate:tts-index -- --season 2025-26
//   npm run aggregate:tts-index -- --all

import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, seasonDirName, writeJsonIfChanged } from "./lib/storage.ts";
import type { Category } from "../shared/types.ts";
import { buildTtsIndex } from "./lib/ttsIndexBuild.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

async function buildSeason(season: string, category: Category): Promise<boolean> {
  const built = await buildTtsIndex(season, category);
  if (!built) return false;
  return writeJsonIfChanged(path.join(DATA_DIR, seasonDirName(season, category), "team-tts.json"), built as unknown as Record<string, unknown>, ["generatedAt"], false);
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
  // --category one: B.ONE（data/{season}/one/。DESIGN.md 295章）。省略は B.PREMIER
  const categoryArg = args.indexOf("--category");
  const category = (categoryArg >= 0 ? args[categoryArg + 1] : "premier") as Category;
  if (category !== "premier" && category !== "one") {
    console.error("--category は premier か one を指定してください");
    process.exit(1);
  }
  for (const season of seasons) {
    const changed = await buildSeason(season, category);
    console.log(`${category === "one" ? `${season} B.ONE` : season}: ${changed ? "保存しました" : "変化なし（または対象外）"}`);
  }
}

await main();
