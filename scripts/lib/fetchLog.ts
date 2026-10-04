// 同じ実行の中で、すでに取り直した試合をもう一度取りに行かないための記録（コミットしない一時ファイル）。
//
// 以前は試合ファイルの meta.lastCheckedAt（確認時刻）を毎回書き換えて、見張りの一覧の確認が「直前に取り直した試合」を
// 判定していたが、確認時刻だけが変わった試合ファイルが毎晩コミットされて履歴が増えていた。いまは試合ファイルは
// 「生データ・状態が実際に変わったとき」だけ書き、確認時刻はこの一時ファイルに残す（環境変数 FETCHED_GAMES_FILE が
// あるときだけ。ワークフローが実行ごとに別の場所を指す）。DESIGN.md 205章

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import type { Category } from "../../shared/types.ts";

function fileOrNull(): string | null {
  return process.env.FETCHED_GAMES_FILE ?? null;
}

function idOf(season: string, category: Category, scheduleKey: string): string {
  return `${season}/${category}/${scheduleKey}`;
}

/** 試合を取り直したことを記録する */
export function recordFetched(season: string, category: Category, scheduleKey: string): void {
  const file = fileOrNull();
  if (!file) return;
  appendFileSync(file, `${Date.now()}\t${idOf(season, category, scheduleKey)}\n`);
}

/** この実行の中で、withinMs以内に取り直した試合か */
export function wasFetchedRecently(season: string, category: Category, scheduleKey: string, withinMs: number): boolean {
  const file = fileOrNull();
  if (!file || !existsSync(file)) return false;
  const id = idOf(season, category, scheduleKey);
  const now = Date.now();
  for (const line of readFileSync(file, "utf-8").split("\n")) {
    const [time, lineId] = line.split("\t");
    if (lineId === id && now - Number(time) < withinMs) return true;
  }
  return false;
}
