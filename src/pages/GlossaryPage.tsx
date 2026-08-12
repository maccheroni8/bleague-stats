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
        公式に定義がない項目のみNBA/Basketball-Reference流で補っています（DESIGN.md 6章）
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
    </div>
  );
}
