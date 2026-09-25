// 年齢は生年月日から動的に計算する（players.jsonのbirthDateは全シーズン共通の事実）。
// 基準日はシーズンによらず「そのシーズンの1月15日」（シーズンの折り返し。2025-26なら2026/01/15）に統一する
// （2026-09-26 ユーザー決定。DESIGN.md 146章。それまでは終了済みシーズンが開幕時点、進行中のシーズンが今日だった）。
// 進行中のシーズンも、まだ来ていないそのシーズンの1月15日時点で数える

/** 年齢の基準日の月日（シーズン終了年の1月15日） */
const AGE_BASE_MONTH = 1;
const AGE_BASE_DAY = 15;

/** 年齢を出す箇所に添える注記 */
export const AGE_BASE_NOTE = "年齢は各シーズンの1月15日時点（シーズンの折り返し）";

function ageAsOf(birthDate: string, year: number, month: number, day: number): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = year - y;
  if (month < m || (month === m && day < d)) age -= 1;
  return age;
}

interface BaseDate {
  year: number;
  month: number;
  day: number;
}

function todayBaseDate(): BaseDate {
  const today = new Date();
  return { year: today.getFullYear(), month: today.getMonth() + 1, day: today.getDate() };
}

/** seasonを表示しているときの年齢の基準日（そのシーズンの1月15日） */
export function ageBaseDate(season: string): BaseDate {
  return { year: Number(season.split("-")[0]) + 1, month: AGE_BASE_MONTH, day: AGE_BASE_DAY };
}

/** seasonを表示しているときの年齢（そのシーズンの1月15日時点） */
export function ageForSeason(birthDate: string, season: string): number {
  const b = ageBaseDate(season);
  return ageAsOf(birthDate, b.year, b.month, b.day);
}

/** 「2026/09/19 現在」形式の基準日ラベル。年齢はageBaseDate(season)、身長・体重（現在値）は今日 */
export function formatBaseDateLabel(b: BaseDate): string {
  return `${b.year}/${String(b.month).padStart(2, "0")}/${String(b.day).padStart(2, "0")} 現在`;
}

/** 年齢の基準日のラベル（「2026/01/15 時点」） */
export function ageBaseDateLabel(season: string): string {
  const b = ageBaseDate(season);
  return `${b.year}/${String(b.month).padStart(2, "0")}/${String(b.day).padStart(2, "0")} 時点`;
}

export function todayBaseDateLabel(): string {
  return formatBaseDateLabel(todayBaseDate());
}
