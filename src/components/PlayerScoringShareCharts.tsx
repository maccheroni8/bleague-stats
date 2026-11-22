import { useState } from "react";
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
  playerScoringShare,
  pointsDetails,
  pointsRightLabel,
  SCORING_CATEGORIES,
  type PointsShare,
} from "../lib/shareCharts";
import { comparePointsShares, type PointsShareOrder } from "./ScoringCompositionChart";
import { compareFgaShares, type FgaShareOrder } from "./FgaCompositionChart";
import { ShareBarChart, type ShareBarRow } from "./ShareBarChart";
import { ShareGraphSave } from "./ShareGraphSave";
import { SEASON_TOTAL_ONLY_LABELS } from "../lib/conditionLabels";
import { sumPlayerGameLogs } from "../lib/playerSeasonBoxscore";
import { playerSelfUnavailable, playerShotSource } from "../lib/playerSelfColumns";
import {
  ASSIST_SELF_CATEGORIES,
  assistSelfShare,
  compareAssistSelf,
  SELF_SHOT_KIND_LABELS,
  type AssistSelfOrder,
  type AssistSelfShare,
  type SelfShotKind,
  type ShotMadeSource,
} from "../lib/selfScoring";

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

/**
 * アシストの有無の材料（レギュラーシーズンの出場試合の合計）。全選手スタッツ・個人詳細の表の %PTSAST・%PTSSELF と同じ合計（設計書469章）。
 * 試合の流れの記録が無い試合（2017-18 の1810）で点を取っていると、アシストの数が足りず Self が多く出るので、その選手・シーズンは null（表の SELF 列の「-」と同じ扱い）
 */
export interface PlayerAssistSource {
  source: ShotMadeSource;
  games: number;
}

export function playerLogsAssistSource(logs: PlayerGameLog[]): PlayerAssistSource | null {
  const raw = sumPlayerGameLogs(logs.filter((g) => g.gameType === "regular"));
  if (raw.gamesPlayed <= 0 || playerSelfUnavailable(raw)) return null;
  return { source: playerShotSource(raw), games: raw.gamesPlayed };
}

const assistShareOf = (a: PlayerAssistSource, kind: SelfShotKind): AssistSelfShare => assistSelfShare(a.source, kind, a.games);

/** アシストの有無の1行の中身（チームの AssistSelfChart と同じ書き方） */
function assistRowParts(share: AssistSelfShare, kind: SelfShotKind) {
  const unit = kind === "pts" ? "点" : "本";
  return {
    pct: share.pct,
    details: share.values.map((v) => v.toFixed(2)),
    tooltipDetails: share.values.map((v) => `（${v.toFixed(2)}${unit}）`),
    rightLabel: { wide: `${share.perGame.toFixed(2)}${unit}`, narrow: share.perGame.toFixed(2) },
    footer: `平均: ${share.perGame.toFixed(2)}${unit}`,
  };
}

/** アシストの有無のシュートの種類を選ぶプルダウン（個人詳細。チーム詳細の AssistSelfTrend と同じ作り） */
function AssistKindSelect({ kind, onChange }: { kind: SelfShotKind; onChange: (k: SelfShotKind) => void }) {
  return (
    <>
      <label className="share-trend-kind export-hide">
        {" "}
        <select value={kind} onChange={(e) => onChange(e.target.value as SelfShotKind)} aria-label="アシストの有無のシュート">
          {(Object.keys(SELF_SHOT_KIND_LABELS) as SelfShotKind[]).map((k) => (
            <option key={k} value={k}>
              {SELF_SHOT_KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {/* 保存画像ではプルダウンの代わりに文字で書く */}
      <span className="export-only">（{SELF_SHOT_KIND_LABELS[kind]}）</span>
    </>
  );
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
  /** アシストの有無の材料（出せない選手・シーズンは null） */
  assist: PlayerAssistSource | null;
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
          <div className="export-hide">
            <button className="load-more-button" type="button" onClick={onMore}>
              もっと見る（あと{rest}人）
            </button>
          </div>
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
          <div className="export-hide">
            <button className="load-more-button" type="button" onClick={onMore}>
              もっと見る（あと{rest}人）
            </button>
          </div>
        )
      }
    />
  );
}

/** 選手一覧 Scoring % のアシストの有無（1行＝1選手。シュートの種類は kind。対象の選手は得点構成と同じ。右端は1試合平均の成功数〔得点全体は得点〕） */
export function PlayersAssistSelfChart({
  rows,
  kind,
  order,
  visibleCount,
  onMore,
}: {
  rows: PlayerShareListRow[];
  kind: SelfShotKind;
  order: AssistSelfOrder;
  visibleCount: number;
  onMore: () => void;
}) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const sorted = rows
    .flatMap((r) => {
      const share = r.assist ? assistShareOf(r.assist, kind) : null;
      return share && share.perGame > 0 ? [{ r, share }] : [];
    })
    .sort((a, b) => compareAssistSelf(order, a.share, b.share) || a.r.playerId.localeCompare(b.r.playerId));
  const chartRows: ShareBarRow[] = sorted.slice(0, visibleCount).map(({ r, share }) => {
    const d = assistRowParts(share, kind);
    const team = teamShortName(r.teamId, r.teamName);
    return {
      key: r.playerId,
      labelLines: [narrow ? surnameOf(r.name) : r.name, team],
      pct: d.pct,
      details: d.details,
      tooltipDetails: d.tooltipDetails,
      rightLabel: d.rightLabel,
      tooltipTitle: `${r.name}（${team}）`,
      tooltipFooter: d.footer,
    };
  });
  const rest = sorted.length - visibleCount;
  return (
    <ShareBarChart
      rows={chartRows}
      categories={ASSIST_SELF_CATEGORIES}
      wideMinSegment={46}
      labelWidth={{ wide: 200, narrow: 90 }}
      rightWidth={{ wide: 56, narrow: 36 }}
      emptyMessage="条件に該当する選手がいません"
      footer={
        rest > 0 && (
          <div className="export-hide">
            <button className="load-more-button" type="button" onClick={onMore}>
              もっと見る（あと{rest}人）
            </button>
          </div>
        )
      }
    />
  );
}

// --- 個人詳細: その選手のシーズン別推移（1行＝1シーズン） ---

const PLAYER_SHARE_GRAPHS = [
  { key: "score", name: "得点構成" },
  { key: "fga", name: "FG試投構成" },
  { key: "assist", name: "アシストの有無" },
] as const;

export function PlayerSeasonScoringChart({
  seasons,
  playerName = "",
}: {
  /** 保存画像の見出しに入れる選手名 */
  playerName?: string;
  /** 新しいシーズンが先頭。ownTeamByScheduleKey は試合ごとの所属チーム（シーズン内移籍の見出しに使う） */
  seasons: { season: string; logs: PlayerGameLog[]; ownTeamByScheduleKey?: Map<string, GameTeamInfo> }[];
}) {
  const [assistKind, setAssistKind] = useState<SelfShotKind>("pts");
  const rows: ShareBarRow[] = [];
  const fgaRows: ShareBarRow[] = [];
  const assistRows: ShareBarRow[] = [];
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
    const sub = teamLabel;
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
    const assist = playerLogsAssistSource(s.logs);
    const assistShare = assist ? assistShareOf(assist, assistKind) : null;
    if (assist && assistShare && assistShare.perGame > 0) {
      const ad = assistRowParts(assistShare, assistKind);
      assistRows.push({
        key: s.season,
        labelLines: sub ? [s.season, sub] : [s.season],
        pct: ad.pct,
        details: ad.details,
        tooltipDetails: ad.tooltipDetails,
        rightLabel: ad.rightLabel,
        tooltipTitle: `${s.season}${sub ? `（${sub}）` : ""}`,
        tooltipFooter: `${ad.footer}（${assist.games}試合）`,
      });
    }
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
    <ShareGraphSave
      graphs={PLAYER_SHARE_GRAPHS}
      title={`${playerName} シーズン別 Scoring %`.trim()}
      exportScope="通算"
      conditions={SEASON_TOTAL_ONLY_LABELS}
      baseDate={{ kind: "allTime", gameType: "regular" }}
    >
      {(show) => (
        <>
          {show("score") && (
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
            </>
          )}
          {show("fga") && (
            <>
              <h4 className="share-trend-title">FG試投構成</h4>
              <ShareBarChart
                rows={fgaRows}
                categories={FGA_CATEGORIES}
                wideMinSegment={46}
                labelWidth={{ wide: 112, narrow: 92 }}
                rightWidth={{ wide: 52, narrow: 36 }}
                emptyMessage="レギュラーシーズンのFG試投がありません"
              />
            </>
          )}
          {show("assist") && (
            <>
              <h4 className="share-trend-title">
                アシストの有無
                <AssistKindSelect kind={assistKind} onChange={setAssistKind} />
              </h4>
              <ShareBarChart
                rows={assistRows}
                categories={ASSIST_SELF_CATEGORIES}
                wideMinSegment={46}
                labelWidth={{ wide: 112, narrow: 92 }}
                rightWidth={{ wide: 56, narrow: 36 }}
                emptyMessage="レギュラーシーズンのアシストの記録がありません"
              />
            </>
          )}
          <GlossaryNote anchor={GLOSSARY_ANCHORS.composition} label="得点構成・FG試投構成・アシストの有無" scope="レギュラーシーズン・シーズン合計の値です（上部の試合種別・Q別・平均/合計とは連動しません）。" />
        </>
      )}
    </ShareGraphSave>
  );
}
