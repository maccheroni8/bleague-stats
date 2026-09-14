import { useEffect, useState } from "react";
import { fetchHeadToHead, fetchSchedule, fetchStandingsHistory, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import { SortableTable, type Column } from "../components/SortableTable";
import { StandingsLineChart } from "../components/StandingsLineChart";
import { HeadToHeadMatrix } from "../components/HeadToHeadMatrix";
import { TeamFilterBlock } from "../components/TeamFilterBlock";
import { ConditionalStandingsTable } from "../components/ConditionalStandingsTable";
import { formatDecimal, formatPct, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak, type TeamStreak } from "../../shared/teamRecords";
import { teamShortName } from "../../shared/teamNames";
import { DIVISION_LABELS, groupByDivision } from "../lib/divisionGroups";
import type {
  HeadToHeadTeamRow,
  StandingsSnapshot,
  StandingsTeamSnapshot,
  TeamGameLog,
  UpcomingGameEntry,
} from "../../shared/types";

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

/**
 * ワイルドカード争いのチーム群（地区上位3位以内に入っていないチーム）を求める。
 * ConditionalStandingsTable.tsxのcomputePlayoffQualifiedTeamIds()と同じく、東西2地区制
 * （東西2地区が既知）のシーズンのみ対象とする（プレーオフ進出条件が他の地区数では未確認のため）
 */
function computeWildcardPoolTeamIds(teams: StandingsTeamSnapshot[]): Set<string> | null {
  const divisions = new Set(teams.map((t) => t.division).filter((d): d is "east" | "west" => !!d));
  if (divisions.size !== 2 || !divisions.has("east") || !divisions.has("west")) return null;
  return new Set(teams.filter((t) => (t.divisionRank ?? 99) > 3).map((t) => t.teamId));
}

/**
 * ワイルドカード争いの「相対順位」推移を求める。日付ごとに、poolTeamIds内のチームだけを
 * 全体順位(rank)昇順に並べ直し、その順位（1始まり）を割り当てる。プールに属さない日は
 * その日の値を持たない（=グラフ上は前後の点をそのまま繋ぐ、StandingsLineChartのconnectNulls）
 */
function reshapeWildcardRank(history: StandingsSnapshot[], poolTeamIds: Set<string>) {
  return history.map((snapshot) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    const poolTeamsAtDate = snapshot.teams.filter((t) => poolTeamIds.has(t.teamId)).sort((a, b) => a.rank - b.rank);
    poolTeamsAtDate.forEach((t, i) => {
      row[t.teamId] = i + 1;
    });
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

  // null = 全チーム選択（絞り込みなし）。個別に外したチームだけをSetで管理する（SchedulePageと同じパターン）
  const [h2hSelectedTeamIds, setH2hSelectedTeamIds] = useState<Set<string> | null>(null);
  const [h2hFilterExpanded, setH2hFilterExpanded] = useState(false);

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
    const timer = setTimeout(() => setAnimFrame((f) => (f ?? 0) + 1), 90);
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

  const visibleHistory = animFrame !== null ? history.slice(0, animFrame) : history;
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

  const h2hTeamIdByName = headToHead ? new Map(headToHead.map((r) => [r.teamName, r.teamId])) : null;
  const h2hRemainingGames =
    headToHead && schedule && h2hTeamIdByName
      ? buildH2hRemainingGames(schedule.upcomingGames, h2hTeamIdByName)
      : undefined;
  const h2hTeamOptions: { teamId: string; teamName: string }[] = headToHead
    ? [...headToHead]
        .map((r: HeadToHeadTeamRow) => ({ teamId: r.teamId, teamName: r.teamName }))
        .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja"))
    : [];
  const filteredHeadToHead =
    headToHead && h2hSelectedTeamIds ? headToHead.filter((r) => h2hSelectedTeamIds.has(r.teamId)) : headToHead;
  const toggleH2hTeam = (teamId: string) => {
    setH2hSelectedTeamIds((prev) => {
      const base = prev ?? new Set(h2hTeamOptions.map((t) => t.teamId));
      const next = new Set(base);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  const rankData = reshape(visibleHistory, (t) => t.rank);
  const winsData = reshape(visibleHistory, (t) => t.wins);
  const gamesAboveData = reshape(visibleHistory, (t) => t.wins - t.losses);
  const divisionRankData = reshape(visibleHistory, (t) => t.divisionRank ?? NaN);

  const divisionGroups = groupByDivision(teams);
  const wildcardPoolIds = computeWildcardPoolTeamIds(teams);
  const wildcardTeams = wildcardPoolIds ? teams.filter((t) => wildcardPoolIds.has(t.teamId)) : [];
  const wildcardRankData = wildcardPoolIds ? reshapeWildcardRank(visibleHistory, wildcardPoolIds) : [];

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
          <>
            <TeamFilterBlock
              options={h2hTeamOptions}
              selected={h2hSelectedTeamIds}
              expanded={h2hFilterExpanded}
              onToggleExpanded={() => setH2hFilterExpanded((v) => !v)}
              onToggle={toggleH2hTeam}
              onSelectAll={() => setH2hSelectedTeamIds(null)}
              onSelectNone={() => setH2hSelectedTeamIds(new Set())}
            />
            {!filteredHeadToHead || filteredHeadToHead.length === 0 ? (
              <p className="empty-message">選択したチームがありません</p>
            ) : (
              <HeadToHeadMatrix
                rows={filteredHeadToHead}
                teamColors={teamColors ?? undefined}
                remainingGames={h2hRemainingGames}
              />
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
              height={360}
              teamColors={teamColors ?? undefined}
            />
          ) : (
            <div className="standings-grid">
              {divisionGroups.map((g) => (
                <StandingsLineChart
                  key={g.division}
                  title={`${DIVISION_LABELS[g.division]}順位推移`}
                  data={divisionRankData}
                  teams={g.teams}
                  reversed
                  height={320}
                  teamColors={teamColors ?? undefined}
                />
              ))}
              {wildcardTeams.length > 0 && (
                <StandingsLineChart
                  title="ワイルドカード順位推移"
                  data={wildcardRankData}
                  teams={wildcardTeams}
                  reversed
                  height={320}
                  teamColors={teamColors ?? undefined}
                />
              )}
            </div>
          )}
        </div>
      )}

      {tab === "recordTrend" && (
        <div>
          <div className="mode-toggle">
            <button type="button" className={isAnimating ? "active" : ""} onClick={playAnimation} disabled={isAnimating}>
              {isAnimating ? "再生中..." : "▶ アニメーション再生"}
            </button>
          </div>
          {divisionGroups.length === 0 ? (
            <div className="standings-grid">
              <StandingsLineChart title="勝ち星推移" data={winsData} teams={teams} height={280} teamColors={teamColors ?? undefined} />
              <StandingsLineChart title="貯金推移" data={gamesAboveData} teams={teams} height={280} teamColors={teamColors ?? undefined} />
            </div>
          ) : (
            <>
              {divisionGroups.map((g) => (
                <div key={g.division}>
                  <h2>{DIVISION_LABELS[g.division]}</h2>
                  <div className="standings-grid">
                    <StandingsLineChart
                      title="勝ち星推移"
                      data={winsData}
                      teams={g.teams}
                      height={260}
                      teamColors={teamColors ?? undefined}
                    />
                    <StandingsLineChart
                      title="貯金推移"
                      data={gamesAboveData}
                      teams={g.teams}
                      height={260}
                      teamColors={teamColors ?? undefined}
                    />
                  </div>
                </div>
              ))}
              {wildcardTeams.length > 0 && (
                <div>
                  <h2>ワイルドカード</h2>
                  <div className="standings-grid">
                    <StandingsLineChart
                      title="勝ち星推移"
                      data={winsData}
                      teams={wildcardTeams}
                      height={260}
                      teamColors={teamColors ?? undefined}
                    />
                    <StandingsLineChart
                      title="貯金推移"
                      data={gamesAboveData}
                      teams={wildcardTeams}
                      height={260}
                      teamColors={teamColors ?? undefined}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
