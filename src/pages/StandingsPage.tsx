import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "../components/GlossaryNote";
import {
  fetchGameSummaries,
  fetchHeadToHead,
  fetchPlayoffRace,
  fetchSchedule,
  fetchStandingsHistory,
  fetchTeamColors,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useLeague, type League } from "../lib/league";
import { ONE_STANDINGS_TAB_REASONS } from "../lib/leagueAvailability";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import { useTrendPlayback, type TrendPlayback } from "../lib/trendPlayback";
import { SortableTable, type Column } from "../components/SortableTable";
import { StandingsLineChart, fallbackColor, type ChartTeam, type FixedYAxis } from "../components/StandingsLineChart";
import { AnnualSchedule } from "../components/AnnualSchedule";
import { enumParam, useUrlState } from "../lib/urlState";
import { TeamLogo } from "../components/TeamLogo";
import { CrownIcon } from "../components/CrownIcon";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { WinLossGrid, WinLossLegend } from "../components/WinLossGrid";
import { HeadToHeadMatrix } from "../components/HeadToHeadMatrix";
import { FilterBar } from "../components/FilterBar";
import { teamMultiAxis } from "../lib/filterAxes";
import { playoffZonePreset } from "../lib/playoffZone";
import { playoffLineSortValue, playoffLineStatus, playoffLineText, playoffWinLine, type PlayoffWinLine } from "../lib/playoffWinLine";
import { ConditionalStandingsTable } from "../components/ConditionalStandingsTable";
import { SaveColumnChoice, SaveColumnHide } from "../components/SaveColumnChoice";
import { ForeignCountStandings } from "../components/ForeignCountStandings";
import { ConditionLine, ConditionTitle, ExportScopeLine } from "../components/ConditionTitle";
import { ExportImageButton } from "../components/ExportImageButton";
import { ExportTarget } from "../components/ExportTarget";
import { sortOrderLabel } from "../components/SortMark";
import { SavableBlock } from "../components/SavableBlock";
import { TrendVideoSaver, type TrendVideoChart } from "../components/TrendVideoSaver";
import { autoAxis, type TrendVideoTeam } from "../lib/trendVideo";
import { buildExportFilename, clubSelectionLabels, composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { formatDecimal, formatPct, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { pendingUpcomingGames } from "../lib/pendingUpcoming";
import { computeOpponentStrength, computeRemainingOpponentStrength, type OpponentStrength } from "../lib/opponentStrength";
import { resultOnlySummaries, withResultOnlyLogs } from "../lib/resultOnlyGames";
import { ResultOnlyNote } from "../components/ResultOnlyNote";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak, type TeamStreak } from "../../shared/teamRecords";
import { isRegularSeasonComplete } from "../lib/regularSeasonComplete";
import { isPastSeason } from "../lib/season";
import { isOffseasonMonth, seasonStreakSummary, streakResultOnlyNote, type StreakKind, type StreakRun } from "../lib/streakRecords";
import { teamShortName } from "../../shared/teamNames";
import {
  clinchTypesForSeason,
  isInWildcardPool,
  postseasonFormat,
  wildcardOrderRank,
  type PostseasonFormat,
} from "../../shared/postseasonFormat";
import { DIVISION_LABELS, divisionPresets, groupByDivision } from "../lib/divisionGroups";
import { formatGamesBehind, standingsStatCells, withUnplayedTeams, type StandingsTeam } from "../lib/standingsTeams";
import { PageTitleRow } from "../components/HeaderActions";
import { findFebruaryBiweekGap } from "../lib/situational";
import { gamesRange, toGamesAxis } from "../lib/trendGamesAxis";
import type {
  Division,
  HeadToHeadTeamRow,
  PlayoffRaceFile,
  PlayoffRaceTeam,
  StandingsSnapshot,
  StandingsTeamSnapshot,
  TeamColors,
  TeamGameLog,
  UpcomingGameEntry,
} from "../../shared/types";


type StandingsTab =
  | "annual"
  | "standings"
  | "magic"
  | "h2h"
  | "winLoss"
  | "conditional"
  | "foreignCount"
  | "rankTrend"
  | "winsTrend"
  | "winPctTrend"
  | "gamesAboveTrend";

const TAB_LABELS: Record<StandingsTab, string> = {
  standings: "順位表",
  magic: "マジックナンバー",
  h2h: "星取り表",
  winLoss: "勝敗表",
  annual: "年間スケジュール",
  conditional: "条件別順位表",
  foreignCount: "外国籍人数別",
  rankTrend: "順位推移",
  winsTrend: "勝ち星推移",
  winPctTrend: "勝率推移",
  gamesAboveTrend: "貯金推移",
};

interface WinLossRecord {
  wins: number;
  losses: number;
}

/** ホーム/アウェー成績・直近5試合・連勝連敗・試合消化率の元になる、地区別テーブル1行分の付加情報 */

interface StandingsRow extends StandingsTeam {
  homeRecord: WinLossRecord | null;
  awayRecord: WinLossRecord | null;
  /** 直近5試合の時系列順（古い→新しい）のW/L文字列（例: "WWLWW"）。データ未取得ならnull */
  last5: string | null;
  streak: TeamStreak | null;
  /** そのシーズン（レギュラーシーズン）の最長の連勝・連敗。結果だけの試合も数える。試合ログが未取得・試合が無いクラブはnull */
  maxWin: SeasonMaxStreak | null;
  maxLoss: SeasonMaxStreak | null;
  /** 消化済み試合数 / (消化済み+未消化) の割合（0〜1）。schedule.json未取得ならnull */
  completionRate: number | null;
  /** マジックナンバー・進出/敗退・年間優勝（playoff-race.json）。未生成のシーズンはnull */
  race: PlayoffRaceTeam | null;
  /** 対戦相手の強さ（これまでに対戦した相手の今季の勝率の加重平均とリーグ内の順位）。試合の記録が未取得・まだ試合をしていないクラブはnull */
  opponentStrength: OpponentStrength | null;
  /** 残りの相手の強さ（開催予定の試合の相手の最新勝率の平均）。残り試合が無い・日程を読み込む前は null */
  remainingOpponentStrength: OpponentStrength | null;
}

/**
 * schedule.jsonのupcomingGames（未消化試合、大会区分情報なし・チーム名のみ）から、
 * チーム名ごとの残り試合数を数える。オールスター等の除外はできないため多少の誤差を許容する
 * （ユーザー確認済み）
 */
function countUpcomingGamesByTeamName(upcomingGames: UpcomingGameEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const g of upcomingGames) {
    counts.set(g.homeTeamName, (counts.get(g.homeTeamName) ?? 0) + 1);
    counts.set(g.awayTeamName, (counts.get(g.awayTeamName) ?? 0) + 1);
  }
  return counts;
}

/**
 * schedule.jsonのupcomingGames（チーム名のみ）を、headToHead.jsonのteamNameで名寄せして
 * teamId同士の残り対戦試合数マップを組み立てる（星取り表タブの「残り対戦試合数」用）
 */
function buildH2hRemainingGames(
  upcomingGames: UpcomingGameEntry[],
  teamIdByName: Map<string, string>,
): Map<string, Map<string, number>> {
  const result = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => {
    let byOpponent = result.get(a);
    if (!byOpponent) {
      byOpponent = new Map();
      result.set(a, byOpponent);
    }
    byOpponent.set(b, (byOpponent.get(b) ?? 0) + 1);
  };
  for (const g of upcomingGames) {
    const homeId = teamIdByName.get(g.homeTeamName);
    const awayId = teamIdByName.get(g.awayTeamName);
    if (!homeId || !awayId) continue;
    bump(homeId, awayId);
    bump(awayId, homeId);
  }
  return result;
}

function regularSeasonLogs(logs: TeamGameLog[]): TeamGameLog[] {
  return logs.filter((l) => l.gameType === "regular");
}

function sortedByDate(logs: TeamGameLog[]): TeamGameLog[] {
  return [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
}

function recordFrom(logs: TeamGameLog[]): WinLossRecord {
  const wins = logs.filter((l) => l.win).length;
  return { wins, losses: logs.length - wins };
}

/** 時系列順（古い→新しい）のW/L文字列を組み立てる（例: "WWLWW"） */
function recordSequence(logs: TeamGameLog[]): string {
  return logs.map((l) => (l.win ? "W" : "L")).join("");
}

/** ホーム/アウェー成績・直近5試合・連勝連敗は、いずれも順位表本体と同じくレギュラーシーズンのみを対象にする */
/** 最多連勝・最多連敗の列の値。length＝最長の長さ、説明＝マウスを載せたときの説明文（継続中・不戦勝などを含む。無ければnull） */
interface SeasonMaxStreak {
  length: number;
  note: string | null;
}

function maxStreakCell(max: { length: number; runs: StreakRun[] } | null, kind: StreakKind, hasGames: boolean): SeasonMaxStreak | null {
  // 試合はあるのに勝ち（負け）が1つも無ければ 0
  if (!max) return hasGames ? { length: 0, note: null } : null;
  const notes: string[] = [];
  // 同じ長さの回が複数あるときは、一番新しい回（先頭）が続いているかを「継続中」の判定に使い、注釈はどの回のものでも添える
  if (max.runs[0]?.ongoing) notes.push("継続中");
  for (const reason of new Set(max.runs.flatMap((r) => r.resultOnlyReasons))) {
    const note = streakResultOnlyNote({ resultOnlyReasons: [reason] }, kind);
    if (note) notes.push(note);
  }
  return { length: max.length, note: notes.length > 0 ? notes.join("・") : null };
}

function buildStandingsRow(
  season: string,
  seasonRunning: boolean,
  team: StandingsTeam,
  logs: TeamGameLog[] | undefined,
  upcomingCount: number | undefined,
  race: PlayoffRaceTeam | null,
  opponentStrength: OpponentStrength | null,
  remainingOpponentStrength: OpponentStrength | null,
): StandingsRow {
  const gamesPlayed = team.wins + team.losses;
  const completionRate = upcomingCount === undefined ? null : safeDiv(gamesPlayed, gamesPlayed + upcomingCount);
  if (!logs) {
    return { ...team, homeRecord: null, awayRecord: null, last5: null, streak: null, maxWin: null, maxLoss: null, completionRate, race, opponentStrength, remainingOpponentStrength };
  }
  const regular = regularSeasonLogs(logs);
  const streaks = seasonStreakSummary(season, regular, seasonRunning);
  return {
    ...team,
    homeRecord: recordFrom(regular.filter((l) => l.isHome)),
    awayRecord: recordFrom(regular.filter((l) => !l.isHome)),
    last5: recordSequence(sortedByDate(regular).slice(-5)),
    streak: currentStreak(regular),
    maxWin: maxStreakCell(streaks.maxWin, "win", regular.length > 0),
    maxLoss: maxStreakCell(streaks.maxLoss, "loss", regular.length > 0),
    completionRate,
    race,
    opponentStrength,
    remainingOpponentStrength,
  };
}

function formatOptionalRecord(record: WinLossRecord | null): string {
  return record ? formatRecord(record.wins, record.losses) : "-";
}

/**
 * 順位表のチーム名の後ろに付けるマーク（DESIGN.md参照）。王冠=年間優勝、★=地区2位以上確定
 * （準々決勝のホームコートアドバンテージ獲得）、☆=プレーオフ進出確定、ー=敗退確定。★は☆を含むため
 * 両方は付けない
 */
function RaceMarks({ race }: { race: PlayoffRaceTeam | null }) {
  if (!race) return null;
  const mark = race.clinchedDivisionTop2 ? "★" : race.clinchedPlayoffs ? "☆" : race.eliminatedPlayoffs ? "ー" : null;
  if (!mark && !race.champion) return null;
  return (
    <span className="race-marks">
      {race.champion && <CrownIcon />}
      {mark && <span className={`race-mark${mark === "ー" ? " race-mark-out" : ""}`}>{mark}</span>}
    </span>
  );
}

function RaceLegend({ race }: { race: PlayoffRaceFile }) {
  return (
    <p className="race-legend">
      <span className="race-legend-item">
        <CrownIcon /> 年間優勝
      </span>
      {race.format === "premier-2026" && (
        <>
          <span className="race-legend-item">★ 地区2位以上確定（準々決勝ホーム開催）</span>
          <span className="race-legend-item">☆ プレーオフ進出確定</span>
          <span className="race-legend-item">ー 敗退確定</span>
        </>
      )}
    </p>
  );
}

/** マジックナンバーの表示: 0=確定、null=可能性消滅 */
function formatMagic(m: number | null | undefined): string {
  if (m === undefined) return "-";
  if (m === null) return "消滅";
  return m === 0 ? "確定" : String(m);
}

interface MagicRow {
  teamId: string;
  teamName: string;
  /** まだ試合をしていないクラブは順位表スナップショットに無いためnull */
  divisionRank: number | null;
  wins: number;
  losses: number;
  race: PlayoffRaceTeam;
}

const magicColumns: Column<MagicRow>[] = [
  {
    key: "divisionRank",
    label: "地区順位",
    // 未試合のクラブ（順位なし）は末尾に並べる
    sortValue: (r) => r.divisionRank ?? 99,
    format: (r) => (r.divisionRank === null ? "-" : String(r.divisionRank)),
  },
  {
    key: "teamName",
    label: "チーム",
    align: "left",
    sortValue: (r) => r.teamName,
    render: (r) => (
      <span className="team-name-cell">
        <TeamLogo teamId={r.teamId} size={20} />
        <ResponsiveTeamName teamId={r.teamId} name={r.teamName} />
        <RaceMarks race={r.race} />
      </span>
    ),
  },
  { key: "record", label: "勝敗", sortValue: (r) => r.wins - r.losses, render: (r) => formatRecord(r.wins, r.losses) },
  { key: "remaining", label: "残り", sortValue: (r) => r.race.remaining, format: (r) => String(r.race.remaining) },
  {
    key: "magicDivisionFirst",
    label: "地区1位",
    sortValue: (r) => r.race.magicDivisionFirst ?? 999,
    format: (r) => formatMagic(r.race.magicDivisionFirst),
  },
  {
    key: "magicDivisionTop3",
    label: "地区3位以内",
    sortValue: (r) => r.race.magicDivisionTop3 ?? 999,
    format: (r) => formatMagic(r.race.magicDivisionTop3),
  },
  {
    key: "playoffs",
    label: "プレーオフ",
    sortValue: (r) => (r.race.clinchedPlayoffs ? 0 : r.race.eliminatedPlayoffs ? 2 : 1),
    format: (r) => (r.race.clinchedPlayoffs ? "進出確定" : r.race.eliminatedPlayoffs ? "敗退" : "-"),
  },
];

const divisionStandingsColumns: Column<StandingsRow>[] = [
  {
    key: "divisionRank",
    label: "地区順位",
    sortValue: (t) => t.divisionRank ?? 0,
    format: (t) => (t.unplayed ? "-" : String(t.divisionRank ?? "-")),
  },
  { key: "rank", label: "全体順位", sortValue: (t) => t.rank, format: (t) => (t.unplayed ? "-" : String(t.rank)) },
  {
    key: "teamName",
    label: "チーム",
    align: "left",
    sortValue: (t) => t.teamName,
    render: (t) => (
      <span className="team-name-cell">
        <TeamLogo teamId={t.teamId} size={20} />
        <ResponsiveTeamName teamId={t.teamId} name={t.teamName} />
        <RaceMarks race={t.race} />
      </span>
    ),
  },
  {
    key: "games",
    label: "試合数",
    // 勝敗の列と同じ数え方（結果だけの試合を含む勝＋敗）
    sortValue: (t) => t.wins + t.losses,
    format: (t) => String(t.wins + t.losses),
  },
  {
    key: "record",
    label: "勝敗",
    sortValue: (t) => t.wins - t.losses,
    render: (t) => formatRecord(t.wins, t.losses),
  },
  {
    key: "winPct",
    label: "勝率",
    sortValue: (t) => (t.unplayed ? -1 : t.winPct),
    format: (t) => (t.unplayed ? "-" : formatWinPct(t.winPct)),
  },
  {
    key: "divisionGamesBehind",
    label: "ゲーム差",
    sortValue: (t) => t.divisionGamesBehind ?? 0,
    // 首位（差0）は「-」。未試合のクラブは首位と同じ勝ち負け差でも「0.0」と数値で示す
    format: (t) => formatGamesBehind(t),
  },
  {
    key: "pointDiff",
    label: "得失点差",
    sortValue: (t) => t.pointDiff,
    format: (t) => (t.unplayed ? "-" : formatSigned(t.pointDiff, 0)),
  },
  {
    key: "homeRecord",
    label: "ホーム",
    sortValue: (t) => (t.homeRecord ? t.homeRecord.wins - t.homeRecord.losses : 0),
    format: (t) => formatOptionalRecord(t.homeRecord),
  },
  {
    key: "awayRecord",
    label: "アウェー",
    sortValue: (t) => (t.awayRecord ? t.awayRecord.wins - t.awayRecord.losses : 0),
    format: (t) => formatOptionalRecord(t.awayRecord),
  },
  {
    key: "last5",
    label: "直近5試合",
    sortValue: (t) => (t.last5 ? [...t.last5].filter((c) => c === "W").length : 0),
    format: (t) => t.last5 ?? "-",
  },
  {
    key: "streak",
    label: "連勝/連敗",
    sortValue: (t) => (t.streak ? (t.streak.type === "win" ? t.streak.count : -t.streak.count) : 0),
    format: (t) => formatTeamStreak(t.streak),
  },
  {
    key: "maxWin",
    label: "最多連勝",
    sortValue: (t) => t.maxWin?.length ?? 0,
    render: (t) => (t.maxWin ? <span title={t.maxWin.note ?? undefined}>{t.maxWin.length}</span> : "-"),
  },
  {
    key: "maxLoss",
    label: "最多連敗",
    sortValue: (t) => t.maxLoss?.length ?? 0,
    render: (t) => (t.maxLoss ? <span title={t.maxLoss.note ?? undefined}>{t.maxLoss.length}</span> : "-"),
  },
  {
    key: "completionRate",
    label: "試合消化率",
    sortValue: (t) => t.completionRate ?? 0,
    format: (t) => (t.completionRate === null ? "-" : formatPct(t.completionRate)),
  },
  {
    key: "opponentStrength",
    label: "対戦相手の強さ",
    // 値のないクラブ（まだ試合をしていない）は、どちらの向きに並べても末尾に来るよう、並べ替えは値の無い扱いにする
    sortValue: (t) => t.opponentStrength?.value ?? -1,
    render: (t) =>
      t.opponentStrength ? (
        <>
          {formatWinPct(t.opponentStrength.value)}
          <span className="opponent-strength-rank">{t.opponentStrength.rank}位</span>
        </>
      ) : (
        "-"
      ),
  },
  {
    key: "remainingOpponentStrength",
    label: "残り相手勝率",
    // 残り試合が無いクラブは「-」。どちらの向きに並べても末尾に来るよう、値の無い扱いにする
    sortValue: (t) => t.remainingOpponentStrength?.value ?? Number.NaN,
    format: (t) => (t.remainingOpponentStrength ? formatWinPct(t.remainingOpponentStrength.value) : "-"),
  },
];

/** 列の見出し（「36勝（仮想PO進出ライン）まで」） */
function playoffLineLabel(line: PlayoffWinLine): string {
  return `${line.wins}勝（仮想PO進出ライン）まで`;
}

/** プレーオフ進出ラインまでの見通しの列（ラインを設定したシーズン・リーグだけ。右端の「対戦相手の強さ」の右に足す） */
function withPlayoffLineColumn(columns: Column<StandingsRow>[], line: PlayoffWinLine | null): Column<StandingsRow>[] {
  if (!line) return columns;
  const col: Column<StandingsRow> = {
    key: "playoffLine",
    label: playoffLineLabel(line),
    sortValue: (t) => playoffLineSortValue(playoffLineStatus(t.wins, t.losses, line)),
    // スマホ幅では「あと25勝」と「（残り21敗まで可）」を2行にする（1行だと列が広すぎて、固定の列の下に隠れて全体が見えない）
    render: (t) => {
      const st = playoffLineStatus(t.wins, t.losses, line);
      if (st.kind !== "open") return playoffLineText(st);
      return (
        <span className="win-line-cell">
          <span>あと{st.needWins}勝</span>
          <span>（残り{st.maxLosses}敗まで可）</span>
        </span>
      );
    },
    higherIsBetter: false,
  };
  const i = columns.findIndex((c) => c.key === "opponentStrength");
  return i < 0 ? [...columns, col] : [...columns.slice(0, i + 1), col, ...columns.slice(i + 1)];
}

// 地区データが無いシーズン用のフォールバック列（「地区順位」列を除いたもの）
const overallStandingsColumns: Column<StandingsRow>[] = divisionStandingsColumns.filter(
  (c) => c.key !== "divisionRank",
);

// ワイルドカード順位表用の列。全体順位の代わりに、プール内の順位（ワイルドカード順位）を出す
const wildcardStandingsColumns: Column<StandingsRow>[] = divisionStandingsColumns.map((c) =>
  c.key === "rank"
    ? {
        key: "wildcardRank",
        label: "WC順位",
        sortValue: (t: StandingsRow) => t.wildcardRank ?? t.rank,
        format: (t: StandingsRow) => String(t.wildcardRank ?? "-"),
      }
    : c,
);

// 「全チームの全体順位表」用の列。地区順位が地区を跨いだ一覧の中でも区別できるよう、
// 地区名の頭文字を併記する（例:「東1」「中5」）
const allStandingsColumns: Column<StandingsRow>[] = divisionStandingsColumns.map((c) =>
  c.key === "divisionRank"
    ? {
        ...c,
        format: (t: StandingsRow) =>
          t.unplayed
            ? "-"
            : t.division && t.divisionRank
              ? `${DIVISION_LABELS[t.division][0]}${t.divisionRank}`
              : String(t.divisionRank ?? "-"),
      }
    : c,
);

/**
 * historyを日付ごとの{date, teamId: 値}行に変換する。
 * アニメーション再生中も全期間分をそのまま渡す（軸は固定。進み具合の分だけ見せるのは
 * グラフの側の再生用の層。設計書378章）
 */
function reshape(
  history: StandingsSnapshot[],
  metric: (t: StandingsTeamSnapshot) => number,
) {
  return history.map((snapshot) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    for (const t of snapshot.teams) row[t.teamId] = metric(t);
    return row;
  });
}

/**
 * このシーズンのワイルドカード表示（順位表・推移グラフ）の対象か。ポストシーズンの出場形式
 * （shared/postseasonFormat.ts）があり、地区データがあるシーズンだけ対象にする（CS中止の2019-20は対象外）
 */
function wildcardFormat(season: string, teams: StandingsTeamSnapshot[], league: League): PostseasonFormat | null {
  const format = postseasonFormat(season, league);
  return format && teams.some((t) => t.division) ? format : null;
}

/** 表示範囲内（historyは既に2月のバイウィーク以降に絞り込み済み）のどこかの日付で、
 * 一度でもワイルドカード争いの対象（地区の自動出場圏外。2026-27なら地区4位以下）だったチームを全て集める
 * （＝そのチームのLineを描画するかどうかの判定に使う。動的な出入りを反映するため、
 * シーズン最終順位ではなく表示範囲内での実際の在籍状況を基準にする） */
function collectWildcardTeams(history: StandingsSnapshot[], format: PostseasonFormat): ChartTeam[] {
  const byId = new Map<string, string>();
  for (const snapshot of history) {
    for (const t of snapshot.teams) {
      if (isInWildcardPool(t, format)) byId.set(t.teamId, t.teamName);
    }
  }
  return [...byId].map(([teamId, teamName]) => ({ teamId, teamName }));
}

/**
 * ワイルドカード争いの「相対順位」推移を求める。日付ごとに、その時点で実際に地区の自動出場圏外
 * だったチームだけを、プール内の順位（wildcardRank。古いデータは全体順位rank）の昇順に並べ、その順位（1始まり）を割り当てる。
 * 自動出場圏内に浮上した日はその日の値を持たない（=StandingsLineChartのconnectGaps={false}と
 * 組み合わせて、グラフ上でその期間だけ線が途切れる。静的な最終順位ベースの固定メンバーでは
 * なく、日々の実際の在籍状況を動的に反映する）
 */
function reshapeWildcardRank(history: StandingsSnapshot[], format: PostseasonFormat) {
  return history.map((snapshot) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    const poolTeamsAtDate = snapshot.teams
      .filter((t) => isInWildcardPool(t, format))
      .sort((a, b) => wildcardOrderRank(a) - wildcardOrderRank(b));
    poolTeamsAtDate.forEach((t, idx) => {
      row[t.teamId] = idx + 1;
    });
    return row;
  });
}

/** 勝ち星推移・貯金推移のワイルドカードグラフ用。reshape()と同じだが、各日付時点で実際に
 * 地区の自動出場圏外だったチームの値のみを設定する（圏内だった日は値を持たせず、
 * reshapeWildcardRankと同様に線を途切れさせる） */
function reshapeWildcardMetric(
  history: StandingsSnapshot[],
  format: PostseasonFormat,
  metric: (t: StandingsTeamSnapshot) => number,
) {
  return history.map((snapshot) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    for (const t of snapshot.teams) {
      if (isInWildcardPool(t, format)) row[t.teamId] = metric(t);
    }
    return row;
  });
}

/** 勝率推移の縦軸: .000〜1.000 で固定。5割（.500）に目立ちすぎない基準線を引く（設計書388章） */
const WIN_PCT_Y_AXIS: FixedYAxis = {
  domain: [0, 1],
  ticks: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1],
  format: (v) => formatWinPct(v),
  referenceLine: 0.5,
  width: 40,
};

/** 「保存する範囲」の選択（全地区まとめて／地区ごと／ワイルドカード）。保存画像だけが変わり、画面の表示は変わらない */
function SaveRangeChoice({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <span className="export-option-group" role="group" aria-label="保存する範囲">
      <span className="export-option-label">保存する範囲</span>
      {options.map((o) => (
        <button key={o.value} type="button" className={value === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

/** 選んだ範囲以外のグラフ・表を保存画像から外すためのクラス（画面では何も変わらない） */
function hideUnless(selected: string, key: string): string | undefined {
  return selected !== "all" && selected !== key ? "export-hide" : undefined;
}

/**
 * 推移タブ（順位・勝ち星・勝率・貯金）の画像保存の枠。グラフを全部（地区別とワイルドカード）まとめて1枚にする。
 * 再生中は保存できない（再生が終わると全期間の最後の形で保存する。再生中の途中の形は保存しない）
 */
function TrendSaveFrame({
  name,
  season,
  seasonLabel,
  isAnimating,
  rangeOptions,
  range,
  onRangeChange,
  videoCharts,
  videoDisabledReason,
  children,
}: {
  name: string;
  season: string;
  seasonLabel: string;
  isAnimating: boolean;
  videoCharts: TrendVideoChart[];
  /** 動画にできない理由（横軸が試合数のとき）。指定時は再生中と同じく動画を作れない */
  videoDisabledReason?: string;
  rangeOptions: { value: string; label: string }[];
  range: string;
  onRangeChange: (v: string) => void;
  children: ReactNode;
}) {
  const rangeLabel = rangeOptions.find((o) => o.value === range && o.value !== "all")?.label;
  return (
    <SavableBlock
      extraControls={rangeOptions.length > 1 ? <SaveRangeChoice value={range} onChange={onRangeChange} options={rangeOptions} /> : undefined}
      filename={buildExportFilename([seasonLabel, ...(rangeLabel ? [rangeLabel] : []), name, "レギュラーシーズン"])}
      baseDate={{ kind: "season", season, gameType: "regular" }}
      className="export-target-trend"
      unavailableReason={isAnimating ? "アニメーションの再生が終わると画像として保存できます（保存されるのは全期間の最後の形です）" : undefined}
      extraButtons={
        <TrendVideoSaver
          tabName={name}
          season={season}
          seasonLabel={seasonLabel}
          charts={videoCharts}
          disabledReason={isAnimating ? "アニメーションの再生が終わると作れます" : videoDisabledReason}
        />
      }
    >
      <ExportScopeLine scope={seasonLabel} />
      {children}
    </SavableBlock>
  );
}

/** 順位表の画像保存で選べる列（チームは常に載せる）。ワイルドカード順位表の「WC順位」は「全体順位」の選択に従う */
const SAVE_COLUMN_CHOICES: { key: string; label: string }[] = [
  ...divisionStandingsColumns.filter((c) => c.key !== "teamName").map((c) => ({ key: c.key, label: c.label })),
];

/** 載せる列の選択肢。「36勝まで」は表と同じく「対戦相手の強さ」の右（「残り相手勝率」の左）に並べる */
function saveColumnChoices(line: PlayoffWinLine | null): { key: string; label: string }[] {
  if (!line) return SAVE_COLUMN_CHOICES;
  const col = { key: "playoffLine", label: playoffLineLabel(line) };
  const i = SAVE_COLUMN_CHOICES.findIndex((c) => c.key === "opponentStrength");
  return i < 0 ? [...SAVE_COLUMN_CHOICES, col] : [...SAVE_COLUMN_CHOICES.slice(0, i + 1), col, ...SAVE_COLUMN_CHOICES.slice(i + 1)];
}

/** ワイルドカード順位表の「WC順位」は、「全体順位」の選択に従う */
const SAVE_COLUMN_ALIAS = { rank: ["wildcardRank"] };

type TrendTabProps = {
  season: string;
  seasonLabel: string;
  /** タブの名前（グラフのタイトルの元。「東地区勝ち星推移」のように地区名・ワイルドカードを前に付ける） */
  name: string;
  data: Record<string, number | string>[];
  wildcardData: Record<string, number | string>[];
  fixedYAxis?: FixedYAxis;
  isAnimating: boolean;
  onPlay: () => void;
  rangeOptions: { value: string; label: string }[];
  range: string;
  onRangeChange: (v: string) => void;
  /** 動画にできるグラフ（全体・地区別・ワイルドカード） */
  videoCharts: TrendVideoChart[];
  divisionGroups: { division: Division; teams: StandingsTeamSnapshot[] }[];
  teams: StandingsTeamSnapshot[];
  teamColors?: Record<string, TeamColors>;
  playback?: TrendPlayback;
  conditionsAt: (playbackIndex?: number) => string[];
  conditions: string[];
  wildcardTeams: ChartTeam[];
  wildcardPlaybackOffset: number;
  wildcardConditionsAt: (playbackIndex?: number) => string[];
  wildcardConditions: string[];
  /** グラフの元になる日ごとの記録（横軸を試合数にするときの組み替えに使う） */
  history: StandingsSnapshot[];
  wildcardHistory: StandingsSnapshot[];
  /** 横軸（日付／試合数） */
  xAxis: "date" | "games";
  onXAxisChange: (v: "date" | "games") => void;
  /** 貯金推移: 0の線を実線にする */
  zeroLine?: boolean;
};

/**
 * 勝ち星推移・勝率推移・貯金推移の中身。再生ボタン・地区別のグラフ・ワイルドカードのグラフの構成は3つで共通で、
 * 違うのはデータと（勝率だけ）縦軸の固定
 */
/** 試合数の横軸の行の、最初の試合数 */
function firstGames(rows: Record<string, number | string>[]): number {
  const v = rows[0]?.date;
  return typeof v === "number" ? v : 0;
}

function MetricTrendTab(props: TrendTabProps) {
  const { name, fixedYAxis } = props;
  const games = props.xAxis === "games";
  // 横軸が試合数のときは、日ごとの行をチームごとの試合数の行に組み替える。再生の時計は「試合数−最小の試合数」の番号で進む
  const gamesBase = gamesRange(props.history).lo;
  const data = useMemo(() => (games ? toGamesAxis(props.history, props.data) : props.data), [games, props.history, props.data]);
  const wildcardData = useMemo(
    () => (games ? toGamesAxis(props.wildcardHistory, props.wildcardData) : props.wildcardData),
    [games, props.wildcardHistory, props.wildcardData],
  );
  const common = {
    teamColors: props.teamColors,
    playback: props.playback,
    fixedYAxis,
    zeroLine: props.zeroLine,
    xAxisKind: props.xAxis,
  };
  return (
    <div>
      <div className="mode-toggle">
        <button type="button" className={props.isAnimating ? "active" : ""} onClick={props.onPlay} disabled={props.isAnimating}>
          {props.isAnimating ? "再生中..." : "▶ アニメーション再生"}
        </button>
        <span className="export-option-group" role="group" aria-label="横軸">
          <span className="export-option-label">横軸</span>
          <button type="button" className={!games ? "active" : ""} onClick={() => props.onXAxisChange("date")} disabled={props.isAnimating}>
            日付
          </button>
          <button type="button" className={games ? "active" : ""} onClick={() => props.onXAxisChange("games")} disabled={props.isAnimating}>
            試合数
          </button>
        </span>
      </div>
      <TrendSaveFrame videoCharts={props.videoCharts} name={name} season={props.season} seasonLabel={props.seasonLabel} isAnimating={props.isAnimating} rangeOptions={props.rangeOptions} range={props.range} onRangeChange={props.onRangeChange}>
      {props.divisionGroups.length === 0 ? (
        <StandingsLineChart
          title={name}
          data={data}
          teams={props.teams}
          height={560}
          playingConditions={games ? undefined : props.conditionsAt}
          playbackOffset={games ? firstGames(data) - gamesBase : 0}
          conditions={props.conditions}
          {...common}
        />
      ) : (
        <div className="standings-stack">
          {props.divisionGroups.map((g) => (
            <div key={g.division} className={hideUnless(props.range, g.division)}>
              <StandingsLineChart
                title={`${DIVISION_LABELS[g.division]}${name}`}
                data={data}
                teams={g.teams}
                height={520}
                playingConditions={games ? undefined : props.conditionsAt}
                playbackOffset={games ? firstGames(data) - gamesBase : 0}
                conditions={props.conditions}
                {...common}
              />
            </div>
          ))}
          {props.wildcardTeams.length > 0 && (
            <div className={hideUnless(props.range, "wildcard")}>
            <StandingsLineChart
              title={`ワイルドカード${name}`}
              data={wildcardData}
              teams={props.wildcardTeams}
              height={520}
              playingConditions={games ? undefined : props.wildcardConditionsAt}
              connectGaps={false}
              conditions={props.wildcardConditions}
              {...common}
              playbackOffset={games ? firstGames(wildcardData) - gamesBase : props.wildcardPlaybackOffset}
            />
            </div>
          )}
        </div>
      )}
      </TrendSaveFrame>
    </div>
  );
}

export function StandingsPage({ season }: { season: string }) {
  const league = useLeague();
  const [urlTab, setTab] = useUrlState(enumParam("tab", Object.keys(TAB_LABELS) as StandingsTab[], "standings"), "standings");
  // B.ONE で見られないタブが URL にあるときは順位表タブにする（タブのボタンには理由を出す）
  const tab: StandingsTab = league === "one" && ONE_STANDINGS_TAB_REASONS[urlTab] ? "standings" : urlTab;
  // 勝ち星・勝率・貯金の推移グラフの横軸（日付／試合数）
  const [trendXAxis, setTrendXAxis] = useUrlState(enumParam("xa", ["date", "games"] as const, "date"), "date");
  const { data: history, loading, error } = useJsonData(() => fetchStandingsHistory(season, league), [season, league]);
  const {
    data: headToHead,
    loading: h2hLoading,
    error: h2hError,
  } = useJsonData(() => fetchHeadToHead(season, league), [season, league]);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const { data: schedule } = useJsonData(() => fetchSchedule(season, league), [season, league]);
  // ワイルドカードグラフの表示開始基準（2月のバイウィーク明け）算出用
  const { data: gameSummaries } = useJsonData(() => fetchGameSummaries(season, league), [season, league]);
  const { data: playoffRace } = useJsonData(() => fetchPlayoffRace(season, league), [season, league]);

  // null = 全チーム選択（絞り込みなし）。個別に外したチームだけをSetで管理する（SchedulePageと同じパターン）
  const [h2hSelectedTeamIds, setH2hSelectedTeamIds] = useState<Set<string> | null>(null);

  // 「順位表」タブの「全チームの全体順位表」（地区を跨いだ順位表）。デフォルト非表示
  const [overallStandingsExpanded, setOverallStandingsExpanded] = useState(false);

  // シーズンが変わったらチームフィルタの選択状態をリセットする（前シーズンのチーム構成は引き継がない）
  useEffect(() => {
    setH2hSelectedTeamIds(null);
    setSaveWhich("divisions");
    setSaveDiv("all");
  }, [season, league]);

  // 順位推移・勝ち星推移・貯金推移タブの「アニメーション再生」。進み具合は1つの値で、グラフが毎フレーム
  // その値からラインの先端とロゴの位置を出す（src/lib/trendPlayback.ts。設計書378章）
  const {
    isAnimating,
    play: playAnimation,
    playback: trendPlayback,
  } = useTrendPlayback(
    history ? (trendXAxis === "games" ? gamesRange(history).hi - gamesRange(history).lo + 1 : history.length) : 0,
    `${league}:${season}:${trendXAxis}`,
  );
  const playback = isAnimating ? trendPlayback : undefined;

  // 星取り表以外のタブ（勝敗表・推移4種）の「保存する範囲」: all＝全地区まとめて、地区の値、wildcard（推移のみ）
  const [saveDiv, setSaveDiv] = useState<string>("all");
  // タブを切り替えたら保存する範囲は「全地区まとめて」に戻す（前のタブの選択が残って何も保存されなくならないように）
  useEffect(() => {
    setSaveDiv("all");
  }, [tab]);
  // 順位表タブの画像保存: 保存する表（地区順位〔全地区まとめて1枚〕・ワイルドカード順位表・全体順位表）を選ぶ。
  // 選んだ表を包む保存範囲の要素を、選択に応じてボタンへ渡す（DESIGN.md 393章）
  const [saveWhich, setSaveWhich] = useState<string>("divisions");
  // 順位表の画像保存で載せない列（キーの一覧。空なら全部の列）
  const [saveHiddenCols, setSaveHiddenCols] = useState<string[]>([]);
  const saveWhichRef = useRef(saveWhich);
  saveWhichRef.current = saveWhich;
  const saveTargets = useRef<Record<string, HTMLDivElement | null>>({});
  const saveTargetRef = useMemo(
    () => ({ get current() { const w = saveWhichRef.current; return saveTargets.current[w.startsWith("div:") ? "divisions" : w] ?? null; } }) as unknown as RefObject<HTMLElement | null>,
    [],
  );
  // 表ごとの今の並び（保存画像のサブタイトルに並び順（「地区順位▲」。381章の sortOrderLabel）を出す）
  const [sorts, setSorts] = useState<Record<string, string>>({});
  const sortProps = (key: string) => ({
    onSortChange: (s: { label: string; dir: "asc" | "desc" }) => {
      const text = sortOrderLabel(s.label, s.dir === "desc");
      setSorts((prev) => (prev[key] === text ? prev : { ...prev, [key]: text }));
    },
  });
  // 推移タブの保存（4つのタブ共通）: 全部のグラフを1枚にまとめる

  const latest = history && history.length > 0 ? history[history.length - 1]! : null;
  const { gameLogsByTeam: statLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, latest?.teams ?? null, league);
  // 結果だけの試合（ボックススコアが公式に無い試合・不戦勝）は、ホーム/アウェー・直近5試合・連勝連敗・条件別順位表・勝敗表にだけ足す
  // （スタッツの画面には渡さない。DESIGN.md 228章）
  const resultOnlyEntries = schedule?.resultOnlyGames;
  const gameLogsByTeam = useMemo(() => withResultOnlyLogs(statLogsByTeam, resultOnlyEntries), [statLogsByTeam, resultOnlyEntries]);
  const resultOnlyGameRows = useMemo(
    () => resultOnlySummaries(resultOnlyEntries, gameSummaries),
    [resultOnlyEntries, gameSummaries],
  );
  const gamesForGrid = useMemo(
    () => (gameSummaries ? [...gameSummaries, ...resultOnlyGameRows] : gameSummaries),
    [gameSummaries, resultOnlyGameRows],
  );

  // タブの並び。B.ONE で見られないタブは、押せない状態にして理由を添える
  const tabBar = (magicShown: boolean) => (
    <>
      <div className="tab-bar">
        {(Object.keys(TAB_LABELS) as StandingsTab[])
          .filter((t) => t !== "magic" || magicShown || league === "one")
          .map((t) => {
            const reason = league === "one" ? ONE_STANDINGS_TAB_REASONS[t] : undefined;
            return (
              <button
                key={t}
                className={`tab-button${tab === t ? " active" : ""}`}
                onClick={() => setTab(t)}
                type="button"
                disabled={!!reason}
                title={reason}
              >
                {TAB_LABELS[t]}
              </button>
            );
          })}
      </div>
      {league === "one" && ONE_STANDINGS_TAB_REASONS[urlTab] && <p className="standings-tab-note">{ONE_STANDINGS_TAB_REASONS[urlTab]}</p>}
    </>
  );
  // 読み込み中・エラー時もv2の範囲に入れ、ヘッダー・ナビの見た目が切り替わらないようにする
  const v2 = (node: ReactNode) => (
    <div data-design="v2" className="standings-page">
      {node}
    </div>
  );
  if (tab === "annual" && (loading || error || !latest)) return v2(<>
    <PageTitleRow>順位表</PageTitleRow>
    {tabBar(false)}
    <AnnualSchedule key={season} season={season} league={league} />
  </>);
  if (loading) return v2(<p className="loading">読み込み中...</p>);
  if (error) return v2(<p className="error-message">{error}</p>);
  if (!history || history.length === 0 || !latest) return v2(<p className="empty-message">データがありません</p>);

  const teams = latest.teams;
  const playoffZone = playoffZonePreset(season, league, teams);
  const winLine = playoffWinLine(season, league);
  // schedule.upcomingGamesは古いschedule.jsonスナップショット（スクレイパーにこのフィールドを
  // 追加する前に取得されたもの）には存在しないことがあるため、undefinedの可能性を必ず考慮する
  // 試合の記録（games-summary）がある試合は開催予定から除く（外れないまま残っていても、残り試合に数えない）
  const pendingUpcoming = pendingUpcomingGames(schedule?.upcomingGames, gameSummaries);
  const upcomingCountByTeamName = schedule ? countUpcomingGamesByTeamName(pendingUpcoming) : null;
  const raceById = new Map((playoffRace?.teams ?? []).map((r) => [r.teamId, r]));
  const standingsTeams = withUnplayedTeams(teams, playoffRace ?? null);
  // 対戦相手の強さ。結果だけの試合も含めた全試合（星取り・勝敗表と同じ gamesForGrid）で数える。試合の記録を読み込むまでは出さない
  const opponentStrengthById = gamesForGrid ? computeOpponentStrength(teams, gamesForGrid) : null;
  // 残りの相手の強さ。まだ試合の記録が無い開催予定（中止・延期で日程が決まっていない試合は載らない）の相手の最新勝率の平均。
  // 結果だけの試合（不戦勝など）はすでに戦った試合なので数えない。日程を読み込むまでは出さない
  const remainingOpponentStrengthById = schedule
    ? computeRemainingOpponentStrength(
        teams,
        pendingUpcoming,
        new Map(standingsTeams.map((t) => [t.teamName, t.teamId])),
        new Set((schedule.resultOnlyGames ?? []).map((g) => g.scheduleKey)),
      )
    : null;
  // 最多連勝・最多連敗の「継続中」の判定: そのシーズンがまだ終わっていない（今のシーズンで、7・8月のオフではなく、レギュラーシーズンの全試合が終わっていない）
  const seasonRunning =
    !isOffseasonMonth() && !isPastSeason(season) && !(schedule && gameSummaries && isRegularSeasonComplete({ schedule, summaries: gameSummaries }));
  const rowFor = (t: StandingsTeam) =>
    buildStandingsRow(
      season,
      seasonRunning,
      t,
      gameLogsByTeam?.get(t.teamId),
      upcomingCountByTeamName ? (upcomingCountByTeamName.get(t.teamName) ?? 0) : undefined,
      raceById.get(t.teamId) ?? null,
      opponentStrengthById?.get(t.teamId) ?? null,
      remainingOpponentStrengthById?.get(t.teamId) ?? null,
    );
  // マジックナンバー表（2026-27〜のB.PREMIERフォーマットのみ。判定を出せない場合は理由を表示）
  // 順位表スナップショットには試合をしたクラブしか載らないため、playoff-race.json側の全クラブを並べる
  const standingById = new Map(teams.map((t) => [t.teamId, t]));
  const magicGroups =
    playoffRace?.format === "premier-2026" && !playoffRace.unavailableReason
      ? (["east", "west"] as const).map((division) => ({
          division,
          rows: playoffRace.teams
            .filter((r) => r.division === division)
            .map((r) => ({
              teamId: r.teamId,
              teamName: standingById.get(r.teamId)?.teamName ?? r.teamName ?? r.teamId,
              divisionRank: standingById.get(r.teamId)?.divisionRank ?? null,
              wins: r.wins,
              losses: r.losses,
              race: r,
            }))
            // 順位表と同じ並び: 試合をしたクラブは地区順位順、未試合のクラブはその後ろに五十音順
            .sort((a, b) =>
              a.divisionRank !== null && b.divisionRank !== null
                ? a.divisionRank - b.divisionRank
                : a.divisionRank !== null
                  ? -1
                  : b.divisionRank !== null
                    ? 1
                    : a.teamName.localeCompare(b.teamName, "ja"),
            ),
        }))
      : [];
  // マジックナンバーのタブは2026-27〜のB.PREMIERフォーマットのシーズンだけ出す。選択中のままシーズンを
  // 切り替えて対象外になった場合は順位表タブを表示する
  const magicAvailable = playoffRace?.format === "premier-2026";
  const activeTab: StandingsTab = tab === "magic" && !magicAvailable ? "standings" : tab;
  // 開幕直後（全クラブの平均消化試合数が10試合未満）は、数字の意味が薄いことを短く添える
  const magicEarly =
    magicAvailable &&
    playoffRace.teams.reduce((sum, r) => sum + r.wins + r.losses, 0) / Math.max(1, playoffRace.teams.length) < 10;
  const divisionStandingsGroups = groupByDivision(standingsTeams, league).map((g) => ({
    division: g.division,
    rows: g.teams.map(rowFor),
  }));
  // 地区を跨いだ全チーム一覧（地区データが無いシーズンのフォールバック表示、および
  // 「全チームの全体順位表」セクションの両方で使う）
  const divisionByTeamId = new Map(standingsTeams.map((t) => [t.teamId, t.division]));
  const allStandingsRows = [...standingsTeams].sort((a, b) => a.rank - b.rank).map(rowFor);

  const h2hTeamIdByName = headToHead ? new Map(headToHead.map((r) => [r.teamName, r.teamId])) : null;
  const h2hRemainingGames =
    headToHead && schedule && h2hTeamIdByName
      ? buildH2hRemainingGames(pendingUpcoming, h2hTeamIdByName)
      : undefined;
  const h2hTeamOptions: { teamId: string; teamName: string }[] = headToHead
    ? [...headToHead]
        .map((r: HeadToHeadTeamRow) => ({ teamId: r.teamId, teamName: r.teamName }))
        .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja"))
    : [];
  const filteredHeadToHead =
    headToHead && h2hSelectedTeamIds ? headToHead.filter((r) => h2hSelectedTeamIds.has(r.teamId)) : headToHead;
  // グラフには再生中も全期間分を渡す（軸を固定したまま、グラフの側で進み具合の分だけ見せる。設計書378章）
  const rankData = reshape(history, (t) => t.rank);
  const winsData = reshape(history, (t) => t.wins);
  const gamesAboveData = reshape(history, (t) => t.wins - t.losses);
  // 勝率は順位表と同じ値（スナップショットの winPct＝勝÷(勝＋敗)。結果だけの試合も順位表と同じく勝敗に入っている）
  const winPctData = reshape(history, (t) => t.winPct);
  const divisionRankData = reshape(history, (t) => t.divisionRank ?? NaN);

  const divisionGroups = groupByDivision(teams, league);

  // ワイルドカードグラフは、シーズン最終順位ベースの固定メンバーではなく、各日付時点で
  // 実際に地区の自動出場圏（上位divisionTop）の外にいたチームを動的に描画する（圏内に浮上した期間は線が途切れる）。
  // 自動出場圏とワイルドカード枠数はシーズンごとの出場形式（shared/postseasonFormat.ts）から取る。
  // 表示範囲は「2月のバイウィーク明け」以降に限定する（それ以前はワイルドカード争いとして
  // 参照する意味が薄い序盤の順位変動が多く、ノイズになるため）。2月のバイウィークが
  // 検出できない場合（gameSummaries未取得時を含む）は、安全側に倒してグラフ自体を
  // 表示しない（誤った全期間表示をしないため。DESIGN.md参照）
  const wcFormat = wildcardFormat(season, teams, league);
  const wildcardApplicable = wcFormat !== null;
  // 「地区4位以下」のような、ワイルドカード争いの対象を表す表記（2025-26など地区上位2が自動出場のシーズンは「地区3位以下」）
  const wildcardPoolLabel = wcFormat ? `地区${wcFormat.divisionTop + 1}位以下` : "";
  const februaryBiweekGap =
    wildcardApplicable && gameSummaries ? findFebruaryBiweekGap(gameSummaries) : null;
  const wildcardCutoffDate = februaryBiweekGap?.after ?? null;
  const wildcardCutoffIndex = wildcardCutoffDate
    ? (() => {
        const idx = history.findIndex((s) => s.date >= wildcardCutoffDate);
        return idx === -1 ? history.length : idx;
      })()
    : null;
  const wildcardHistory = wildcardCutoffIndex !== null ? history.slice(wildcardCutoffIndex) : [];
  const wildcardTeams: ChartTeam[] = wcFormat ? collectWildcardTeams(wildcardHistory, wcFormat) : [];
  // wildcardHistoryは全期間historyの後半部分の切り出しのため、再生ではこの切り出し分だけ遅れて始まる
  const wildcardPlaybackOffset = wildcardCutoffIndex ?? 0;
  const wildcardRankData = wcFormat ? reshapeWildcardRank(wildcardHistory, wcFormat) : [];
  const wildcardWinsData = wcFormat ? reshapeWildcardMetric(wildcardHistory, wcFormat, (t) => t.wins) : [];
  const wildcardGamesAboveData = wcFormat
    ? reshapeWildcardMetric(wildcardHistory, wcFormat, (t) => t.wins - t.losses)
    : [];
  const wildcardWinPctData = wcFormat ? reshapeWildcardMetric(wildcardHistory, wcFormat, (t) => t.winPct) : [];
  // ワイルドカードプールの1日あたりの人数（各地区の自動出場圏＝上位divisionTopを除いた残り）は、
  // シーズンを通じて常に一定。動的な出入りにより凡例に載る延べチーム数
  // （wildcardTeams.length）はこれより多くなりうるため、順位グラフのY軸上限には
  // 延べチーム数ではなくこちらを使う（StandingsLineChartのrankDomainMax参照）
  const divisionCount = new Set(teams.map((t) => t.division).filter(Boolean)).size;
  const wildcardRankDomainMax = teams.length - (wcFormat?.divisionTop ?? 0) * divisionCount;

  // ワイルドカード順位表（「順位表」タブ）: 最新スナップショット時点で地区の自動出場圏外の
  // チームを、プールのクラブだけで同率を判定し直した順位（wildcardRank。DESIGN.md 229章）の順に並べる。
  // 全体順位rankの部分集合とは、プール外のクラブを含む3クラブ以上の同率で順序が変わりうる。
  // wildcardRankが無い古いデータは全体順位rankで並べる。表の順位列は、並べた順の1始まりの番号を出す。
  // 表示可否の判定はワイルドカードグラフと同じ基準（2月のバイウィーク明け以降）を流用する:
  // - 進行中のシーズンでバイウィーク前: 非表示（案内メッセージ）
  // - 進行中のシーズンでバイウィーク後、または既に終了したシーズン: 最新スナップショットを表示
  //   （終了済みシーズンは最新スナップショット＝最終日のため、この基準だけで両ケースを扱える）
  const wildcardStandingsEligible =
    wildcardApplicable && wildcardCutoffDate !== null && latest.date >= wildcardCutoffDate;
  const wildcardStandingsRows = wildcardStandingsEligible
    ? [...teams]
        .filter((t) => wcFormat !== null && isInWildcardPool(t, wcFormat))
        .sort((a, b) => wildcardOrderRank(a) - wildcardOrderRank(b))
        .map((t, idx) => rowFor({ ...t, wildcardRank: idx + 1 }))
    : [];

  // 各表・グラフに出す「選択中の条件」（Batch 5、DESIGN.md 99章）。順位・星取り・推移はいずれも
  // レギュラーシーズンの試合のみが対象（standings-history.json / head-to-head.jsonの元データ）
  const seasonLabel = `${season}シーズン`;
  const asOfLabel = `${latest.date}時点`;
  const standingsConditions = composeLabels(seasonLabel, asOfLabel, gameTypeLabels("regular", null));
  // アニメーション再生中は、その時点までに表示済みの最終日を対象期間の終端にする（playbackIndex＝いま何番目の日付まで進んだか）
  const trendEndLabelAt = (playbackIndex?: number) => {
    const date = playbackIndex === undefined ? undefined : history[Math.min(playbackIndex, history.length - 1)]?.date;
    return date ? `${date}（再生中）` : latest.date;
  };
  const trendConditionsAt = (playbackIndex?: number) =>
    composeLabels(seasonLabel, gameTypeLabels("regular", null), `開幕〜${trendEndLabelAt(playbackIndex)}`);
  const wildcardTrendConditionsAt = (playbackIndex?: number) =>
    composeLabels(
      seasonLabel,
      gameTypeLabels("regular", null),
      wildcardCutoffDate ? `${wildcardCutoffDate}〜${trendEndLabelAt(playbackIndex)}（2月バイウィーク明け以降）` : null,
      wcFormat ? `${wildcardPoolLabel}（日ごとに入れ替わり）` : null,
    );
  const trendConditions = trendConditionsAt();
  const wildcardTrendConditions = wildcardTrendConditionsAt();
  const h2hClubLabels = !h2hSelectedTeamIds
    ? multiSelectLabels("対象クラブ", [], "全クラブ")
    : h2hSelectedTeamIds.size === 0
      ? ["対象クラブ: なし"]
      : clubSelectionLabels(
          "対象クラブ",
          [...h2hSelectedTeamIds],
          h2hTeamOptions.map((t) => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName) })),
          divisionPresets(
            h2hTeamOptions.map((t) => t.teamId),
            (id) => divisionByTeamId.get(id),
            league,
          ).map((g) => ({ label: g.label, values: g.teamIds })),
        );
  const h2hConditions = composeLabels(gameTypeLabels("regular", null), asOfLabel, h2hClubLabels);

  // 保存する範囲の選択肢（全地区まとめて／各地区／ワイルドカード）
  const divisionRangeOptions = divisionGroups.map((g) => ({ value: g.division as string, label: DIVISION_LABELS[g.division] }));
  const trendRangeOptions = [
    { value: "all", label: divisionGroups.length > 0 ? "全地区まとめて" : "全体" },
    ...divisionRangeOptions,
    ...(divisionGroups.length > 0 && wildcardTeams.length > 0 ? [{ value: "wildcard", label: "ワイルドカード" }] : []),
  ];
  // 星取り表: 今の絞り込みが1つの地区のチームだけと一致するときは、その地区を選んだ状態として出す
  const h2hDivisionChoice =
    h2hSelectedTeamIds === null
      ? "all"
      : (divisionGroups.find(
          (g) => g.teams.length === h2hSelectedTeamIds.size && g.teams.every((t) => h2hSelectedTeamIds.has(t.teamId)),
        )?.division ?? "all");
  // 動画にできるグラフ（全体または地区別＋ワイルドカード）。値・軸・色・サブタイトルは画面のグラフと同じもの（設計書395章）
  const videoTeamsOf = (list: { teamId: string; teamName: string }[]): TrendVideoTeam[] =>
    list.map((t, i) => ({
      teamId: t.teamId,
      label: teamShortName(t.teamId, t.teamName),
      color: teamColors?.[t.teamId]?.primary ?? fallbackColor(i, list.length),
    }));
  const videoCharts = (
    name: string,
    kind: "rank" | "metric",
    allData: Record<string, number | string>[],
    divData: Record<string, number | string>[],
    wcData: Record<string, number | string>[],
    fixed?: FixedYAxis,
    zeroLine?: boolean,
  ): TrendVideoChart[] => {
    const gamesMode = trendXAxis === "games" && kind === "metric";
    const toRows = (rows: Record<string, number | string>[], snaps: StandingsSnapshot[]) => (gamesMode ? toGamesAxis(snaps, rows) : rows);
    const make = (
      key: string,
      label: string,
      title: string,
      rows: Record<string, number | string>[],
      list: { teamId: string; teamName: string }[],
      rankMax: number,
      offset: number,
      connectGaps: boolean,
      conditionsAt: (playbackIndex?: number) => string[],
    ): TrendVideoChart => ({
      key,
      label,
      title,
      rows,
      teams: videoTeamsOf(list),
      connectGaps,
      axis:
        kind === "rank"
          ? { min: 1, max: Math.max(rankMax, 2), ticks: Array.from({ length: rankMax }, (_, i) => i + 1), format: (v) => String(v), reversed: true }
          : fixed
            ? { min: fixed.domain[0], max: fixed.domain[1], ticks: fixed.ticks, format: fixed.format, reversed: false, referenceLine: fixed.referenceLine }
            : { ...autoAxis(rows, list.map((t) => t.teamId), (v) => String(v)), ...(zeroLine ? { referenceLine: 0 } : {}) },
      subtitleAt: (index) => conditionsAt(gamesMode || index === undefined ? undefined : offset + index).join("／"),
      xLabel: gamesMode ? (v) => `${v}試合` : undefined,
    });
    if (divisionGroups.length === 0) return [make("all", "全体", name, toRows(allData, history), teams, teams.length, 0, true, trendConditionsAt)];
    return [
      ...divisionGroups.map((g) => make(g.division, DIVISION_LABELS[g.division], `${DIVISION_LABELS[g.division]}${name}`, toRows(divData, history), g.teams, g.teams.length, 0, true, trendConditionsAt)),
      ...(wildcardTeams.length > 0
        ? [make("wildcard", "ワイルドカード", `ワイルドカード${name}`, toRows(wcData, wildcardHistory), wildcardTeams, wildcardRankDomainMax, wildcardPlaybackOffset, false, wildcardTrendConditionsAt)]
        : []),
    ];
  };
  // 勝ち星推移・勝率推移・貯金推移で共通の部品に渡すもの（再生・地区別・ワイルドカードの構成は3つで同じ）
  const trendTabShared = {
    season,
    seasonLabel,
    isAnimating,
    onPlay: playAnimation,
    rangeOptions: trendRangeOptions,
    range: saveDiv,
    onRangeChange: setSaveDiv,
    divisionGroups,
    teams,
    teamColors: teamColors ?? undefined,
    playback,
    conditionsAt: trendConditionsAt,
    conditions: trendConditions,
    wildcardTeams,
    wildcardPlaybackOffset,
    wildcardConditionsAt: wildcardTrendConditionsAt,
    wildcardConditions: wildcardTrendConditions,
    history,
    wildcardHistory,
    xAxis: trendXAxis,
    onXAxisChange: setTrendXAxis,
  };

  return (
    <div data-design="v2" className="standings-page">
      <PageTitleRow subtitle={`${season}シーズン・${latest.date}時点`}>順位表</PageTitleRow>
      <ResultOnlyNote games={resultOnlyEntries} />

      {tabBar(magicAvailable)}

      {activeTab === "annual" && <AnnualSchedule key={season} season={season} league={league} />}

      {activeTab === "standings" && (
        <div>
          {/* 画像として保存する表は、保存の窓の中で選ぶ（選んだ表だけを保存する。画面の表は変わらない） */}
          <>
            <ExportImageButton
              targetRef={saveTargetRef}
              filename={buildExportFilename([
                  seasonLabel,
                  saveWhich === "wildcard"
                    ? "ワイルドカード順位表"
                    : saveWhich === "overall"
                      ? "全体順位表"
                      : saveWhich.startsWith("div:")
                        ? `${DIVISION_LABELS[saveWhich.slice(4) as Division]} 順位表`
                        : "順位表",
                  asOfLabel,
                ])}
              baseDate={{ kind: "season", season, gameType: "regular" }}
              disabledReason={saveWhich === "overall" && !overallStandingsExpanded ? "「全チームの全体順位表」を開くと保存できます" : undefined}
              options={
                <>
                <span className="export-option-group" role="group" aria-label="保存する表">
              <span className="export-option-label">保存する表</span>
              <button type="button" className={saveWhich === "divisions" ? "active" : ""} onClick={() => setSaveWhich("divisions")}>
                {divisionStandingsGroups.length > 0 ? "地区順位（全地区まとめて）" : "順位表"}
              </button>
              {divisionStandingsGroups.map((g) => (
                <button key={g.division} type="button" className={saveWhich === `div:${g.division}` ? "active" : ""} onClick={() => setSaveWhich(`div:${g.division}`)}>
                  {DIVISION_LABELS[g.division]}
                </button>
              ))}
              {wildcardStandingsEligible && (
                <button type="button" className={saveWhich === "wildcard" ? "active" : ""} onClick={() => setSaveWhich("wildcard")}>
                  ワイルドカード順位表
                </button>
              )}
              {divisionStandingsGroups.length > 0 && (
                <button
                  type="button"
                  className={saveWhich === "overall" ? "active" : ""}
                  onClick={() => {
                    setSaveWhich("overall");
                    setOverallStandingsExpanded(true);
                  }}
                >
                  全体順位表
                </button>
              )}
            </span>
                <SaveColumnChoice
                  choices={saveColumnChoices(winLine)}
                  hidden={saveHiddenCols}
                  onChange={setSaveHiddenCols}
                />
                </>
              }
            />
          </>
          <ExportTarget
            ref={(el) => {
              saveTargets.current.divisions = el;
            }}
            className="export-target-standings"
            baseDate={{ kind: "season", season, gameType: "regular" }}
          >
              <SaveColumnHide hidden={saveHiddenCols} alias={SAVE_COLUMN_ALIAS} />
          <ExportScopeLine scope={seasonLabel} />
          <div className="standings-stack">
            {divisionStandingsGroups.length > 0
              ? divisionStandingsGroups.map((g) => (
                  <div key={g.division} className={saveWhich.startsWith("div:") && saveWhich !== `div:${g.division}` ? "export-hide" : undefined}>
                    <ConditionTitle
 exportScope={seasonLabel}
                      section
                      exportScopeHidden
                      title={`${DIVISION_LABELS[g.division]} 順位表`}
                      conditions={composeLabels(standingsConditions, "地区内順位", sorts[`div:${g.division}`])}
                    />
                    <div className="table-scroll standings-sticky-3">
                      <SortableTable
                        statScope="team"
                        columns={withPlayoffLineColumn(divisionStandingsColumns, winLine)}
                        rows={g.rows}
                        rowKey={(t) => t.teamId}
                        defaultSortKey="divisionRank"
                        defaultSortDir="asc"
                        linkTo={(t) => `/teams/${t.teamId}`}
                        rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                        {...sortProps(`div:${g.division}`)}
                      />
                    </div>
                  </div>
                ))
              : (
                  <div>
                    <ConditionTitle
 exportScope={seasonLabel}
                      section
                      exportScopeHidden
                      title={`${seasonLabel} 順位表`}
                      conditions={composeLabels(standingsConditions, sorts.all)}
                    />
                    <div className="table-scroll standings-sticky-2">
                      <SortableTable
                        statScope="team"
                        columns={withPlayoffLineColumn(overallStandingsColumns, winLine)}
                        rows={allStandingsRows}
                        rowKey={(t) => t.teamId}
                        defaultSortKey="rank"
                        defaultSortDir="asc"
                        linkTo={(t) => `/teams/${t.teamId}`}
                        rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                        {...sortProps("all")}
                      />
                    </div>
                  </div>
                )}
          </div>
          </ExportTarget>

          {playoffRace && <RaceLegend race={playoffRace} />}
          <GlossaryNote anchor={GLOSSARY_ANCHORS.standingsTable} label="順位表の対戦相手の強さ" />

          {wildcardApplicable && (
            <>
              {wildcardStandingsEligible ? (
                <ExportTarget
                  ref={(el) => {
                    saveTargets.current.wildcard = el;
                  }}
                  className="export-target-standings"
                  baseDate={{ kind: "season", season, gameType: "regular" }}
                >
                    <SaveColumnHide hidden={saveHiddenCols} alias={SAVE_COLUMN_ALIAS} />
                  <ConditionTitle
                    section
                    exportScope={seasonLabel}
                    title="ワイルドカード順位表"
                    conditions={composeLabels(
                      standingsConditions,
                      wildcardPoolLabel,
                      `上位${wcFormat?.wildcardSlots ?? 0}クラブがワイルドカード`,
                      "ワイルドカード順位順",
                      sorts.wildcard,
                    )}
                  />
                  <div className="table-scroll standings-sticky-3">
                    <SortableTable
                      statScope="team"
                      columns={withPlayoffLineColumn(wildcardStandingsColumns, winLine)}
                      rows={wildcardStandingsRows}
                      rowKey={(t) => t.teamId}
                      defaultSortKey="wildcardRank"
                      defaultSortDir="asc"
                      linkTo={(t) => `/teams/${t.teamId}`}
                      rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                      {...sortProps("wildcard")}
                    />
                  </div>
                </ExportTarget>
              ) : (
                <>
                  <ConditionTitle
 exportScope={seasonLabel}
                    section
                    title="ワイルドカード順位表"
                    conditions={composeLabels(
                      standingsConditions,
                      wildcardPoolLabel,
                      `上位${wcFormat?.wildcardSlots ?? 0}クラブがワイルドカード`,
                      "ワイルドカード順位順",
                    )}
                  />
                  <p className="empty-message">シーズン終盤（2月のバイウィーク明け以降）に表示されます。</p>
                </>
              )}
            </>
          )}

          {divisionStandingsGroups.length > 0 && (
            <>
              <h2
                className="collapsible-heading"
                onClick={() => setOverallStandingsExpanded((v) => !v)}
              >
                {overallStandingsExpanded ? "▼ " : "▶ "}
                全チームの全体順位表
              </h2>
              {overallStandingsExpanded && (
                <ExportTarget
                  ref={(el) => {
                    saveTargets.current.overall = el;
                  }}
                  className="export-target-standings"
                  baseDate={{ kind: "season", season, gameType: "regular" }}
                >
                    <SaveColumnHide hidden={saveHiddenCols} alias={SAVE_COLUMN_ALIAS} />
                  <ConditionTitle
                    exportScope={seasonLabel}
                    title="全体順位表"
                    conditions={composeLabels(standingsConditions, "全クラブ", "公式の順位ではなく参考の並び", sorts.overall)}
                  />
                  <p className="standings-tab-note export-hide">
                    公式の順位ではなく、全クラブを1つの表に並べた参考の並びです（公式の順位は、各地区の順位とワイルドカードの順位です）。
                  </p>
                  <div className="table-scroll standings-sticky-3">
                    <SortableTable
                      statScope="team"
                      columns={withPlayoffLineColumn(allStandingsColumns, winLine)}
                      rows={allStandingsRows}
                      rowKey={(t) => t.teamId}
                      defaultSortKey="rank"
                      defaultSortDir="asc"
                      linkTo={(t) => `/teams/${t.teamId}`}
                      rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                      {...sortProps("overall")}
                    />
                  </div>
                </ExportTarget>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === "magic" && magicAvailable && playoffRace && (
        <div className="standings-tab-panel">
          {magicEarly && (
            <p className="standings-tab-note">
              シーズン序盤のため、どのクラブも大きな数字になっています。残り試合が減るにつれて意味を持つ数字です。
            </p>
          )}
          {playoffRace.unavailableReason ? (
            <p className="empty-message">現在は計算できません（{playoffRace.unavailableReason}）</p>
          ) : (
            <div className="standings-stack">
              {magicGroups.map((g) => (
                <div key={g.division}>
                  <ConditionTitle
 exportScope={seasonLabel}
                    section
                    title={`${DIVISION_LABELS[g.division]} マジックナンバー`}
                    conditions={composeLabels(standingsConditions, "残り全勝/全敗で比較する安全側の判定")}
                  />
                  <div className="table-scroll standings-sticky-2">
                    <SortableTable
                      statScope="team"
                      columns={magicColumns}
                      rows={g.rows}
                      rowKey={(r) => r.teamId}
                      defaultSortKey="divisionRank"
                      defaultSortDir="asc"
                      linkTo={(r) => `/teams/${r.teamId}`}
                      rowAccentColor={(r) => teamColors?.[r.teamId]?.primary}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <GlossaryNote anchor={GLOSSARY_ANCHORS.magicNumber} label="マジックナンバー" />
        </div>
      )}

      {activeTab === "h2h" &&
        (h2hLoading ? (
          <p className="loading">読み込み中...</p>
        ) : h2hError ? (
          <p className="error-message">{h2hError}</p>
        ) : !headToHead || headToHead.length === 0 ? (
          <p className="empty-message">データがありません</p>
        ) : (
          <>
            <FilterBar
              axes={[
                teamMultiAxis({
                  options: h2hTeamOptions,
                  selected: h2hSelectedTeamIds,
                  onChange: setH2hSelectedTeamIds,
                  divisionOf: (id) => divisionByTeamId.get(id),
                  presets: playoffZone ? [playoffZone] : [],
                }),
              ]}
              stateKey="standings:h2h"
              onClearAll={() => setH2hSelectedTeamIds(null)}
            />
            {!filteredHeadToHead || filteredHeadToHead.length === 0 ? (
              <p className="empty-message">選択したチームがありません</p>
            ) : (
              <>
              <SavableBlock
                filename={buildExportFilename([seasonLabel, ...(h2hDivisionChoice !== "all" ? [DIVISION_LABELS[h2hDivisionChoice as Division]] : []), "星取り表", ...h2hConditions])}
                baseDate={{ kind: "season", season, gameType: "regular" }}
                className="export-target-wide-table"
                extraControls={
                  divisionGroups.length > 0 ? (
                    <SaveRangeChoice
                      value={h2hDivisionChoice}
                      onChange={(v) =>
                        setH2hSelectedTeamIds(v === "all" ? null : new Set(divisionGroups.find((g) => g.division === v)?.teams.map((t) => t.teamId) ?? []))
                      }
                      options={[{ value: "all", label: "全チーム" }, ...divisionRangeOptions]}
                    />
                  ) : undefined
                }
              >
                <ConditionTitle
 exportScope={seasonLabel} title={h2hDivisionChoice !== "all" ? `${DIVISION_LABELS[h2hDivisionChoice as Division]} 星取り表` : `${seasonLabel} 星取り表`} conditions={h2hConditions} />
                <HeadToHeadMatrix
                  rows={filteredHeadToHead}
                  teamColors={teamColors ?? undefined}
                  remainingGames={h2hRemainingGames}
                />
              </SavableBlock>
              </>
            )}
          </>
        ))}

      {activeTab === "winLoss" &&
        (!gameSummaries ? (
          <p className="loading">読み込み中...</p>
        ) : (
          <div className="standings-tab-panel">
            <SavableBlock
              filename={buildExportFilename([seasonLabel, ...(saveDiv !== "all" ? [DIVISION_LABELS[saveDiv as Division]] : []), "勝敗表", asOfLabel])}
              baseDate={{ kind: "season", season, gameType: "regular" }}
              className="export-target-wide-table"
              extraControls={
                divisionGroups.length > 0 ? (
                  <SaveRangeChoice
                    value={saveDiv}
                    onChange={setSaveDiv}
                    options={[{ value: "all", label: "全地区まとめて" }, ...divisionRangeOptions]}
                  />
                ) : undefined
              }
            >
            <ExportScopeLine scope={seasonLabel} />
            <WinLossLegend season={season} clinchTypes={clinchTypesForSeason(season).filter((c) => league === "premier" || c !== "homeCourt")} />
            <div className="standings-stack">
              {(divisionStandingsGroups.length > 0
                ? divisionStandingsGroups.map((g) => ({ key: g.division, title: `${DIVISION_LABELS[g.division]} 勝敗表`, rows: g.rows }))
                : [{ key: "all", title: `${seasonLabel} 勝敗表`, rows: allStandingsRows }]
              ).map((g) => (
                <div key={g.key} className={hideUnless(saveDiv, g.key)}>
                  <ConditionTitle
 exportScope={seasonLabel}
                    section
                    exportScopeHidden
                    title={g.title}
                    conditions={composeLabels(standingsConditions, "順位順", "第何試合かは日付順")}
                  />
                  <WinLossGrid
                    season={season}
                    teams={g.rows.map((r) => ({
                      teamId: r.teamId,
                      teamName: r.teamName,
                      // 地区順位（順位表の表示と同じ値）。地区の無いシーズンの全体表示では順位を出さない
                      divisionRank: g.key === "all" ? undefined : r.unplayed ? null : (r.divisionRank ?? null),
                      stats: standingsStatCells(r),
                    }))}
                    games={gamesForGrid ?? gameSummaries}
                    resultOnly={resultOnlyEntries}
                    upcomingGames={pendingUpcoming}
                    clinchEvents={playoffRace?.clinchEvents ?? []}
                    teamColors={teamColors ?? undefined}
                    teamIdByName={new Map(standingsTeams.map((t) => [t.teamName, t.teamId]))}
                  />
                </div>
              ))}
            </div>
            </SavableBlock>
          </div>
        ))}

      {activeTab === "conditional" && (
        <ConditionalStandingsTable
          season={season}
          league={league}
          teams={teams}
          gameLogsByTeam={gameLogsByTeam}
          gameLogsLoading={gameLogsLoading}
          upcomingGames={pendingUpcoming}
          teamColors={teamColors ?? undefined}
          resultOnlyGames={resultOnlyEntries}
        />
      )}

      {activeTab === "foreignCount" && (
        gameLogsLoading || !gameLogsByTeam ? (
          <p className="loading">読み込み中...</p>
        ) : (
          <ForeignCountStandings
            season={season}
            seasonLabel={seasonLabel}
            asOfLabel={asOfLabel}
            groups={
              divisionStandingsGroups.length > 0
                ? groupByDivision(standingsTeams, league).map((g) => ({ division: g.division as Division | null, teams: g.teams }))
                : [{ division: null, teams: [...standingsTeams].sort((a, b) => a.rank - b.rank) }]
            }
            gameLogsByTeam={gameLogsByTeam}
            teamColors={teamColors ?? undefined}
          />
        )
      )}

      {activeTab === "rankTrend" && (
        <div>
          <div className="mode-toggle">
            <button type="button" className={isAnimating ? "active" : ""} onClick={playAnimation} disabled={isAnimating}>
              {isAnimating ? "再生中..." : "▶ アニメーション再生"}
            </button>
          </div>
          <TrendSaveFrame videoCharts={videoCharts("順位推移", "rank", rankData, divisionRankData, wildcardRankData)} name="順位推移" season={season} seasonLabel={seasonLabel} isAnimating={isAnimating} rangeOptions={trendRangeOptions} range={saveDiv} onRangeChange={setSaveDiv}>
          {divisionGroups.length === 0 ? (
            <StandingsLineChart
              title="順位推移"
              data={rankData}
              teams={teams}
              reversed
              height={720}
              teamColors={teamColors ?? undefined}
              playback={playback}
              playingConditions={trendConditionsAt}
              conditions={trendConditions}
            />
          ) : (
            <div className="standings-stack">
              {divisionGroups.map((g) => (
                <div key={g.division} className={hideUnless(saveDiv, g.division)}>
                  <StandingsLineChart
                    title={`${DIVISION_LABELS[g.division]}順位推移`}
                    data={divisionRankData}
                    teams={g.teams}
                    reversed
                    height={640}
                    teamColors={teamColors ?? undefined}
                    playback={playback}
                    playingConditions={trendConditionsAt}
                    conditions={trendConditions}
                  />
                </div>
              ))}
              {wildcardTeams.length > 0 && (
                <div className={hideUnless(saveDiv, "wildcard")}>
                <StandingsLineChart
                  title="ワイルドカード順位推移"
                  data={wildcardRankData}
                  teams={wildcardTeams}
                  reversed
                  height={640}
                  teamColors={teamColors ?? undefined}
                  playback={playback}
                  playbackOffset={wildcardPlaybackOffset}
                  playingConditions={wildcardTrendConditionsAt}
                  connectGaps={false}
                  rankDomainMax={wildcardRankDomainMax}
                  conditions={wildcardTrendConditions}
                />
                </div>
              )}
            </div>
          )}
          </TrendSaveFrame>
        </div>
      )}

      {activeTab === "winsTrend" && (
        <MetricTrendTab {...trendTabShared} videoCharts={videoCharts("勝ち星推移", "metric", winsData, winsData, wildcardWinsData)} name="勝ち星推移" data={winsData} wildcardData={wildcardWinsData} />
      )}

      {activeTab === "winPctTrend" && (
        <MetricTrendTab
          {...trendTabShared}
          videoCharts={videoCharts("勝率推移", "metric", winPctData, winPctData, wildcardWinPctData, WIN_PCT_Y_AXIS)}
          name="勝率推移"
          data={winPctData}
          wildcardData={wildcardWinPctData}
          fixedYAxis={WIN_PCT_Y_AXIS}
        />
      )}

      {activeTab === "gamesAboveTrend" && (
        <MetricTrendTab {...trendTabShared} videoCharts={videoCharts("貯金推移", "metric", gamesAboveData, gamesAboveData, wildcardGamesAboveData, undefined, true)} zeroLine name="貯金推移" data={gamesAboveData} wildcardData={wildcardGamesAboveData} />
      )}
    </div>
  );
}
