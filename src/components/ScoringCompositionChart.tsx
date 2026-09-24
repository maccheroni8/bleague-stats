import { teamShortName } from "../../shared/teamNames";
import type { TeamSummary } from "../../shared/types";
import { pointsDetails, pointsRightLabel, SCORING_CATEGORIES, teamScoringShare, type PointsShare } from "../lib/shareCharts";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";

/**
 * 得点構成の並び順（全チームスタッツ Scoring %・選手一覧 Scoring %。DESIGN.md 141章）。
 * total は1試合平均の得点（失点構成では失点）が多い順、catN はその区分の割合が高い順（同じなら得点が多い順）
 */
export type PointsShareOrder = "total" | "cat0" | "cat1" | "cat2" | "cat3";

export const SCORING_ORDER_LABELS: Record<Exclude<PointsShareOrder, never>, string> = {
  total: "得点（失点）が多い順",
  cat0: "3Pの割合が高い順",
  cat1: "FTの割合が高い順",
  cat2: "ミッドレンジの割合が高い順",
  cat3: "ペイント内の割合が高い順",
};

export function comparePointsShares(order: PointsShareOrder, a: PointsShare, b: PointsShare): number {
  if (order === "total") return b.perGame - a.perGame;
  const i = Number(order.slice(3));
  return (b.pct[i] ?? 0) - (a.pct[i] ?? 0) || b.perGame - a.perGame;
}

/**
 * 全チームの得点構成／失点構成（3P・FT・ミッドレンジ・ペイント内、1行＝1チーム）。描画は共通部品の ShareBarChart（141章）で、
 * On-Court Foreign と同じ見た目（スマホ幅は棒の中に割合だけ、右端に1試合平均の得点・失点）
 */
export function ScoringCompositionChart({
  teams,
  mode,
  order = "total",
}: {
  teams: TeamSummary[];
  mode: "own" | "opponent";
  order?: PointsShareOrder;
}) {
  const rows: ShareBarRow[] = teams
    .map((t) => ({ team: t, share: teamScoringShare(t, mode) }))
    .sort((a, b) => comparePointsShares(order, a.share, b.share) || a.team.teamId.localeCompare(b.team.teamId))
    .map(({ team, share }) => {
      const d = pointsDetails(share, mode === "own" ? "pts" : "opp");
      const short = teamShortName(team.teamId, team.teamName);
      return {
        key: team.teamId,
        labelLines: [short],
        pct: share.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: pointsRightLabel(share.perGame),
        tooltipTitle: short,
        tooltipFooter: d.footer,
      };
    });
  return <ShareBarChart rows={rows} categories={SCORING_CATEGORIES} wideMinSegment={46} rightWidth={{ wide: 52, narrow: 36 }} />;
}
