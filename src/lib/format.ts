/**
 * 小数の桁を指定して文字列にする。整数（digits=0）で1,000以上のとき（シーズン合計等）は3桁ごとに区切る（「1,591」。DESIGN.md 180章）。
 * 小数のある値は区切らない（小数・割合・年・ID は区切らない方針）
 */
export function formatDecimal(value: number, digits = 1): string {
  return digits === 0 ? formatInteger(value) : value.toFixed(digits);
}

/** 整数（四捨五入）を、1,000以上のとき3桁ごとに区切って文字列にする。負の値は先頭に「-」 */
export function formatInteger(value: number): string {
  const fixed = value.toFixed(0);
  const negative = fixed.startsWith("-");
  const digits = negative ? fixed.slice(1) : fixed;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return negative ? `-${grouped}` : grouped;
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
  const rounded = digits === 0 ? formatInteger(value) : value.toFixed(digits);
  return value > 0 ? `+${rounded}` : rounded;
}

export function formatRecord(wins: number, losses: number): string {
  return `${wins}勝${losses}敗`;
}

const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

/** "2026-10-03" -> "2026年10月3日（土）"。JSTの暦日文字列前提でUTC基準に構築し、閲覧者側のtzに影響されないようにする */
export function formatDateHeading(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAY_JA[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${y}年${m}月${d}日（${weekday}）`;
}
