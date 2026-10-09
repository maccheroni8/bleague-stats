import { OVERTIME_GAMES_LABEL, PERIOD_TABLE_COLUMNS, overtimeGamesText, periodCellText } from "../lib/teamPeriodColumns";
import type { PeriodScoringMode, PeriodScoringPerspective, PeriodScoringRow } from "../lib/teamPeriodScoring";
import { statDescription } from "../lib/statDescriptions";
import { StatHeaderLabel } from "./StatHeaderLabel";

/**
 * チーム詳細のカテゴリタブ「Periods」の表の、区間の列（試合・1Q〜4Q・前半・後半・OT・OT G。DESIGN.md 226章）。
 * シーズン別成績・シチュエーション別成績が、自前の表の中で同じ列を使うための部品（全チームスタッツは SortableTable で teamPeriodColumns.ts の列を使う）
 */
export function PeriodScoringHeaderCells() {
  return (
    <>
      {PERIOD_TABLE_COLUMNS.map((c) => (
        <th key={c.key} className="align-right" title={statDescription(c.label, "team")}>
          <StatHeaderLabel label={c.label} />
        </th>
      ))}
      <th className="align-right" title={statDescription(OVERTIME_GAMES_LABEL, "team")}>
        {OVERTIME_GAMES_LABEL}
      </th>
    </>
  );
}

export function PeriodScoringCells({ scoring, perspective, mode }: { scoring: PeriodScoringRow; perspective: PeriodScoringPerspective; mode: PeriodScoringMode }) {
  return (
    <>
      {PERIOD_TABLE_COLUMNS.map((c) => (
        <td key={c.key} className="align-right">
          {periodCellText(scoring, c.key, perspective, mode)}
        </td>
      ))}
      <td className="align-right">{overtimeGamesText(scoring)}</td>
    </>
  );
}

/** 表の下の注記。前後半5分の特別な試合があれば、その試合数（表の行すべての合計）も書く */
export function periodScoringNote(withoutPeriods: number): string {
  return (
    "前半は1Q＋2Q、後半は3Q＋4Q。OTは延長のあった試合だけの値で、平均はその試合数（OT G）で割ります（合計はすべての延長の合計）。「試合」は試合全体の値です。" +
    (withoutPeriods > 0 ? `前後半5分の特別な試合（${withoutPeriods}試合）は1Q〜4Q・前半・後半・OTの値がないため、これらの列から除いています。` : "")
  );
}
