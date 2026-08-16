// data/ 配下のファイル入出力とシーズン/パス解決ユーティリティ。
//
// 全JSONは`.json.gz`としてgzip圧縮保存する（DESIGN.md 8-3章）。呼び出し側は従来通り
// 拡張子`.json`のパスを渡せばよく、圧縮・伸長はこのモジュール内で透過的に行う
// （実体ファイル名の`.gz`付与・削除もここに閉じる）。

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Category, StoredGame } from "../../shared/types.ts";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "data");

/** Game.Year（シーズン開始年）から "2025-26" 形式のシーズン文字列を作る */
export function seasonFromYear(year: number): string {
  return `${year}-${String(year + 1).slice(-2)}`;
}

/**
 * シーズンのデータ保存先ディレクトリ名を解決する（DESIGN.md 14-5章の案A）。
 * "premier"（B.PREMIER）は既存の`data/{season}/`のまま無変更（後方互換）。
 * それ以外のカテゴリは`data/{season}/{category}/`にサブディレクトリを切る
 */
export function seasonDirName(season: string, category: Category = "premier"): string {
  return category === "premier" ? season : path.join(season, category);
}

export function gamesDir(season: string, category: Category = "premier"): string {
  return path.join(DATA_DIR, seasonDirName(season, category), "games");
}

/** 論理パス（`.json`）を返す。実体ファイルは`.json.gz`だが、呼び出し側はこちらだけ意識すればよい */
export function gameFilePath(season: string, scheduleKey: string | number, category: Category = "premier"): string {
  return path.join(gamesDir(season, category), `${scheduleKey}.json`);
}

function gzPathOf(filePath: string): string {
  return `${filePath}.gz`;
}

async function writeJsonGz(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const json = `${JSON.stringify(data, null, 2)}\n`;
  await writeFile(gzPathOf(filePath), gzipSync(Buffer.from(json, "utf-8")));
}

async function readJsonGz<T>(filePath: string): Promise<T | null> {
  const gzPath = gzPathOf(filePath);
  if (!existsSync(gzPath)) return null;
  const compressed = await readFile(gzPath);
  const json = gunzipSync(compressed).toString("utf-8");
  return JSON.parse(json) as T;
}

export async function readGameFile(filePath: string): Promise<StoredGame | null> {
  return readJsonGz<StoredGame>(filePath);
}

export async function writeGameFile(filePath: string, data: StoredGame): Promise<void> {
  await writeJsonGz(filePath, data);
}

/**
 * 生データ（games/）が既に存在するScheduleKeyの集合を返す（ファイル一覧のみ、中身は読まない軽量版）。
 * scrape-schedule.tsが「まだ生データが無い試合＝開催予定」を判定するために使う
 */
export async function listStoredScheduleKeys(season: string, category: Category = "premier"): Promise<Set<string>> {
  const dir = gamesDir(season, category);
  if (!existsSync(dir)) return new Set();
  const files = await readdir(dir);
  return new Set(files.filter((f) => f.endsWith(".json.gz")).map((f) => f.replace(/\.json\.gz$/, "")));
}

/** シーズンに保存済みの全試合ファイルを読み込む（aggregate.ts等で使用） */
export async function readAllGames(season: string, category: Category = "premier"): Promise<StoredGame[]> {
  const dir = gamesDir(season, category);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json.gz"));
  const games: StoredGame[] = [];
  for (const file of files) {
    const compressed = await readFile(path.join(dir, file));
    games.push(JSON.parse(gunzipSync(compressed).toString("utf-8")) as StoredGame);
  }
  return games;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await writeJsonGz(filePath, data);
}

/**
 * バイナリファイル（ロゴ・選手写真等）をそのまま保存する。PNG/WebPは既に圧縮済みの
 * フォーマットなのでJSONと違いgzip化はしない
 */
export async function writeBinaryFile(filePath: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, data);
}

export function fileExists(filePath: string): boolean {
  return existsSync(filePath);
}

/** ファイルが無ければnullを返す汎用JSON読み込み（players-master.json等、単一ファイルもの向け） */
export async function readJson<T>(filePath: string): Promise<T | null> {
  return readJsonGz<T>(filePath);
}
