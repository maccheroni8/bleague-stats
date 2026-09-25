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

/**
 * 身長・体重はplayers-master.jsonの現在値1つを全シーズンに一律適用している（公式サイトに当時の
 * 記録が存在しないため。DESIGN.md参照）。終了済みのシーズンを表示するときに添える注記
 */

/** 現在進行中（または開幕前）のシーズンより前＝終了済みのシーズンか */
export function isPastSeason(season: string): boolean {
  return season < currentSeason();
}
