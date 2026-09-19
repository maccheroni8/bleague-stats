// 2026-27シーズンの新競技規則（DESIGN.md 16章）関連の共通定義。

/** 新競技規則が先行適用される最初のシーズン（9/22開幕から） */
export const NEW_RULE_FIRST_SEASON = "2026-27";

/** シーズン文字列は"2026-27"形式で辞書順＝時系列順なので、文字列比較で足りる */
export function seasonsIncludeNewRule(seasons: readonly string[]): boolean {
  return seasons.some((s) => s >= NEW_RULE_FIRST_SEASON);
}

/** 新規則の脚注が必要な統計項目のキー（UFOUL=アンスポーツマンファウル、TF=テクニカルファウル）。
 * ランキング等、1度に1項目だけ表示する画面で、その項目が対象かを判定するのに使う */
export function isRuleChangeStatKey(key: string | undefined): boolean {
  return key === "ufoul" || key === "tf";
}
