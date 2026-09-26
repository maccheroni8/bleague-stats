import { teamShortName } from "../../shared/teamNames";
import { LEAGUE_TEAM_ID, LEAGUE_TEAM_NAME } from "../lib/leagueAverage";
import type { TeamSummary } from "../../shared/types";
import { FOREIGN_CATEGORIES, foreignAverageLabel, foreignDetails, foreignShare, type ForeignShare } from "../lib/shareCharts";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";

interface ForeignPlayerCourtTimeChartProps {
  teams: TeamSummary[];
  order?: ForeignCourtOrder;
  /**
   * そのシーズンに同時に出られる外国籍・特別枠の最大人数（season-rules.json の maxForeignOnCourt）。これを超える人数の区分
   * （規定上ありえない。公式記録の選手の取り違え等で生じる）は並べ替えの比較に使わない。グラフの表示はそのまま。未指定なら全区分を使う
   */
  maxOnCourt?: number;
}

/**
 * チームの並び順（全チームスタッツのOn-Court Foreign。DESIGN.md 135章）。比べる値は画面に出している割合（%、丸める前）。
 * - foreignDesc: 外国籍が多い順。人数の多い区分の割合から順に比べる（4名→3名→2名→1名→0名。規定上ありえない人数の区分は飛ばす）（初期値）
 * - averageDesc / averageAsc: 平均人数（Σ 人数×割合）が多い順 / 少ない順。同じなら外国籍が多い順
 */
export type ForeignCourtOrder = "foreignDesc" | "averageDesc" | "averageAsc";

export const FOREIGN_COURT_ORDER_LABELS: Record<ForeignCourtOrder, string> = {
  foreignDesc: "外国籍が多い順",
  averageDesc: "平均人数が多い順",
  averageAsc: "平均人数が少ない順",
};

function compareByBuckets(a: readonly number[], b: readonly number[], buckets: readonly number[]): number {
  for (const i of buckets) {
    const diff = b[i]! - a[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareShares(order: ForeignCourtOrder, a: ForeignShare, b: ForeignShare, buckets: readonly number[]): number {
  const byForeign = compareByBuckets(a.pct, b.pct, buckets);
  if (order === "averageDesc") return b.average - a.average || byForeign;
  if (order === "averageAsc") return a.average - b.average || byForeign;
  return byForeign;
}

/**
 * 全チームのOn-Court Foreign（1行＝1チーム。DESIGN.md 84章・135章）。PBPの在コート復元に依存するため、登録区分が不明な選手を含む
 * ラインナップと規定の上限人数を超える区間は除外されている（合計時間が実際の出場時間より短くなりうる）。合計が0のチーム（データ欠落）は出さない。
 * 描画は共通部品の ShareBarChart（141章）
 */
export function ForeignPlayerCourtTimeChart({ teams, order = "foreignDesc", maxOnCourt }: ForeignPlayerCourtTimeChartProps) {
  // 比べる区分: 人数の多い順（規定の上限を超える区分は除く）
  const buckets = [4, 3, 2, 1, 0].filter((n) => maxOnCourt === undefined || n <= maxOnCourt);
  const rows: ShareBarRow[] = teams
    .map((t) => ({ team: t, share: foreignShare(t) }))
    .filter((r) => r.share.totalSeconds > 0)
    .sort((a, b) => compareShares(order, a.share, b.share, buckets) || a.team.teamId.localeCompare(b.team.teamId))
    .map(({ team, share }) => {
      const d = foreignDetails(share);
      const league = team.teamId === LEAGUE_TEAM_ID;
      const short = league ? LEAGUE_TEAM_NAME : teamShortName(team.teamId, team.teamName);
      return {
        key: team.teamId,
        labelLines: [short],
        variant: league ? ("league" as const) : undefined,
        pct: share.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: foreignAverageLabel(share.average),
        tooltipTitle: short,
        tooltipFooter: d.footer,
      };
    });
  return <ShareBarChart rows={rows} categories={FOREIGN_CATEGORIES} />;
}
