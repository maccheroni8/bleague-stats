// data/{season}/fouls.json.gz（ファウルの導出データ。形式は shared/foulsIndex.ts）を生成する。
// 1試合行の索引（aggregate-game-index.ts）を先に作っておく（試合の並び・チーム辞書・選手名をそこから使う）。
// 導出データなのでコミットしない（デプロイのときに npm run build:data が作る）。
//
// 使い方:
//   node --experimental-strip-types scripts/aggregate-fouls-index.ts --season 2026-27 [--category one]

import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName, writeJsonIfChanged } from "./lib/storage.ts";
import type { Category } from "../shared/types.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { buildFoulsIndex } from "./lib/foulsIndexBuild.ts";

async function main() {
  const args = process.argv.slice(2);
  const seasonArg = args.indexOf("--season");
  const season = seasonArg >= 0 ? args[seasonArg + 1] : undefined;
  if (!season || !/^\d{4}-\d{2}$/.test(season)) {
    console.error("--season <YYYY-YY> を指定してください");
    process.exit(1);
  }
  const categoryArg = args.indexOf("--category");
  const category = (categoryArg >= 0 ? args[categoryArg + 1] : "premier") as Category;
  if (category !== "premier" && category !== "one") {
    console.error("--category は premier か one を指定してください");
    process.exit(1);
  }
  const dir = path.join(DATA_DIR, seasonDirName(season, category));
  const teamIndex = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  const name = category === "one" ? `${season} B.ONE` : season;
  if (!teamIndex) {
    console.log(`${name}: 1試合行の索引が無いので作りません`);
    return;
  }
  const playerIndex = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
  const built = buildFoulsIndex(season, teamIndex, playerIndex, await readAllGames(season, category));
  const changed = await writeJsonIfChanged(path.join(dir, "fouls.json"), built as unknown as Record<string, unknown>, ["generatedAt"], false);
  console.log(`${name}: ${changed ? "保存しました" : "変化なし"}`);
}

await main();
