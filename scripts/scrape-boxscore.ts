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
//   npm run scrape:boxscore -- 505076 505118       # ScheduleKeyを直接指定
//   npm run scrape:boxscore -- --season 2025-26     # そのシーズンのschedule.jsonから
//                                                     未取得試合＋再チェック対象(watching)をまとめて処理

import path from "node:path";
import { fetchLatestGameContext, getPeriodScores, parseAspNetDate } from "./lib/geniusApi.ts";
import { fetchLegacyGameContext, legacyPeriodScores, parseLegacyGameDateTime } from "./lib/legacyGameDetail.ts";
import { gameFilePath, readGameFile, readJson, writeGameFile, seasonFromYear, DATA_DIR } from "./lib/storage.ts";
import type { GeniusContext, ScheduleFile, StoredGame, StoredGameMeta } from "../shared/types.ts";
import { isMainModule } from "./lib/isMain.ts";

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

export async function scrapeAndSaveGame(scheduleKey: string | number): Promise<ScrapeResult> {
  const key = String(scheduleKey);
  const result = await fetchGameContextWithFallback(key);
  if (!result) {
    return { outcome: "no-data", scheduleKey: key };
  }
  const { latestId, context, isLegacy } = result;
  const { Game } = context;

  if (!Game.BoxscoreExistsFlg && !Game.GameEndedFlg) {
    // 試合未実施・データ未整備。保存対象外
    return { outcome: "not-played-yet", scheduleKey: key };
  }

  const gameDate = isLegacy ? parseLegacyGameDateTime(Game.GameDateTime) : parseAspNetDate(Game.GameDateTime);
  const dateStr = formatJstDate(gameDate);
  const season = seasonFromYear(Game.Year);
  const filePath = gameFilePath(season, key);

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

async function loadScheduleKeys(season: string): Promise<string[]> {
  const schedulePath = path.join(DATA_DIR, season, "schedule.json");
  const schedule = await readJson<ScheduleFile>(schedulePath);
  if (!schedule) {
    throw new Error(
      `${schedulePath}.gz が見つかりません。先に npm run scrape:schedule -- --season ${season} を実行してください`,
    );
  }
  return schedule.scheduleKeys;
}

/** シーズン一括モード: 未取得試合 + status=watchingの再チェック対象をまとめて処理する */
export async function runForSeason(season: string): Promise<void> {
  const scheduleKeys = await loadScheduleKeys(season);
  console.log(`[${season}] schedule.json から ${scheduleKeys.length} 試合を確認`);

  for (const scheduleKey of scheduleKeys) {
    const filePath = gameFilePath(season, scheduleKey);
    const existing = await readGameFile(filePath);

    // 既に final の試合はスキップ（8章: 再チェック終了後はスクレイピング量を抑える）
    if (existing?.meta.status === "final") {
      continue;
    }

    const result = await scrapeAndSaveGame(scheduleKey);
    logResult(result);
  }
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

  if (seasonFlagIndex !== -1) {
    const season = args[seasonFlagIndex + 1];
    if (!season) throw new Error("--season の後にシーズン(例: 2025-26)を指定してください");
    await runForSeason(season);
    return;
  }

  if (args.length === 0) {
    console.error("使い方: scrape-boxscore.ts <ScheduleKey...> | --season <2025-26>");
    process.exitCode = 1;
    return;
  }

  for (const key of args) {
    const result = await scrapeAndSaveGame(key);
    logResult(result);
  }
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
