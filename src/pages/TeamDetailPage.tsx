import { Link, useParams } from "react-router-dom";
import { fetchPlayers, fetchTeamGameLogs, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import type { PlayerSummary, TeamGameLog } from "../lib/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { formatDecimal, formatPct, formatRecord, formatSigned } from "../lib/format";

const playerColumns: Column<PlayerSummary>[] = [
  { key: "name", label: "選手", sortValue: (p) => p.name, align: "left" },
  { key: "gamesPlayed", label: "試合数", sortValue: (p) => p.gamesPlayed, format: (p) => String(p.gamesPlayed) },
  { key: "min", label: "MIN", sortValue: (p) => p.perGame.min, format: (p) => formatDecimal(p.perGame.min) },
  { key: "pts", label: "PTS", sortValue: (p) => p.perGame.pts, format: (p) => formatDecimal(p.perGame.pts) },
  { key: "reb", label: "REB", sortValue: (p) => p.perGame.reb, format: (p) => formatDecimal(p.perGame.reb) },
  { key: "ast", label: "AST", sortValue: (p) => p.perGame.ast, format: (p) => formatDecimal(p.perGame.ast) },
  { key: "stl", label: "STL", sortValue: (p) => p.perGame.stl, format: (p) => formatDecimal(p.perGame.stl) },
  { key: "blk", label: "BLK", sortValue: (p) => p.perGame.blk, format: (p) => formatDecimal(p.perGame.blk) },
  { key: "fgPct", label: "FG%", sortValue: (p) => p.shooting.fgPct, format: (p) => formatPct(p.shooting.fgPct) },
  { key: "tpPct", label: "3P%", sortValue: (p) => p.shooting.tpPct, format: (p) => formatPct(p.shooting.tpPct) },
];

export function TeamDetailPage({ season }: { season: string }) {
  const { teamId } = useParams<{ teamId: string }>();
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const { data: players, loading: playersLoading } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: gameLogs, loading: gameLogsLoading } = useJsonData(
    () => (teamId ? fetchTeamGameLogs(season, teamId) : Promise.resolve([])),
    [season, teamId],
  );

  if (teamsLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;

  const team = teams?.find((t) => t.teamId === teamId);
  if (!team) return <p className="error-message">チームが見つかりませんでした</p>;

  const teamPlayers = (players ?? []).filter((p) => p.teamId === teamId);

  return (
    <div>
      <Link to="/teams" className="back-link">
        ← チーム一覧に戻る
      </Link>
      <h1>{team.teamName}</h1>
      <p className="page-subtitle">
        {season}シーズン・{formatRecord(team.wins, team.losses)}
      </p>

      <div className="stat-grid">
        <StatTile label="得点" value={formatDecimal(team.perGame.pts)} />
        <StatTile label="失点" value={formatDecimal(team.opponentPerGame.pts)} />
        <StatTile label="Net" value={formatSigned(team.netPerGame.pts)} />
        <StatTile label="REB" value={formatDecimal(team.perGame.reb)} />
        <StatTile label="AST" value={formatDecimal(team.perGame.ast)} />
        <StatTile label="STL" value={formatDecimal(team.perGame.stl)} />
        <StatTile label="BLK" value={formatDecimal(team.perGame.blk)} />
        <StatTile label="TOV" value={formatDecimal(team.perGame.tov)} />
        <StatTile label="FG%" value={formatPct(team.shooting.fgPct)} />
        <StatTile label="3P%" value={formatPct(team.shooting.tpPct)} />
        <StatTile label="FT%" value={formatPct(team.shooting.ftPct)} />
        <StatTile label="eFG%" value={formatPct(team.shooting.efgPct)} />
        <StatTile label="TS%" value={formatPct(team.shooting.tsPct)} />
      </div>

      <h2>個人スタッツ</h2>
      {teamPlayers.length === 0 ? (
        <p className="empty-message">このチームの選手データがありません</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            columns={playerColumns}
            rows={teamPlayers}
            rowKey={(p) => p.playerId}
            defaultSortKey="pts"
            linkTo={(p) => `/players/${p.playerId}`}
          />
        </div>
      )}

      <h2>試合結果</h2>
      {gameLogsLoading ? (
        <p className="loading">読み込み中...</p>
      ) : !gameLogs || gameLogs.length === 0 ? (
        <p className="empty-message">試合結果がありません</p>
      ) : (
        <div className="table-scroll recent-games-table">
          <SortableTable columns={gameLogColumns} rows={gameLogs} rowKey={(g) => g.scheduleKey} defaultSortKey="date" linkTo={(g) => `/games/${g.scheduleKey}`} />
        </div>
      )}
    </div>
  );
}

const gameLogColumns: Column<TeamGameLog>[] = [
  { key: "date", label: "日付", sortValue: (g) => g.date, align: "left" },
  {
    key: "opponent",
    label: "対戦相手",
    sortValue: (g) => g.opponentTeamName,
    align: "left",
    render: (g) => `${g.isHome ? "vs" : "@"} ${g.opponentTeamName}`,
  },
  {
    key: "result",
    label: "結果",
    sortValue: (g) => (g.win ? 1 : 0),
    render: (g) => <span className={`result-badge ${g.win ? "win" : "loss"}`}>{g.win ? "W" : "L"}</span>,
  },
  {
    key: "score",
    label: "スコア",
    sortValue: (g) => g.teamScore,
    render: (g) => `${g.teamScore}-${g.opponentScore}`,
  },
];

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
