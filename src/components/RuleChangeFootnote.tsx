/**
 * 2026-27シーズンの新競技規則（DESIGN.md 16章）に関する脚注。UFOUL・TF・DQFOULの列を含むテーブルの直下に置く。
 *
 * 公式の記録は2026-10-06に新表記へ移行した（旧24→テクニカル カテゴリ1/2、旧25→フレグラント/ディスラプティブ。DESIGN.md 16-7章）。
 * 当サイトは、2026-27シーズン以降のUFOUL・TFを新しい区分の合計として表示する（列の分け方は今後決める）。
 * 表示対象のシーズン選択に2026-27以降が含まれるときだけ表示する。
 */
import { NEW_RULE_FIRST_SEASON, seasonsIncludeNewRule } from "../lib/ruleChange";

export function RuleChangeFootnote({ seasons }: { seasons: readonly string[] }) {
  if (!seasonsIncludeNewRule(seasons)) return null;
  return (
    <p className="rule-change-footnote">
      ※ {NEW_RULE_FIRST_SEASON}シーズン以降は新競技規則が適用されており、UFOULはフレグラントファウルとディスラプティブファウルの合計、
      TFはテクニカルファウル（カテゴリ1とカテゴリ2）の合計です。2025-26シーズン以前のUFOULはアンスポーツマンファウル、
      TFはテクニカルファウルの件数です。DQFOULは、どのシーズンもディスクォリファイングファウルの件数です。
    </p>
  );
}
