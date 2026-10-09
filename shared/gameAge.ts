// 試合当日の年齢（「〇歳〇日」。ランキングの年齢の記録で「達成時の年齢」と呼ぶ。DESIGN.md 213-1・219章）。
// 満年齢と、直近の誕生日から試合当日までの日数。既存の6/30基準の年齢（172章）・3月31日基準の年齢（shared/rookieAge.ts）とは別。
// 2月29日生まれの人は、平年は2月28日に年を取る（民法143条の期間の計算に合わせた）。生年月日・試合日が読めなければ null

export interface AgeOnDate {
  years: number;
  /** 直近の誕生日（その日を含む）から試合当日までの日数。誕生日当日は 0 */
  days: number;
}

function parseYmd(s: string | undefined): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s ?? "");
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** その年の誕生日（2月29日生まれで平年なら2月28日）を、[年, 月, 日] で返す */
function birthdayIn(year: number, month: number, day: number): [number, number, number] {
  return month === 2 && day === 29 && !isLeapYear(year) ? [year, 2, 28] : [year, month, day];
}

const dayNumber = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86400000;

export function ageOnDate(birthDate: string | undefined, date: string | undefined): AgeOnDate | null {
  const b = parseYmd(birthDate);
  const g = parseYmd(date);
  if (!b || !g) return null;
  const [by, bm, bd] = b;
  const [gy, gm, gd] = g;
  let years = gy - by;
  let last = birthdayIn(gy, bm, bd);
  if (dayNumber(gy, gm, gd) < dayNumber(...last)) {
    years -= 1;
    last = birthdayIn(gy - 1, bm, bd);
  }
  if (years < 0) return null;
  return { years, days: dayNumber(gy, gm, gd) - dayNumber(...last) };
}

/** 「25歳123日」の形 */
export function formatAgeOnDate(age: AgeOnDate): string {
  return `${age.years}歳${age.days}日`;
}

/** 年齢の大小（若い方が小さい）。同じ年齢の中は日数で比べる */
export function compareAge(a: AgeOnDate, b: AgeOnDate): number {
  return a.years - b.years || a.days - b.days;
}
