// カテゴリタブ「Periods」の表の列（全チームスタッツ。DESIGN.md 226章）。値の取り出し・集計は teamPeriodScoring.ts。
// チーム詳細のシーズン別成績・シチュエーション別成績は SortableTable ではなく自前の表なので、同じ列の定義（PERIOD_TABLE_COLUMNS）と文字列（periodCellText）を使う。
import type { Column } from "../components/SortableTable";
import {
  PERIOD_SCORING_LABELS,
  formatPeriodScoringValue,
  periodScoringValue,
  type PeriodScoringCell,
  type PeriodScoringMode,
  type PeriodScoringPerspective,
  type PeriodScoringRow,
} from "./teamPeriodScoring";

/** 表の列。試合全体（参考）・1Q〜4Q・前半・後半・延長と、延長のあった試合数 */
export const PERIOD_TABLE_COLUMNS = [
  { key: "full", label: "試合" },
  { key: "q1", label: PERIOD_SCORING_LABELS.q1 },
  { key: "q2", label: PERIOD_SCORING_LABELS.q2 },
  { key: "q3", label: PERIOD_SCORING_LABELS.q3 },
  { key: "q4", label: PERIOD_SCORING_LABELS.q4 },
  { key: "h1", label: PERIOD_SCORING_LABELS.h1 },
  { key: "h2", label: PERIOD_SCORING_LABELS.h2 },
  { key: "ot", label: PERIOD_SCORING_LABELS.ot },
] as const;
export type PeriodTableColumnKey = (typeof PERIOD_TABLE_COLUMNS)[number]["key"];

/** 延長のあった試合数の列の見出し */
export const OVERTIME_GAMES_LABEL = "OT G";

export function periodCell(scoring: PeriodScoringRow, key: PeriodTableColumnKey): PeriodScoringCell {
  return key === "full" ? scoring.full : scoring.periods[key];
}

/** 表のセルの文字列（値の無い区間は「-」） */
export function periodCellText(scoring: PeriodScoringRow, key: PeriodTableColumnKey, perspective: PeriodScoringPerspective, mode: PeriodScoringMode): string {
  return formatPeriodScoringValue(periodScoringValue(periodCell(scoring, key), perspective, mode), perspective, mode);
}

/** 延長のあった試合数の文字列。リーグ平均の行（チーム数で割った小数）は小数1桁 */
export function overtimeGamesText(scoring: PeriodScoringRow): string {
  const n = scoring.periods.ot.games;
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/** 全チームスタッツの列（SortableTable）。視点・平均/合計は、選んだ値に合わせる */
export function buildPeriodColumns<T extends { scoring: PeriodScoringRow }>(mode: PeriodScoringMode, perspective: PeriodScoringPerspective): Column<T>[] {
  const columns: Column<T>[] = PERIOD_TABLE_COLUMNS.map((c) => ({
    key: c.key,
    label: c.label,
    // 値の無い（延長の無い）チームは、並び替えで最後に回す
    sortValue: (r) => periodScoringValue(periodCell(r.scoring, c.key), perspective, mode) ?? Number.NEGATIVE_INFINITY,
    format: (r) => periodCellText(r.scoring, c.key, perspective, mode),
    // 失点は少ない方が良い
    higherIsBetter: perspective !== "opp",
  }));
  columns.push({
    key: "otGames",
    label: OVERTIME_GAMES_LABEL,
    sortValue: (r) => r.scoring.periods.ot.games,
    format: (r) => overtimeGamesText(r.scoring),
  });
  return columns;
}
