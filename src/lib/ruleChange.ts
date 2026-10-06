// 2026-27シーズンの新競技規則（DESIGN.md 16章）関連の共通定義。

/** 新競技規則が先行適用される最初のシーズン（9/22開幕から） */
export const NEW_RULE_FIRST_SEASON = "2026-27";

/** シーズン文字列は"2026-27"形式で辞書順＝時系列順なので、文字列比較で足りる */
export function seasonsIncludeNewRule(seasons: readonly string[]): boolean {
  return seasons.some((s) => s >= NEW_RULE_FIRST_SEASON);
}

/** 新規則の脚注が必要な統計項目のキー（UFOUL=アンスポーツマン系ファウル、TF=テクニカルファウル、DQFOUL=ディスクォリファイングファウル。
 * 脚注は3つをまとめて説明する）。ランキング等、1度に1項目だけ表示する画面で、その項目が対象かを判定するのに使う */
export function isRuleChangeStatKey(key: string | undefined): boolean {
  return key === "ufoul" || key === "tf" || key === "dqfoul" || isFoulSplitKey(key);
}

/** すべてのシーズンが新競技規則（2026-27以降）か。空のときはfalse */
export function seasonsAllNewRule(seasons: readonly string[]): boolean {
  return seasons.length > 0 && seasons.every((s) => s >= NEW_RULE_FIRST_SEASON);
}

/**
 * ファウルの列の出し方。2026-27以降のシーズンだけの表は、UFOUL・TFの代わりに新しい区分の4列を出す。
 * 2025-26以前を含む表（通算・複数シーズン・歴代）は、UFOUL・TFを新旧の合計として出す（DESIGN.md 16-8章）。
 * 列の定義には両方の列を持たせ、表に出すときに foulKeyVisible で選ぶ。
 */
export const FOUL_SPLIT_KEYS = ["tf1", "tf2", "flag", "disr"] as const;
export type FoulSplitKey = (typeof FOUL_SPLIT_KEYS)[number];

/** 合計の列（UFOUL・TF）のキー */
const FOUL_MERGED_KEYS: readonly string[] = ["ufoul", "tf"];

/** 新しい区分の列（tf1・tf2・flag・disr）のキーか */
export function isFoulSplitKey(key: string | undefined): key is FoulSplitKey {
  return (FOUL_SPLIT_KEYS as readonly string[]).includes(key ?? "");
}

/** split=true（新しい区分の列を出す表）のとき、この列を出すか。ファウル以外の列は常に出す */
export function foulKeyVisible(key: string, split: boolean): boolean {
  if (FOUL_MERGED_KEYS.includes(key)) return !split;
  if (isFoulSplitKey(key)) return split;
  return true;
}

/** 列の一覧から、表の種類（split）に合わないファウルの列を除く */
export function filterFoulColumns<T extends { key: string }>(columns: readonly T[], split: boolean): T[] {
  return columns.filter((c) => foulKeyVisible(c.key, split));
}

/** 表示対象のシーズンから、ファウルの列を新しい区分にするか（すべて2026-27以降のときだけtrue） */
export function foulColumnsSplit(seasons: readonly string[]): boolean {
  return seasonsAllNewRule(seasons);
}
