// 見張りの一覧（data/game-watchlist.json）の操作。DESIGN.md 202章。
//
// 使い方:
//   node --experimental-strip-types scripts/game-watchlist.ts check            （夜間実行用。見張り中の試合を取り直して、記録の変化を調べる）
//   node --experimental-strip-types scripts/game-watchlist.ts show             （一覧を表示）
//   node --experimental-strip-types scripts/game-watchlist.ts add <ScheduleKey> --season 2026-27 [--category one]
//        --reason "理由" [--check orderRepairs|warnings|plusMinus] [--status out-of-scope|resolved] [--note "メモ"]
//
// check の出力:
//   - 標準出力に、変化・解消・期間終了を「見張り：506412 交代の記録が変化」の形で出す（::notice:: 付きでジョブの実行画面にも出る）
//   - 環境変数 WATCH_SUMMARY_FILE があれば、その1行ずつをファイルに書く（コミットメッセージ用）
//   - 環境変数 WATCH_SEASONS_FILE があれば、記録が変わった試合のシーズン（"2025-26" / "2025-26 one"）を1行ずつ書く（再集計用）

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR, gameFilePath, readGameFile, readJson, writeJsonIfChanged } from "./lib/storage.ts";
import { isMainModule } from "./lib/isMain.ts";
import { scrapeAndSaveGame } from "./scrape-boxscore.ts";
import {
  WATCH_DAYS,
  addDays,
  describeChanges,
  diagnose,
  isResolved,
  snapshotOf,
  todayJst,
  watchId,
  type WatchCheck,
  type WatchEntry,
  type WatchFile,
  type WatchSnapshot,
  type WatchStatus,
} from "./lib/gameWatch.ts";
import type { Category } from "../shared/types.ts";

const WATCHLIST_PATH = path.join(DATA_DIR, "game-watchlist.json");
const SNAPSHOTS_PATH = path.join(DATA_DIR, "game-watchlist-snapshots.json");
/** 今回の実行で、すでに取り直した（最終確認が新しい）試合は、もう一度取りに行かない */
const FRESH_WITHIN_MS = 6 * 3600_000;

const DESCRIPTION =
  "こちらが見つけた公式の記録の誤りが、公式のスタッツ修正で直るかを見張る試合の一覧。夜間実行（scripts/game-watchlist.ts check）が、" +
  "status=watching の試合を21日を過ぎても取り直し、交代・得点の記録、recordFixedFlg、最終スコア、公式の+/-が変わっていれば history に残す。" +
  "期間は見つけた日から60日。DESIGN.md 202章";

export function readWatchFile(): WatchFile {
  if (!existsSync(WATCHLIST_PATH)) return { description: DESCRIPTION, watchDays: WATCH_DAYS, entries: [] };
  return JSON.parse(readFileSync(WATCHLIST_PATH, "utf-8")) as WatchFile;
}

function writeWatchFile(file: WatchFile): void {
  writeFileSync(WATCHLIST_PATH, `${JSON.stringify(file, null, 2)}\n`);
}

async function readSnapshots(): Promise<Record<string, WatchSnapshot>> {
  return (await readJson<Record<string, WatchSnapshot>>(SNAPSHOTS_PATH)) ?? {};
}

async function writeSnapshots(snaps: Record<string, WatchSnapshot>): Promise<void> {
  await writeJsonIfChanged(SNAPSHOTS_PATH, snaps as Record<string, unknown>, []);
}

function notice(line: string): void {
  console.log(`::notice::${line}`);
}

async function runCheck(): Promise<void> {
  const file = readWatchFile();
  const snaps = await readSnapshots();
  const today = todayJst();
  const summary: string[] = [];
  const changedSeasons = new Set<string>();
  const active = file.entries.filter((e) => e.status === "watching");
  console.log(`[見張り] 見張り中 ${active.length}試合（一覧 ${file.entries.length}試合）`);
  let fileDirty = false;
  let failed = 0;

  for (const entry of active) {
    const id = watchId(entry);
    const gamePath = gameFilePath(entry.season, entry.scheduleKey, entry.category);
    // 通常の再チェック（試合から21日以内）ですでに取り直した試合は、もう一度取りに行かない
    const before = await readGameFile(gamePath);
    const fresh = before && Date.now() - new Date(before.meta.lastCheckedAt).getTime() < FRESH_WITHIN_MS;
    if (!fresh) {
      try {
        await scrapeAndSaveGame(entry.scheduleKey, entry.category, { writeOnlyIfChanged: true });
      } catch (err) {
        failed += 1;
        console.error(`  [${id}] 取得に失敗（次回の実行で取り直します）: ${(err as Error).message}`);
        continue;
      }
    }
    const game = await readGameFile(gamePath);
    if (!game) {
      console.error(`  [${id}] 試合のファイルがありません`);
      continue;
    }
    const snap = snapshotOf(game);
    const old = snaps[id];
    const changes = old ? describeChanges(old, snap) : [];
    const diagnosis = diagnose(game);
    if (changes.length > 0) {
      entry.history.push({ at: new Date().toISOString(), changes, diagnosis });
      fileDirty = true;
      summary.push(`見張り：${entry.scheduleKey} ${changes.join("、")}`);
      changedSeasons.add(entry.category === "premier" ? entry.season : `${entry.season} ${entry.category}`);
    }
    if (!old || changes.length > 0) snaps[id] = snap;

    if (entry.check && isResolved(entry.check, diagnosis)) {
      entry.status = "resolved";
      entry.closedAt = today;
      delete snaps[id];
      fileDirty = true;
      summary.push(`見張り：${entry.scheduleKey} 解消（${entry.reason}）`);
    } else if (today > entry.watchUntil) {
      entry.status = entry.history.length > 0 ? "changed" : "no-change";
      entry.closedAt = today;
      delete snaps[id];
      fileDirty = true;
      summary.push(`見張り：${entry.scheduleKey} 期間終了（${entry.status === "changed" ? "修正あり・問題は残っている" : "修正なし"}）`);
    } else if (changes.length === 0) {
      console.log(`  [${id}] 変化なし`);
    }
  }

  if (fileDirty) writeWatchFile(file);
  await writeSnapshots(snaps);
  for (const line of summary) notice(line);
  if (process.env.WATCH_SUMMARY_FILE && summary.length > 0) writeFileSync(process.env.WATCH_SUMMARY_FILE, `${summary.join("\n")}\n`);
  if (process.env.WATCH_SEASONS_FILE && changedSeasons.size > 0) writeFileSync(process.env.WATCH_SEASONS_FILE, `${[...changedSeasons].join("\n")}\n`);
  console.log(`[見張り] 変化 ${summary.length}件${failed > 0 ? `、取得失敗 ${failed}試合` : ""}`);
  if (failed > 0) process.exitCode = 1;
}

function runShow(): void {
  const file = readWatchFile();
  const labels: Record<WatchStatus, string> = {
    watching: "見張り中",
    resolved: "解消",
    changed: "修正あり",
    "no-change": "修正なし",
    "out-of-scope": "対象外（古い）",
  };
  for (const e of file.entries) {
    console.log(`${e.season}${e.category === "one" ? "(B.ONE)" : ""} ${e.scheduleKey} [${labels[e.status]}] 見つけた日 ${e.foundAt} → ${e.watchUntil} 変化${e.history.length}回 ${e.reason}`);
  }
}

async function runAdd(args: string[]): Promise<void> {
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const scheduleKey = args[0];
  const season = flag("--season");
  const reason = flag("--reason");
  if (!scheduleKey || scheduleKey.startsWith("--") || !season || !reason) {
    throw new Error("使い方: game-watchlist.ts add <ScheduleKey> --season 2026-27 [--category one] --reason \"理由\" [--check ...] [--status ...]");
  }
  const category = (flag("--category") ?? "premier") as Category;
  const check = flag("--check") as WatchCheck | undefined;
  const status = (flag("--status") ?? "watching") as WatchStatus;
  const note = flag("--note");
  const game = await readGameFile(gameFilePath(season, scheduleKey, category));
  if (!game) throw new Error(`試合のファイルがありません: ${season}/${category}/${scheduleKey}`);

  const file = readWatchFile();
  const entry: WatchEntry = {
    scheduleKey,
    season,
    category,
    reason,
    foundAt: todayJst(),
    watchUntil: addDays(todayJst(), WATCH_DAYS),
    status,
    ...(check ? { check } : {}),
    diagnosisAtFound: diagnose(game),
    history: [],
    ...(status === "watching" ? {} : { closedAt: todayJst() }),
    ...(note ? { note } : {}),
  };
  const id = watchId(entry);
  if (file.entries.some((e) => watchId(e) === id)) throw new Error(`すでに一覧にあります: ${id}`);
  file.entries.push(entry);
  writeWatchFile(file);
  if (status === "watching") {
    const snaps = await readSnapshots();
    snaps[id] = snapshotOf(game);
    await writeSnapshots(snaps);
  }
  console.log(`追加しました: ${id} [${status}]`);
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  if (command === "check") return runCheck();
  if (command === "show") return runShow();
  if (command === "add") return runAdd(rest);
  console.error("使い方: game-watchlist.ts check | show | add <ScheduleKey> --season ... --reason ...");
  process.exitCode = 1;
}

if (isMainModule(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
