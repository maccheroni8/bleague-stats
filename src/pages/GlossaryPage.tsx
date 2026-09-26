import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  PLAYER_STAT_DEFS,
  STAT_CATEGORY_LABELS,
  STAT_CATEGORY_ORDER,
  TEAM_STAT_DEFS,
  type StatCategory,
  type StatMeta,
  type StatSource,
} from "../lib/statDefs";

const SOURCE_LABELS: Record<StatSource, string> = {
  official: "Bリーグ公式",
  nba: "NBA/Basketball-Reference流",
  custom: "独自集計",
};

interface GlossaryRow extends StatMeta {
  appliesTo: string[];
}

function mergeStatDefs(): GlossaryRow[] {
  const rows = new Map<string, GlossaryRow>();

  const addAll = (defs: StatMeta[], appliesToLabel: string) => {
    for (const def of defs) {
      const existing = rows.get(def.key);
      if (existing) {
        if (!existing.appliesTo.includes(appliesToLabel)) existing.appliesTo.push(appliesToLabel);
        continue;
      }
      rows.set(def.key, { ...def, appliesTo: [appliesToLabel] });
    }
  };

  addAll(TEAM_STAT_DEFS, "チーム");
  addAll(PLAYER_STAT_DEFS, "個人");

  return [...rows.values()];
}

function groupByCategory(rows: GlossaryRow[]): Map<StatCategory, GlossaryRow[]> {
  const grouped = new Map<StatCategory, GlossaryRow[]>();
  for (const row of rows) {
    const list = grouped.get(row.category) ?? [];
    list.push(row);
    grouped.set(row.category, list);
  }
  return grouped;
}

export function GlossaryPage() {
  const { hash } = useLocation();
  // 各ページの表の下のリンク（/glossary#節のid）から来たときは、その節まで送る
  useEffect(() => {
    if (!hash) return;
    document.getElementById(decodeURIComponent(hash.slice(1)))?.scrollIntoView();
  }, [hash]);
  const grouped = groupByCategory(mergeStatDefs());
  const categories = [
    ...STAT_CATEGORY_ORDER,
    ...[...grouped.keys()].filter((c) => !STAT_CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div>
      <h1>スタッツ用語集</h1>
      <p className="page-subtitle">
        各項目の計算式とデータソース。Bリーグ公式の「スタッツ用語解説」に定義がある項目はその式を採用し、
        公式に定義がない項目のみNBA/Basketball-Reference流で補っています
      </p>

      {categories.map((category) => {
        const rows = grouped.get(category);
        if (!rows || rows.length === 0) return null;
        return (
          <section key={category} className="glossary-section">
            <h2>{STAT_CATEGORY_LABELS[category] ?? category}</h2>
            <div className="table-scroll">
              <table className="sortable-table glossary-table">
                <thead>
                  <tr>
                    <th className="align-left">項目</th>
                    <th className="align-left">計算式</th>
                    <th className="align-left">対象</th>
                    <th className="align-left">ソース</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td className="align-left">
                        {row.label}
                        {row.officialAbbr && <span className="glossary-abbr">{row.officialAbbr}</span>}
                      </td>
                      <td className="align-left glossary-formula">{row.formulaText}</td>
                      <td className="align-left">{row.appliesTo.join(" / ")}</td>
                      <td className="align-left">
                        <span className={`source-badge source-${row.source}`}>{SOURCE_LABELS[row.source]}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

      <section className="glossary-section">
        <h2>ボックススコア・チーム個別指標の補足</h2>
        <h3>ターンオーバー強制/被強制（種類別）</h3>
        <p>
          Yahoo!スポーツplay-by-play由来の指標（2023-24シーズン以降）。「相手から奪った」＝自チームのディフェンス成果（相手に強制したターンオーバー）、
          「自チームが記録」＝自チームのオフェンス課題（相手に強制されたターンオーバー）。いずれも種類別カウント（レギュラーシーズンのみ）。
          チーム詳細ページ「チームスタッツ」タブに掲載。
        </p>
      </section>

      <section className="glossary-section" id="game-lineups">
        <h2>ラインナップ別成績（試合詳細）</h2>
        <h3>集計の対象</h3>
        <p>
          同じ5人が同時にコートにいた時間帯ごとの成績です。得点・失点は、その5人の在コート中に両チームが記録した得点です。
        </p>
        <h3>OC（オンザコート）と色分け</h3>
        <p>
          OCは、5人のうち外国籍・帰化・アジア特別枠の選手の人数です。4人の組み合わせはチームカラーの背景と左端の線、3人は薄い背景で示します。
        </p>
        <h3>OCの人数ごとの合計</h3>
        <p>
          各チームの上の表はOCの人数ごとの合計です。行を押すと、下の一覧がその人数の組み合わせだけになります（もう一度押すと元に戻ります）。
        </p>
        <h3>集計外</h3>
        <p>
          区分が分からない選手がいた時間・そのシーズンの上限を超える人数になっていた時間・記録から5人を割り出せなかった時間は「集計外」にまとめます。
          集計外を含めた合計は、試合時間・試合の得点と一致します。
        </p>
        <h3>Q別・前後半</h3>
        <p>Q別・前後半では、Qをまたいで出場した組み合わせの出場時間・得点をQごとに分けて集計します。</p>
      </section>

      <section className="glossary-section">
        <h2>試合種別の表記</h2>
        <h3>CS・プレーオフ・ポストシーズン</h3>
        <p>
          レギュラーシーズン後の優勝決定戦の名称はシーズンによって異なります。2025-26シーズンまでは「CS（チャンピオンシップ）」、
          2026-27シーズンからは「プレーオフ」（公式名称「B.LEAGUE PREMIER PLAYOFFS」）と表記します。
          通算成績・歴代記録・シーズン別成績など複数シーズンをまたぐ表示では、両方を含む中立の表記として「ポストシーズン」を使います。
        </p>
      </section>
    </div>
  );
}
