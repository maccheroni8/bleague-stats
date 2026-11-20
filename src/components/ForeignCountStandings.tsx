import { useMemo, useRef, useState, type RefObject } from "react";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { ExportTarget } from "./ExportTarget";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";
import { sortOrderLabel } from "./SortMark";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS } from "../lib/divisionGroups";
import { formatWinPct } from "../lib/format";
import {
  DEFAULT_FOREIGN_COUNT_GROUPS,
  FOREIGN_COUNT_GROUPS,
  foreignGroupRecord,
  type ForeignCountRecord,
} from "../lib/foreignCountStandings";
import { standingsStatCells, type StandingsTeam } from "../lib/standingsTeams";
import { listParam, useUrlState } from "../lib/urlState";
import { topThreeRanks, type BetterDirection } from "../lib/topThreeTiers";
import type { Division, TeamColors, TeamGameLog } from "../../shared/types";

interface Row {
  team: StandingsTeam;
  records: Map<string, ForeignCountRecord>;
}

type SortKey = string;
const SUB_COLUMNS = ["games", "wins", "losses", "winPct"] as const;
const SUB_LABELS = { games: "試合数", wins: "勝", losses: "負", winPct: "勝率" } as const;

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
    case "wins":
      return t.wins;
    case "losses":
      return t.losses;
    case "winPct":
      return t.unplayed ? undefined : t.winPct;
  }
  const [gk, col] = key.split(":");
  const r = row.records.get(gk!);
  if (!r || r.games === 0) return undefined;
  return col === "games" ? r.games : col === "wins" ? r.wins : col === "losses" ? r.losses : r.wins / r.games;
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

type TierMap = Map<string, 1 | 2 | 3>;

/** 勝・敗・勝率の上位3位（良い数値）。条件別順位表と同じ決まり（表の中のクラブで、その条件の試合があるクラブだけを比べる。敗は少ないほうが良い） */
function tierMapOf(rows: Row[], valueOf: (r: Row) => number | undefined, better: BetterDirection): TierMap {
  const base = rows.filter((r) => valueOf(r) !== undefined);
  return new Map([...topThreeRanks(base, valueOf, better)].map(([i, rank]) => [base[i]!.team.teamId, rank] as const));
}

function tierClass(map: TierMap | undefined, teamId: string): string | undefined {
  const rank = map?.get(teamId);
  return rank ? `rank-tier-top rank-tier-${rank}` : undefined;
}

function cellText(r: ForeignCountRecord | undefined, col: (typeof SUB_COLUMNS)[number]): string {
  if (!r || r.games === 0) return "-";
  return col === "games" ? String(r.games) : col === "wins" ? String(r.wins) : col === "losses" ? String(r.losses) : formatWinPct(r.wins / r.games);
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
          // 上位3位の色（試合数は多いほうが上位）。シーズン全体は試合をしたクラブ、まとまりはそのまとまりの試合があるクラブだけを比べる
          const tiers = new Map<string, TierMap>();
          const seasonPlayed = (r: Row) => !r.team.unplayed && r.team.wins + r.team.losses > 0;
          tiers.set("s:games", tierMapOf(rows, (r) => (seasonPlayed(r) ? r.team.wins + r.team.losses : undefined), "high"));
          tiers.set("s:wins", tierMapOf(rows, (r) => (seasonPlayed(r) ? r.team.wins : undefined), "high"));
          tiers.set("s:losses", tierMapOf(rows, (r) => (seasonPlayed(r) ? r.team.losses : undefined), "low"));
          tiers.set("s:winPct", tierMapOf(rows, (r) => (seasonPlayed(r) ? r.team.winPct : undefined), "high"));
          for (const fg of shown) {
            const rec = (r: Row) => r.records.get(fg.key);
            const has = (r: Row) => (rec(r)?.games ?? 0) > 0;
            tiers.set(`${fg.key}:games`, tierMapOf(rows, (r) => (has(r) ? rec(r)!.games : undefined), "high"));
            tiers.set(`${fg.key}:wins`, tierMapOf(rows, (r) => (has(r) ? rec(r)!.wins : undefined), "high"));
            tiers.set(`${fg.key}:losses`, tierMapOf(rows, (r) => (has(r) ? rec(r)!.losses : undefined), "low"));
            tiers.set(`${fg.key}:winPct`, tierMapOf(rows, (r) => (has(r) ? rec(r)!.wins / rec(r)!.games : undefined), "high"));
          }
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
                      <th colSpan={4} className="fc-head fc-season">
                        シーズン全体
                      </th>
                      {shown.map((fg) => (
                        <th key={fg.key} colSpan={4} className={`fc-head fc-g${FOREIGN_COUNT_GROUPS.indexOf(fg)}`}>
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
                          {(["games", "wins", "losses", "winPct"] as const).map((c) => {
                            const text = c === "games" ? cells.games : c === "winPct" ? cells.winPct : seasonPlayed(r) ? String(c === "wins" ? r.team.wins : r.team.losses) : "-";
                            const tier = seasonPlayed(r) ? tierClass(tiers.get(`s:${c}`), r.team.teamId) : undefined;
                            return (
                              <td key={`s-${c}`} className={`align-right fc-season${tier ? ` ${tier}` : ""}`}>
                                {text}
                              </td>
                            );
                          })}
                          {shown.flatMap((fg) =>
                            SUB_COLUMNS.map((c) => {
                              const rec = r.records.get(fg.key);
                              const id = r.team.teamId;
                              const base = `align-right fc-g${FOREIGN_COUNT_GROUPS.indexOf(fg)}`;
                              const tier = tierClass(tiers.get(`${fg.key}:${c}`), id);
                              return (
                                <td key={`${fg.key}-${c}`} className={tier ? `${base} ${tier}` : base}>
                                  {cellText(rec, c)}
                                </td>
                              );
                            }),
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
