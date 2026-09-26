import { useState } from "react";
import type { SeasonRules, TeamSummary } from "../../shared/types";
import {
  CLASSIFICATION_CATEGORIES,
  FGA_CATEGORIES,
  fgaDetails,
  fgaRightLabel,
  FOREIGN_CATEGORIES,
  foreignAverageLabel,
  foreignDetails,
  foreignShare,
  pointsDetails,
  pointsRightLabel,
  SCORING_CATEGORIES,
  teamClassificationShare,
  teamScoringShare,
  type PointsShare,
} from "../lib/shareCharts";
import { ShareBarChart, type ShareBarCategory, type ShareBarRow } from "./ShareBarChart";

/**
 * チーム詳細「チームスタッツ」タブの On-Court Foreign・Scoring % のシーズン別推移（1行＝1シーズン、新しいシーズンが上。DESIGN.md 141章）。
 * 値は全チームスタッツの同じグラフと同じ（各シーズンの teams.json）。レギュラーシーズン・シーズン合計で、上部の自チーム/opp/+/-・
 * 平均/合計とは連動しない
 */
export interface TeamSeasonShareRow {
  season: string;
  team: TeamSummary;
}

const IN_PROGRESS = "途中経過";

export function TeamSeasonForeignChart({
  rows,
  rules,
  inProgressSeason,
}: {
  rows: TeamSeasonShareRow[];
  rules: SeasonRules[] | null;
  /** レギュラーシーズンの途中のシーズン（「途中経過」を添える） */
  inProgressSeason: string | null;
}) {
  const chartRows: ShareBarRow[] = rows
    .map((r) => ({ ...r, share: foreignShare(r.team) }))
    .filter((r) => r.share.totalSeconds > 0)
    .map(({ season, share }) => {
      const max = rules?.find((x) => x.season === season)?.maxForeignOnCourt;
      const sub = [max !== undefined ? `上限${max}名` : null, season === inProgressSeason ? IN_PROGRESS : null].filter(Boolean).join("・");
      const d = foreignDetails(share);
      return {
        key: season,
        labelLines: sub ? [season, sub] : [season],
        pct: share.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: foreignAverageLabel(share.average),
        tooltipTitle: `${season}${max !== undefined ? `（上限${max}名）` : ""}${season === inProgressSeason ? `・${IN_PROGRESS}` : ""}`,
        tooltipFooter: d.footer,
      };
    });
  return (
    <>
      <ShareBarChart rows={chartRows} categories={FOREIGN_CATEGORIES} labelWidth={{ wide: 104, narrow: 92 }} />
      <p className="page-subtitle">
        レギュラーシーズン・シーズン合計の在コート時間から集計しています（上部の自チーム/opp/+/-・平均/合計とは連動しません）。各シーズンの見出しに、そのシーズンにコートに同時に出られる外国籍・帰化・アジア特別枠の選手の上限人数を添えています。
        平均人数は、0〜4名それぞれの在コート時間の割合に人数を掛けて合計した値です。登録区分が不明な選手を含むラインナップと、規定上ありえない人数の区間（公式記録の誤りと見られるもの）は集計から除外しています
      </p>
    </>
  );
}

function pointsRows(
  rows: TeamSeasonShareRow[],
  inProgressSeason: string | null,
  share: (t: TeamSummary) => PointsShare,
  unit: "pts" | "opp",
): ShareBarRow[] {
  return rows
    .map((r) => ({ season: r.season, s: share(r.team) }))
    .filter((r) => r.s.perGame > 0)
    .map(({ season, s }) => {
      const d = pointsDetails(s, unit);
      return {
        key: season,
        labelLines: season === inProgressSeason ? [season, IN_PROGRESS] : [season],
        pct: s.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: pointsRightLabel(s.perGame),
        tooltipTitle: season === inProgressSeason ? `${season}・${IN_PROGRESS}` : season,
        tooltipFooter: d.footer,
      };
    });
}

/** FG試投構成のシーズン別推移。fgaBySeason はシーズンごとのレギュラーシーズンの自チーム・相手のFG試投構成 */
function fgaRows(
  rows: TeamSeasonShareRow[],
  inProgressSeason: string | null,
  fgaBySeason: Map<string, { own: PointsShare; opponent: PointsShare }>,
  mode: "own" | "opponent",
): ShareBarRow[] {
  return rows.flatMap((r) => {
    const s = fgaBySeason.get(r.season)?.[mode];
    if (!s || s.perGame <= 0) return [];
    const d = fgaDetails(s, mode === "own" ? "own" : "opp");
    return [
      {
        key: r.season,
        labelLines: r.season === inProgressSeason ? [r.season, IN_PROGRESS] : [r.season],
        pct: s.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: fgaRightLabel(s.perGame),
        tooltipTitle: r.season === inProgressSeason ? `${r.season}・${IN_PROGRESS}` : r.season,
        tooltipFooter: d.footer,
      },
    ];
  });
}

function PointsTrend({ title, rows, categories }: { title: string; rows: ShareBarRow[]; categories: ShareBarCategory[] }) {
  return (
    <>
      <h4 className="share-trend-title">{title}</h4>
      <ShareBarChart rows={rows} categories={categories} wideMinSegment={46} labelWidth={{ wide: 64, narrow: 56 }} rightWidth={{ wide: 52, narrow: 36 }} />
    </>
  );
}

export function TeamSeasonScoringCharts({
  rows,
  inProgressSeason,
  fgaBySeason,
}: {
  rows: TeamSeasonShareRow[];
  inProgressSeason: string | null;
  /** FG試投構成（試合ログから求める。読み込み中は null） */
  fgaBySeason: Map<string, { own: PointsShare; opponent: PointsShare }> | null;
}) {
  // 失点構成は最初は隠し、ボタンで出す（得点構成・得点構成（登録区分）の2つを並べるのが主）
  const [showOpponent, setShowOpponent] = useState(false);
  return (
    <>
      <PointsTrend title="得点構成" rows={pointsRows(rows, inProgressSeason, (t) => teamScoringShare(t, "own"), "pts")} categories={SCORING_CATEGORIES} />
      <PointsTrend
        title="得点構成（登録区分）"
        rows={pointsRows(rows, inProgressSeason, (t) => teamClassificationShare(t, "own"), "pts")}
        categories={CLASSIFICATION_CATEGORIES}
      />
      {fgaBySeason ? (
        <PointsTrend title="FG試投構成" rows={fgaRows(rows, inProgressSeason, fgaBySeason, "own")} categories={FGA_CATEGORIES} />
      ) : (
        <p className="loading">読み込み中...</p>
      )}
      <button type="button" className="mobile-collapse-toggle share-trend-toggle" aria-expanded={showOpponent} onClick={() => setShowOpponent((v) => !v)}>
        {showOpponent ? "失点構成・opp FG試投構成を隠す" : "失点構成・opp FG試投構成を表示"}
      </button>
      {showOpponent && (
        <>
          <PointsTrend
            title="失点構成"
            rows={pointsRows(rows, inProgressSeason, (t) => teamScoringShare(t, "opponent"), "opp")}
            categories={SCORING_CATEGORIES}
          />
          <PointsTrend
            title="失点構成（登録区分）"
            rows={pointsRows(rows, inProgressSeason, (t) => teamClassificationShare(t, "opponent"), "opp")}
            categories={CLASSIFICATION_CATEGORIES}
          />
          {fgaBySeason && (
            <PointsTrend title="opp FG試投構成" rows={fgaRows(rows, inProgressSeason, fgaBySeason, "opponent")} categories={FGA_CATEGORIES} />
          )}
        </>
      )}
      <p className="page-subtitle">
        レギュラーシーズン・シーズン合計の値です（上部の自チーム/opp/+/-・平均/合計とは連動しません）。棒の中の数値は割合(%)と1試合平均の得点、右端は1試合平均の得点（失点構成は失点）です。
        ミッドレンジは「2Pの得点−ペイント内の得点」です。登録区分は現在の登録情報に基づく値です。
        FG試投構成はFGAに占める3P・Mid-range・Paintの割合で、Paint・Mid-rangeはプレーバイプレーの公式の区分（ペイント内／ペイント外の2P）です。棒の中の数値は割合(%)と1試合平均の試投数、右端は1試合平均のFGAです
      </p>
    </>
  );
}
