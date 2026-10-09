// data/{season}/player-game-index.json.gz・team-game-index.json.gz（1試合行の索引。DESIGN.md 219章）を生成する。
//
// 選手・チームの試合ログと試合の要約から、ランキングの1試合記録の条件・昇順・連続記録などに使う項目を、1シーズン1ファイルに列ごとにまとめる。
// 導出データなのでコミットしない。デプロイのときに npm run build:data が、シーズンごとの集計の一部として作る（過去のシーズンは保存から戻す）。
//
// 使い方:
//   npm run aggregate:game-index -- --season 2025-26
//   npm run aggregate:game-index -- --all

import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, writeJsonIfChanged } from "./lib/storage.ts";
import { buildGameIndex } from "./lib/gameIndexBuild.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;

async function buildSeason(season: string): Promise<boolean> {
  const built = await buildGameIndex(season);
  if (!built) return false;
  // 列ごとに数値を並べるので、字下げなしで書く
  const a = await writeJsonIfChanged(path.join(DATA_DIR, season, "player-game-index.json"), built.player as unknown as Record<string, unknown>, ["generatedAt"], false);
  const b = await writeJsonIfChanged(path.join(DATA_DIR, season, "team-game-index.json"), built.team as unknown as Record<string, unknown>, ["generatedAt"], false);
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
