import { teamShortName } from "../../shared/teamNames";
import { LEAGUE_TEAM_ID, LEAGUE_TEAM_NAME } from "../lib/leagueAverage";
import { ASSIST_SELF_CATEGORIES, compareAssistSelf, type AssistSelfOrder, type AssistSelfShare, type SelfShotKind } from "../lib/selfScoring";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";

export interface AssistSelfChartTeam {
  teamId: string;
  teamName: string;
  share: AssistSelfShare;
}

/**
 * 全チームのアシストの有無（自チームの成功のうち、アシストあり・セルフの割合。1行＝1チーム）。mode="opponent" は相手の成功のうち。
 * 描画は共通部品の ShareBarChart（得点構成・FG試投構成と同じ見た目。リーグ平均の行は teamId=LEAGUE_TEAM_ID で渡す）
 */
export function AssistSelfChart({
  teams,
  mode,
  kind,
  order = "total",
}: {
  teams: AssistSelfChartTeam[];
  mode: "own" | "opponent";
  kind: SelfShotKind;
  order?: AssistSelfOrder;
}) {
  const unit = kind === "pts" ? "点" : "本";
  const rows: ShareBarRow[] = teams
    .filter((t) => t.share.perGame > 0)
    .sort((a, b) => compareAssistSelf(order, a.share, b.share) || a.teamId.localeCompare(b.teamId))
    .map(({ teamId, teamName, share }) => {
      const league = teamId === LEAGUE_TEAM_ID;
      const short = league ? LEAGUE_TEAM_NAME : teamShortName(teamId, teamName);
      return {
        key: teamId,
        labelLines: [short],
        variant: league ? ("league" as const) : undefined,
        pct: share.pct,
        details: share.values.map((v) => v.toFixed(2)),
        tooltipDetails: share.values.map((v) => `（${v.toFixed(2)}${unit}）`),
        rightLabel: { wide: `${share.perGame.toFixed(2)}${unit}`, narrow: share.perGame.toFixed(2) },
        tooltipTitle: short,
        tooltipFooter: `${mode === "own" ? "平均" : "相手の平均"}: ${share.perGame.toFixed(2)}${unit}`,
      };
    });
  return <ShareBarChart rows={rows} categories={ASSIST_SELF_CATEGORIES} wideMinSegment={46} rightWidth={{ wide: 56, narrow: 36 }} />;
}
