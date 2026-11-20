import { useMemo, useRef, useState, type RefObject } from "react";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";
import { sortOrderLabel } from "./SortMark";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS } from "../lib/divisionGroups";
import { formatRecord, formatWinPct } from "../lib/format";
import {
  DEFAULT_FOREIGN_COUNT_GROUPS,
  FOREIGN_COUNT_GROUPS,
  foreignGroupRecord,
  type ForeignCountRecord,
} from "../lib/foreignCountStandings";
import { standingsStatCells, type StandingsTeam } from "../lib/standingsTeams";
import { listParam, useUrlState } from "../lib/urlState";
import type { Division, TeamColors, TeamGameLog } from "../../shared/types";

interface Row {
  team: StandingsTeam;
  records: Map<string, ForeignCountRecord>;
}

type SortKey = string;
const SUB_COLUMNS = ["games", "record", "winPct"] as const;
const SUB_LABELS = { games: "試合数", record: "勝敗", winPct: "勝率" } as const;

/** 並べ替えの値。値の無いセル（その条件の試合が無い）は、どちらの向きでも末尾に置くため undefined */
function sortValueOf(row: Row, key: SortKey): number | string | undefined {
  const t = row.team;
  switch (key) {
    case "divisionRank":
      return t.unplayed ? undefined : (t.divisionRank ?? t.rank);
    case "team":
      return t.teamName;
    case "games":
      return t.wins + t.losses;
    case "record":
      return t.wins - t.losses;
    case "winPct":
      return t.unplayed ? undefined : t.winPct;
  }
  const [gk, col] = key.split(":");
  const r = row.records.get(gk!);
  if (!r || r.games === 0) return undefined;
  return col === "games" ? r.games : col === "record" ? r.wins - r.losses : r.wins / r.games;
}

function sortRows(rows: Row[], key: SortKey, dir: "asc" | "desc"): Row[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValueOf(a, key);
    const vb = sortValueOf(b, key);
    if (va === undefined || vb === undefined) {
      if (va === vb) return a.team.rank - b.team.rank;
      return va === undefined ? 1 : -1;
    }
    const c = typeof va === "string" ? va.localeCompare(vb as string, "ja") : (va as number) - (vb as number);
    return c * sign || a.team.rank - b.team.rank;
  });
}

function cellText(r: ForeignCountRecord | undefined, col: (typeof SUB_COLUMNS)[number]): string {
  if (!r || r.games === 0) return "-";
  return col === "games" ? String(r.games) : col === "record" ? formatRecord(r.wins, r.losses) : formatWinPct(r.wins / r.games);
}

/**
 * 順位表の「外国籍人数別」タブ。地区ごとの表で、左にシーズン全体（試合数・勝敗・勝率）、その右に選んだ人数のまとまりを並べる。
 * 数え方は条件別順位表の「外国籍の人数」の条件と同じ（foreignCountStandings.ts）。見出しを押すとその列で並べ替える
 */
export function ForeignCountStandings({
  season,
  seasonLabel,
  asOfLabel,
  groups,
  gameLogsByTeam,
  teamColors,
}: {
  season: string;
  seasonLabel: string;
  asOfLabel: string;
  /** 順位表と同じ地区ごとのチーム（地区データが無いシーズンは division が null の1つだけ） */
  groups: { division: Division | null; teams: StandingsTeam[] }[];
  gameLogsByTeam: Map<string, TeamGameLog[]> | null;
  teamColors?: Record<string, TeamColors>;
}) {
  const [picked, setPicked] = useUrlState(listParam("fg"), DEFAULT_FOREIGN_COUNT_GROUPS as string[]);
  const shown = FOREIGN_COUNT_GROUPS.filter((g) => picked.includes(g.key));
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "divisionRank", dir: "asc" });
  // 保存する地区（画面の状態。URL には載せない）。選んだ地区が今の地区の中に無ければ先頭
  const [saveDivision, setSaveDivision] = useState<string>(groups[0]?.division ?? "all");

  const rowsByGroup = useMemo(
    () =>
      groups.map((g) =>
        g.teams.map((team): Row => {
          const regular = (gameLogsByTeam?.get(team.teamId) ?? []).filter((l) => l.gameType === "regular");
          const records = new Map<string, ForeignCountRecord>();
          for (const fg of FOREIGN_COUNT_GROUPS) records.set(fg.key, foreignGroupRecord(regular, fg));
          return { team, records };
        }),
      ),
    [groups, gameLogsByTeam],
  );

  const saveTargets = useRef<Record<string, HTMLDivElement | null>>({});
  const saveKeyRef = useRef(saveDivision);
  saveKeyRef.current = saveDivision;
  const saveTargetRef = useMemo(
    () => ({ get current() { return saveTargets.current[saveKeyRef.current] ?? null; } }) as unknown as RefObject<HTMLElement | null>,
    [],
  );

  const sortLabel = (() => {
    const [gk, col] = sort.key.split(":");
    const fg = FOREIGN_COUNT_GROUPS.find((g) => g.key === gk);
    const base =
      sort.key === "divisionRank" ? (groups[0]?.division ? "地区順位" : "順位") : sort.key === "team" ? "チーム" : fg ? `${fg.short} ${SUB_LABELS[col as keyof typeof SUB_LABELS]}` : `シーズン全体 ${SUB_LABELS[sort.key as keyof typeof SUB_LABELS]}`;
    return sortOrderLabel(base, sort.dir === "desc");
  })();
  const shownLabel = `表示: ${shown.map((g) => g.short).join("・")}`;
  const divisionName = (d: Division | null) => (d ? DIVISION_LABELS[d] : "");

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "divisionRank" || key === "team" ? "asc" : "desc" }));
  const sortMark = (key: SortKey) => (sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="foreign-count-standings">
      <ExportImageButton
        targetRef={saveTargetRef}
        filename={buildExportFilename([seasonLabel, ...(groups.length > 1 || groups[0]?.division ? [divisionName(saveDivisionOf(groups, saveDivision))] : []), "外国籍人数別順位表", asOfLabel])}
        baseDate={{ kind: "season", season, gameType: "regular" }}
        options={
          groups.length > 1 || groups[0]?.division ? (
            <span className="export-option-group" role="group" aria-label="保存する地区">
              <span className="export-option-label">保存する地区</span>
              {groups.map((g) => (
                <button key={g.division ?? "all"} type="button" className={saveDivisionOf(groups, saveDivision) === g.division ? "active" : ""} onClick={() => setSaveDivision(g.division ?? "all")}>
                  {divisionName(g.division)}
                </button>
              ))}
            </span>
          ) : undefined
        }
      />
      <div className="mode-toggle fc-group-choice" role="group" aria-label="表示するまとまり">
        <span className="export-option-label">表示するまとまり</span>
        {FOREIGN_COUNT_GROUPS.map((g, i) => {
          const on = picked.includes(g.key);
          return (
            <button
              key={g.key}
              type="button"
              className={`fc-choice fc-g${i}${on ? " active" : ""}`}
              aria-pressed={on}
              onClick={() => {
                // 1つも選ばない状態は作らない（最後の1つは外せない）
                if (on && shown.length === 1) return;
                setPicked(FOREIGN_COUNT_GROUPS.filter((x) => (x.key === g.key ? !on : picked.includes(x.key))).map((x) => x.key));
              }}
            >
              {g.label}
            </button>
          );
        })}
      </div>
      <div className="standings-stack">
        {groups.map((g, gi) => {
          const key = g.division ?? "all";
          const rows = sortRows(rowsByGroup[gi]!, sort.key, sort.dir);
          return (
            <ExportTarget
              key={key}
              ref={(el) => {
                saveTargets.current[key] = el;
              }}
              className="export-target-standings"
              baseDate={{ kind: "season", season, gameType: "regular" }}
            >
              <ConditionTitle
                exportScope={seasonLabel}
                section
                title={`${g.division ? `${DIVISION_LABELS[g.division]} ` : ""}外国籍人数別順位表`}
                conditions={composeLabels(seasonLabel, asOfLabel, gameTypeLabels("regular", null), shownLabel, sortLabel)}
              />
              <div className="table-scroll standings-sticky-2 foreign-count-scroll">
                <table className="sortable-table foreign-count-table">
                  <thead>
                    <tr>
                      <th rowSpan={2} className="align-right" onClick={() => toggleSort("divisionRank")}>
                        {g.division ? "地区順位" : "順位"}
                        {sortMark("divisionRank")}
                      </th>
                      <th rowSpan={2} className="align-left" onClick={() => toggleSort("team")}>
                        チーム{sortMark("team")}
                      </th>
                      <th colSpan={3} className="fc-head fc-season">
                        シーズン全体
                      </th>
                      {shown.map((fg) => (
                        <th key={fg.key} colSpan={3} className={`fc-head fc-g${FOREIGN_COUNT_GROUPS.indexOf(fg)}`}>
                          {fg.short}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {SUB_COLUMNS.map((c) => (
                        <th key={`s-${c}`} className="align-right fc-season" onClick={() => toggleSort(c)}>
                          {SUB_LABELS[c]}
                          {sortMark(c)}
                        </th>
                      ))}
                      {shown.flatMap((fg) =>
                        SUB_COLUMNS.map((c) => (
                          <th key={`${fg.key}-${c}`} className={`align-right fc-g${FOREIGN_COUNT_GROUPS.indexOf(fg)}`} onClick={() => toggleSort(`${fg.key}:${c}`)}>
                            {SUB_LABELS[c]}
                            {sortMark(`${fg.key}:${c}`)}
                          </th>
                        )),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const cells = standingsStatCells(r.team);
                      const accent = teamColors?.[r.team.teamId]?.primary;
                      return (
                        <tr key={r.team.teamId}>
                          <td className="align-right">{r.team.unplayed ? "-" : String(r.team.divisionRank ?? r.team.rank)}</td>
                          <td className="align-left row-accent-cell" style={accent ? { borderLeftColor: accent } : undefined}>
                            <span className="team-name-cell">
                              <TeamLogo teamId={r.team.teamId} size={20} />
                              <ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} />
                            </span>
                          </td>
                          <td className="align-right fc-season">{cells.games}</td>
                          <td className="align-right fc-season">{cells.record}</td>
                          <td className="align-right fc-season">{cells.winPct}</td>
                          {shown.flatMap((fg) =>
                            SUB_COLUMNS.map((c) => (
                              <td key={`${fg.key}-${c}`} className={`align-right fc-g${FOREIGN_COUNT_GROUPS.indexOf(fg)}`}>
                                {cellText(r.records.get(fg.key), c)}
                              </td>
                            )),
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ExportTarget>
          );
        })}
      </div>
    </div>
  );
}

function saveDivisionOf(groups: { division: Division | null }[], key: string): Division | null {
  return groups.find((g) => (g.division ?? "all") === key)?.division ?? groups[0]?.division ?? null;
}
