import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
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

export function TeamSeasonForeignChart({
  rows,
  rules,
}: {
  rows: TeamSeasonShareRow[];
  rules: SeasonRules[] | null;
}) {
  const chartRows: ShareBarRow[] = rows
    .map((r) => ({ ...r, share: foreignShare(r.team) }))
    .filter((r) => r.share.totalSeconds > 0)
    .map(({ season, share }) => {
      const max = rules?.find((x) => x.season === season)?.maxForeignOnCourt;
      const sub = max !== undefined ? `上限${max}名` : "";
      const d = foreignDetails(share);
      return {
        key: season,
        labelLines: sub ? [season, sub] : [season],
        pct: share.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: foreignAverageLabel(share.average),
        tooltipTitle: `${season}${max !== undefined ? `（上限${max}名）` : ""}`,
        tooltipFooter: d.footer,
      };
    });
  return (
    <>
      <ShareBarChart rows={chartRows} categories={FOREIGN_CATEGORIES} labelWidth={{ wide: 104, narrow: 92 }} />
      <GlossaryNote anchor={GLOSSARY_ANCHORS.foreignCourt} label="在コート時間" scope="レギュラーシーズン・シーズン合計の値です（上部の自チーム/opp/+/-・平均/合計とは連動しません）。" />
    </>
  );
}

function pointsRows(
  rows: TeamSeasonShareRow[],
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
        labelLines: [season],
        pct: s.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: pointsRightLabel(s.perGame),
        tooltipTitle: season,
        tooltipFooter: d.footer,
      };
    });
}

/** FG試投構成のシーズン別推移。fgaBySeason はシーズンごとのレギュラーシーズンの自チーム・相手のFG試投構成 */
function fgaRows(
  rows: TeamSeasonShareRow[],
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
        labelLines: [r.season],
        pct: s.pct,
        details: d.details,
        tooltipDetails: d.tooltipDetails,
        rightLabel: fgaRightLabel(s.perGame),
        tooltipTitle: r.season,
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
  fgaBySeason,
  perspective,
}: {
  rows: TeamSeasonShareRow[];
  /** FG試投構成（試合ログから求める。読み込み中は null） */
  fgaBySeason: Map<string, { own: PointsShare; opponent: PointsShare }> | null;
  /** 自チーム（得点構成・FG試投構成）か opp（失点構成・opp FG試投構成。DESIGN.md 183章） */
  perspective: "own" | "opp";
}) {
  const opp = perspective === "opp";
  const side = opp ? "opponent" : "own";
  return (
    <>
      <PointsTrend
        title={opp ? "失点構成" : "得点構成"}
        rows={pointsRows(rows, (t) => teamScoringShare(t, side), opp ? "opp" : "pts")}
        categories={SCORING_CATEGORIES}
      />
      <PointsTrend
        title={opp ? "失点構成（登録区分）" : "得点構成（登録区分）"}
        rows={pointsRows(rows, (t) => teamClassificationShare(t, side), opp ? "opp" : "pts")}
        categories={CLASSIFICATION_CATEGORIES}
      />
      {fgaBySeason ? (
        <PointsTrend title={opp ? "opp FG試投構成" : "FG試投構成"} rows={fgaRows(rows, fgaBySeason, side)} categories={FGA_CATEGORIES} />
      ) : (
        <p className="loading">読み込み中...</p>
      )}
      <GlossaryNote anchor={GLOSSARY_ANCHORS.composition} label="得点構成・FG試投構成" scope="レギュラーシーズン・シーズン合計の値です（上部の視点は自チーム/oppに連動し、平均/合計とは連動しません）。" />
    </>
  );
}
