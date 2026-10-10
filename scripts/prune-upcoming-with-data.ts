// schedule.json の upcomingGames から、生データ（games/）がある試合を外す（DESIGN.md 227章）。
// 生データが揃った試合は開催予定ではない。更新ジョブは次の実行で自然に外す（resolveUpcomingGames）が、更新の対象でない
// 過去のシーズン・B.ONEには、外れないまま残っていたため、一度だけ整理する。
// 今のシーズンは更新ジョブが毎回書き換えるので対象外（手元で書き換えるとボットのコミットと衝突する）。
//
// 使い方: node --experimental-strip-types scripts/prune-upcoming-with-data.ts [--dry-run]
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, listStoredScheduleKeys, readJson, seasonDirName, writeJson } from "./lib/storage.ts";
import { currentSeason } from "./lib/season.ts";
import { dropUpcomingWithData } from "./lib/scheduleCancelled.ts";
import type { Category } from "../shared/types.ts";
import type { ScheduleFileWithCancelled } from "../shared/scheduleCancelled.ts";

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const current = currentSeason();
  const seasons = readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
  let total = 0;
  for (const season of seasons) {
    if (season === current) {
      console.log(`${season}: 今のシーズンは更新ジョブが整理するので対象外`);
      continue;
    }
    for (const category of ["premier", "one"] as Category[]) {
      const file = path.join(DATA_DIR, seasonDirName(season, category), "schedule.json");
      if (!existsSync(`${file}.gz`)) continue;
      const schedule = await readJson<ScheduleFileWithCancelled>(file);
      if (!schedule) continue;
      const withData = await listStoredScheduleKeys(season, category);
      const before = schedule.upcomingGames ?? [];
      const after = dropUpcomingWithData(before, withData);
      const dropped = before.length - after.length;
      if (dropped === 0) continue;
      total += dropped;
      console.log(`${season}${category === "one" ? "（B.ONE）" : ""}: 開催予定 ${before.length} → ${after.length}（生データがある${dropped}件を外す）`);
      if (!dryRun) await writeJson(file, { ...schedule, upcomingGames: after });
    }
  }
  console.log(`${dryRun ? "（確認のみ）" : ""}合計 ${total} 件`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
