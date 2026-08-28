import { fetchPlayers } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import type { PlayerSummary } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { formatDecimal, formatPct } from "../lib/format";

const columns: Column<PlayerSummary>[] = [
  { key: "name", label: "選手", sortValue: (p) => p.name, align: "left" },
  { key: "teamName", label: "チーム", sortValue: (p) => p.teamName, align: "left" },
  { key: "gamesPlayed", label: "試合数", sortValue: (p) => p.gamesPlayed, format: (p) => String(p.gamesPlayed) },
  { key: "min", label: "MIN", sortValue: (p) => p.perGame.min, format: (p) => formatDecimal(p.perGame.min) },
  { key: "pts", label: "PTS", sortValue: (p) => p.perGame.pts, format: (p) => formatDecimal(p.perGame.pts) },
  { key: "reb", label: "REB", sortValue: (p) => p.perGame.reb, format: (p) => formatDecimal(p.perGame.reb) },
  { key: "ast", label: "AST", sortValue: (p) => p.perGame.ast, format: (p) => formatDecimal(p.perGame.ast) },
  { key: "stl", label: "STL", sortValue: (p) => p.perGame.stl, format: (p) => formatDecimal(p.perGame.stl) },
  { key: "blk", label: "BLK", sortValue: (p) => p.perGame.blk, format: (p) => formatDecimal(p.perGame.blk) },
  { key: "tov", label: "TOV", sortValue: (p) => p.perGame.tov, format: (p) => formatDecimal(p.perGame.tov) },
  { key: "fgPct", label: "FG%", sortValue: (p) => p.shooting.fgPct, format: (p) => formatPct(p.shooting.fgPct) },
  { key: "tpPct", label: "3P%", sortValue: (p) => p.shooting.tpPct, format: (p) => formatPct(p.shooting.tpPct) },
  { key: "ftPct", label: "FT%", sortValue: (p) => p.shooting.ftPct, format: (p) => formatPct(p.shooting.ftPct) },
];

export function PlayersListPage({ season }: { season: string }) {
  const { data, loading, error } = useJsonData(() => fetchPlayers(season), [season]);

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!data || data.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <h1>個人スタッツ</h1>
      <p className="page-subtitle">{season}シーズン</p>
      <div className="table-scroll">
        <SortableTable
          columns={columns}
          rows={data}
          rowKey={(p) => p.playerId}
          defaultSortKey="pts"
          linkTo={(p) => `/players/${p.playerId}`}
        />
      </div>
    </div>
  );
}
