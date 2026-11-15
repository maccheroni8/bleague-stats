// 日程の画像保存で選ぶ「保存する期間」（設計書399章）。日付は YYYY-MM-DD の文字列で扱い、UTC 基準で足し引きする（時刻のずれを持ち込まない）。
// 画面だけの部品（保存キーの対象外）

/** 期間の選び方: 1日／1週間（月曜〜日曜）／1か月（暦の月）／開始日と終了日 */
export type SchedulePeriodMode = "day" | "week" | "month" | "custom";

export const SCHEDULE_PERIOD_MODE_LABELS: Record<SchedulePeriodMode, string> = {
  day: "1日",
  week: "1週間",
  month: "1か月",
  custom: "期間を指定",
};

/** 保存できる最大の日数。リストは縦に長くなるので1か月、カレンダーは週を並べるので2か月分 */
export const SCHEDULE_SAVE_MAX_DAYS = { list: 31, calendar: 62 } as const;

const DAY_MS = 86_400_000;

function parse(date: string): Date {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  return format(new Date(parse(date).getTime() + days * DAY_MS));
}

/** 2つの日付の間の日数（両端を含む）。終了日が開始日より前なら 0 */
export function daysInclusive(from: string, to: string): number {
  const diff = Math.round((parse(to).getTime() - parse(from).getTime()) / DAY_MS) + 1;
  return diff > 0 ? diff : 0;
}

/** 曜日（0=日曜〜6=土曜） */
export function weekdayOf(date: string): number {
  return parse(date).getUTCDay();
}

const WEEKDAY_NAMES = ["日", "月", "火", "水", "木", "金", "土"];

export function weekdayName(date: string): string {
  return WEEKDAY_NAMES[weekdayOf(date)]!;
}

/** その日を含む週（月曜〜日曜） */
export function weekRangeOf(date: string): { from: string; to: string } {
  const offset = (weekdayOf(date) + 6) % 7;
  const from = addDays(date, -offset);
  return { from, to: addDays(from, 6) };
}

/** その日を含む月（1日〜末日） */
export function monthRangeOf(date: string): { from: string; to: string } {
  const [y, m] = date.split("-").map(Number) as [number, number];
  const from = format(new Date(Date.UTC(y, m - 1, 1)));
  const to = format(new Date(Date.UTC(y, m, 0)));
  return { from, to };
}

/** 選び方と基準の日付（custom のときは開始日・終了日）から、保存する期間を決める。custom は開始日が終了日より後なら入れ替える */
export function schedulePeriod(
  mode: SchedulePeriodMode,
  date: string,
  customFrom: string,
  customTo: string,
): { from: string; to: string } {
  if (mode === "day") return { from: date, to: date };
  if (mode === "week") return weekRangeOf(date);
  if (mode === "month") return monthRangeOf(date);
  return customFrom <= customTo ? { from: customFrom, to: customTo } : { from: customTo, to: customFrom };
}

/** 「2026/11/09」形式 */
export function slashDate(date: string): string {
  return date.replaceAll("-", "/");
}

/** サブタイトル・ファイル名に書く期間（「期間: 2026/11/09〜2026/11/15」。1日は「期間: 2026/11/15」） */
export function schedulePeriodLabel(period: { from: string; to: string }): string {
  return period.from === period.to ? `期間: ${slashDate(period.from)}` : `期間: ${slashDate(period.from)}〜${slashDate(period.to)}`;
}

/** 期間の日付を含む月曜始まりの週を、期間の最初の週から最後の週まで並べる（カレンダーの保存用） */
export function weeksCovering(period: { from: string; to: string }): string[][] {
  const weeks: string[][] = [];
  let start = weekRangeOf(period.from).from;
  const last = weekRangeOf(period.to).to;
  while (start <= last) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(start, i)));
    start = addDays(start, 7);
  }
  return weeks;
}

/** 初期の基準日: 今日。試合のある日の範囲の外なら、いちばん近い端（過去のシーズンは最後の試合日、開幕前は開幕日） */
export function clampToDates(today: string, firstDate: string | undefined, lastDate: string | undefined): string {
  if (!firstDate || !lastDate) return today;
  if (today < firstDate) return firstDate;
  if (today > lastDate) return lastDate;
  return today;
}
