import { useMemo, useRef } from "react";
import type { Division } from "../../shared/types";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { divisionListParam, enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { divisionMultiAxis, gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import type { SituationalFilter } from "../lib/situational";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { situationalFilterLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, divisionOrder } from "../lib/divisionGroups";
import { buildFreeRows, type FreeRow } from "../lib/figureTeamFree";
import { shootReference, teamShootCells } from "../lib/figureShootTableData";
import { TEAM_SHOOT_COLUMNS, percentileLevel, sharedRanks, sortByValue } from "../lib/figureShootTable";
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { TeamLogo } from "../components/TeamLogo";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { FigureExportButton } from "./FigureExport";
import { useHighlightClubs } from "./highlightClubs";
import { ShootLegend, ShootTableView, type ShootSort, type ShootViewColumn } from "./ShootTableView";
import type { FigureProps } from "./catalog";
import "./RatingsScatterFigure.css";

const DEFAULT: SituationalFilter = { range: { kind: "all" } };
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ["rng"],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== "recent" || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>("gt", ["regular", "playoff", "both"], "regular"), read: GAME_TYPE_PARAM.read };
type DivisionChoice = Division | "unknown";
const divisionCodec = divisionListParam<"unknown">("dv", ["unknown"]);
const NO_DIVISIONS: DivisionChoice[] = [];
const divisionLabel = (d: DivisionChoice) => d === "unknown" ? "地区不明" : DIVISION_LABELS[d];
const DEFAULT_SORT: ShootSort = { key: "netrtg", descending: true };
// 並べ替え（tss=列 または 列:asc）。初期値（NetRtg の高い順）は URL に載せない
const sortCodec: UrlCodec<ShootSort> = {
  keys: ["tss"],
  read: p => {
    const [key, dir] = (p.get("tss") ?? "").split(":");
    const found = TEAM_SHOOT_COLUMNS.find(c => c.key === key);
    return found ? { key: found.key, descending: dir !== "asc" } : undefined;
  },
  write: (p, v) => { p.delete("tss"); if (v.key !== DEFAULT_SORT.key || !v.descending) p.set("tss", v.descending ? v.key : `${v.key}:asc`); },
};

export default function TeamShootTableFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const [division, setDivision] = useUrlState(divisionCodec, NO_DIVISIONS);
  const [sort, setSort] = useUrlState(sortCodec, DEFAULT_SORT);
  const target = useRef<HTMLDivElement>(null);
  const request = useJsonData(async () => {
    const teams = await fetchTeams(season, category);
    const [divisions, entries] = await Promise.all([fetchDivisionHistory().catch(() => null), Promise.all(teams.map(async team => {
      try { return [team.teamId, await fetchTeamGameLogs(season, team.teamId, category)] as const; } catch { return [team.teamId, null] as const; }
    }))]);
    return { teams, divisions, missing: entries.filter(([, l]) => l === null).length, logs: new Map(entries.map(([id, l]) => [id, l ?? []])) };
  }, [season, category]);
  const hl = useHighlightClubs({ season, category, teams: request.data?.teams ?? [], divisionOf: id => request.data?.divisions?.[category]?.[season]?.[id] });
  const model = useMemo(() => request.data && !request.data.missing ? buildFreeRows(request.data.teams, request.data.logs, request.data.divisions, { season, category, range: filter.range, gameType, seasonTotals: false }) : null,
    [request.data, season, category, filter, gameType]);
  const allRows = model?.rows ?? [];
  const present = useMemo(() => {
    const values = new Set(allRows.map(r => r.division ?? "unknown"));
    return [...divisionOrder(category).filter(d => values.has(d)), ...(values.has("unknown") ? ["unknown" as const] : [])];
  }, [allRows, category]);
  const activeDivision = division.filter(d => present.includes(d));
  const cells = useMemo(() => teamShootCells(allRows, season), [allRows, season]);
  // 色の基準は全チーム（地区で絞っても変わらない）
  const reference = useMemo(() => shootReference(cells.values(), TEAM_SHOOT_COLUMNS.map(d => d.key)), [cells]);
  const visible = allRows.filter(r => activeDivision.length === 0 || activeDivision.includes(r.division ?? "unknown"));
  const sorted = useMemo(() => sortByValue(visible, r => cells.get(r.teamId)![sort.key]!.value, sort.descending), [visible, cells, sort]);
  const ranks = useMemo(() => sharedRanks(sorted, r => cells.get(r.teamId)![sort.key]!.value, sort.descending), [sorted, cells, sort]);
  // 値が1チームもない列（記録が無いシーズン）は出さない
  const shown = TEAM_SHOOT_COLUMNS.filter(def => sorted.some(r => cells.get(r.teamId)![def.key]!.value !== null));
  const sortKey = shown.some(c => c.key === sort.key) ? sort : { key: shown[0]?.key ?? DEFAULT_SORT.key, descending: true };
  const columns: ShootViewColumn<FreeRow>[] = shown.map(def => ({
    key: def.key, label: def.label, scope: "team", stat: def.label,
    groupStart: def.key === "opppts" ? false : ["pts", "ortg", "efg"].includes(def.key),
    text: r => cells.get(r.teamId)![def.key]!.text,
    level: r => { const v = cells.get(r.teamId)![def.key]!.value; return def.color && v !== null ? percentileLevel(v, reference[def.key]!, def.higherIsBetter) : null; },
  }));
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === "s.range" || (filter.range.kind === "dateRange" && (a.id === "s.dateStart" || a.id === "s.dateEnd")))
    .map(a => a.kind === "select" ? { ...a, options: a.options.filter(o => ["all", "recent:5", "recent:10", "custom"].includes(o.value)) } : { ...a, tier: "primary" as const });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season),
    divisionMultiAxis<"unknown">({ id: "shootTeamDivision", divisions: present.filter((d): d is Division => d !== "unknown"), extra: present.includes("unknown") ? [{ value: "unknown", label: "地区不明" }] : [], selected: activeDivision, onChange: setDivision }),
    hl.axis];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[gameType], ...(activeDivision.length === 0 ? [] : [activeDivision.map(divisionLabel).join("・")]), ...hl.labels];
  const baseDate = { kind: "season" as const, season, gameType };
  const toggleSort = (key: string) => setSort(prev => ({ key, descending: prev.key === key ? !prev.descending : true }));
  return <section aria-label="シュート成功率の一覧（チーム）">
    <FilterBar axes={axes} stateKey="figures:team-shoot-table" onClearAll={() => { setFilter(DEFAULT); setGameType("regular"); setDivision(NO_DIVISIONS); setSort(DEFAULT_SORT); hl.setIds([]); }} />
    {request.loading ? <p role="status">読み込み中…</p> : request.error || request.data?.missing ? <p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p> : !model || !sorted.length ? <p className="empty-message">この条件で表示できるチームがありません。</p> : <>
      <FigureExportButton targetRef={target} filename={`Team_Shooting_Efficiency_${conditions.join("_")}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export shoot-export shoot-export-team" baseDate={baseDate}>
        <ConditionTitle title="Team Shooting Efficiency" exportScope={`${season}シーズン`} conditions={conditions} />
        <ShootTableView rows={sorted} rowKey={r => r.teamId} columns={columns} sort={sortKey} onSort={toggleSort} ranks={ranks} nameHeader="TEAM" ariaLabel="シュート成功率の一覧（チーム）" highlight={r => hl.has([r.teamId])}
          renderName={r => <span className="shoot-team-line"><TeamLogo teamId={r.teamId} size={24} /><ResponsiveTeamName teamId={r.teamId} name={r.teamName} nowrap /></span>} />
        <ShootLegend />
      </ExportTarget>
    </>}
  </section>;
}
