import { useState } from "react";
import { fetchHeadToHead, fetchStandingsHistory, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { SortableTable, type Column } from "../components/SortableTable";
import { StandingsLineChart } from "../components/StandingsLineChart";
import { HeadToHeadMatrix } from "../components/HeadToHeadMatrix";
import { formatDecimal, formatPct, formatRecord, formatSigned } from "../lib/format";
import type { StandingsSnapshot, StandingsTeamSnapshot } from "../../shared/types";

type View = "standings" | "h2h";

const divisionStandingsColumns: Column<StandingsTeamSnapshot>[] = [
  {
    key: "divisionRank",
    label: "順位",
    sortValue: (t) => t.divisionRank ?? 0,
    format: (t) => String(t.divisionRank ?? "-"),
  },
  { key: "teamName", label: "チーム", sortValue: (t) => t.teamName, align: "left" },
  {
    key: "record",
    label: "勝敗",
    sortValue: (t) => t.wins - t.losses,
    render: (t) => formatRecord(t.wins, t.losses),
  },
  { key: "winPct", label: "勝率", sortValue: (t) => t.winPct, format: (t) => formatPct(t.winPct) },
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
];

function reshape(history: StandingsSnapshot[], metric: (t: StandingsTeamSnapshot) => number) {
  return history.map((snapshot) => {
    const row: Record<string, number | string> = { date: snapshot.date };
    for (const t of snapshot.teams) row[t.teamId] = metric(t);
    return row;
  });
}

export function StandingsPage({ season }: { season: string }) {
  const [view, setView] = useState<View>("standings");
  const { data: history, loading, error } = useJsonData(() => fetchStandingsHistory(season), [season]);
  const {
    data: headToHead,
    loading: h2hLoading,
    error: h2hError,
  } = useJsonData(() => fetchHeadToHead(season), [season]);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!history || history.length === 0) return <p className="empty-message">データがありません</p>;

  const latest = history[history.length - 1]!;
  const teams = latest.teams;
  const eastTeams = teams.filter((t) => t.division === "east");
  const westTeams = teams.filter((t) => t.division === "west");

  const rankData = reshape(history, (t) => t.rank);
  const winsData = reshape(history, (t) => t.wins);
  const gamesAboveData = reshape(history, (t) => t.wins - t.losses);

  return (
    <div>
      <h1>順位表</h1>
      <p className="page-subtitle">{season}シーズン・{latest.date}時点</p>

      <div className="mode-toggle">
        <button className={view === "standings" ? "active" : ""} onClick={() => setView("standings")}>
          順位表
        </button>
        <button className={view === "h2h" ? "active" : ""} onClick={() => setView("h2h")}>
          星取り表
        </button>
      </div>

      {view === "standings" ? (
        <>
          <div className="standings-grid">
            <div>
              <h2>東地区</h2>
              <div className="table-scroll">
                <SortableTable
                  columns={divisionStandingsColumns}
                  rows={eastTeams}
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
                  rows={westTeams}
                  rowKey={(t) => t.teamId}
                  defaultSortKey="divisionRank"
                  defaultSortDir="asc"
                  linkTo={(t) => `/teams/${t.teamId}`}
                  rowAccentColor={(t) => teamColors?.[t.teamId]?.primary}
                />
              </div>
            </div>
          </div>

          <h2>順位・勝敗の推移</h2>
          <StandingsLineChart title="順位推移" data={rankData} teams={teams} reversed height={360} />
          <div className="standings-grid">
            <StandingsLineChart title="勝ち星推移" data={winsData} teams={teams} height={280} />
            <StandingsLineChart title="貯金推移" data={gamesAboveData} teams={teams} height={280} />
          </div>
        </>
      ) : h2hLoading ? (
        <p className="loading">読み込み中...</p>
      ) : h2hError ? (
        <p className="error-message">{h2hError}</p>
      ) : !headToHead || headToHead.length === 0 ? (
        <p className="empty-message">データがありません</p>
      ) : (
        <HeadToHeadMatrix rows={headToHead} teamColors={teamColors ?? undefined} />
      )}
    </div>
  );
}
