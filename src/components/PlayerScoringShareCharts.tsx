import { teamShortName } from "../../shared/teamNames";
import type { PlayerGameLog } from "../../shared/types";
import type { GameTeamInfo } from "../lib/situational";
import { surnameOf } from "../lib/playerSurname";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
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

// --- 選手一覧「Scoring %」: 選択したシーズンの選手（1行＝1選手） ---

/** スマホ幅の行の見出しに使う名字。「ケリー・ブラックシアー・ジュニア」のように末尾が「ジュニア」の名前は、その前の要素にする */
function chartSurname(name: string): string {
  const parts = name.split("・");
  if (parts.length > 2 && parts.at(-1) === "ジュニア") return parts.at(-2)!;
  return surnameOf(name);
}

export interface PlayerShareListRow {
  playerId: string;
  name: string;
  teamId: string;
  teamName: string;
  share: PointsShare;
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
      // スマホ幅は名字だけ（見出しの幅に収めるため）
      labelLines: [narrow ? chartSurname(r.name) : r.name, team],
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
      <p className="page-subtitle">
        レギュラーシーズン・シーズン合計の値です（上部の試合種別・Q別・平均/合計とは連動しません）。移籍したシーズンは1本にまとめ、見出しに所属チームを並べています。
        棒の中の数値は割合(%)と1試合平均の得点、右端は1試合平均の得点です。ミッドレンジは「2Pの得点−ペイント内の得点」です
      </p>
    </>
  );
}
