// 日本の祝日判定（シチュエーション別フィルタの「平日開催」用。DESIGN.md参照）。
// 外部ライブラリ・APIを使わず、祝日法の計算ルール（ハッピーマンデー・春分/秋分の日の
// 計算式・振替休日・国民の休日）で判定する。2020年・2021年の東京オリンピックに伴う
// 一時的な祝日移動（海の日・山の日・スポーツの日）と、2019年の御代替わりに伴う
// 一時的な祝日は、計算式では表現できないため個別に上書きする。
// 対象範囲は特に区切っていないが、B.LEAGUEの対象シーズン（2016年〜）をカバーできれば十分。

function utc(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d);
}

function ymd(dateStr: string): [number, number, number] {
  const [y, m, d] = dateStr.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

function toDateStr(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** 月内の第n曜日（weekday: 0=日〜6=土）の日付（1〜31）を返す */
function nthWeekday(year: number, month: number, weekday: number, n: number): number {
  const firstDow = new Date(utc(year, month, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  return 1 + offset + (n - 1) * 7;
}

/** 春分の日（近似式。1980〜2099年の範囲で国立天文台の実際の発表と一致することが知られている） */
function vernalEquinoxDay(year: number): number {
  return Math.floor(20.8431 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

/** 秋分の日（同上） */
function autumnalEquinoxDay(year: number): number {
  return Math.floor(23.2488 + 0.242194 * (year - 1980)) - Math.floor((year - 1980) / 4);
}

// 東京オリンピック特例（2020年・2021年）で通常のハッピーマンデー/固定日から移動した祝日。
// 実際に施行された特別措置法に基づく日付
const MOVED_HOLIDAYS: Record<number, { marine: [number, number]; mountain: [number, number]; sports: [number, number] }> = {
  2020: { marine: [7, 23], mountain: [8, 10], sports: [7, 24] },
  2021: { marine: [7, 22], mountain: [8, 8], sports: [7, 23] },
};

// 通常ルールの計算式では表現できない、御代替わり（2019年）に伴う一時的な祝日
const ONE_OFF_HOLIDAYS: Record<number, [number, number][]> = {
  2019: [
    [4, 30], // 国民の休日（前天皇陛下御退位）
    [5, 1], // 天皇の即位の日
    [5, 2], // 国民の休日
    [10, 22], // 即位礼正殿の儀の行われる日
  ],
};

/** その年の祝日一覧（振替休日・国民の休日を適用する前の基本セット）を計算する */
function baseHolidaysForYear(year: number): Set<string> {
  const dates: [number, number][] = [
    [1, 1], // 元日
    [1, nthWeekday(year, 1, 1, 2)], // 成人の日
    [2, 11], // 建国記念の日
    [3, vernalEquinoxDay(year)], // 春分の日
    [4, 29], // 昭和の日
    [5, 3], // 憲法記念日
    [5, 4], // みどりの日
    [5, 5], // こどもの日
    MOVED_HOLIDAYS[year]?.marine ?? [7, nthWeekday(year, 7, 1, 3)], // 海の日
    MOVED_HOLIDAYS[year]?.mountain ?? [8, 11], // 山の日（2016年〜）
    [9, nthWeekday(year, 9, 1, 3)], // 敬老の日
    [9, autumnalEquinoxDay(year)], // 秋分の日
    MOVED_HOLIDAYS[year]?.sports ?? [10, nthWeekday(year, 10, 1, 2)], // スポーツの日/体育の日
    [11, 3], // 文化の日
    [11, 23], // 勤労感謝の日
    ...(ONE_OFF_HOLIDAYS[year] ?? []),
  ];
  // 天皇誕生日: 上皇陛下（〜2018年）12/23、今上天皇（2020年〜）2/23。2019年は御代替わりの年で無し
  if (year <= 2018) dates.push([12, 23]);
  else if (year >= 2020) dates.push([2, 23]);

  return new Set(dates.map(([m, d]) => toDateStr(utc(year, m, d))));
}

/**
 * 振替休日（祝日が日曜の場合、後続の最初の非祝日を休日にする）と、国民の休日
 * （前後を祝日に挟まれた平日を休日にする。祝日法第3条2項）を、基本の祝日セットに追加する
 */
function applyDerivedHolidays(base: Set<string>): Set<string> {
  const result = new Set(base);

  for (const dateStr of base) {
    const t = utc(...ymd(dateStr));
    if (new Date(t).getUTCDay() === 0) {
      let next = t + 86400000;
      while (result.has(toDateStr(next))) next += 86400000;
      result.add(toDateStr(next));
    }
  }

  for (const dateStr of base) {
    const t = utc(...ymd(dateStr));
    const plusTwo = t + 2 * 86400000;
    if (!base.has(toDateStr(plusTwo))) continue;
    const plusOne = t + 86400000;
    const plusOneStr = toDateStr(plusOne);
    if (!base.has(plusOneStr) && new Date(plusOne).getUTCDay() !== 0) {
      result.add(plusOneStr);
    }
  }

  return result;
}

const holidayCache = new Map<number, Set<string>>();

function holidaysForYear(year: number): Set<string> {
  let cached = holidayCache.get(year);
  if (!cached) {
    cached = applyDerivedHolidays(baseHolidaysForYear(year));
    holidayCache.set(year, cached);
  }
  return cached;
}

/** "2024-11-23"のようなJST暦日文字列が日本の祝日かどうかを判定する */
export function isJapaneseHoliday(dateStr: string): boolean {
  const [year] = ymd(dateStr);
  return holidaysForYear(year).has(dateStr);
}

/** 水曜開催かどうかを判定する（シチュエーション別勝敗「水曜開催」区分用。DESIGN.md参照） */
export function isWednesdayGame(dateStr: string): boolean {
  const [y, m, d] = ymd(dateStr);
  return new Date(utc(y, m, d)).getUTCDay() === 3;
}

/** 土日祝のいずれでもない（平日開催）かどうかを判定する */
export function isWeekdayGame(dateStr: string): boolean {
  const [y, m, d] = ymd(dateStr);
  const dow = new Date(utc(y, m, d)).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !isJapaneseHoliday(dateStr);
}
