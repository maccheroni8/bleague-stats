import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { GlossaryGuides } from "../components/GlossaryGuides";
import {
  PLAYER_STAT_DEFS,
  STAT_CATEGORY_LABELS,
  STAT_CATEGORY_ORDER,
  TEAM_STAT_DEFS,
  type StatCategory,
  type StatMeta,
  type StatSource,
} from "../lib/statDefs";
import { statGlossaryTitle } from "../lib/statNames";
import { RANK_DIRECTION_GLOSSARY } from "../lib/rankDirection";

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
                        {/* 日本語名（略称）。Bリーグ公式の略称が表の略称と違う項目（AST の公式略称 AS 等）だけ、公式の略称を添える */}
                        {statGlossaryTitle(row.label, row.appliesTo.length === 1 && row.appliesTo[0] === "チーム" ? "team" : "player")}
                        {row.officialAbbr && row.officialAbbr !== row.label && <span className="glossary-abbr">{row.officialAbbr}</span>}
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

      <section className="glossary-section">
        <h2>試合詳細ボックススコアのリバウンドの割合</h2>
        <h3>OR%（オフェンスリバウンド率）</h3>
        <p>
          チームの行は、100 × 自チームOR ÷（自チームOR＋相手DR）です。選手の行は、100 × 本人のOR ÷（本人が出場中の自チームOR＋出場中の相手DR）で、
          チームに付いたリバウンドも分母に含めます（Q別・前後半を選ぶと、その期間の値になります）。
          プレーバイプレーの記録が無い試合と、リバウンドの記録が出場選手の復元と合わない試合の選手の行は「-」です。
        </p>
        <h3>%OR（チームORに占める割合）</h3>
        <p>
          内訳集計（スタメン・ベンチ・登録区分）だけの項目で、100 × グループのOR ÷ チームのORです。選手に付いたORの割合なので、チームに付いたORは
          どの内訳にも含まれず、合計が100%にならないことがあります（チーム合計の行は100%）。個人のOR%（オフェンスリバウンド率）とは分母が違う別の項目です。
          手入力の試合（チームリバウンドの記録が無い試合）は「-」です。
        </p>
        <h3>%USG・%AST（内訳集計）</h3>
        <p>
          内訳集計（スタメン・ベンチ・登録区分）だけの項目で、チーム全体に占める割合です。%USG は 100 × グループの（FGA＋0.44×FTA＋TOV）÷ チーム全体の同じ値、
          %AST は 100 × グループのAST ÷ チームのASTです。チーム合計の行は100%です。個人の USG%・AST% とは別の項目です。
        </p>
      </section>

      <section className="glossary-section">
        <h2>ランキングの順位の向き・最低試投数</h2>
        <p>
          ランキングは「1位＝良いほう」にそろえます。次の3種類に分けています。同じ値は同じ順位（次の順位はとばす）です。
          1試合記録の成功率は、同じ成功率なら成功数が多いほうを上にします（成功数も同じなら同順位）。
        </p>
        {RANK_DIRECTION_GLOSSARY.map((g) => (
          <div key={g.direction}>
            <h3>{g.title}</h3>
            <p>{g.items}</p>
          </div>
        ))}
        <h3>成功率の最低試投数</h3>
        <p>
          FG%・2P%・3P%・FT% は、ランキングの掲載基準（出場率と、1試合平均の成功数）のとおりです。シュートタイプ・エリア別の成功率（Shooting）は、
          その期間のチームの試合数の半分以上（端数は切り上げ。60試合なら30本、5試合なら3本）の試投がある選手だけに順位を付けます。チームには最低ラインを付けません。
        </p>
        <h3>比較ページの順位</h3>
        <p>
          比較ページの数字の下に、ランキング（シーズン成績）と同じ決め方の順位を添えます（「順位を表示」で切り替え）。チームは全チームの中の順位です。
          選手は、ランキングの掲載基準（出場率と、成功率の項目の追加の基準）を満たす選手の中で20位以内のときだけ出します。
          「◯位相当」は、出場率が掲載基準に届かない選手が、もし基準を満たしていたら何位にあたるかを表します（20位以内のときだけ。成功率の項目で追加の基準に届かないときは出しません）。
          良し悪しのない項目（試合数・出場時間・テンポなど）には順位を付けません。選手の順位は、条件を絞っていないレギュラーシーズンの枠だけに付きます。
        </p>
        <h3>チーム詳細の順位と色</h3>
        <p>
          チーム詳細のチームスタッツ（シーズン別成績の Traditional・Advanced・Misc・Scoring と、Q別タブの表）では、数字の下に、そのシーズンのリーグの全チームの中の順位を添えます（「順位を表示」で切り替え）。
          順位は、表で選んでいる条件（シーズン・平均／合計・自チーム／opp・Q別・登録区分）での順位で、ランキング・比較ページと同じ決め方です。
          上位3位のマスは緑、下位3位のマスは赤で塗ります。少ないほど良い項目（TOV・ファウルなど）は、少ないほうが上位です。良し悪しのない項目には色を付けません（G・MIN・POSS・PACE などには順位も付けませんが、ベンチ／スターターの得点・登録区分別の得点とその割合・%3P・%PoutP・%FT・%OPA には、色なしで多い順の順位だけ付けます）。
        </p>
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
      <GlossaryGuides />
    </div>
  );
}
