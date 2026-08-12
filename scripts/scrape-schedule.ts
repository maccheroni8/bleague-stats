// bleague.jp/schedule/ の裏側JSON（?data_format=json）からScheduleKeyを収集し、
// data/{season}/schedule.jsonに保存する。
//
// 仕組み（ブラウザのネットワークログから発見）:
//   GET https://www.bleague.jp/schedule/?data_format=json&year={year}&mon={mon}&day={day}&event={event}&club=&tab=1&ha=&fb=
//   → { topics: string[] } で、指定日に試合があればその日の試合カードHTML断片一覧、
//     無ければ次の開催日にスナップして返る。day=01〜31を総当たりし、ScheduleKeyをdedupeすれば
//     その月の全試合を漏れなく拾える。
//   year: シーズン開始年（"2025-26"シーズンなら2025固定。1〜5月の試合でも2025のまま）
//   event: 2=B1リーグ, 3=B1チャンピオンシップ, 5=オールスターゲーム
//
// 2モードあり（DESIGN.md 8-2章: フル収集は日次cronに含めない）:
//   フル収集: 全月×全日を総当たり。約500リクエスト・20分。シーズン開幕時/日程変更時に手動実行
//   --recent N: 直近N日分の日付だけ問い合わせ、既存schedule.jsonにマージ。日次cron向けの軽量版
//
// 使い方:
//   npm run scrape:schedule -- --season 2025-26 [--events 2,3]        # フル収集
//   npm run scrape:schedule -- --season 2025-26 --recent 14           # 直近14日の軽量チェック

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, writeJson } from "./lib/storage.ts";
import { seasonStartYearForDate } from "./lib/season.ts";
import { isMainModule } from "./lib/isMain.ts";
import type { ScheduleFile } from "./lib/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

// B.LEAGUEのシーズンは10月開幕・5月終了（DESIGN.md 1章）
const SEASON_MONTHS = ["10", "11", "12", "01", "02", "03", "04", "05"];

/** 2=B1リーグ, 3=B1チャンピオンシップ。オールスター(5)は対象外（DESIGN.md 1章: B.PREMIER優先） */
const DEFAULT_EVENTS = [2, 3];

interface ScheduleJsonResponse {
  topics: string[];
}

function extractScheduleKeys(topics: string[]): string[] {
  const html = topics.join("");
  return [...new Set([...html.matchAll(/ScheduleKey=(\d+)/g)].map((m) => m[1]!))];
}

async function fetchDaySchedule(year: number, mon: string, day: string, event: number): Promise<string[]> {
  const url = `https://www.bleague.jp/schedule/?data_format=json&year=${year}&mon=${mon}&day=${day}&event=${event}&club=&tab=1&ha=&fb=`;
  const res = await throttledFetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  const data = (await res.json()) as ScheduleJsonResponse;
  return extractScheduleKeys(data.topics);
}

async function fetchMonthScheduleKeys(year: number, mon: string, event: number): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let day = 1; day <= 31; day++) {
    const dayStr = String(day).padStart(2, "0");
    for (const key of await fetchDaySchedule(year, mon, dayStr, event)) {
      keys.add(key);
    }
  }
  return keys;
}

export async function scrapeSeasonSchedule(season: string, events: number[] = DEFAULT_EVENTS): Promise<string[]> {
  const year = Number(season.split("-")[0]);
  const allKeys = new Set<string>();

  for (const event of events) {
    for (const mon of SEASON_MONTHS) {
      const monthKeys = await fetchMonthScheduleKeys(year, mon, event);
      for (const key of monthKeys) allKeys.add(key);
      console.log(`[${season}] event=${event} mon=${mon}: ${monthKeys.size}件（累計${allKeys.size}件）`);
    }
  }

  return [...allKeys].sort();
}

/**
 * 直近days日分の日付だけ問い合わせる軽量版（DESIGN.md 8-2章）。日次cronはこちらを使う。
 * seasonに属さない日付（オフシーズンをまたぐ等）は自動的にスキップする。
 */
export async function scrapeRecentSchedule(
  season: string,
  days: number,
  events: number[] = DEFAULT_EVENTS,
  referenceDate: Date = new Date(),
): Promise<string[]> {
  const seasonYear = Number(season.split("-")[0]);
  const foundKeys = new Set<string>();

  for (let i = 0; i < days; i++) {
    const target = new Date(referenceDate.getTime() - i * 86_400_000);
    if (seasonStartYearForDate(target) !== seasonYear) continue;

    const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(target);
    const [, monStr, dayStr] = jst.split("-") as [string, string, string];

    for (const event of events) {
      for (const key of await fetchDaySchedule(seasonYear, monStr, dayStr, event)) {
        foundKeys.add(key);
      }
    }
  }

  return [...foundKeys].sort();
}

async function readExistingScheduleKeys(outPath: string): Promise<string[]> {
  if (!existsSync(outPath)) return [];
  const text = await readFile(outPath, "utf-8");
  return (JSON.parse(text) as ScheduleFile).scheduleKeys;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error("使い方: scrape-schedule.ts --season 2025-26 [--events 2,3] [--recent 14]");
    process.exitCode = 1;
    return;
  }

  const eventsIndex = args.indexOf("--events");
  const events = eventsIndex !== -1 ? args[eventsIndex + 1]!.split(",").map(Number) : DEFAULT_EVENTS;
  const outPath = path.join(DATA_DIR, season, "schedule.json");

  const recentIndex = args.indexOf("--recent");
  if (recentIndex !== -1) {
    const days = Number(args[recentIndex + 1] ?? "14");
    const existingKeys = await readExistingScheduleKeys(outPath);
    const recentKeys = await scrapeRecentSchedule(season, days, events);
    const mergedKeys = [...new Set([...existingKeys, ...recentKeys])].sort();
    const addedCount = mergedKeys.length - existingKeys.length;

    await writeJson(outPath, { season, generatedAt: new Date().toISOString(), scheduleKeys: mergedKeys });
    console.log(
      `[${season}] 直近${days}日の軽量チェック完了: 新規${addedCount}件（累計${mergedKeys.length}件）`,
    );
    return;
  }

  const scheduleKeys = await scrapeSeasonSchedule(season, events);
  await writeJson(outPath, {
    season,
    generatedAt: new Date().toISOString(),
    scheduleKeys,
  });
  console.log(`保存完了: ${outPath}（${scheduleKeys.length}試合）`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
