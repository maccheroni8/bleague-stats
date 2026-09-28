// 年齢は生年月日から動的に計算する（players.jsonのbirthDateは全シーズン共通の事実）。
// 基準日は「そのシーズンの6月30日（シーズンが終わる年）」と「今日（日本時間）」の早い方（2026-09-29 ユーザー決定。DESIGN.md 172章）。
// 終わったシーズンは6月30日時点、進行中のシーズンは今日時点になる。年齢を出すすべての箇所（ランキングの Profile・チーム詳細の平均年齢・
// 個人詳細の年齢・スタッツの条件の年齢）がここを使う。それまでは各シーズンの1月15日時点だった（146章）。
// 身長・体重・ポジションを固定する1月15日（scripts/freeze-season-profiles.ts）とは別の話で、そちらは変えない

/** 年齢の基準日の月日（シーズンが終わる年の6月30日） */
const AGE_BASE_MONTH = 6;
const AGE_BASE_DAY = 30;

/** 年齢を出す箇所に添える注記 */
export const AGE_BASE_NOTE = "年齢は各シーズンの6月30日時点（進行中のシーズンは本日時点）";

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

/** 今日（日本時間）。見ている人の端末の時刻帯によらず、基準日の比較は日本時間で行う */
function todayJstBaseDate(): BaseDate {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return { year: jst.getUTCFullYear(), month: jst.getUTCMonth() + 1, day: jst.getUTCDate() };
}

function isBefore(a: BaseDate, b: BaseDate): boolean {
  return a.year !== b.year ? a.year < b.year : a.month !== b.month ? a.month < b.month : a.day < b.day;
}

/** seasonを表示しているときの年齢の基準日（そのシーズンの6月30日と、今日（日本時間）の早い方） */
export function ageBaseDate(season: string): BaseDate {
  const seasonEnd = { year: Number(season.split("-")[0]) + 1, month: AGE_BASE_MONTH, day: AGE_BASE_DAY };
  const today = todayJstBaseDate();
  return isBefore(today, seasonEnd) ? today : seasonEnd;
}

/** seasonを表示しているときの年齢（ageBaseDate の時点） */
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
