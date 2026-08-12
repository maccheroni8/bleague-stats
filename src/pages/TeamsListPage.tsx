import { fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import type { TeamSummary } from "../lib/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { formatDecimal, formatPct, formatRecord, formatSigned } from "../lib/format";

const columns: Column<TeamSummary>[] = [
  { key: "teamName", label: "チーム", sortValue: (t) => t.teamName, align: "left" },
  {
    key: "record",
    label: "勝敗",
    sortValue: (t) => t.wins - t.losses,
    render: (t) => formatRecord(t.wins, t.losses),
  },
  { key: "pts", label: "得点", sortValue: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts) },
  {
    key: "oppPts",
    label: "失点",
    sortValue: (t) => t.opponentPerGame.pts,
    format: (t) => formatDecimal(t.opponentPerGame.pts),
  },
  { key: "net", label: "Net", sortValue: (t) => t.netPerGame.pts, format: (t) => formatSigned(t.netPerGame.pts) },
  { key: "reb", label: "REB", sortValue: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb) },
  { key: "ast", label: "AST", sortValue: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast) },
  { key: "stl", label: "STL", sortValue: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl) },
  { key: "blk", label: "BLK", sortValue: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk) },
  { key: "tov", label: "TOV", sortValue: (t) => t.perGame.tov, format: (t) => formatDecimal(t.perGame.tov) },
  { key: "fgPct", label: "FG%", sortValue: (t) => t.shooting.fgPct, format: (t) => formatPct(t.shooting.fgPct) },
  { key: "tpPct", label: "3P%", sortValue: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct) },
  { key: "ftPct", label: "FT%", sortValue: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct) },
];

export function TeamsListPage({ season }: { season: string }) {
  const { data, loading, error } = useJsonData(() => fetchTeams(season), [season]);

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!data || data.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <h1>チームスタッツ</h1>
      <p className="page-subtitle">{season}シーズン</p>
      <div className="table-scroll">
        <SortableTable
          columns={columns}
          rows={data}
          rowKey={(t) => t.teamId}
          defaultSortKey="pts"
          linkTo={(t) => `/teams/${t.teamId}`}
        />
      </div>
    </div>
  );
}
