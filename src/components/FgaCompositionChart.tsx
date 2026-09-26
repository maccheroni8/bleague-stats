import { teamShortName } from "../../shared/teamNames";
import { LEAGUE_TEAM_ID, LEAGUE_TEAM_NAME } from "../lib/leagueAverage";
import { FGA_CATEGORIES, fgaDetails, fgaRightLabel, type PointsShare } from "../lib/shareCharts";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";

/**
 * FG試投構成の並び順（全チームスタッツ Scoring %）。total は1試合平均のFGA（opp は相手のFGA）が多い順、
 * catN はその区分の割合が高い順（同じならFGAが多い順）
 */
export type FgaShareOrder = "total" | "cat0" | "cat1" | "cat2";

export const FGA_ORDER_LABELS: Record<FgaShareOrder, string> = {
  total: "FGAが多い順",
  cat0: "3Pの割合が高い順",
  cat1: "Mid-rangeの割合が高い順",
  cat2: "Paintの割合が高い順",
};

function compareFgaShares(order: FgaShareOrder, a: PointsShare, b: PointsShare): number {
  if (order === "total") return b.perGame - a.perGame;
  const i = Number(order.slice(3));
  return (b.pct[i] ?? 0) - (a.pct[i] ?? 0) || b.perGame - a.perGame;
}

export interface FgaChartTeam {
  teamId: string;
  teamName: string;
  share: PointsShare;
}

/**
 * 全チームのFG試投構成／opp FG試投構成（3P・Mid-range・Paint、1行＝1チーム）。得点構成と同じ見た目
 * （スマホ幅は棒の中に割合だけ、右端に1試合平均のFGA）。リーグ平均の行は teamId=LEAGUE_TEAM_ID で渡す
 */
export function FgaCompositionChart({ teams, mode, order = "total" }: { teams: FgaChartTeam[]; mode: "own" | "opponent"; order?: FgaShareOrder }) {
  const rows: ShareBarRow[] = teams
    .filter((t) => t.share.perGame > 0)
    .sort((a, b) => compareFgaShares(order, a.share, b.share) || a.teamId.localeCompare(b.teamId))
    .map(({ teamId, teamName, share }) => {
      const d = fgaDetails(share, mode === "own" ? "own" : "opp");
      const league = teamId === LEAGUE_TEAM_ID;
      const short = league ? LEAGUE_TEAM_NAME : teamShortName(teamId, teamName);
      return {
        key: teamId,
        labelLines: [short],
        variant: league ? ("league" as const) : undefined,
        pct: share.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: fgaRightLabel(share.perGame),
        tooltipTitle: short,
        tooltipFooter: d.footer,
      };
    });
  return <ShareBarChart rows={rows} categories={FGA_CATEGORIES} wideMinSegment={46} rightWidth={{ wide: 52, narrow: 36 }} />;
}
