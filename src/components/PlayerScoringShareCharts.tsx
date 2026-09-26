import { teamShortName } from "../../shared/teamNames";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
import type { PlayerGameLog } from "../../shared/types";
import type { GameTeamInfo } from "../lib/situational";
import { surnameOf } from "../lib/playerSurname";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  FGA_CATEGORIES,
  fgaDetails,
  fgaRightLabel,
  fgaShare,
  isRegularSeasonInProgress,
  playerScoringShare,
  pointsDetails,
  pointsRightLabel,
  SCORING_CATEGORIES,
  type PointsShare,
} from "../lib/shareCharts";
import { fetchPlayoffRace } from "../lib/data";
import { currentSeason } from "../lib/season";
import { useJsonData } from "../lib/useJsonData";
import { comparePointsShares, type PointsShareOrder } from "./ScoringCompositionChart";
import { compareFgaShares, type FgaShareOrder } from "./FgaCompositionChart";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";

/**
 * 選手の得点構成（3P・FT・ミッドレンジ・ペイント内。DESIGN.md 141章）。チームの得点構成と同じ区分・同じ計算で、選手が決めた得点の内訳。
 * 失点構成・登録区分の構成は選手単位では意味が無いので出さない（選手ごとの失点の記録は無く、登録区分は本人の1区分だけのため）
 */

/** レギュラーシーズンの出場試合（出場時間0の試合は除く）の合計から得点構成を出す */
export function playerLogsScoringShare(logs: PlayerGameLog[]): PointsShare & { games: number } {
  const played = logs.filter((g) => g.gameType === "regular" && g.min > 0);
  const sum = (f: (g: PlayerGameLog) => number) => played.reduce((a, g) => a + f(g), 0);
  const share = playerScoringShare({
    games: played.length,
    pts: sum((g) => g.pts),
    fgm: sum((g) => g.fgm),
    tpm: sum((g) => g.tpm),
    ftm: sum((g) => g.ftm),
    pt2in: sum((g) => g.pt2in),
  });
  return { ...share, games: played.length };
}

/** レギュラーシーズンの出場試合の合計から FG試投構成（3P・Mid-range・Paint。ペイント内外はプレーバイプレーの公式の区分）を出す */
export function playerLogsFgaShare(logs: PlayerGameLog[]): PointsShare & { games: number } {
  const played = logs.filter((g) => g.gameType === "regular" && g.min > 0);
  const sum = (f: (g: PlayerGameLog) => number) => played.reduce((a, g) => a + f(g), 0);
  const share = fgaShare({ games: played.length, tpa: sum((g) => g.tpa), mid2a: sum((g) => g.mid2a), paint2a: sum((g) => g.paint2a) });
  return { ...share, games: played.length };
}

// --- 選手一覧「Scoring %」: 選択したシーズンの選手（1行＝1選手） ---

export interface PlayerShareListRow {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  share: PointsShare;
  /** FG試投構成 */
  fga: PointsShare;
}

export function PlayersScoringShareChart({
  rows,
  order,
  visibleCount,
  onMore,
}: {
  rows: PlayerShareListRow[];
  order: PointsShareOrder;
  visibleCount: number;
  onMore: () => void;
}) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const sorted = [...rows].sort((a, b) => comparePointsShares(order, a.share, b.share) || a.playerId.localeCompare(b.playerId));
  const chartRows: ShareBarRow[] = sorted.slice(0, visibleCount).map((r) => {
    const d = pointsDetails(r.share);
    const team = teamShortName(r.teamId, r.teamName);
    return {
      key: r.playerId,
      // スマホ幅は名字だけ（見出しの幅に収めるため。サイト全体と同じ出し方で、「〜・ジュニア」は「ジュニア」）
      labelLines: [narrow ? surnameOf(r.name) : r.name, team],
      pct: r.share.pct,
      details: d.details,
      tooltipDetails: d.tooltipDetails,
      rightLabel: pointsRightLabel(r.share.perGame),
      tooltipTitle: `${r.name}（${team}）`,
      tooltipFooter: d.footer,
    };
  });
  const rest = sorted.length - visibleCount;
  return (
    <ShareBarChart
      rows={chartRows}
      categories={SCORING_CATEGORIES}
      wideMinSegment={46}
      labelWidth={{ wide: 200, narrow: 90 }}
      rightWidth={{ wide: 52, narrow: 36 }}
      emptyMessage="条件に該当する選手がいません"
      footer={
        rest > 0 && (
          <button className="load-more-button" type="button" onClick={onMore}>
            もっと見る（あと{rest}人）
          </button>
        )
      }
    />
  );
}

/** 選手一覧 Scoring % の FG試投構成（1行＝1選手）。対象の選手は得点構成と同じ。右端は1試合平均のFGA */
export function PlayersFgaShareChart({
  rows,
  order,
  visibleCount,
  onMore,
}: {
  rows: PlayerShareListRow[];
  order: FgaShareOrder;
  visibleCount: number;
  onMore: () => void;
}) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const sorted = rows.filter((r) => r.fga.perGame > 0).sort((a, b) => compareFgaShares(order, a.fga, b.fga) || a.playerId.localeCompare(b.playerId));
  const chartRows: ShareBarRow[] = sorted.slice(0, visibleCount).map((r) => {
    const d = fgaDetails(r.fga);
    const team = teamShortName(r.teamId, r.teamName);
    return {
      key: r.playerId,
      labelLines: [narrow ? surnameOf(r.name) : r.name, team],
      pct: r.fga.pct,
      details: d.details,
      tooltipDetails: d.tooltipDetails,
      rightLabel: fgaRightLabel(r.fga.perGame),
      tooltipTitle: `${r.name}（${team}）`,
      tooltipFooter: d.footer,
    };
  });
  const rest = sorted.length - visibleCount;
  return (
    <ShareBarChart
      rows={chartRows}
      categories={FGA_CATEGORIES}
      wideMinSegment={46}
      labelWidth={{ wide: 200, narrow: 90 }}
      rightWidth={{ wide: 52, narrow: 36 }}
      emptyMessage="条件に該当する選手がいません"
      footer={
        rest > 0 && (
          <button className="load-more-button" type="button" onClick={onMore}>
            もっと見る（あと{rest}人）
          </button>
        )
      }
    />
  );
}

// --- 個人詳細: その選手のシーズン別推移（1行＝1シーズン） ---

export function PlayerSeasonScoringChart({
  seasons,
}: {
  /** 新しいシーズンが先頭。ownTeamByScheduleKey は試合ごとの所属チーム（シーズン内移籍の見出しに使う） */
  seasons: { season: string; logs: PlayerGameLog[]; ownTeamByScheduleKey?: Map<string, GameTeamInfo> }[];
}) {
  // 今のシーズンがレギュラーシーズンの途中なら「途中経過」を添える（リーグ全体の残り試合で判定）
  const current = currentSeason();
  const { data: race } = useJsonData(() => fetchPlayoffRace(current).catch(() => null), [current]);
  const inProgressSeason = isRegularSeasonInProgress(current, current, race) ? current : null;
  const rows: ShareBarRow[] = [];
  const fgaRows: ShareBarRow[] = [];
  for (const s of seasons) {
    const share = playerLogsScoringShare(s.logs);
    if (share.games === 0 || share.perGame <= 0) continue;
    // 所属チームを試合の日付順に並べる（移籍したシーズンは1本にまとめ、見出しに「千葉J→A東京」と添える）
    const teams: string[] = [];
    for (const g of [...s.logs].filter((x) => x.gameType === "regular" && x.min > 0).sort((a, b) => a.date.localeCompare(b.date))) {
      const own = s.ownTeamByScheduleKey?.get(g.scheduleKey);
      if (!own) continue;
      const label = teamShortName(own.teamId, own.teamName);
      if (teams.at(-1) !== label) teams.push(label);
    }
    const teamLabel = teams.join("→");
    const sub = [teamLabel || null, s.season === inProgressSeason ? "途中経過" : null].filter(Boolean).join("・");
    const d = pointsDetails(share);
    rows.push({
      key: s.season,
      labelLines: sub ? [s.season, sub] : [s.season],
      pct: share.pct,
      details: d.details,
      tooltipDetails: d.tooltipDetails,
      rightLabel: pointsRightLabel(share.perGame),
      tooltipTitle: `${s.season}${sub ? `（${sub}）` : ""}`,
      tooltipFooter: `${d.footer}（${share.games}試合）`,
    });
    const fga = playerLogsFgaShare(s.logs);
    if (fga.perGame > 0) {
      const fd = fgaDetails(fga);
      fgaRows.push({
        key: s.season,
        labelLines: sub ? [s.season, sub] : [s.season],
        pct: fga.pct,
        details: fd.details,
        tooltipDetails: fd.tooltipDetails,
        rightLabel: fgaRightLabel(fga.perGame),
        tooltipTitle: `${s.season}${sub ? `（${sub}）` : ""}`,
        tooltipFooter: `${fd.footer}（${fga.games}試合）`,
      });
    }
  }
  return (
    <>
      <h4 className="share-trend-title">得点構成</h4>
      <ShareBarChart
        rows={rows}
        categories={SCORING_CATEGORIES}
        wideMinSegment={46}
        labelWidth={{ wide: 112, narrow: 92 }}
        rightWidth={{ wide: 52, narrow: 36 }}
        emptyMessage="レギュラーシーズンの得点がありません"
      />
      <h4 className="share-trend-title">FG試投構成</h4>
      <ShareBarChart
        rows={fgaRows}
        categories={FGA_CATEGORIES}
        wideMinSegment={46}
        labelWidth={{ wide: 112, narrow: 92 }}
        rightWidth={{ wide: 52, narrow: 36 }}
        emptyMessage="レギュラーシーズンのFG試投がありません"
      />
      <GlossaryNote anchor={GLOSSARY_ANCHORS.composition} label="得点構成・FG試投構成" scope="レギュラーシーズン・シーズン合計の値です（上部の試合種別・Q別・平均/合計とは連動しません）。" />
    </>
  );
}
