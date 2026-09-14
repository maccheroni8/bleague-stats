import { useState } from "react";
import { fetchHeadToHead, fetchSchedule, fetchStandingsHistory, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import { SortableTable, type Column } from "../components/SortableTable";
import { StandingsLineChart } from "../components/StandingsLineChart";
import { HeadToHeadMatrix } from "../components/HeadToHeadMatrix";
import { formatDecimal, formatPct, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak, type TeamStreak } from "../../shared/teamRecords";
import type { StandingsSnapshot, StandingsTeamSnapshot, TeamGameLog, UpcomingGameEntry } from "../../shared/types";

type StandingsTab = "standings" | "h2h" | "conditional" | "rankTrend" | "recordTrend";

const TAB_LABELS: Record<StandingsTab, string> = {
  standings: "順位表",
  h2h: "星取り表",
  conditional: "条件別順位表",
  rankTrend: "順位推移",
  recordTrend: "勝ち星推移・貯金推移",
};

interface WinLossRecord {
  wins: number;
  losses: number;
}

/** ホーム/アウェー成績・直近5試合・連勝連敗・試合消化率の元になる、地区別テーブル1行分の付加情報 */
interface StandingsRow extends StandingsTeamSnapshot {
  homeRecord: WinLossRecord | null;
  awayRecord: WinLossRecord | null;
  last5: WinLossRecord | null;
  streak: TeamStreak | null;
  /** 消化済み試合数 / (消化済み+未消化) の割合（0〜1）。schedule.json未取得ならnull */
  completionRate: number | null;
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

/** ホーム/アウェー成績・直近5試合・連勝連敗は、いずれも順位表本体と同じくレギュラーシーズンのみを対象にする */
function buildStandingsRow(
  team: StandingsTeamSnapshot,
  logs: TeamGameLog[] | undefined,
  upcomingCount: number | undefined,
): StandingsRow {
  const gamesPlayed = team.wins + team.losses;
  const completionRate = upcomingCount === undefined ? null : safeDiv(gamesPlayed, gamesPlayed + upcomingCount);
  if (!logs) {
    return { ...team, homeRecord: null, awayRecord: null, last5: null, streak: null, completionRate };
  }
  const regular = regularSeasonLogs(logs);
  return {
    ...team,
    homeRecord: recordFrom(regular.filter((l) => l.isHome)),
    awayRecord: recordFrom(regular.filter((l) => !l.isHome)),
    last5: recordFrom(sortedByDate(regular).slice(-5)),
    streak: currentStreak(regular),
    completionRate,
  };
}

function formatOptionalRecord(record: WinLossRecord | null): string {
  return record ? formatRecord(record.wins, record.losses) : "-";
}

const divisionStandingsColumns: Column<StandingsRow>[] = [
  {
    key: "divisionRank",
    label: "地区順位",
    sortValue: (t) => t.divisionRank ?? 0,
    format: (t) => String(t.divisionRank ?? "-"),
  },
  { key: "rank", label: "全体順位", sortValue: (t) => t.rank, format: (t) => String(t.rank) },
  { key: "teamName", label: "チーム", sortValue: (t) => t.teamName, align: "left" },
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
    sortValue: (t) => (t.last5 ? t.last5.wins - t.last5.losses : 0),
    format: (t) => formatOptionalRecord(t.last5),
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

function reshape(history: StandingsSnapshot[], metric: (t: StandingsTeamSnapshot) => number) {
  return history.map((snapshot) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    for (const t of snapshot.teams) row[t.teamId] = metric(t);
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

  const latest = history && history.length > 0 ? history[history.length - 1]! : null;
  const { gameLogsByTeam } = useAllTeamGameLogs(season, latest?.teams ?? null);

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!history || history.length === 0 || !latest) return <p className="empty-message">データがありません</p>;

  const teams = latest.teams;
  const upcomingCountByTeamName = schedule ? countUpcomingGamesByTeamName(schedule.upcomingGames) : null;
  const rowFor = (t: StandingsTeamSnapshot) =>
    buildStandingsRow(
      t,
      gameLogsByTeam?.get(t.teamId),
      upcomingCountByTeamName ? (upcomingCountByTeamName.get(t.teamName) ?? 0) : undefined,
    );
  const eastRows = teams.filter((t) => t.division === "east").map(rowFor);
  const westRows = teams.filter((t) => t.division === "west").map(rowFor);

  const rankData = reshape(history, (t) => t.rank);
  const winsData = reshape(history, (t) => t.wins);
  const gamesAboveData = reshape(history, (t) => t.wins - t.losses);

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
        <div className="standings-grid">
          <div>
            <h2>東地区</h2>
            <div className="table-scroll">
              <SortableTable
                columns={divisionStandingsColumns}
                rows={eastRows}
                rowKey={(t) => t.teamId}
                defaultSortKey="divisionRank"
                defaultSortDir="asc"
                linkTo={(t) => `/teams/${t.teamId}`}
                rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
              />
            </div>
          </div>
          <div>
            <h2>西地区</h2>
            <div className="table-scroll">
              <SortableTable
                columns={divisionStandingsColumns}
                rows={westRows}
                rowKey={(t) => t.teamId}
                defaultSortKey="divisionRank"
                defaultSortDir="asc"
                linkTo={(t) => `/teams/${t.teamId}`}
                rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
              />
            </div>
          </div>
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
          <HeadToHeadMatrix rows={headToHead} teamColors={teamColors ?? undefined} />
        ))}

      {tab === "conditional" && <p className="empty-message">この機能は準備中です。</p>}

      {tab === "rankTrend" && <StandingsLineChart title="順位推移" data={rankData} teams={teams} reversed height={360} />}

      {tab === "recordTrend" && (
        <div className="standings-grid">
          <StandingsLineChart title="勝ち星推移" data={winsData} teams={teams} height={280} />
          <StandingsLineChart title="貯金推移" data={gamesAboveData} teams={teams} height={280} />
        </div>
      )}
    </div>
  );
}
