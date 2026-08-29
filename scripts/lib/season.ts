// 日付からB.LEAGUEシーズンを算出する（JST基準）。
// シーズンは主に10月開幕〜5月終了だが、開幕戦が9月に前倒しされる年もあるため9月を
// シーズン開始月として扱う（DESIGN.md 68章）。オフシーズン(7〜8月)は直前に終わった
// シーズン扱いとする。

import { seasonFromYear } from "./storage.ts";

/** JST基準の日付が属するシーズン開始年を返す（9〜12月はその年、1〜8月は前年） */
export function seasonStartYearForDate(date: Date): number {
  const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
  const [yearStr, monthStr] = jst.split("-") as [string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  return month >= 9 ? year : year - 1;
}

/** JST基準の現在日付が属するシーズン文字列（例: "2025-26"）を返す */
export function currentSeason(date: Date = new Date()): string {
  return seasonFromYear(seasonStartYearForDate(date));
}
