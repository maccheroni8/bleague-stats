/**
 * 2026-27シーズンの新競技規則（DESIGN.md 16章）に関する脚注。UFOUL（アンスポーツマンファウル）・
 * TF（テクニカルファウル）の列を含むテーブルの直下に置く。
 *
 * 公式の記録システム改修が間に合わないため、2026-27シーズン以降の試合でも旧名称で記録・配信される。
 * 実際の判定は新区分（ディスラプティブ/フレグラント、カテゴリ1/2）だが、当サイトは公式データの
 * 旧名称のまま表示する。表示対象のシーズン選択に2026-27以降が含まれるときだけ表示する。
 * 公式の一括更新後にデータ側が新表記へ移行したら、この脚注は削除する（16-3章）。
 */
import { NEW_RULE_FIRST_SEASON, seasonsIncludeNewRule } from "../lib/ruleChange";

export function RuleChangeFootnote({ seasons }: { seasons: readonly string[] }) {
  if (!seasonsIncludeNewRule(seasons)) return null;
  return (
    <p className="rule-change-footnote">
      ※ {NEW_RULE_FIRST_SEASON}シーズン以降は新競技規則が適用されており、UFOUL（アンスポーツマンファウル）の実際の判定は
      ディスラプティブファウルまたはフレグラントファウル、TF（テクニカルファウル）の実際の判定はカテゴリ1またはカテゴリ2の
      いずれかです。公式の記録システム改修完了まで、旧名称で表示されます。
    </p>
  );
}
