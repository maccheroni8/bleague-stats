import { useState } from "react";
import { useParams } from "react-router-dom";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchPlayerGameLogs, fetchPlayers } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import type { PlayerGameLog } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
import {
  computePlayerSituationalStats,
  filterGameLogs,
  isDefaultFilter,
  type SituationalFilter,
} from "../lib/situational";

const gameLogColumns: Column<PlayerGameLog>[] = [
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
  { key: "min", label: "MIN", sortValue: (g) => g.min, format: (g) => formatDecimal(g.min) },
  { key: "pts", label: "PTS", sortValue: (g) => g.pts, format: (g) => String(g.pts) },
  { key: "reb", label: "REB", sortValue: (g) => g.reb, format: (g) => String(g.reb) },
  { key: "ast", label: "AST", sortValue: (g) => g.ast, format: (g) => String(g.ast) },
  { key: "stl", label: "STL", sortValue: (g) => g.stl, format: (g) => String(g.stl) },
  { key: "blk", label: "BLK", sortValue: (g) => g.blk, format: (g) => String(g.blk) },
  { key: "tov", label: "TOV", sortValue: (g) => g.tov, format: (g) => String(g.tov) },
  {
    key: "fg",
    label: "FG",
    sortValue: (g) => g.fgm,
    render: (g) => `${g.fgm}-${g.fga}`,
  },
  {
    key: "tp",
    label: "3P",
    sortValue: (g) => g.tpm,
    render: (g) => `${g.tpm}-${g.tpa}`,
  },
  {
    key: "ft",
    label: "FT",
    sortValue: (g) => g.ftm,
    render: (g) => `${g.ftm}-${g.fta}`,
  },
  {
    key: "plusMinus",
    label: "+/-",
    sortValue: (g) => g.plusMinus,
    format: (g) => formatSigned(g.plusMinus, 0),
  },
];

export function PlayerDetailPage({ season }: { season: string }) {
  const { playerId } = useParams<{ playerId: string }>();
  const {
    data: players,
    loading: playersLoading,
    error: playersError,
  } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: gameLogs, loading: logsLoading } = useJsonData(
    () => (playerId ? fetchPlayerGameLogs(season, playerId) : Promise.resolve([])),
    [season, playerId],
  );
  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;

  const player = players?.find((p) => p.playerId === playerId);
  if (!player) return <p className="error-message">選手が見つかりませんでした</p>;

  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter) : [];
  const situational = isDefaultFilter(filter) ? null : computePlayerSituationalStats(filteredLogs);

  return (
    <div>
      <Link to="/players" className="back-link">
        ← 個人一覧に戻る
      </Link>
      <div className="player-detail-header">
        <PlayerPhoto playerId={player.playerId} size={96} />
        <div>
          <h1>{player.name}</h1>
          <p className="page-subtitle">
            {player.teamName}・{season}シーズン・{player.gamesPlayed}試合出場
          </p>
        </div>
      </div>

      <SituationalFilterPicker filter={filter} onChange={setFilter} />

      {isDefaultFilter(filter) ? (
        <div className="stat-grid">
          <StatTile label="MIN" value={formatDecimal(player.perGame.min)} />
          <StatTile label="PTS" value={formatDecimal(player.perGame.pts)} />
          <StatTile label="REB" value={formatDecimal(player.perGame.reb)} />
          <StatTile label="AST" value={formatDecimal(player.perGame.ast)} />
          <StatTile label="STL" value={formatDecimal(player.perGame.stl)} />
          <StatTile label="BLK" value={formatDecimal(player.perGame.blk)} />
          <StatTile label="TOV" value={formatDecimal(player.perGame.tov)} />
          <StatTile label="+/-" value={formatSigned(player.perGame.plusMinus)} />
          <StatTile label="FG%" value={formatPct(player.shooting.fgPct)} />
          <StatTile label="3P%" value={formatPct(player.shooting.tpPct)} />
          <StatTile label="FT%" value={formatPct(player.shooting.ftPct)} />
          <StatTile label="eFG%" value={formatPct(player.shooting.efgPct)} />
          <StatTile label="TS%" value={formatPct(player.shooting.tsPct)} />
        </div>
      ) : !situational ? (
        <p className="empty-message">該当する試合がありません</p>
      ) : (
        <div className="stat-grid">
          <StatTile label="試合数" value={String(situational.gamesPlayed)} />
          <StatTile label="MIN" value={formatDecimal(situational.perGame.min)} />
          <StatTile label="PTS" value={formatDecimal(situational.perGame.pts)} />
          <StatTile label="REB" value={formatDecimal(situational.perGame.reb)} />
          <StatTile label="AST" value={formatDecimal(situational.perGame.ast)} />
          <StatTile label="STL" value={formatDecimal(situational.perGame.stl)} />
          <StatTile label="BLK" value={formatDecimal(situational.perGame.blk)} />
          <StatTile label="TOV" value={formatDecimal(situational.perGame.tov)} />
          <StatTile label="+/-" value={formatSigned(situational.perGame.plusMinus)} />
          <StatTile label="FG%" value={formatPct(situational.shooting.fgPct)} />
          <StatTile label="3P%" value={formatPct(situational.shooting.tpPct)} />
          <StatTile label="FT%" value={formatPct(situational.shooting.ftPct)} />
          <StatTile label="eFG%" value={formatPct(situational.shooting.efgPct)} />
          <StatTile label="TS%" value={formatPct(situational.shooting.tsPct)} />
        </div>
      )}

      <h2>オンオフコートスタッツ</h2>
      {coverageLoading ? (
        <p className="loading">読み込み中...</p>
      ) : !pbpSupported ? (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      ) : (
        <div className="stat-grid">
          <StatTile label="オンコート+/-" value={formatSigned(player.advanced.onCourtNetPerGame)} />
          <StatTile label="オフコート+/-" value={formatSigned(player.advanced.offCourtNetPerGame)} />
        </div>
      )}

      <h2>試合ログ</h2>
      {logsLoading ? (
        <p className="loading">読み込み中...</p>
      ) : !gameLogs || gameLogs.length === 0 ? (
        <p className="empty-message">試合ログがありません</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            columns={gameLogColumns}
            rows={gameLogs}
            rowKey={(g) => g.scheduleKey}
            defaultSortKey="date"
            linkTo={(g) => `/games/${g.scheduleKey}`}
          />
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
