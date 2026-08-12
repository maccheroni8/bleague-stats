// 日付からB.LEAGUEシーズンを算出する（JST基準）。
// シーズンは10月開幕〜5月終了。オフシーズン(6〜9月)は直前に終わったシーズン扱いとする。

import { seasonFromYear } from "./storage.ts";

/** JST基準の日付が属するシーズン開始年を返す（10〜12月はその年、1〜9月は前年） */
export function seasonStartYearForDate(date: Date): number {
  const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
  const [yearStr, monthStr] = jst.split("-") as [string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 10 ? year : year - 1;
}

/** JST基準の現在日付が属するシーズン文字列（例: "2025-26"）を返す */
export function currentSeason(date: Date = new Date()): string {
  return seasonFromYear(seasonStartYearForDate(date));
}
