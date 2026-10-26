// チーム詳細 > チームスタッツ > シーズン別成績の、登録区分別（各シーズンの行から、日本人／外国籍・帰化・アジアの2行を開く。DESIGN.md 288章の段階4）。
// 2026-27 以降のシーズンは、日本人／外国籍／帰化／アジア特別枠の4行（試合ごとの区分。DESIGN.md 298章）。
// 値は teamClassSplit.ts の sumClassTotals（自チームのその区分の選手の合計。opp の視点は相手チームの同じ区分の選手）。
// 列の値の出し方は、区間別（teamSeasonPeriod.ts）と同じく全チームスタッツの列の式を名前で引き、区分では出せない列は「-」にする。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { TeamGameLog } from "../../shared/types";
import type { SeasonDisplayMode } from "./playerSeasonBoxscore";
import { DETAILED_SPLIT_CLASSES, SPLIT_CLASS_LABELS, SPLIT_CLASSES, sumClassTotals, withOppMinutes, CLASS_SPLIT_UNAVAILABLE_COLUMN_KEYS, type SplitClass } from "./teamClassSplit";
import { splitClassificationSeason } from "./classificationFilter";
import type { ClassSplitSourceState } from "./teamClassSplitLoad";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  type TeamPerspective,
  type TeamTotals,
} from "./teamStatsColumns";
import { seasonPeriodFormatters, type PeriodFormatter, type SeasonPeriodRow } from "./teamSeasonPeriod";

/** 行の見出し。opp の視点は相手の同じ区分の選手（決定済みの表記） */
export function classRowLabel(cls: SplitClass, perspective: TeamPerspective): string {
  const name = SPLIT_CLASS_LABELS[cls];
  return perspective === "opp" ? `相手の${name}` : name;
}

/** そのシーズンの区分の行（2026-27 以降は外国籍・帰化・アジア特別枠を分ける） */
export function seasonSplitClasses(season: string): readonly SplitClass[] {
  return splitClassificationSeason(season) ? DETAILED_SPLIT_CLASSES : SPLIT_CLASSES;
}

/** 1シーズン・1区分の行（SeasonPeriodRow と同じ形。ready のとき数えた試合・勝敗・合計が入る） */
export function buildSeasonClassRow(
  season: string,
  state: ClassSplitSourceState | undefined,
  regularLogs: readonly TeamGameLog[],
  cls: SplitClass,
  perspective: TeamPerspective,
  emptyTotals: TeamTotals,
): SeasonPeriodRow {
  const none = { season, games: [], wins: 0, losses: 0, totals: emptyTotals };
  if (!state || state.status === "loading") return { ...none, status: "loading" };
  if (state.status === "unreadable") return { ...none, status: "unreadable" };
  const { games, totals } = sumClassTotals(state.source, regularLogs, cls);
  if (games.length === 0) return { ...none, status: "empty" };
  const wins = games.filter((g) => g.win).length;
  return { season, status: "ready", games, wins, losses: games.length - wins, totals: perspective === "opp" ? withOppMinutes(totals) : totals };
}

/** 区分の行で出せない列の名前（全チームスタッツの列のキー→見出し。BSR は相手のBLKなので区分では意味が変わるため同じく出さない） */
function unavailableLabels(mode: SeasonDisplayMode, perspective: TeamPerspective, foulSplit: boolean): Set<string> {
  const labels = new Set<string>(["BSR"]);
  for (const cols of [
    buildTraditionalColumns(mode, perspective),
    buildAdvancedColumns(mode, perspective),
    buildMiscColumns(mode, perspective, true, foulSplit),
    buildScoringColumns(mode, perspective, true, true),
  ]) {
    for (const c of cols) if (CLASS_SPLIT_UNAVAILABLE_COLUMN_KEYS.has(c.key)) labels.add(c.label);
  }
  return labels;
}

/** 区分の行の、列の値の出し方。出せない列と、+/- の視点（G 以外の全列）は「-」 */
export function seasonClassFormatters(mode: SeasonDisplayMode, perspective: TeamPerspective, foulSplit: boolean): Map<string, PeriodFormatter> {
  const base = seasonPeriodFormatters(mode, perspective, foulSplit);
  const out = new Map<string, PeriodFormatter>();
  const off = unavailableLabels(mode, perspective, foulSplit);
  for (const [label, f] of base) out.set(label, perspective === "diff" ? (label === "G" ? f : () => "-") : off.has(label) ? () => "-" : f);
  return out;
}
