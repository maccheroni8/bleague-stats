// ルーキー（選手契約および登録に関する規程 第5条〔新人選手〕に準じた判定。DESIGN.md 215章）の年齢の判定。
// 規程: 新人選手として扱われるシーズンに、当該シーズン3月31日時点で22歳以下の選手は、出場試合数が所属チームの試合の半分以下なら翌シーズンも新人選手として扱う。
// 「当該シーズン3月31日」は、シーズンの中にある3月31日（2025-26なら2026年3月31日）と読む。

export const ROOKIE_EXTENSION_MAX_AGE = 22;

/** 生年月日（"YYYY-MM-DD"）の人の、指定した年の3月31日時点の満年齢。読めなければ null */
export function ageOnMarch31(birthDate: string | undefined, year: number): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birthDate ?? "");
  if (!m) return null;
  const [, y, mo, d] = m;
  let age = year - Number(y);
  // 3月31日より後に誕生日が来る（その年の誕生日をまだ迎えていない）なら1つ引く
  if (Number(mo) > 3 || (Number(mo) === 3 && Number(d) > 31)) age -= 1;
  return age;
}

/** そのシーズン（"2025-26" など）の3月31日（終了年）時点で22歳以下か。生年月日が読めなければ null（判定できない） */
export function isUnderExtensionAge(birthDate: string | undefined, season: string): boolean | null {
  const age = ageOnMarch31(birthDate, Number(season.slice(0, 4)) + 1);
  return age === null ? null : age <= ROOKIE_EXTENSION_MAX_AGE;
}
