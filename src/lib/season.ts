// scripts/lib/season.tsと同じロジック（JST基準、主に10月開幕・5月終了だが開幕戦が9月に
// 前倒しされる年もあるため9月をシーズン開始月として扱う。オフシーズンの7〜8月は
// 直前シーズン扱い）。
// フロントエンドはNode向けtsconfigと解決方式が異なるためscripts/を直接importせず複製している。

export function currentSeason(date: Date = new Date()): string {
  const jst = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(date);
  const [yearStr, monthStr] = jst.split("-") as [string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  const seasonStartYear = month >= 9 ? year : year - 1;
  return `${seasonStartYear}-${String(seasonStartYear + 1).slice(-2)}`;
}
