// bleague.jp/schedule/ の裏側JSON（?data_format=json）からScheduleKeyを収集し、
// data/{season}/schedule.json（B.PREMIER）またはdata/{season}/{category}/schedule.json
// （B.ONE等）に保存する（DESIGN.md 14-5章の案A）。
//
// 仕組み（ブラウザのネットワークログから発見）:
//   GET https://www.bleague.jp/schedule/?data_format=json&year={year}&mon={mon}&day={day}&event={event}&club=&tab={tab}&ha=&fb=
//   → { topics: string[] } で、指定日に試合があればその日の試合カードHTML断片一覧、
//     無ければ次の開催日にスナップして返る。day=01〜31を総当たりし、ScheduleKeyをdedupeすれば
//     その月の全試合を漏れなく拾える。
//   year: シーズン開始年（"2025-26"シーズンなら2025固定。1〜5月の試合でも2025のまま）
//   event: 2=B1(B.PREMIER)リーグ, 3=B1(B.PREMIER)チャンピオンシップ, 5=オールスターゲーム,
//          7=B2(B.ONE)。B.ONEはレギュラーシーズンとプレーオフ（"PLAYOFFS"表記）が同じevent=7に
//          混在する（B.PREMIERのようにチャンピオンシップ用の別event番号は無い。2026-08-16確認、
//          DESIGN.md 14章）
//   tab: 1=B.PREMIER, 2=B.ONE, 3=B.NEXT。⚠️ eventだけを変えてもtabが伴わないとサーバー側の
//        フィルタが効かず、常にtab=1（B.PREMIER）相当の結果が返ってくる（2026-08-16、
//        B.ONE対応の実装時にこの不具合で誤ってB.PREMIERのスケジュールを取得してしまい発覚。
//        eventとtabは必ずカテゴリに応じたペアで指定すること。DESIGN.md 14章）
//
// 2モードあり（DESIGN.md 8-2章: フル収集は日次cronに含めない）:
//   フル収集: 全月×全日を総当たり。約500リクエスト・20分。シーズン開幕時/日程変更時に手動実行
//   --recent N: 直近N日分の日付だけ問い合わせ、既存schedule.jsonにマージ。日次cron向けの軽量版
//
// 使い方:
//   npm run scrape:schedule -- --season 2025-26 [--events 2,3]                  # フル収集(B.PREMIER)
//   npm run scrape:schedule -- --season 2025-26 --category one                  # フル収集(B.ONE)
//   npm run scrape:schedule -- --season 2025-26 --recent 14                     # 直近14日の軽量チェック
//   npm run scrape:schedule -- --season 2025-26 --recent 14 --verify-upcoming 14  # ＋今後14日の日程変更検知（深夜用）

import path from "node:path";
import { createThrottledFetch } from "./lib/throttle.ts";
import { DATA_DIR, listStoredScheduleKeys, readJson, seasonDirName, writeJson } from "./lib/storage.ts";
import { seasonStartYearForDate } from "./lib/season.ts";
import { isMainModule } from "./lib/isMain.ts";
import { fetchUpcomingGameEntry } from "./lib/upcomingGame.ts";
import type { Category, ScheduleFile, UpcomingGameEntry } from "../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

// B.LEAGUEのシーズンは主に10月開幕・5月終了だが、開幕戦が9月に前倒しされる年や
// ファイナルが6月にずれ込む年があるため、安全マージンを持たせて9月〜6月を走査する
// （DESIGN.md 1章・68章。2020-21ファイナルGAME3が6/1、2016-17開幕戦が9/22等の実例で
// 10〜5月固定では欠落することが2回判明したため、2026-08-29に固定範囲を拡張した）
const SEASON_MONTHS = ["09", "10", "11", "12", "01", "02", "03", "04", "05", "06"];

/**
 * カテゴリ別のデフォルトevent番号（DESIGN.md 14章）。
 * B.PREMIER: 2=リーグ戦, 3=チャンピオンシップ（オールスター5は対象外）。
 * B.ONE: 7のみ（レギュラーシーズン・プレーオフとも同じevent番号）
 */
const DEFAULT_EVENTS_BY_CATEGORY: Record<Category, number[]> = {
  premier: [2, 3],
  one: [7],
};

/** カテゴリ別のtab番号（DESIGN.md 14章）。eventと必ずペアで指定する（ファイル冒頭の注記参照） */
const CATEGORY_TAB: Record<Category, number> = {
  premier: 1,
  one: 2,
};

interface ScheduleJsonResponse {
  topics: string[];
}

function extractScheduleKeys(topics: string[]): string[] {
  const html = topics.join("");
  return [...new Set([...html.matchAll(/ScheduleKey=(\d+)/g)].map((m) => m[1]!))];
}

async function fetchDaySchedule(year: number, mon: string, day: string, event: number, tab: number): Promise<string[]> {
  const url = `https://www.bleague.jp/schedule/?data_format=json&year=${year}&mon=${mon}&day=${day}&event=${event}&club=&tab=${tab}&ha=&fb=`;
  const res = await throttledFetch(url);
  if (!res.ok) {
    throw new Error(`GET ${url} failed: ${res.status}`);
  }
  const data = (await res.json()) as ScheduleJsonResponse;
  return extractScheduleKeys(data.topics);
}

async function fetchMonthScheduleKeys(year: number, mon: string, event: number, tab: number): Promise<Set<string>> {
  const keys = new Set<string>();
  for (let day = 1; day <= 31; day++) {
    const dayStr = String(day).padStart(2, "0");
    for (const key of await fetchDaySchedule(year, mon, dayStr, event, tab)) {
      keys.add(key);
    }
  }
  return keys;
}

export async function scrapeSeasonSchedule(
  season: string,
  events: number[] = DEFAULT_EVENTS_BY_CATEGORY.premier,
  tab: number = CATEGORY_TAB.premier,
): Promise<string[]> {
  const year = Number(season.split("-")[0]);
  const allKeys = new Set<string>();

  for (const event of events) {
    for (const mon of SEASON_MONTHS) {
      const monthKeys = await fetchMonthScheduleKeys(year, mon, event, tab);
      for (const key of monthKeys) allKeys.add(key);
      console.log(`[${season}] event=${event} tab=${tab} mon=${mon}: ${monthKeys.size}件（累計${allKeys.size}件）`);
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
  events: number[] = DEFAULT_EVENTS_BY_CATEGORY.premier,
  referenceDate: Date = new Date(),
  tab: number = CATEGORY_TAB.premier,
): Promise<string[]> {
  const seasonYear = Number(season.split("-")[0]);
  const foundKeys = new Set<string>();

  for (let i = 0; i < days; i++) {
    const target = new Date(referenceDate.getTime() - i * 86_400_000);
    if (seasonStartYearForDate(target) !== seasonYear) continue;

    const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(target);
    const [, monStr, dayStr] = jst.split("-") as [string, string, string];

    for (const event of events) {
      for (const key of await fetchDaySchedule(seasonYear, monStr, dayStr, event, tab)) {
        foundKeys.add(key);
      }
    }
  }

  return [...foundKeys].sort();
}

export interface UpcomingWindowScan {
  firstDay: string;
  lastDay: string;
  /** 走査範囲の各日の問い合わせで返ってきたScheduleKey */
  keys: Set<string>;
}

/**
 * 今日から先days日分の日付を問い合わせ、そこに載っている試合のScheduleKeyを集める（深夜のみ。
 * DESIGN.md 8-7章）。日程JSONは試合の無い日を指定すると前後どちらかの開催日にスナップして返し
 * （2026-09-24実機確認: 9/28〜30→9/27、10/1→10/2、10/5〜6→10/7。向きは一定しない）、カードにも
 * 日付が無いため、ここからは個々の試合の開催日は判定しない。「範囲内に載っている」ことだけを使う
 */
export async function scanUpcomingWindow(
  season: string,
  days: number,
  events: number[],
  tab: number,
  referenceDate: Date = new Date(),
): Promise<UpcomingWindowScan | null> {
  const seasonYear = Number(season.split("-")[0]);
  const keys = new Set<string>();
  const queriedDays: string[] = [];

  for (let i = 0; i < days; i++) {
    const target = new Date(referenceDate.getTime() + i * 86_400_000);
    if (seasonStartYearForDate(target) !== seasonYear) continue;
    const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(target);
    const [, monStr, dayStr] = jst.split("-") as [string, string, string];
    queriedDays.push(jst);
    for (const event of events) {
      for (const key of await fetchDaySchedule(seasonYear, monStr, dayStr, event, tab)) keys.add(key);
    }
  }

  if (queriedDays.length === 0) return null;
  return { firstDay: queriedDays[0]!, lastDay: queriedDays.at(-1)!, keys };
}

/**
 * game_detailページから開催予定（日付・ティップオフ時刻）を取り直すScheduleKeyを選ぶ。
 * 生データ取得済みの試合は対象外。
 * - 開催日が走査範囲の最終日以前（過去日を含む）の試合は全件: 直前の日付・時刻の変更と、
 *   開催日を過ぎても生データが無い試合（延期の可能性）の新しい日付を拾う
 * - 走査範囲に載っているのに、開催予定の日付が範囲より後の試合: 前倒しの可能性。範囲の終端付近では
 *   スナップで範囲直後の開催日の試合も返るため空振りしうるが、数件の追加リクエストで済む
 * - 走査範囲に載っているのに開催予定が未解決の試合
 */
export function selectUpcomingToRefresh(
  scan: UpcomingWindowScan,
  existingUpcoming: UpcomingGameEntry[],
  withBoxscore: Set<string>,
): { refresh: Set<string>; reasons: Record<string, number> } {
  const cached = new Map(existingUpcoming.map((g) => [g.scheduleKey, g]));
  const refresh = new Set<string>();
  const reasons: Record<string, number> = {};
  const mark = (key: string, reason: string) => {
    if (refresh.has(key)) return;
    refresh.add(key);
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  for (const entry of existingUpcoming) {
    if (withBoxscore.has(entry.scheduleKey)) continue;
    if (entry.date < scan.firstDay) mark(entry.scheduleKey, "開催日を過ぎても未取得");
    else if (entry.date <= scan.lastDay) mark(entry.scheduleKey, "範囲内");
  }
  for (const key of scan.keys) {
    if (withBoxscore.has(key)) continue;
    const entry = cached.get(key);
    if (!entry) mark(key, "開催予定が未解決");
    else if (entry.date > scan.lastDay) mark(key, "範囲より後の日付で範囲内に掲載");
  }

  return { refresh, reasons };
}

const TIPOFF_RETRY_WITHIN_DAYS = 14;

function isWithinDays(jstDate: string, days: number): boolean {
  return new Date(`${jstDate}T00:00:00+09:00`).getTime() - Date.now() <= days * 86_400_000;
}

/**
 * scheduleKeysのうち、生データ（games/）がまだ無い試合（開催予定）だけをgame_detailページから
 * 解決する。既に解決済み（existingUpcoming）なら再取得せず使い回し、生データが揃った試合は
 * 自然にこの一覧から外れる（日程ページはgames-summary.json側を見るようになる）
 */
async function resolveUpcomingGames(
  season: string,
  scheduleKeys: string[],
  existingUpcoming: UpcomingGameEntry[],
  category: Category,
  forceRefresh: Set<string> = new Set(),
): Promise<UpcomingGameEntry[]> {
  const withBoxscore = await listStoredScheduleKeys(season, category);
  const cached = new Map(existingUpcoming.map((g) => [g.scheduleKey, g]));
  const result: UpcomingGameEntry[] = [];

  for (const key of scheduleKeys) {
    if (withBoxscore.has(key)) continue;
    const existing = cached.get(key);
    // tipoffTime未解決のエントリは再取得して補完する。ただし公式サイトで「TIP OFF調整中」の
    // 試合（シーズン後半の日程は時刻未定のまま公開される）を毎回問い合わせると数百件になるため、
    // 再取得するのは試合日がTIPOFF_RETRY_WITHIN_DAYS日以内に迫ったものだけにする
    const refresh = forceRefresh.has(key);
    if (existing && !refresh && (existing.tipoffTime || !isWithinDays(existing.date, TIPOFF_RETRY_WITHIN_DAYS))) {
      result.push(existing);
      continue;
    }
    const entry = await fetchUpcomingGameEntry(key);
    if (entry) {
      if (!existing) {
        console.log(
          `[${season}] 開催予定を解決: ScheduleKey=${key} ${entry.date} ${entry.homeTeamName} vs ${entry.awayTeamName}`,
        );
      } else if (entry.date !== existing.date || entry.tipoffTime !== existing.tipoffTime) {
        console.log(
          `[${season}] 開催予定を更新: ScheduleKey=${key} ${existing.date} ${existing.tipoffTime ?? "時刻未定"} → ${entry.date} ${entry.tipoffTime ?? "時刻未定"}`,
        );
      }
      result.push(entry);
    } else if (existing) {
      // 取り直しに失敗したら既存の情報を残す（消すと頻繁チェックの判定対象から外れるため）
      console.warn(`[${season}] 開催予定の再取得に失敗（既存の情報を維持）: ScheduleKey=${key}`);
      result.push(existing);
    } else {
      console.warn(`[${season}] 開催予定の解決に失敗（次回再試行）: ScheduleKey=${key}`);
    }
  }

  return result;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonIndex = args.indexOf("--season");
  const season = seasonIndex !== -1 ? args[seasonIndex + 1] : undefined;
  if (!season) {
    console.error(
      "使い方: scrape-schedule.ts --season 2025-26 [--category one] [--events 2,3] [--recent 14 [--verify-upcoming 14]]",
    );
    process.exitCode = 1;
    return;
  }

  const categoryIndex = args.indexOf("--category");
  const category: Category = categoryIndex !== -1 ? (args[categoryIndex + 1] as Category) : "premier";

  const eventsIndex = args.indexOf("--events");
  const events =
    eventsIndex !== -1 ? args[eventsIndex + 1]!.split(",").map(Number) : DEFAULT_EVENTS_BY_CATEGORY[category];
  const tab = CATEGORY_TAB[category];
  const outPath = path.join(DATA_DIR, seasonDirName(season, category), "schedule.json");

  const recentIndex = args.indexOf("--recent");
  if (recentIndex !== -1) {
    const days = Number(args[recentIndex + 1] ?? "14");
    const existingFile = await readJson<ScheduleFile>(outPath);
    const existingKeys = existingFile?.scheduleKeys ?? [];
    const recentKeys = await scrapeRecentSchedule(season, days, events, new Date(), tab);

    // 深夜のみ: 今後N日分の日程も問い合わせ、開催予定の日付・時刻の変更を検知する（DESIGN.md 8-7章）
    const verifyIndex = args.indexOf("--verify-upcoming");
    let forceRefresh = new Set<string>();
    let windowKeys: string[] = [];
    if (verifyIndex !== -1) {
      const verifyDays = Number(args[verifyIndex + 1] ?? "14");
      const scan = await scanUpcomingWindow(season, verifyDays, events, tab);
      if (scan) {
        windowKeys = [...scan.keys];
        const detected = selectUpcomingToRefresh(
          scan,
          existingFile?.upcomingGames ?? [],
          await listStoredScheduleKeys(season, category),
        );
        forceRefresh = detected.refresh;
        const summary = Object.entries(detected.reasons).map(([r, n]) => `${r}${n}件`).join("・") || "なし";
        console.log(
          `[${season}] 今後${verifyDays}日の日程確認（${scan.firstDay}〜${scan.lastDay}、掲載${scan.keys.size}試合）: 開催予定の取り直し対象 ${summary}`,
        );
      }
    }

    const mergedKeys = [...new Set([...existingKeys, ...recentKeys, ...windowKeys])].sort();
    const addedCount = mergedKeys.length - existingKeys.length;
    const upcomingGames = await resolveUpcomingGames(
      season,
      mergedKeys,
      existingFile?.upcomingGames ?? [],
      category,
      forceRefresh,
    );

    await writeJson(outPath, {
      season,
      generatedAt: new Date().toISOString(),
      scheduleKeys: mergedKeys,
      upcomingGames,
    });
    console.log(
      `[${season}] 直近${days}日の軽量チェック完了: 新規${addedCount}件（累計${mergedKeys.length}件） ／ 開催予定${upcomingGames.length}件`,
    );
    return;
  }

  const scheduleKeys = await scrapeSeasonSchedule(season, events, tab);
  const existingFile = await readJson<ScheduleFile>(outPath);
  const upcomingGames = await resolveUpcomingGames(season, scheduleKeys, existingFile?.upcomingGames ?? [], category);
  await writeJson(outPath, {
    season,
    generatedAt: new Date().toISOString(),
    scheduleKeys,
    upcomingGames,
  });
  console.log(`保存完了: ${outPath}（${scheduleKeys.length}試合／開催予定${upcomingGames.length}件）`);
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
