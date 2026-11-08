// 保存画像の見出し（2行）。1行目はリーグと範囲（「B.PREMIER 2026-27シーズン」「B.ONE 歴代」）、2行目は図の名前（「得点ランキング」「A vs B」）。
// 両リーグとも出す（DESIGN.md 297章）。画面の見出しは今までどおり1行（ConditionTitle の title）のまま。
//
// 範囲は、見出しの先頭の「2026-27シーズン」「歴代」「通算」「通算（2020-21以降）」を切り出して1行目に移す（半角スペースか「の」で区切る）。
// 先頭に範囲が無い見出し（比較の「A vs B」・図解）は、呼び出し側が範囲（scope）を渡す。どちらも無ければ1行目はリーグ名だけ

const SCOPE_PATTERN = /^(\d{4}-\d{2}シーズン|歴代|通算(?:（[^）]*）)?)(?: |の)(.+)$/;

export interface ExportHeadingLines {
  /** 1行目（リーグと範囲） */
  scope: string;
  /** 2行目（図の名前） */
  name: string;
}

/** リーグ名と範囲をつなぐ。「B.PREMIER（旧B1）」のように括弧で終わるときは空白を入れない（「B.PREMIER（旧B1）通算」） */
function joinScope(label: string, range: string): string {
  return label.endsWith("）") ? `${label}${range}` : `${label} ${range}`;
}

/** 範囲が「通算」「歴代」で始まる（複数のシーズンにまたがる）か。1つのシーズンの範囲は含まない */
export function isMultiSeasonScope(scope: string): boolean {
  return /^(歴代|通算)/.test(scope);
}

/**
 * leagueLabel は「B.PREMIER」、formerLabel は「B.PREMIER（旧B1）」（league.ts の leagueScopeLabel(league, true)）。
 * 範囲が通算・歴代のときだけ formerLabel を使う（省略時は leagueLabel のまま）
 */
export function exportHeadingLines(title: string, leagueLabel: string, scope?: string, formerLabel?: string): ExportHeadingLines {
  const labelFor = (range: string) => (formerLabel && isMultiSeasonScope(range) ? formerLabel : leagueLabel);
  if (scope) return { scope: joinScope(labelFor(scope), scope), name: title };
  const m = SCOPE_PATTERN.exec(title);
  if (m) return { scope: joinScope(labelFor(m[1]!), m[1]!), name: m[2]! };
  return { scope: leagueLabel, name: title };
}

/** 比較の範囲（比べている枠のシーズン。1つなら「2026-27シーズン」、複数なら古い順に「2024-25・2026-27シーズン」） */
export function seasonsScope(seasons: readonly string[]): string | undefined {
  const list = [...new Set(seasons)].sort();
  return list.length === 0 ? undefined : `${list.join("・")}シーズン`;
}
