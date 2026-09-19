// 年齢は生年月日から動的に計算する（players.jsonのbirthDateは全シーズン共通の事実）。
// 表示中のシーズンに応じて基準日を切り替える（DESIGN.md 102章）:
//   終了済みシーズン → そのシーズン開幕時点（開始年の10月1日）の年齢
//   進行中・開幕前のシーズン → 今日の年齢
import { isPastSeason } from "./season";

/** 開幕時点として使う月日（シーズン開始年の10月1日。開幕戦が9月に前倒しされる年もあるが固定値で統一） */
const SEASON_START_MONTH = 10;
const SEASON_START_DAY = 1;

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

/** seasonを表示しているときの年齢の基準日（終了済みシーズンは開幕時点、それ以外は今日） */
export function ageBaseDate(season: string): BaseDate {
  if (isPastSeason(season)) {
    return { year: Number(season.split("-")[0]), month: SEASON_START_MONTH, day: SEASON_START_DAY };
  }
  return todayBaseDate();
}

/** seasonを表示しているときの年齢（終了済みシーズンは開幕時点、それ以外は今日） */
export function ageForSeason(birthDate: string, season: string): number {
  const b = ageBaseDate(season);
  return ageAsOf(birthDate, b.year, b.month, b.day);
}

/** 「2026/09/19 現在」形式の基準日ラベル。年齢はageBaseDate(season)、身長・体重（現在値）は今日 */
export function formatBaseDateLabel(b: BaseDate): string {
  return `${b.year}/${String(b.month).padStart(2, "0")}/${String(b.day).padStart(2, "0")} 現在`;
}

export function todayBaseDateLabel(): string {
  return formatBaseDateLabel(todayBaseDate());
}
