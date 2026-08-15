import { useRef, useState } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchPlayers, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS, TEAM_STAT_DEFS, type StatDef } from "../lib/statDefs";
import type { PlayerSummary, TeamSummary } from "../../shared/types";
import { ExportImageButton } from "../components/ExportImageButton";

type Mode = "team" | "player";
const SLOT_COUNT = 3;

interface ComparisonTableProps<T> {
  rows: T[];
  defs: StatDef<T>[];
  rowKey: (row: T) => string;
  name: (row: T) => string;
  linkTo: (row: T) => string;
}

function ComparisonTable<T>({ rows, defs, rowKey, name, linkTo }: ComparisonTableProps<T>) {
  if (rows.length === 0) {
    return <p className="empty-message">比較する項目を選んでください</p>;
  }
  return (
    <div className="table-scroll">
      <table className="sortable-table compare-table">
        <thead>
          <tr>
            <th className="align-left">項目</th>
            {rows.map((row) => (
              <th key={rowKey(row)} className="align-right">
                <Link to={linkTo(row)} className="cell-link">
                  {name(row)}
                </Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {defs.map((def) => {
            const values = rows.map((row) => def.value(row));
            const best = def.higherIsBetter === false ? Math.min(...values) : Math.max(...values);
            return (
              <tr key={def.key}>
                <td className="align-left">{def.label}</td>
                {rows.map((row, i) => (
                  <td
                    key={rowKey(row)}
                    className={`align-right${rows.length > 1 && values[i] === best ? " compare-best" : ""}`}
                  >
                    {def.format(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function useSlotSelection(defaultIds: string[]) {
  const [overrides, setOverrides] = useState<(string | null)[]>(Array(SLOT_COUNT).fill(null));
  const ids = Array.from({ length: SLOT_COUNT }, (_, i) => overrides[i] ?? defaultIds[i] ?? "");
  const setSlot = (index: number, id: string) => {
    setOverrides((prev) => {
      const next = [...prev];
      next[index] = id;
      return next;
    });
  };
  return { ids, setSlot };
}

export function ComparePage({ season }: { season: string }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>("team");

  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const {
    data: players,
    loading: playersLoading,
    error: playersError,
  } = useJsonData(() => fetchPlayers(season), [season]);

  const teamSelection = useSlotSelection((teams ?? []).slice(0, 2).map((t) => t.teamId));
  const playerSelection = useSlotSelection((players ?? []).slice(0, 2).map((p) => p.playerId));

  const loading = mode === "team" ? teamsLoading : playersLoading;
  const error = mode === "team" ? teamsError : playersError;

  const selectedTeams = teamSelection.ids
    .map((id) => teams?.find((t) => t.teamId === id))
    .filter((t): t is TeamSummary => Boolean(t));
  const selectedPlayers = playerSelection.ids
    .map((id) => players?.find((p) => p.playerId === id))
    .filter((p): p is PlayerSummary => Boolean(p));

  return (
    <div>
      <h1>比較</h1>
      <p className="page-subtitle">{season}シーズン・最大3件まで選んで比較</p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
          個人
        </button>
      </div>

      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : error ? (
        <p className="error-message">{error}</p>
      ) : mode === "team" ? (
        <>
          <div className="compare-slots">
            {teamSelection.ids.map((id, i) => (
              <select key={i} value={id} onChange={(e) => teamSelection.setSlot(i, e.target.value)}>
                <option value="">未選択</option>
                {(teams ?? []).map((t) => (
                  <option key={t.teamId} value={t.teamId}>
                    {t.teamName}
                  </option>
                ))}
              </select>
            ))}
          </div>
          <ExportImageButton targetRef={exportRef} filename="compare-teams.png" />
          <div ref={exportRef} className="export-target">
            <ComparisonTable
              rows={selectedTeams}
              defs={TEAM_STAT_DEFS}
              rowKey={(t) => t.teamId}
              name={(t) => t.teamName}
              linkTo={(t) => `/teams/${t.teamId}`}
            />
          </div>
        </>
      ) : (
        <>
          <div className="compare-slots">
            {playerSelection.ids.map((id, i) => (
              <select key={i} value={id} onChange={(e) => playerSelection.setSlot(i, e.target.value)}>
                <option value="">未選択</option>
                {(players ?? []).map((p) => (
                  <option key={p.playerId} value={p.playerId}>
                    {p.name}（{p.teamName}）
                  </option>
                ))}
              </select>
            ))}
          </div>
          <ExportImageButton targetRef={exportRef} filename="compare-players.png" />
          <div ref={exportRef} className="export-target">
            <ComparisonTable
              rows={selectedPlayers}
              defs={PLAYER_STAT_DEFS.filter((d) => !d.hiddenFromPicker)}
              rowKey={(p) => p.playerId}
              name={(p) => p.name}
              linkTo={(p) => `/players/${p.playerId}`}
            />
          </div>
        </>
      )}
    </div>
  );
}
