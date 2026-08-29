export function formatDecimal(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function formatPct(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

/** すでに0〜100スケールになっている値（ORB%・Usage%など）を%表記にする */
export function formatPct100(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** 勝率専用のピリオド3桁表記（例: 0.75 -> ".750"、1 -> "1.000"）。先頭の"0"のみ省略する */
export function formatWinPct(value: number, digits = 3): string {
  const fixed = value.toFixed(digits);
  return fixed.startsWith("0.") ? fixed.slice(1) : fixed;
}

export function formatSigned(value: number, digits = 1): string {
  const rounded = value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

export function formatRecord(wins: number, losses: number): string {
  return `${wins}-${losses}`;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-10-03" -> "2026年10月3日（土）"。JSTの暦日文字列前提でUTC基準に構築し、閲覧者側のtzに影響されないようにする */
export function formatDateHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAY_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${weekday}）`;
}
