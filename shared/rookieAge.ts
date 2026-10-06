// ルーキー（新人賞の対象要件に準じた判定。DESIGN.md 214章）の年齢の判定。
// 要件: 「前シーズン4月1日時点で満23歳の誕生日を迎えていない」＝そのシーズンの開始年の4月1日時点で22歳以下。
// 判定の対象になりうる選手を絞るスクリプト（scripts/lib/clubHistory.ts）と、判定（shared/rookieEligibility.ts）が同じ書き方を使う。

export const ROOKIE_MAX_AGE = 22;

/** 生年月日（"YYYY-MM-DD"）の人の、指定した年の4月1日時点の満年齢。読めなければ null */
export function ageOnAprilFirst(birthDate: string | undefined, year: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? "");
  if (!m) return null;
  const [, y, mo, d] = m;
  let age = year - Number(y);
  // 4月1日より後に誕生日が来る（その年の誕生日をまだ迎えていない）なら1つ引く
  if (Number(mo) > 4 || (Number(mo) === 4 && Number(d) > 1)) age -= 1;
  return age;
}

/** そのシーズン（"2025-26" など）の開始年の4月1日時点で22歳以下か。生年月日が読めなければ null（判定できない） */
export function isRookieAgeAtSeason(birthDate: string | undefined, season: string): boolean | null {
  const age = ageOnAprilFirst(birthDate, Number(season.slice(0, 4)));
  return age === null ? null : age <= ROOKIE_MAX_AGE;
}
