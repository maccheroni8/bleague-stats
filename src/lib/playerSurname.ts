// スマホ幅の表で使う名字のみの表記。PlayerNameJは日本人選手が「名字 名前」（半角スペース区切り）、
// 外国籍選手等が「名・姓」（中黒区切り）の形式のため、後者は末尾、前者は先頭の要素を名字とみなす。
// 同じチーム内で名字が重複する選手（兄弟等）はフルネームのまま表示する
export function surnameOf(fullName: string): string {
  const trimmed = fullName.trim();
  // 中黒を含む名前は末尾の要素（「セルジオ・エル ダーウィッチ」→「エル ダーウィッチ」のように
  // 姓の中にスペースを含む場合もあるため、スペースより先に判定する）
  const byDot = trimmed.split("・");
  if (byDot.length > 1) return byDot[byDot.length - 1] || trimmed;
  return trimmed.split(/[ 　]+/)[0] || trimmed;
}

/** チームごとの選手リスト（id・フルネーム）から、名字のみの表示名を作る（重複はフルネーム） */
export function buildSurnameMap(teams: { id: string; name: string }[][]): Map<string, string> {
  const result = new Map<string, string>();
  for (const players of teams) {
    const counts = new Map<string, number>();
    for (const p of players) counts.set(surnameOf(p.name), (counts.get(surnameOf(p.name)) ?? 0) + 1);
    for (const p of players) {
      const surname = surnameOf(p.name);
      result.set(p.id, (counts.get(surname) ?? 0) > 1 ? p.name : surname);
    }
  }
  return result;
}
