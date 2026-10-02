// 登録区分の絞り込み（全選手・日本人・外国籍/帰化/アジア）の、上位だけのファイル（選手の1試合記録・通算記録）での区分名。
// 画面の区分（src/lib/classificationFilter.ts の ClassificationGroup）と対応する: jp＝日本人、intl＝外国籍・帰化・アジア。
// 区分は選手マスタ（players-master.json）の classification で決まる、選手ごとの1つの値（シーズンによって変わらない。DESIGN.md 197章）
export type ClassKey = "jp" | "intl";

export const CLASS_KEYS: ClassKey[] = ["jp", "intl"];

export function classKeyOf(classification: "日本人" | "外国籍" | "帰化選手" | "アジア特別枠" | undefined): ClassKey | undefined {
  if (classification === undefined) return undefined;
  return classification === "日本人" ? "jp" : "intl";
}
