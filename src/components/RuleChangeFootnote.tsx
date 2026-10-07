/**
 * 2026-27シーズンの新競技規則（DESIGN.md 16章）に関する脚注。UFOUL・TF・DQFOULの列（2026-27以降だけの表ではTF1・TF2・FLAG・DISR・DQFOUL）を含むテーブルの直下に置く。
 *
 * 公式の記録は2026-10-06に新表記へ移行した（旧24→テクニカル カテゴリ1/2、旧25→フレグラント/ディスラプティブ。DESIGN.md 16-7章）。
 * 表示対象のシーズンがすべて2026-27以降の表は、新しい区分の4列を出す（16-8章）ので、その説明にする。
 * 2025-26以前を含む表は、UFOUL・TFが新旧の区分の合計であることを書く。2025-26以前だけの表には出さない。
 */
import { foulColumnsSplit, NEW_RULE_FIRST_SEASON, seasonsIncludeNewRule } from "../lib/ruleChange";

export function RuleChangeFootnote({ seasons }: { seasons: readonly string[] }) {
  if (!seasonsIncludeNewRule(seasons)) return null;
  if (foulColumnsSplit(seasons)) {
    return (
      <p className="rule-change-footnote">
        {`※ ${NEW_RULE_FIRST_SEASON}シーズン以降は新競技規則が適用されており、TF1・TF2はテクニカルファウルのカテゴリ1・カテゴリ2、` +
          "FLAGはフレグラントファウル、DISRはディスラプティブファウルの件数です。DQFOULはディスクォリファイングファウルの件数です。" +
          "チームのTF1・TF2には、ヘッドコーチ・ベンチのテクニカルファウルも含むため、選手の合計より多くなります。"}
      </p>
    );
  }
  return (
    <p className="rule-change-footnote">
      {"※ UFOULとTFは、新旧の区分の合計です。2025-26シーズン以前はアンスポーツマンファウル（UFOUL）とテクニカルファウル（TF）、" +
        `${NEW_RULE_FIRST_SEASON}シーズン以降はフレグラントファウルとディスラプティブファウルの合計（UFOUL）、` +
        "テクニカルファウルのカテゴリ1とカテゴリ2の合計（TF）の件数です。DQFOULは、どのシーズンもディスクォリファイングファウルの件数です。"}
    </p>
  );
}
