import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { fetchPlayers, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS, TEAM_STAT_DEFS, type StatDef } from "../lib/statDefs";
import { ExportImageButton } from "../components/ExportImageButton";

type Mode = "team" | "player";
type NationalityFilter = "all" | "jp" | "intl";

interface RankedListProps<T> {
  rows: T[];
  def: StatDef<T>;
  rowKey: (row: T) => string;
  name: (row: T) => string;
  subLabel?: (row: T) => string;
  linkTo: (row: T) => string;
}

function RankedList<T>({ rows, def, rowKey, name, subLabel, linkTo }: RankedListProps<T>) {
  const sorted = [...rows].sort((a, b) => def.value(b) - def.value(a));
  return (
    <div className="table-scroll">
      <table className="sortable-table rankings-table">
        <thead>
          <tr>
            <th className="align-right">#</th>
            <th className="align-left">名前</th>
            <th className="align-right">{def.label}</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row, i) => (
            <tr key={rowKey(row)}>
              <td className="align-right rank-cell">{i + 1}</td>
              <td className="align-left">
                <Link to={linkTo(row)} className="cell-link rank-name-cell">
                  <span className="rank-name">{name(row)}</span>
                  {subLabel && <span className="rank-sublabel">{subLabel(row)}</span>}
                </Link>
              </td>
              <td className="align-right rank-value">{def.format(row)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RankingsPage({ season }: { season: string }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("team");
  const [statKey, setStatKey] = useState("pts");
  const [nationalityFilter, setNationalityFilter] = useState<NationalityFilter>("all");

  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const {
    data: players,
    loading: playersLoading,
    error: playersError,
  } = useJsonData(() => fetchPlayers(season), [season]);

  const loading = mode === "team" ? teamsLoading : playersLoading;
  const error = mode === "team" ? teamsError : playersError;

  const defs = mode === "team" ? TEAM_STAT_DEFS : PLAYER_STAT_DEFS;
  const teamDef = TEAM_STAT_DEFS.find((d) => d.key === statKey) ?? TEAM_STAT_DEFS[0]!;
  const playerDef = PLAYER_STAT_DEFS.find((d) => d.key === statKey) ?? PLAYER_STAT_DEFS[0]!;

  const selectMode = (next: Mode) => {
    setMode(next);
    setStatKey("pts");
    setNationalityFilter("all");
  };

  const filteredPlayers = (players ?? []).filter((p) => {
    if (nationalityFilter === "all") return true;
    if (!p.nationality) return false;
    return nationalityFilter === "jp" ? p.nationality === "日本" : p.nationality !== "日本";
  });

  return (
    <div>
      <h1>ランキング</h1>
      <p className="page-subtitle">{season}シーズン・基本スタッツ</p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => selectMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => selectMode("player")}>
          個人
        </button>
      </div>

      {mode === "player" && (
        <div className="mode-toggle">
          <button className={nationalityFilter === "all" ? "active" : ""} onClick={() => setNationalityFilter("all")}>
            すべて
          </button>
          <button className={nationalityFilter === "jp" ? "active" : ""} onClick={() => setNationalityFilter("jp")}>
            日本人選手
          </button>
          <button className={nationalityFilter === "intl" ? "active" : ""} onClick={() => setNationalityFilter("intl")}>
            外国籍選手
          </button>
        </div>
      )}

      <div className="stat-picker">
        {defs.map((d) => (
          <button key={d.key} className={d.key === statKey ? "active" : ""} onClick={() => setStatKey(d.key)}>
            {d.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : error ? (
        <p className="error-message">{error}</p>
      ) : (
        <>
          <ExportImageButton
            targetRef={exportRef}
            filename={`ranking-${mode}-${mode === "team" ? teamDef.key : playerDef.key}.png`}
          />
          <div ref={exportRef} className="export-target">
            {mode === "team" ? (
              <RankedList
                rows={teams ?? []}
                def={teamDef}
                rowKey={(t) => t.teamId}
                name={(t) => t.teamName}
                linkTo={(t) => `/teams/${t.teamId}`}
              />
            ) : (
              <RankedList
                rows={filteredPlayers}
                def={playerDef}
                rowKey={(p) => p.playerId}
                name={(p) => p.name}
                subLabel={(p) => p.teamName}
                linkTo={(p) => `/players/${p.playerId}`}
              />
            )}
          </div>
        </>
      )}
    </div>
  );
}
