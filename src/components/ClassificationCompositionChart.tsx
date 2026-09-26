import { teamShortName } from "../../shared/teamNames";
import { LEAGUE_TEAM_ID, LEAGUE_TEAM_NAME } from "../lib/leagueAverage";
import type { TeamSummary } from "../../shared/types";
import { CLASSIFICATION_CATEGORIES, pointsDetails, pointsRightLabel, teamClassificationShare } from "../lib/shareCharts";
import { comparePointsShares, type PointsShareOrder } from "./ScoringCompositionChart";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";

export type ClassificationShareOrder = Extract<PointsShareOrder, "total" | "cat0" | "cat1">;

export const CLASSIFICATION_ORDER_LABELS: Record<ClassificationShareOrder, string> = {
  total: "得点（失点）が多い順",
  cat0: "日本人の割合が高い順",
  cat1: "外国籍・帰化・アジアの割合が高い順",
};

/**
 * 全チームの得点構成／失点構成（登録区分、1行＝1チーム）。登録区分が不明な選手の得点はどちらにも入れないため、2区分の合計が
 * 100%に満たないことがある。描画は共通部品の ShareBarChart（141章）
 */
export function ClassificationCompositionChart({
  teams,
  mode,
  order = "total",
}: {
  teams: TeamSummary[];
  mode: "own" | "opponent";
  order?: ClassificationShareOrder;
}) {
  const rows: ShareBarRow[] = teams
    .map((t) => ({ team: t, share: teamClassificationShare(t, mode) }))
    .sort((a, b) => comparePointsShares(order, a.share, b.share) || a.team.teamId.localeCompare(b.team.teamId))
    .map(({ team, share }) => {
      const d = pointsDetails(share, mode === "own" ? "pts" : "opp");
      const league = team.teamId === LEAGUE_TEAM_ID;
      const short = league ? LEAGUE_TEAM_NAME : teamShortName(team.teamId, team.teamName);
      return {
        key: team.teamId,
        labelLines: [short],
        variant: league ? ("league" as const) : undefined,
        pct: share.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: pointsRightLabel(share.perGame),
        tooltipTitle: short,
        tooltipFooter: d.footer,
      };
    });
  return <ShareBarChart rows={rows} categories={CLASSIFICATION_CATEGORIES} wideMinSegment={46} rightWidth={{ wide: 52, narrow: 36 }} />;
}
