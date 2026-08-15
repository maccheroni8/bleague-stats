// 過去シーズンの一括バックフィル（Phase 5、DESIGN.md 2-7章）。ローカル環境でバックグラウンド
// 実行する想定（GitHub Actionsの通常cronとは別。数時間規模かかる）。
//
// シーズンを1つずつ順番に処理する（並列実行しない。レート制限はscrape-schedule.ts/
// scrape-boxscore.ts内の各throttledFetchが2.5秒間隔を個別に守る）:
//   1. schedule.jsonが無ければ全ScheduleKeyを収集（フル収集、DEFAULT_EVENTS=[2,3]）
//   2. scrape-boxscore.tsの通常ロジックで試合を取得（既にstatus="final"の試合は自動スキップ）
//   3. aggregate.tsで再集計
//
// 再開可能性: 2の「既にfinalな試合をスキップ」する既存ロジックがそのまま効くため、
// 中断後に再実行すれば未取得分だけ処理される（進捗ファイルを別途持つ必要が無い）。
// schedule.jsonは1シーズン分をまとめて1回で書き込むため、収集の途中で中断した場合は
// そのシーズンのスケジュール収集をやり直す（試合本体の取得と違い、ここは再開できない。
// ただし全体の所要時間に占める割合は小さい）。
//
// 使い方:
//   node --experimental-strip-types scripts/backfill.ts                      # デフォルト範囲
//   node --experimental-strip-types scripts/backfill.ts 2016-17 2017-18      # シーズンを指定

import path from "node:path";
import { scrapeSeasonSchedule } from "./scrape-schedule.ts";
import { runForSeason } from "./scrape-boxscore.ts";
import { aggregateSeason } from "./aggregate.ts";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { ScheduleFile } from "../shared/types.ts";

// 2025-26は当初「現行シーズンとして通常運用（cron）でカバー済み」としていたが、
// シーズン終了に伴い他シーズンと同様にフルバックフィル対象とする。
// 2026-27（B.PREMIER）は開幕前のため対象データが無い
const DEFAULT_SEASONS = [
  "2016-17",
  "2017-18",
  "2018-19",
  "2019-20",
  "2020-21",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
];

// 空または極端に少ないscheduleKeysを「収集済み」と誤認しないための下限値。
// 実データ最小の2019-20（COVID短縮シーズン）でも367試合あるため、
// 十分に安全マージンを取った値にしておく。
const MIN_REASONABLE_SCHEDULE_GAMES = 100;

async function backfillSeason(season: string): Promise<void> {
  console.log(`\n========== [${season}] バックフィル開始 (${new Date().toISOString()}) ==========`);

  const schedulePath = path.join(DATA_DIR, season, "schedule.json");
  const existingSchedule = await readJson<ScheduleFile>(schedulePath);
  if (existingSchedule && existingSchedule.scheduleKeys.length >= MIN_REASONABLE_SCHEDULE_GAMES) {
    console.log(`[${season}] スケジュール取得済み（${existingSchedule.scheduleKeys.length}試合）、収集をスキップ`);
  } else {
    if (existingSchedule) {
      console.log(`[${season}] 既存のschedule.jsonは${existingSchedule.scheduleKeys.length}試合と件数が異常に少ないため、収集をやり直します`);
    }
    console.log(`[${season}] スケジュール収集中...`);
    const scheduleKeys = await scrapeSeasonSchedule(season);
    await writeJson(schedulePath, { season, generatedAt: new Date().toISOString(), scheduleKeys });
    console.log(`[${season}] スケジュール収集完了: ${scheduleKeys.length}試合`);
  }

  console.log(`[${season}] ボックススコア取得中...`);
  await runForSeason(season);

  console.log(`[${season}] 集計中...`);
  await aggregateSeason(season);

  console.log(`[${season}] 完了 (${new Date().toISOString()})`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasons = args.length > 0 ? args : DEFAULT_SEASONS;

  console.log(`バックフィル対象: ${seasons.join(", ")}`);
  for (const season of seasons) {
    await backfillSeason(season);
  }
  console.log(`\n全シーズンのバックフィルが完了しました (${new Date().toISOString()})`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
