import type { Column } from "../components/SortableTable";
import type { ShotTypeBreakdown } from "../../shared/types";
import { BOX_CATEGORY_TABS, CATEGORY_LABELS, type BoxCategoryKey } from "./categoryLabels";
import { formatWinPct } from "./format";
import type { SeasonDisplayMode } from "./playerSeasonBoxscore";
import { shotTypeEntityColumns } from "./shotTypeBreakdown";
import type { StatConditionItemDef } from "./statConditions";
import type { AllTeamsRow, TeamPerspective } from "./teamStatsColumns";

/**
 * チーム一覧・チームランキングのスタッツの条件に選べる項目（DESIGN.md 162章）。今のタブに限らず、
 * Traditional〜Scoring の自チームの項目と相手側の項目（opp PTS 等）、G・勝率、Shooting（シーズン通算）から選べる。
 * columnsFor は各ページが表に出している列そのもの（ページごとに列の作り方が少し違うため、ページから渡す）
 */
export function buildTeamConditionDefs(opts: {
  mode: SeasonDisplayMode;
  columnsFor: (tab: BoxCategoryKey, mode: SeasonDisplayMode, perspective: TeamPerspective) => Column<AllTeamsRow>[];
  /** 相手側の項目のうち、自チームと同じ値しか出ない列（試合数等）を除くための見本の行 */
  sampleRows: readonly AllTeamsRow[];
  /** Shooting はシーズン通算の値（teams.json）。1試合平均はシーズン全体の試合数で割る */
  shotTypesOf: (row: AllTeamsRow) => ShotTypeBreakdown | undefined;
  shotGamesOf: (row: AllTeamsRow) => number;
  shotTypeKeys: string[];
}): StatConditionItemDef<AllTeamsRow>[] {
  const { mode, columnsFor, sampleRows, shotTypesOf, shotGamesOf, shotTypeKeys } = opts;
  const otherMode: SeasonDisplayMode = mode === "total" ? "perGame" : "total";
  const text = (c: Column<AllTeamsRow>, r: AllTeamsRow) => (c.format ? c.format(r) : String(c.sortValue(r)));
  const firstTab = BOX_CATEGORY_TABS[0]!.label;
  const defs: StatConditionItemDef<AllTeamsRow>[] = [
    { key: "g", label: "G", group: firstTab, display: (r) => String(r.gamesPlayed) },
    {
      key: "winPct",
      label: "勝率",
      group: firstTab,
      display: (r) => (r.wins + r.losses > 0 ? formatWinPct(r.wins / (r.wins + r.losses)) : "-"),
    },
  ];
  const oppDefs: StatConditionItemDef<AllTeamsRow>[] = [];
  for (const tab of BOX_CATEGORY_TABS) {
    const own = columnsFor(tab.key, mode, "own");
    const ownOther = columnsFor(tab.key, otherMode, "own");
    const opp = columnsFor(tab.key, mode, "opp");
    const oppOther = columnsFor(tab.key, otherMode, "opp");
    own.forEach((c, i) => {
      const other = ownOther.find((o) => o.key === c.key) ?? ownOther[i];
      defs.push({ key: c.key, label: c.label, group: tab.label, display: (r) => text(c, r), displayOther: other ? (r) => text(other, r) : undefined });
      const o = opp.find((x) => x.key === c.key);
      if (!o) return;
      // 自チームと相手で同じ値しか出ない列（相手側の値を持たない列）は相手側の項目にしない
      if (sampleRows.length > 0 && sampleRows.every((r) => text(o, r) === text(c, r))) return;
      const oOther = oppOther.find((x) => x.key === c.key);
      oppDefs.push({
        key: `opp_${c.key}`,
        label: `opp ${c.label}`,
        group: `opp ${tab.label}`,
        display: (r) => text(o, r),
        displayOther: oOther ? (r) => text(oOther, r) : undefined,
      });
    });
  }
  const shootMode = mode === "total" ? "total" : "perGame";
  const shooting = shotTypeEntityColumns(shotTypeKeys, shotTypesOf, shootMode, shotGamesOf);
  const shootingOther = shotTypeEntityColumns(shotTypeKeys, shotTypesOf, shootMode === "total" ? "perGame" : "total", shotGamesOf);
  const shootingDefs = shooting.map((c, i) => {
    const other = shootingOther[i];
    return {
      key: c.key,
      label: c.label,
      group: CATEGORY_LABELS.shooting,
      display: (r: AllTeamsRow) => text(c, r),
      displayOther: other ? (r: AllTeamsRow) => text(other, r) : undefined,
      seasonTotal: true,
    };
  });
  return [...defs, ...oppDefs, ...shootingDefs];
}
