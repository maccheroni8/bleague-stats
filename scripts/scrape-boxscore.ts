// 1試合分のボックススコア・PBPを取得し、data/{season}/games/{scheduleKey}.jsonに保存する。
// DESIGN.md 5章（保存スキーマ）・8章（再チェック・差分検知運用）・2-7章（バックフィル方針）を実装。
//
// データ源は2層構成（DESIGN.md 2-7章）:
//   - 2020-21シーズン以降: genius_contexts API本体を直接叩く（従来通り）
//   - 2016-17〜2019-20シーズン: genius_contexts APIが403で使えないため、game_detailページに
//     埋め込まれた同一構造のJSONを代わりに使う（lib/legacyGameDetail.ts）。
//   呼び出し側でシーズンを事前判定する必要は無く、genius_contexts APIが失敗した場合に
//   自動的にlegacy取得へフォールバックする（結果的に境界年で自然に切り替わる）
//
// 使い方:
//   npm run scrape:boxscore -- 505076 505118                     # ScheduleKeyを直接指定
//   npm run scrape:boxscore -- --season 2025-26                  # そのシーズンのschedule.jsonから
//                                                                   未取得試合（開催予定はティップオフ+2時間
//                                                                   経過後のみ）＋再チェック対象(watching)をまとめて処理
//   npm run scrape:boxscore -- --season 2025-26 --category one   # B.ONE分（保存先はdata/{season}/one/games/）
//   npm run scrape:boxscore -- --season 2025-26 --new-only        # 新着試合のみ処理し、
//                                                                   watching再チェック対象はスキップする
//                                                                   （8-1章: 30分おきの頻繁チェック向け）

import path from "node:path";
import { fetchLatestGameContext, getPeriodScores, parseAspNetDate } from "./lib/geniusApi.ts";
import { fetchLegacyGameContext, legacyPeriodScores, parseLegacyGameDateTime } from "./lib/legacyGameDetail.ts";
import {
  gameFilePath,
  readGameFile,
  readJson,
  writeGameFile,
  seasonFromYear,
  seasonDirName,
  DATA_DIR,
} from "./lib/storage.ts";
import type { Category, GeniusContext, ScheduleFile, StoredGame, StoredGameMeta } from "../shared/types.ts";
import { isMainModule } from "./lib/isMain.ts";
import { isDue } from "./lib/pendingGames.ts";
import { applyPlayerIdCorrections } from "./lib/playerIdCorrections.ts";

const WATCHING_PERIOD_DAYS = 14;

function formatJstDate(date: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
}

function computeStatus(gameEndedFlg: boolean, jstDateStr: string): "watching" | "final" {
  if (!gameEndedFlg) return "watching";
  const daysSince = (Date.now() - new Date(`${jstDateStr}T00:00:00+09:00`).getTime()) / 86_400_000;
  return daysSince > WATCHING_PERIOD_DAYS ? "final" : "watching";
}

export type ScrapeResult =
  | { outcome: "no-data"; scheduleKey: string }
  | { outcome: "not-played-yet"; scheduleKey: string }
  | { outcome: "saved"; scheduleKey: string; season: string; changed: boolean; status: StoredGameMeta["status"] };

async function fetchGameContextWithFallback(
  key: string,
): Promise<{ context: GeniusContext; latestId: number; isLegacy: boolean } | null> {
  const apiResult = await fetchLatestGameContext(key);
  if (apiResult) {
    return { context: apiResult.context, latestId: apiResult.latestId, isLegacy: false };
  }
  // genius_contexts APIが失敗した場合（2019-20以前の403を含む）、game_detailページ埋め込みJSONに
  // フォールバックする。latestidの概念が無いlegacy取得では0固定にする（DESIGN.md 2-7章）
  const legacyContext = await fetchLegacyGameContext(key);
  if (!legacyContext) return null;
  return { context: legacyContext, latestId: 0, isLegacy: true };
}

export async function scrapeAndSaveGame(
  scheduleKey: string | number,
  category: Category = "premier",
): Promise<ScrapeResult> {
  const key = String(scheduleKey);
  const result = await fetchGameContextWithFallback(key);
  if (!result) {
    return { outcome: "no-data", scheduleKey: key };
  }
  const { latestId, isLegacy } = result;
  // bleague.jp側で選手IDが誤って記録されている試合は、保存前に訂正する（playerIdCorrections.ts）
  const context = applyPlayerIdCorrections(key, result.context);
  const { Game } = context;

  if (!Game.BoxscoreExistsFlg && !Game.GameEndedFlg) {
    // 試合未実施・データ未整備。保存対象外
    return { outcome: "not-played-yet", scheduleKey: key };
  }

  const gameDate = isLegacy ? parseLegacyGameDateTime(Game.GameDateTime) : parseAspNetDate(Game.GameDateTime);
  const dateStr = formatJstDate(gameDate);
  const season = seasonFromYear(Game.Year);
  const filePath = gameFilePath(season, key, category);

  const existing = await readGameFile(filePath);
  const isFirstScrape = existing === null;
  const rawChanged = !isFirstScrape && JSON.stringify(existing.raw) !== JSON.stringify(context);

  const now = new Date().toISOString();
  const meta: StoredGameMeta = {
    firstScrapedAt: existing?.meta.firstScrapedAt ?? now,
    lastCheckedAt: now,
    lastChangedAt: isFirstScrape || rawChanged ? now : existing.meta.lastChangedAt,
    status: computeStatus(Game.GameEndedFlg, dateStr),
    revisionCount: isFirstScrape ? 0 : rawChanged ? existing.meta.revisionCount + 1 : existing.meta.revisionCount,
    latestRevisionId: latestId,
  };

  const stored: StoredGame = {
    scheduleKey: key,
    season,
    date: dateStr,
    meta,
    homeTeam: { id: Game.HomeTeamID, name: Game.HomeTeamNameJ },
    awayTeam: { id: Game.AwayTeamID, name: Game.AwayTeamNameJ },
    homeScore: Game.HomeTeamScore,
    awayScore: Game.AwayTeamScore,
    quarterScores: {
      home: isLegacy ? legacyPeriodScores(Game, "Home") : getPeriodScores(Game, "Home"),
      away: isLegacy ? legacyPeriodScores(Game, "Away") : getPeriodScores(Game, "Away"),
    },
    gameEndedFlg: Game.GameEndedFlg,
    recordFixedFlg: Game.RecordFixedFlg,
    raw: context,
  };

  await writeGameFile(filePath, stored);

  return { outcome: "saved", scheduleKey: key, season, changed: isFirstScrape || rawChanged, status: meta.status };
}

async function loadSchedule(season: string, category: Category): Promise<ScheduleFile> {
  const schedulePath = path.join(DATA_DIR, seasonDirName(season, category), "schedule.json");
  const schedule = await readJson<ScheduleFile>(schedulePath);
  if (!schedule) {
    const categoryFlag = category === "premier" ? "" : ` --category ${category}`;
    throw new Error(
      `${schedulePath}.gz が見つかりません。先に npm run scrape:schedule -- --season ${season}${categoryFlag} を実行してください`,
    );
  }
  return schedule;
}

/**
 * シーズン一括モード: 未取得試合 + status=watchingの再チェック対象をまとめて処理する。
 * 未取得の試合のうち、schedule.jsonのupcomingGamesにあって「ティップオフ+2時間」をまだ過ぎて
 * いない試合（lib/pendingGames.ts）は、どちらのモードでも問い合わせない（未開催の試合は必ず
 * 「データなし」になるため。2026-09-24以前は深夜モードだけ全試合を問い合わせており、シーズン序盤は
 * 約780試合分のbleague.jpアクセスが毎晩発生していた。DESIGN.md 8-7章）。開催日がずれた試合は、
 * 深夜の日程取得（scrape-schedule.ts --verify-upcoming）がupcomingGamesの日付を更新することで拾う。
 * upcomingGamesに無い未取得の試合（開催予定の解決に失敗した試合）は安全側に倒して問い合わせる。
 * newOnly=trueのときは、既存のstatus=watching試合の再チェックもスキップする（DESIGN.md 8-5章:
 * 30分おきの頻繁チェック用）
 */
export async function runForSeason(
  season: string,
  category: Category = "premier",
  options: { newOnly?: boolean } = {},
): Promise<{ failedKeys: string[] }> {
  const schedule = await loadSchedule(season, category);
  const scheduleKeys = schedule.scheduleKeys;
  const upcomingByKey = new Map(schedule.upcomingGames.map((g) => [g.scheduleKey, g]));
  const now = Date.now();
  console.log(`[${season}] schedule.json から ${scheduleKeys.length} 試合を確認${options.newOnly ? "（新着試合のみ）" : ""}`);
  let notDueSkipped = 0;
  let queried = 0;
  // ある試合で問い合わせや保存に失敗しても、ほかの試合の取得は続ける（DESIGN.md 8-9）。失敗した試合は最後にまとめて報告し、
  // 呼び出し元（main）は終了コードを1にする。ワークフロー側はこのステップを continue-on-error にして、集計・コミットは続ける
  const failedKeys: string[] = [];

  for (const scheduleKey of scheduleKeys) {
    const filePath = gameFilePath(season, scheduleKey, category);
    const existing = await readGameFile(filePath);

    // 既に final の試合はスキップ（8章: 再チェック終了後はスクレイピング量を抑える）
    if (existing?.meta.status === "final") {
      continue;
    }

    // 新着試合のみモードでは、既存データがある（＝watching再チェック対象の）試合をスキップする。
    // ただし試合中に取得されて終了フラグが立っていない試合は取り直す
    if (options.newOnly && existing?.gameEndedFlg) {
      continue;
    }

    // まだティップオフ+2時間を過ぎていない開催予定の試合は問い合わせない（両モード共通）
    const upcoming = upcomingByKey.get(scheduleKey);
    if (!existing && upcoming && !isDue(upcoming, now)) {
      notDueSkipped++;
      continue;
    }

    queried++;
    try {
      const result = await scrapeAndSaveGame(scheduleKey, category);
      logResult(result);
    } catch (err) {
      failedKeys.push(scheduleKey);
      console.error(`  [${scheduleKey}] 取得に失敗（ほかの試合は続けます。次回の実行で取り直します）: ${(err as Error).message}`);
    }
  }
  console.log(`[${season}] 問い合わせ: ${queried}試合 ／ ティップオフ+2時間前のためスキップ: ${notDueSkipped}試合`);
  if (failedKeys.length > 0) {
    console.error(`[${season}] 取得に失敗した試合: ${failedKeys.length}試合（${failedKeys.join(", ")}）`);
  }
  return { failedKeys };
}

function logResult(result: ScrapeResult): void {
  switch (result.outcome) {
    case "no-data":
      console.log(`  [${result.scheduleKey}] データなし（無効なScheduleKeyの可能性）`);
      break;
    case "not-played-yet":
      console.log(`  [${result.scheduleKey}] 未実施のためスキップ`);
      break;
    case "saved":
      console.log(
        `  [${result.scheduleKey}] 保存完了 season=${result.season} status=${result.status} changed=${result.changed}`,
      );
      break;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seasonFlagIndex = args.indexOf("--season");
  const categoryIndex = args.indexOf("--category");
  const category: Category = categoryIndex !== -1 ? (args[categoryIndex + 1] as Category) : "premier";
  // --category <value> をScheduleKeyの直接指定リストから除いた残り
  const scheduleKeyArgs =
    categoryIndex !== -1 ? args.filter((_, i) => i !== categoryIndex && i !== categoryIndex + 1) : args;

  if (seasonFlagIndex !== -1) {
    const season = args[seasonFlagIndex + 1];
    if (!season) throw new Error("--season の後にシーズン(例: 2025-26)を指定してください");
    const newOnly = args.includes("--new-only");
    const { failedKeys } = await runForSeason(season, category, { newOnly });
    if (failedKeys.length > 0) process.exitCode = 1;
    return;
  }

  if (scheduleKeyArgs.length === 0) {
    console.error("使い方: scrape-boxscore.ts <ScheduleKey...> | --season <2025-26> [--category one]");
    process.exitCode = 1;
    return;
  }

  for (const key of scheduleKeyArgs) {
    const result = await scrapeAndSaveGame(key, category);
    logResult(result);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
