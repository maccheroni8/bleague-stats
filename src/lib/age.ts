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

/** seasonを表示しているときの年齢（終了済みシーズンは開幕時点、それ以外は今日） */
export function ageForSeason(birthDate: string, season: string): number {
  if (isPastSeason(season)) {
    return ageAsOf(birthDate, Number(season.split("-")[0]), SEASON_START_MONTH, SEASON_START_DAY);
  }
  const today = new Date();
  return ageAsOf(birthDate, today.getFullYear(), today.getMonth() + 1, today.getDate());
}
