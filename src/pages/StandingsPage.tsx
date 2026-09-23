import { useEffect, useState } from "react";
import {
  fetchGameSummaries,
  fetchHeadToHead,
  fetchPlayoffRace,
  fetchSchedule,
  fetchStandingsHistory,
  fetchTeamColors,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import { SortableTable, type Column } from "../components/SortableTable";
import { StandingsLineChart, type ChartTeam } from "../components/StandingsLineChart";
import { TeamLogo } from "../components/TeamLogo";
import { CrownIcon } from "../components/CrownIcon";
import { HeadToHeadMatrix } from "../components/HeadToHeadMatrix";
import { FilterBar } from "../components/FilterBar";
import { teamMultiAxis } from "../lib/filterAxes";
import { ConditionalStandingsTable } from "../components/ConditionalStandingsTable";
import { ConditionLine, ConditionTitle } from "../components/ConditionTitle";
import { composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { formatDecimal, formatPct, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak, type TeamStreak } from "../../shared/teamRecords";
import { teamShortName } from "../../shared/teamNames";
import { DIVISION_LABELS, groupByDivision } from "../lib/divisionGroups";
import { findFebruaryBiweekGap } from "../lib/situational";
import type {
  HeadToHeadTeamRow,
  PlayoffRaceFile,
  PlayoffRaceTeam,
  StandingsSnapshot,
  StandingsTeamSnapshot,
  TeamGameLog,
  UpcomingGameEntry,
} from "../../shared/types";

type StandingsTab = "standings" | "h2h" | "conditional" | "rankTrend" | "winsTrend" | "gamesAboveTrend";

const TAB_LABELS: Record<StandingsTab, string> = {
  standings: "順位表",
  h2h: "星取り表",
  conditional: "条件別順位表",
  rankTrend: "順位推移",
  winsTrend: "勝ち星推移",
  gamesAboveTrend: "貯金推移",
};

interface WinLossRecord {
  wins: number;
  losses: number;
}

/** ホーム/アウェー成績・直近5試合・連勝連敗・試合消化率の元になる、地区別テーブル1行分の付加情報 */
interface StandingsRow extends StandingsTeamSnapshot {
  homeRecord: WinLossRecord | null;
  awayRecord: WinLossRecord | null;
  /** 直近5試合の時系列順（古い→新しい）のW/L文字列（例: "WWLWW"）。データ未取得ならnull */
  last5: string | null;
  streak: TeamStreak | null;
  /** 消化済み試合数 / (消化済み+未消化) の割合（0〜1）。schedule.json未取得ならnull */
  completionRate: number | null;
  /** マジックナンバー・進出/敗退・年間優勝（playoff-race.json）。未生成のシーズンはnull */
  race: PlayoffRaceTeam | null;
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
function buildStandingsRow(
  team: StandingsTeamSnapshot,
  logs: TeamGameLog[] | undefined,
  upcomingCount: number | undefined,
  race: PlayoffRaceTeam | null,
): StandingsRow {
  const gamesPlayed = team.wins + team.losses;
  const completionRate = upcomingCount === undefined ? null : safeDiv(gamesPlayed, gamesPlayed + upcomingCount);
  if (!logs) {
    return { ...team, homeRecord: null, awayRecord: null, last5: null, streak: null, completionRate, race };
  }
  const regular = regularSeasonLogs(logs);
  return {
    ...team,
    homeRecord: recordFrom(regular.filter((l) => l.isHome)),
    awayRecord: recordFrom(regular.filter((l) => !l.isHome)),
    last5: recordSequence(sortedByDate(regular).slice(-5)),
    streak: currentStreak(regular),
    completionRate,
    race,
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
        {r.teamName}
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
    format: (t) => String(t.divisionRank ?? "-"),
  },
  { key: "rank", label: "全体順位", sortValue: (t) => t.rank, format: (t) => String(t.rank) },
  {
    key: "teamName",
    label: "チーム",
    align: "left",
    sortValue: (t) => t.teamName,
    render: (t) => (
      <span className="team-name-cell">
        <TeamLogo teamId={t.teamId} size={20} />
        {t.teamName}
        <RaceMarks race={t.race} />
      </span>
    ),
  },
  {
    key: "record",
    label: "勝敗",
    sortValue: (t) => t.wins - t.losses,
    render: (t) => formatRecord(t.wins, t.losses),
  },
  { key: "winPct", label: "勝率", sortValue: (t) => t.winPct, format: (t) => formatWinPct(t.winPct) },
  {
    key: "divisionGamesBehind",
    label: "GB",
    sortValue: (t) => t.divisionGamesBehind ?? 0,
    format: (t) => (!t.divisionGamesBehind ? "-" : formatDecimal(t.divisionGamesBehind)),
  },
  {
    key: "pointDiff",
    label: "得失点差",
    sortValue: (t) => t.pointDiff,
    format: (t) => formatSigned(t.pointDiff, 0),
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
    key: "completionRate",
    label: "試合消化率",
    sortValue: (t) => t.completionRate ?? 0,
    format: (t) => (t.completionRate === null ? "-" : formatPct(t.completionRate)),
  },
];

// 地区データが無いシーズン用のフォールバック列（「地区順位」列を除いたもの）
const overallStandingsColumns: Column<StandingsRow>[] = divisionStandingsColumns.filter(
  (c) => c.key !== "divisionRank",
);

// 「全チームの全体順位表」用の列。地区順位が地区を跨いだ一覧の中でも区別できるよう、
// 地区名の頭文字を併記する（例:「東1」「中5」）
const allStandingsColumns: Column<StandingsRow>[] = divisionStandingsColumns.map((c) =>
  c.key === "divisionRank"
    ? {
        ...c,
        format: (t: StandingsRow) =>
          t.division && t.divisionRank ? `${DIVISION_LABELS[t.division][0]}${t.divisionRank}` : String(t.divisionRank ?? "-"),
      }
    : c,
);

/**
 * historyを日付ごとの{date, teamId: 値}行に変換する。
 * revealCountを指定した場合（アニメーション再生中）、それ以降のインデックスの行は
 * dateだけを持たせチーム値を一切設定しない。これにより、X軸のドメイン（日付範囲）は
 * historyの全期間で固定されたままになり、まだ明かされていない区間はチーム値が
 * undefinedのまま（=末端のロゴがXAxisの実際の日付位置を左から右へ移動していくように
 * 見える）。revealCountを渡さない場合は全期間分の値をそのまま設定する
 * （X軸ドメインが表示データに応じて可変だった旧実装では、末端の点が常にプロット領域の
 * 右端に固定表示されてしまい、アニメーション中もロゴが移動して見えない不具合があった）
 */
function reshape(
  history: StandingsSnapshot[],
  metric: (t: StandingsTeamSnapshot) => number,
  revealCount?: number,
) {
  return history.map((snapshot, i) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    if (revealCount !== undefined && i >= revealCount) return row;
    for (const t of snapshot.teams) row[t.teamId] = metric(t);
    return row;
  });
}

/** そのチームが日付snapshotの時点で「地区3位以内」に入っておらず、ワイルドカード争いの
 * 対象と言えるかどうか（地区上位3位以内に入っていないチーム）。東西2地区制のシーズンのみ
 * 意味を持つ（ConditionalStandingsTable.tsxのcomputePlayoffQualifiedTeamIds()と同じ考え方） */
function isInWildcardPool(t: StandingsTeamSnapshot): boolean {
  return (t.division === "east" || t.division === "west") && (t.divisionRank ?? 99) > 3;
}

/**
 * このシーズンが東西2地区制（ワイルドカードグラフの対象）かどうか。
 * プレーオフ進出条件が他の地区数では未確認のため、東西2地区が既知のシーズンのみ対象とする
 */
function isWildcardApplicable(teams: StandingsTeamSnapshot[]): boolean {
  const divisions = new Set(teams.map((t) => t.division).filter((d): d is "east" | "west" => !!d));
  return divisions.size === 2 && divisions.has("east") && divisions.has("west");
}

/** 表示範囲内（historyは既に2月のバイウィーク以降に絞り込み済み）のどこかの日付で、
 * 一度でもワイルドカード争いの対象（地区4位以下）だったチームを全て集める
 * （＝そのチームのLineを描画するかどうかの判定に使う。動的な出入りを反映するため、
 * シーズン最終順位ではなく表示範囲内での実際の在籍状況を基準にする） */
function collectWildcardTeams(history: StandingsSnapshot[]): ChartTeam[] {
  const byId = new Map<string, string>();
  for (const snapshot of history) {
    for (const t of snapshot.teams) {
      if (isInWildcardPool(t)) byId.set(t.teamId, t.teamName);
    }
  }
  return [...byId].map(([teamId, teamName]) => ({ teamId, teamName }));
}

/**
 * ワイルドカード争いの「相対順位」推移を求める。日付ごとに、その時点で実際に地区4位以下
 * だったチームだけを全体順位(rank)昇順に並べ直し、その順位（1始まり）を割り当てる。
 * 地区3位以内に浮上した日はその日の値を持たない（=StandingsLineChartのconnectGaps={false}と
 * 組み合わせて、グラフ上でその期間だけ線が途切れる。静的な最終順位ベースの固定メンバーでは
 * なく、日々の実際の在籍状況を動的に反映する）。revealCountの意味・目的はreshape()と同じ
 * （アニメーション中もX軸ドメインを固定するため）
 */
function reshapeWildcardRank(history: StandingsSnapshot[], revealCount?: number) {
  return history.map((snapshot, i) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    if (revealCount !== undefined && i >= revealCount) return row;
    const poolTeamsAtDate = snapshot.teams.filter(isInWildcardPool).sort((a, b) => a.rank - b.rank);
    poolTeamsAtDate.forEach((t, idx) => {
      row[t.teamId] = idx + 1;
    });
    return row;
  });
}

/** 勝ち星推移・貯金推移のワイルドカードグラフ用。reshape()と同じだが、各日付時点で実際に
 * 地区4位以下だったチームの値のみを設定する（地区3位以内だった日は値を持たせず、
 * reshapeWildcardRankと同様に線を途切れさせる） */
function reshapeWildcardMetric(
  history: StandingsSnapshot[],
  metric: (t: StandingsTeamSnapshot) => number,
  revealCount?: number,
) {
  return history.map((snapshot, i) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    if (revealCount !== undefined && i >= revealCount) return row;
    for (const t of snapshot.teams) {
      if (isInWildcardPool(t)) row[t.teamId] = metric(t);
    }
    return row;
  });
}

export function StandingsPage({ season }: { season: string }) {
  const [tab, setTab] = useState<StandingsTab>("standings");
  const { data: history, loading, error } = useJsonData(() => fetchStandingsHistory(season), [season]);
  const {
    data: headToHead,
    loading: h2hLoading,
    error: h2hError,
  } = useJsonData(() => fetchHeadToHead(season), [season]);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const { data: schedule } = useJsonData(() => fetchSchedule(season), [season]);
  // ワイルドカードグラフの表示開始基準（2月のバイウィーク明け）算出用
  const { data: gameSummaries } = useJsonData(() => fetchGameSummaries(season), [season]);
  const { data: playoffRace } = useJsonData(() => fetchPlayoffRace(season), [season]);

  // null = 全チーム選択（絞り込みなし）。個別に外したチームだけをSetで管理する（SchedulePageと同じパターン）
  const [h2hSelectedTeamIds, setH2hSelectedTeamIds] = useState<Set<string> | null>(null);

  // 「順位表」タブの「全チームの全体順位表」（地区を跨いだ順位表）。デフォルト非表示
  const [overallStandingsExpanded, setOverallStandingsExpanded] = useState(false);

  // シーズンが変わったらチームフィルタの選択状態をリセットする（前シーズンのチーム構成は引き継がない）
  useEffect(() => {
    setH2hSelectedTeamIds(null);
  }, [season]);

  // 順位推移・勝ち星推移タブの「アニメーション再生」。animFrame===nullなら通常表示（全期間分）、
  // 非nullならhistoryの先頭からanimFrame件だけを各グラフに渡す
  const [animFrame, setAnimFrame] = useState<number | null>(null);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    setAnimFrame(null);
    setIsAnimating(false);
  }, [season]);

  useEffect(() => {
    if (!isAnimating || animFrame === null || !history) return;
    if (animFrame >= history.length) {
      setIsAnimating(false);
      setAnimFrame(null);
      return;
    }
    const timer = setTimeout(() => setAnimFrame((f) => (f ?? 0) + 1), 180);
    return () => clearTimeout(timer);
  }, [isAnimating, animFrame, history]);

  const playAnimation = () => {
    setAnimFrame(1);
    setIsAnimating(true);
  };

  const latest = history && history.length > 0 ? history[history.length - 1]! : null;
  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, latest?.teams ?? null);

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!history || history.length === 0 || !latest) return <p className="empty-message">データがありません</p>;

  const teams = latest.teams;
  // schedule.upcomingGamesは古いschedule.jsonスナップショット（スクレイパーにこのフィールドを
  // 追加する前に取得されたもの）には存在しないことがあるため、undefinedの可能性を必ず考慮する
  const upcomingCountByTeamName = schedule ? countUpcomingGamesByTeamName(schedule.upcomingGames ?? []) : null;
  const raceById = new Map((playoffRace?.teams ?? []).map((r) => [r.teamId, r]));
  const rowFor = (t: StandingsTeamSnapshot) =>
    buildStandingsRow(
      t,
      gameLogsByTeam?.get(t.teamId),
      upcomingCountByTeamName ? (upcomingCountByTeamName.get(t.teamName) ?? 0) : undefined,
      raceById.get(t.teamId) ?? null,
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
            })),
        }))
      : [];
  const divisionStandingsGroups = groupByDivision(teams).map((g) => ({
    division: g.division,
    rows: g.teams.map(rowFor),
  }));
  // 地区を跨いだ全チーム一覧（地区データが無いシーズンのフォールバック表示、および
  // 「全チームの全体順位表」セクションの両方で使う）
  const allStandingsRows = [...teams].sort((a, b) => a.rank - b.rank).map(rowFor);

  const h2hTeamIdByName = headToHead ? new Map(headToHead.map((r) => [r.teamName, r.teamId])) : null;
  const h2hRemainingGames =
    headToHead && schedule && h2hTeamIdByName
      ? buildH2hRemainingGames(schedule.upcomingGames ?? [], h2hTeamIdByName)
      : undefined;
  const h2hTeamOptions: { teamId: string; teamName: string }[] = headToHead
    ? [...headToHead]
        .map((r: HeadToHeadTeamRow) => ({ teamId: r.teamId, teamName: r.teamName }))
        .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja"))
    : [];
  const filteredHeadToHead =
    headToHead && h2hSelectedTeamIds ? headToHead.filter((r) => h2hSelectedTeamIds.has(r.teamId)) : headToHead;
  // revealCount===undefined（animFrame===null）なら全期間を表示する。
  // アニメーション再生中はhistory全体を渡しつつrevealCountで区切ることで、
  // X軸ドメイン（日付範囲）を固定したまま値だけを段階的に明かす（詳細はreshape()参照）
  const revealCount = animFrame ?? undefined;
  const rankData = reshape(history, (t) => t.rank, revealCount);
  const winsData = reshape(history, (t) => t.wins, revealCount);
  const gamesAboveData = reshape(history, (t) => t.wins - t.losses, revealCount);
  const divisionRankData = reshape(history, (t) => t.divisionRank ?? NaN, revealCount);

  const divisionGroups = groupByDivision(teams);

  // ワイルドカードグラフは、シーズン最終順位ベースの固定メンバーではなく、各日付時点で
  // 実際に地区4位以下だったチームを動的に描画する（地区3位以内に浮上した期間は線が途切れる）。
  // 表示範囲は「2月のバイウィーク明け」以降に限定する（それ以前はワイルドカード争いとして
  // 参照する意味が薄い序盤の順位変動が多く、ノイズになるため）。2月のバイウィークが
  // 検出できない場合（gameSummaries未取得時を含む）は、安全側に倒してグラフ自体を
  // 表示しない（誤った全期間表示をしないため。DESIGN.md参照）
  const wildcardApplicable = isWildcardApplicable(teams);
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
  const wildcardTeams: ChartTeam[] = collectWildcardTeams(wildcardHistory);
  // wildcardHistoryは全期間historyの後半部分の切り出しのため、revealCount（history全体での
  // フレーム番号）をこの切り出し分だけ前倒しして、アニメーションの進行と時系列を合わせる
  const wildcardRevealCount =
    revealCount === undefined || wildcardCutoffIndex === null
      ? revealCount
      : Math.max(0, revealCount - wildcardCutoffIndex);
  const wildcardRankData = reshapeWildcardRank(wildcardHistory, wildcardRevealCount);
  const wildcardWinsData = reshapeWildcardMetric(wildcardHistory, (t) => t.wins, wildcardRevealCount);
  const wildcardGamesAboveData = reshapeWildcardMetric(
    wildcardHistory,
    (t) => t.wins - t.losses,
    wildcardRevealCount,
  );
  // ワイルドカードプールの1日あたりの人数（東西各3位以内=6チームを除いた残り）は、
  // シーズンを通じて常に一定（total - 6）。動的な出入りにより凡例に載る延べチーム数
  // （wildcardTeams.length）はこれより多くなりうるため、順位グラフのY軸上限には
  // 延べチーム数ではなくこちらを使う（StandingsLineChartのrankDomainMax参照）
  const wildcardRankDomainMax = teams.length - 6;

  // ワイルドカード順位表（「順位表」タブ）: 最新スナップショット時点で地区4位以下の
  // チームを、既存のタイブレークロジック（rankStandingsTeams、全体順位rankに反映済み）の
  // 順序のまま抽出する。rankは全チーム間の一貫した全順序のため、その部分集合を
  // rank昇順に並べれば「プール内だけで見たタイブレーク順」と同じ結果になる
  // （プール内相対順位を1から振り直す必要はない）。
  // 表示可否の判定はワイルドカードグラフと同じ基準（2月のバイウィーク明け以降）を流用する:
  // - 進行中のシーズンでバイウィーク前: 非表示（案内メッセージ）
  // - 進行中のシーズンでバイウィーク後、または既に終了したシーズン: 最新スナップショットを表示
  //   （終了済みシーズンは最新スナップショット＝最終日のため、この基準だけで両ケースを扱える）
  const wildcardStandingsEligible =
    wildcardApplicable && wildcardCutoffDate !== null && latest.date >= wildcardCutoffDate;
  const wildcardStandingsRows = wildcardStandingsEligible
    ? [...teams]
        .filter(isInWildcardPool)
        .sort((a, b) => a.rank - b.rank)
        .map(rowFor)
    : [];

  // 各表・グラフに出す「選択中の条件」（Batch 5、DESIGN.md 99章）。順位・星取り・推移はいずれも
  // レギュラーシーズンの試合のみが対象（standings-history.json / head-to-head.jsonの元データ）
  const seasonLabel = `${season}シーズン`;
  const asOfLabel = `${latest.date}時点`;
  const standingsConditions = composeLabels(seasonLabel, asOfLabel, gameTypeLabels("regular", null));
  // アニメーション再生中は、その時点までに表示済みの最終日を対象期間の終端にする
  const revealedLastDate =
    revealCount !== undefined ? history[Math.min(revealCount, history.length) - 1]?.date : undefined;
  const trendEndLabel = revealedLastDate ? `${revealedLastDate}（再生中）` : latest.date;
  const trendConditions = composeLabels(seasonLabel, gameTypeLabels("regular", null), `開幕〜${trendEndLabel}`);
  const wildcardTrendConditions = composeLabels(
    seasonLabel,
    gameTypeLabels("regular", null),
    wildcardCutoffDate ? `${wildcardCutoffDate}〜${trendEndLabel}（2月バイウィーク明け以降）` : null,
    "地区4位以下（日ごとに入れ替わり）",
  );
  const h2hClubLabels = !h2hSelectedTeamIds
    ? multiSelectLabels("対象クラブ", [], "全クラブ")
    : h2hSelectedTeamIds.size === 0
      ? ["対象クラブ: なし"]
      : multiSelectLabels(
          "対象クラブ",
          h2hTeamOptions.filter((t) => h2hSelectedTeamIds.has(t.teamId)).map((t) => teamShortName(t.teamId, t.teamName)),
          "全クラブ",
        );
  const h2hConditions = composeLabels(gameTypeLabels("regular", null), asOfLabel, h2hClubLabels);

  return (
    <div>
      <h1>順位表</h1>
      <p className="page-subtitle">{season}シーズン・{latest.date}時点</p>

      <div className="tab-bar">
        {(Object.keys(TAB_LABELS) as StandingsTab[]).map((t) => (
          <button key={t} className={`tab-button${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "standings" && (
        <div>
          <div className="standings-stack">
            {divisionStandingsGroups.length > 0
              ? divisionStandingsGroups.map((g) => (
                  <div key={g.division}>
                    <ConditionTitle
                      section
                      title={`${DIVISION_LABELS[g.division]} 順位表`}
                      conditions={composeLabels(standingsConditions, "地区内順位")}
                    />
                    <div className="table-scroll">
                      <SortableTable
                        columns={divisionStandingsColumns}
                        rows={g.rows}
                        rowKey={(t) => t.teamId}
                        defaultSortKey="divisionRank"
                        defaultSortDir="asc"
                        linkTo={(t) => `/teams/${t.teamId}`}
                        rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                      />
                    </div>
                  </div>
                ))
              : (
                  <div>
                    <ConditionTitle section title={`${seasonLabel} 順位表`} conditions={standingsConditions} />
                    <div className="table-scroll">
                      <SortableTable
                        columns={overallStandingsColumns}
                        rows={allStandingsRows}
                        rowKey={(t) => t.teamId}
                        defaultSortKey="rank"
                        defaultSortDir="asc"
                        linkTo={(t) => `/teams/${t.teamId}`}
                        rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                      />
                    </div>
                  </div>
                )}
          </div>

          {playoffRace && <RaceLegend race={playoffRace} />}

          {playoffRace?.format === "premier-2026" && (
            <>
              <ConditionTitle
                section
                title="マジックナンバー"
                conditions={composeLabels(standingsConditions, "残り全勝/全敗で比較する安全側の判定")}
              />
              {playoffRace.unavailableReason ? (
                <p className="empty-message">現在は計算できません（{playoffRace.unavailableReason}）</p>
              ) : (
                <div className="standings-stack">
                  {magicGroups.map((g) => (
                    <div key={g.division}>
                      <h3>{DIVISION_LABELS[g.division]}</h3>
                      <div className="table-scroll">
                        <SortableTable
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
              <p className="page-subtitle">
                マジックナンバーは、自チームの勝利1つ・相手の敗戦1つごとに1減ります（地区1位は地区内で最も勝ち数を伸ばしうる相手、
                地区3位以内はその3番目の相手が基準）。ライバル同士の直接対決や同率時のタイブレークは考慮せず、同率は不利側に数える
                安全側の判定のため、確定・敗退の表示が実際に決まる時点より遅れることがあります。プレーオフはワイルドカード
                （各地区の上位3クラブを除いた20クラブの上位2）を含む進出確定・敗退のみ表示します
              </p>
            </>
          )}

          {wildcardApplicable && (
            <>
              <ConditionTitle
                section
                title="ワイルドカード順位表"
                conditions={composeLabels(standingsConditions, "地区4位以下", "全体順位順")}
              />
              {wildcardStandingsEligible ? (
                <div className="table-scroll">
                  <SortableTable
                    columns={divisionStandingsColumns}
                    rows={wildcardStandingsRows}
                    rowKey={(t) => t.teamId}
                    defaultSortKey="rank"
                    defaultSortDir="asc"
                    linkTo={(t) => `/teams/${t.teamId}`}
                    rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                  />
                </div>
              ) : (
                <p className="empty-message">シーズン終盤（2月のバイウィーク明け以降）に表示されます。</p>
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
              {overallStandingsExpanded && <ConditionLine conditions={composeLabels(standingsConditions, "全クラブ")} />}
              {overallStandingsExpanded && (
                <div className="table-scroll">
                  <SortableTable
                    columns={allStandingsColumns}
                    rows={allStandingsRows}
                    rowKey={(t) => t.teamId}
                    defaultSortKey="rank"
                    defaultSortDir="asc"
                    linkTo={(t) => `/teams/${t.teamId}`}
                    rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                  />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === "h2h" &&
        (h2hLoading ? (
          <p className="loading">読み込み中...</p>
        ) : h2hError ? (
          <p className="error-message">{h2hError}</p>
        ) : !headToHead || headToHead.length === 0 ? (
          <p className="empty-message">データがありません</p>
        ) : (
          <>
            <FilterBar
              axes={[teamMultiAxis({ options: h2hTeamOptions, selected: h2hSelectedTeamIds, onChange: setH2hSelectedTeamIds })]}
              stateKey="standings:h2h"
              onClearAll={() => setH2hSelectedTeamIds(null)}
            />
            {!filteredHeadToHead || filteredHeadToHead.length === 0 ? (
              <p className="empty-message">選択したチームがありません</p>
            ) : (
              <>
              <ConditionTitle title={`${seasonLabel} 星取り表`} conditions={h2hConditions} />
              <HeadToHeadMatrix
                rows={filteredHeadToHead}
                teamColors={teamColors ?? undefined}
                remainingGames={h2hRemainingGames}
              />
              </>
            )}
          </>
        ))}

      {tab === "conditional" && (
        <ConditionalStandingsTable
          season={season}
          teams={teams}
          gameLogsByTeam={gameLogsByTeam}
          gameLogsLoading={gameLogsLoading}
          upcomingGames={schedule?.upcomingGames ?? []}
          teamColors={teamColors ?? undefined}
        />
      )}

      {tab === "rankTrend" && (
        <div>
          <div className="mode-toggle">
            <button type="button" className={isAnimating ? "active" : ""} onClick={playAnimation} disabled={isAnimating}>
              {isAnimating ? "再生中..." : "▶ アニメーション再生"}
            </button>
          </div>
          {divisionGroups.length === 0 ? (
            <StandingsLineChart
              title="順位推移"
              data={rankData}
              teams={teams}
              reversed
              height={720}
              teamColors={teamColors ?? undefined}
              isAnimating={isAnimating}
              conditions={trendConditions}
            />
          ) : (
            <div className="standings-stack">
              {divisionGroups.map((g) => (
                <StandingsLineChart
                  key={g.division}
                  title={`${DIVISION_LABELS[g.division]}順位推移`}
                  data={divisionRankData}
                  teams={g.teams}
                  reversed
                  height={640}
                  teamColors={teamColors ?? undefined}
                  isAnimating={isAnimating}
                  conditions={trendConditions}
                />
              ))}
              {wildcardTeams.length > 0 && (
                <StandingsLineChart
                  title="ワイルドカード順位推移"
                  data={wildcardRankData}
                  teams={wildcardTeams}
                  reversed
                  height={640}
                  teamColors={teamColors ?? undefined}
                  isAnimating={isAnimating}
                  connectGaps={false}
                  rankDomainMax={wildcardRankDomainMax}
                  conditions={wildcardTrendConditions}
                />
              )}
            </div>
          )}
        </div>
      )}

      {tab === "winsTrend" && (
        <div>
          <div className="mode-toggle">
            <button type="button" className={isAnimating ? "active" : ""} onClick={playAnimation} disabled={isAnimating}>
              {isAnimating ? "再生中..." : "▶ アニメーション再生"}
            </button>
          </div>
          {divisionGroups.length === 0 ? (
            <StandingsLineChart
              title="勝ち星推移"
              data={winsData}
              teams={teams}
              height={560}
              teamColors={teamColors ?? undefined}
              isAnimating={isAnimating}
              conditions={trendConditions}
            />
          ) : (
            <div className="standings-stack">
              {divisionGroups.map((g) => (
                <StandingsLineChart
                  key={g.division}
                  title={`${DIVISION_LABELS[g.division]}勝ち星推移`}
                  data={winsData}
                  teams={g.teams}
                  height={520}
                  teamColors={teamColors ?? undefined}
                  isAnimating={isAnimating}
                  conditions={trendConditions}
                />
              ))}
              {wildcardTeams.length > 0 && (
                <StandingsLineChart
                  title="ワイルドカード勝ち星推移"
                  data={wildcardWinsData}
                  teams={wildcardTeams}
                  height={520}
                  teamColors={teamColors ?? undefined}
                  isAnimating={isAnimating}
                  connectGaps={false}
                  conditions={wildcardTrendConditions}
                />
              )}
            </div>
          )}
        </div>
      )}

      {tab === "gamesAboveTrend" && (
        <div>
          <div className="mode-toggle">
            <button type="button" className={isAnimating ? "active" : ""} onClick={playAnimation} disabled={isAnimating}>
              {isAnimating ? "再生中..." : "▶ アニメーション再生"}
            </button>
          </div>
          {divisionGroups.length === 0 ? (
            <StandingsLineChart
              title="貯金推移"
              data={gamesAboveData}
              teams={teams}
              height={560}
              teamColors={teamColors ?? undefined}
              isAnimating={isAnimating}
              conditions={trendConditions}
            />
          ) : (
            <div className="standings-stack">
              {divisionGroups.map((g) => (
                <StandingsLineChart
                  key={g.division}
                  title={`${DIVISION_LABELS[g.division]}貯金推移`}
                  data={gamesAboveData}
                  teams={g.teams}
                  height={520}
                  teamColors={teamColors ?? undefined}
                  isAnimating={isAnimating}
                  conditions={trendConditions}
                />
              ))}
              {wildcardTeams.length > 0 && (
                <StandingsLineChart
                  title="ワイルドカード貯金推移"
                  data={wildcardGamesAboveData}
                  teams={wildcardTeams}
                  height={520}
                  teamColors={teamColors ?? undefined}
                  isAnimating={isAnimating}
                  connectGaps={false}
                  conditions={wildcardTrendConditions}
                />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
