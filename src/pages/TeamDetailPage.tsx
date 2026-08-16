import { useState } from "react";
import { useParams } from "react-router-dom";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchPlayers, fetchTeamGameLogs, fetchTeamLineups, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import type { PlayerSummary, TeamGameLog } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { TeamLogo } from "../components/TeamLogo";
import { formatDecimal, formatPct, formatRecord, formatSigned } from "../lib/format";
import { computeTeamSituationalStats, filterGameLogs, isDefaultFilter, type SituationalFilter } from "../lib/situational";

// 出場時間がこれ未満のラインナップはサンプルが小さすぎてノイズが大きいため一覧から除外する
// （実データ確認: 4試合時点で3分(180秒)基準だとチームあたり4〜14組が該当。DESIGN.md参照）
const MIN_LINEUP_SECONDS = 180;
const MAX_LINEUP_ROWS = 10;

function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function calculateAge(birthDate: string, asOf: Date = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = asOf.getFullYear() - y;
  const hadBirthdayThisYear = asOf.getMonth() + 1 > m || (asOf.getMonth() + 1 === m && asOf.getDate() >= d);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

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
  const { data: lineupsFile } = useJsonData(
    () => (teamId ? fetchTeamLineups(season, teamId) : Promise.resolve(null)),
    [season, teamId],
  );
  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  if (teamsLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;

  const team = teams?.find((t) => t.teamId === teamId);
  if (!team) return <p className="error-message">チームが見つかりませんでした</p>;

  const teamPlayers = (players ?? []).filter((p) => p.teamId === teamId);

  // 「スタメン選手」は現状このアプリに現在の先発5人という概念が無いため、シーズン中に
  // 1度でも先発出場した選手（gamesStarted > 0）を近似として使う
  const starters = teamPlayers.filter((p) => p.gamesStarted > 0);
  const avgHeightCm = averageOf(starters.flatMap((p) => (p.heightCm != null ? [p.heightCm] : [])));
  const avgWeightKg = averageOf(starters.flatMap((p) => (p.weightKg != null ? [p.weightKg] : [])));
  const avgAge = averageOf(starters.flatMap((p) => (p.birthDate ? [calculateAge(p.birthDate)] : [])));

  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter) : [];
  const situational = isDefaultFilter(filter) ? null : computeTeamSituationalStats(filteredLogs);

  const playerNameById = new Map((players ?? []).map((p) => [p.playerId, p.name]));
  const topLineups = (lineupsFile?.lineups ?? [])
    .filter((l) => l.secondsPlayed >= MIN_LINEUP_SECONDS)
    .slice(0, MAX_LINEUP_ROWS);

  return (
    <div>
      <Link to="/teams" className="back-link">
        ← チーム一覧に戻る
      </Link>
      <h1 className="team-detail-heading">
        <TeamLogo teamId={team.teamId} size={36} />
        {team.teamName}
      </h1>
      <p className="page-subtitle">
        {season}シーズン・{formatRecord(team.wins, team.losses)}
      </p>

      <SituationalFilterPicker filter={filter} onChange={setFilter} />

      {isDefaultFilter(filter) ? (
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
      ) : !situational ? (
        <p className="empty-message">該当する試合がありません</p>
      ) : (
        <div className="stat-grid">
          <StatTile label="試合数" value={String(situational.gamesPlayed)} />
          <StatTile label="得点" value={formatDecimal(situational.perGame.pts)} />
          <StatTile label="失点" value={formatDecimal(situational.perGame.oppPts)} />
          <StatTile label="Net" value={formatSigned(situational.perGame.net)} />
          <StatTile label="REB" value={formatDecimal(situational.perGame.reb)} />
          <StatTile label="AST" value={formatDecimal(situational.perGame.ast)} />
          <StatTile label="STL" value={formatDecimal(situational.perGame.stl)} />
          <StatTile label="BLK" value={formatDecimal(situational.perGame.blk)} />
          <StatTile label="TOV" value={formatDecimal(situational.perGame.tov)} />
          <StatTile label="FG%" value={formatPct(situational.shooting.fgPct)} />
          <StatTile label="3P%" value={formatPct(situational.shooting.tpPct)} />
          <StatTile label="FT%" value={formatPct(situational.shooting.ftPct)} />
          <StatTile label="eFG%" value={formatPct(situational.shooting.efgPct)} />
          <StatTile label="TS%" value={formatPct(situational.shooting.tsPct)} />
          <StatTile label="PACE" value={formatDecimal(situational.advanced.pace)} />
          <StatTile label="ORtg" value={formatDecimal(situational.advanced.offRtg)} />
          <StatTile label="DRtg" value={formatDecimal(situational.advanced.defRtg)} />
          <StatTile label="NetRtg" value={formatSigned(situational.advanced.netRtg)} />
        </div>
      )}

      {(avgHeightCm != null || avgWeightKg != null || avgAge != null) && (
        <>
          <h2>スタメン平均（先発出場経験のある選手）</h2>
          <div className="stat-grid">
            <StatTile label="平均身長" value={avgHeightCm != null ? `${formatDecimal(avgHeightCm)}cm` : "-"} />
            <StatTile label="平均体重" value={avgWeightKg != null ? `${formatDecimal(avgWeightKg)}kg` : "-"} />
            <StatTile label="平均年齢" value={avgAge != null ? `${formatDecimal(avgAge)}歳` : "-"} />
          </div>
        </>
      )}

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

      <h2>よく使われるラインナップ</h2>
      {coverageLoading ? (
        <p className="loading">読み込み中...</p>
      ) : !pbpSupported ? (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      ) : topLineups.length === 0 ? (
        <p className="empty-message">
          {(lineupsFile?.lineups.length ?? 0) === 0
            ? "ラインナップデータがありません"
            : `出場時間${MIN_LINEUP_SECONDS}秒以上の組み合わせがまだありません（試合数が増えると表示されます）`}
        </p>
      ) : (
        <>
          <div className="table-scroll">
            <table className="sortable-table">
              <thead>
                <tr>
                  <th className="align-left">5人の組み合わせ</th>
                  <th className="align-right">試合数</th>
                  <th className="align-right">出場時間</th>
                  <th className="align-right">得失点差</th>
                  <th className="align-right">Net Rating（推定）</th>
                </tr>
              </thead>
              <tbody>
                {topLineups.map((l) => (
                  <tr key={l.lineupKey}>
                    <td className="align-left">{l.playerIds.map((id) => playerNameById.get(id) ?? id).join(" / ")}</td>
                    <td className="align-right">{l.gamesPlayed}</td>
                    <td className="align-right">{formatDecimal(l.secondsPlayed / 60)}分</td>
                    <td className="align-right">{formatSigned(l.netPoints, 0)}</td>
                    <td className="align-right">{formatSigned(l.estimatedNetRtg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="page-subtitle">
            出場時間{MIN_LINEUP_SECONDS}秒未満の組み合わせは除外・上位{MAX_LINEUP_ROWS}組まで表示。Net
            Ratingはスティント単位の実ポゼッション数が無いため、チームのシーズン平均ペースから推定した参考値。
            試合数がまだ少ないため、いずれの数値もサンプルサイズが小さい点に留意
          </p>
        </>
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
    render: (g) => (
      <>
        {g.isHome ? "vs" : "@"} {g.opponentTeamName}
        {g.gameType === "playoff" && <span className="playoff-badge">PO</span>}
      </>
    ),
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
