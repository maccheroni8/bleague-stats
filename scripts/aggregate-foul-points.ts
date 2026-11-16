// data/{season}/foul-points.json.gz（反則ポイントの導出データ。形式は shared/foulPoints.ts）を生成する（DESIGN.md 416章）。
// 1試合行の索引（aggregate-game-index.ts）を先に作っておく（試合の並び・チーム辞書をそこから使う）。
// 出場停止・コーチの退場は、台帳から作った元データ data/{season}/foul-penalties.json.gz（scripts/build-foul-penalties.ts）を読む。無ければ0件。
// 導出データなのでコミットしない（デプロイのときに npm run build:data が作る）。
//
// 使い方:
//   node --experimental-strip-types scripts/aggregate-foul-points.ts --season 2026-27 [--category one]

import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName, writeJsonIfChanged } from "./lib/storage.ts";
import type { Category } from "../shared/types.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import { buildFoulPoints, type FoulPenaltiesFile } from "../shared/foulPoints.ts";

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
  const name = category === "one" ? `${season} B.ONE` : season;
  const teamIndex = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  if (!teamIndex) {
    console.log(`${name}: 1試合行の索引が無いので作りません`);
    return;
  }
  const penalties = await readJson<FoulPenaltiesFile>(path.join(dir, "foul-penalties.json"));
  const built = buildFoulPoints(season, teamIndex, await readAllGames(season, category), penalties?.rows ?? []);
  const changed = await writeJsonIfChanged(path.join(dir, "foul-points.json"), built as unknown as Record<string, unknown>, ["generatedAt"], false);
  console.log(`${name}: ${changed ? "保存しました" : "変化なし"}（台帳の行 ${built.penalties.length}）`);
}

await main();
