// 項目のキー（URL・保存した設定に入る値）の読み替え（画面専用。DESIGN.md 468章）。
// 列のキーは変えない決まりだが、%PoutP（key pctpoutp）は %PTSMID（key midptspct）に1つにまとめたため、古い URL・保存した図の設定のキーを新しいキーに読み替える。
// 図の軸は「カテゴリ.キー」（scoring.pctpoutp）の形でも書かれる。
export const STAT_KEY_ALIASES: Readonly<Record<string, string>> = { pctpoutp: "midptspct" };

/** 古い項目のキーを今のキーに読み替える（「カテゴリ.キー」の形も受け付ける。知らないキーはそのまま） */
export function canonicalStatKey(key: string): string {
  const dot = key.lastIndexOf(".");
  if (dot < 0) return STAT_KEY_ALIASES[key] ?? key;
  const tail = key.slice(dot + 1);
  return STAT_KEY_ALIASES[tail] ? `${key.slice(0, dot + 1)}${STAT_KEY_ALIASES[tail]}` : key;
}
