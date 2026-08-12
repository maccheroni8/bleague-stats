// data/ 配下のファイル入出力とシーズン/パス解決ユーティリティ。

import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { StoredGame } from "./types.ts";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(SCRIPTS_DIR, "..", "..", "data");

/** Game.Year（シーズン開始年）から "2025-26" 形式のシーズン文字列を作る */
export function seasonFromYear(year: number): string {
  return `${year}-${String(year + 1).slice(-2)}`;
}

export function gamesDir(season: string): string {
  return path.join(DATA_DIR, season, "games");
}

export function gameFilePath(season: string, scheduleKey: string | number): string {
  return path.join(gamesDir(season), `${scheduleKey}.json`);
}

export async function readGameFile(filePath: string): Promise<StoredGame | null> {
  if (!existsSync(filePath)) return null;
  const text = await readFile(filePath, "utf-8");
  return JSON.parse(text) as StoredGame;
}

export async function writeGameFile(filePath: string, data: StoredGame): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

/** シーズンに保存済みの全試合ファイルを読み込む（aggregate.ts等で使用） */
export async function readAllGames(season: string): Promise<StoredGame[]> {
  const dir = gamesDir(season);
  if (!existsSync(dir)) return [];
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const games: StoredGame[] = [];
  for (const file of files) {
    const text = await readFile(path.join(dir, file), "utf-8");
    games.push(JSON.parse(text) as StoredGame);
  }
  return games;
}

export async function writeJson(filePath: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}
