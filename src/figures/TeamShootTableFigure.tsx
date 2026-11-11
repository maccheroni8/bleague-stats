import { useMemo, useRef } from "react";
import type { Division } from "../../shared/types";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { divisionListParam, enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { divisionMultiAxis, gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import type { SituationalFilter } from "../lib/situational";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { situationalFilterLabels, visibleConditionLabels } from "../lib/conditionLabels";
import { DIVISION_LABELS, divisionOrder } from "../lib/divisionGroups";
import { buildFreeRows, type FreeRow } from "../lib/figureTeamFree";
import { shootReference, teamShootCells } from "../lib/figureShootTableData";
import { TEAM_SHOOT_SLOTS, TEAM_SHOOT_VIEWS, TEAM_SHOOT_VIEW_LABELS, percentileLevel, sharedRanks, shootSortLabel, shootTitle, sortByValue, teamShootConditions, teamShootDefaultSort, teamShootHigherIsBetter, type TeamShootView } from "../lib/figureShootTable";
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
// 視点（tsv）。初期値（自チーム）は URL に載せない
const viewCodec = enumParam<TeamShootView>("tsv", ["own", "opp", "diff"], "own");
// 並べ替えの列は視点によらず同じ（pts・rating・成功率）。初期は rating 列を良い順（自チーム＝ORtg の高い順・差＝NetRtg の高い順・相手＝DRtg の低い順。視点で変わる）
// 並べ替え（tss=列:desc または 列:asc）。URL に無いときは視点ごとの初期の並び順（列だけの古い形は大きい順）
const sortCodec: UrlCodec<ShootSort | null> = {
  keys: ["tss"],
  read: p => {
    const [key, dir] = (p.get("tss") ?? "").split(":");
    const found = TEAM_SHOOT_SLOTS.find(c => c.key === key);
    return found ? { key: found.key, descending: dir !== "asc" } : undefined;
  },
  write: (p, v) => { p.delete("tss"); if (v) p.set("tss", `${v.key}:${v.descending ? "desc" : "asc"}`); },
};

export default function TeamShootTableFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const [division, setDivision] = useUrlState(divisionCodec, NO_DIVISIONS);
  const [view, setView] = useUrlState(viewCodec, "own");
  const [sortParam, setSort] = useUrlState(sortCodec, null);
  const sort: ShootSort = sortParam ?? teamShootDefaultSort(view);
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
  const cells = useMemo(() => teamShootCells(allRows, season, view), [allRows, season, view]);
  // 色の基準は全チーム（地区で絞っても変わらない）
  const reference = useMemo(() => shootReference(cells.values(), TEAM_SHOOT_SLOTS.map(d => d.key)), [cells]);
  const visible = allRows.filter(r => activeDivision.length === 0 || activeDivision.includes(r.division ?? "unknown"));
  const sorted = useMemo(() => sortByValue(visible, r => cells.get(r.teamId)![sort.key]!.value, sort.descending), [visible, cells, sort]);
  const ranks = useMemo(() => sharedRanks(sorted, r => cells.get(r.teamId)![sort.key]!.value, sort.descending), [sorted, cells, sort]);
  // 値が1チームもない列（記録が無いシーズン）は出さない
  const shown = TEAM_SHOOT_SLOTS.filter(def => sorted.some(r => cells.get(r.teamId)![def.key]!.value !== null));
  const sortKey = shown.some(c => c.key === sort.key) ? sort : { key: shown.find(c => c.key === "rating")?.key ?? shown[0]?.key ?? "rating", descending: teamShootDefaultSort(view).descending };
  const higher = teamShootHigherIsBetter(view);
  const columns: ShootViewColumn<FreeRow>[] = shown.map(def => ({
    key: def.key, label: def.label(view), scope: "team", stat: def.label(view),
    groupStart: ["pts", "efg"].includes(def.key),
    text: r => cells.get(r.teamId)![def.key]!.text,
    level: r => { const v = cells.get(r.teamId)![def.key]!.value; return def.color && v !== null ? percentileLevel(v, reference[def.key]!, higher) : null; },
  }));
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === "s.range" || (filter.range.kind === "dateRange" && (a.id === "s.dateStart" || a.id === "s.dateEnd")))
    .map(a => a.kind === "select" ? { ...a, options: a.options.filter(o => ["all", "recent:5", "recent:10", "custom"].includes(o.value)) } : { ...a, tier: "primary" as const });
  const viewAxis: FilterAxis = { kind: "select", id: "shootView", label: "視点", tier: "primary", value: view, defaultValue: "own", options: TEAM_SHOOT_VIEWS.map(v => ({ value: v, label: TEAM_SHOOT_VIEW_LABELS[v] })), onChange: v => setView(v as TeamShootView) };
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season), viewAxis,
    divisionMultiAxis<"unknown">({ id: "shootTeamDivision", divisions: present.filter((d): d is Division => d !== "unknown"), extra: present.includes("unknown") ? [{ value: "unknown", label: "地区不明" }] : [], selected: activeDivision, onChange: setDivision }),
    hl.axis];
  const [periodLabel] = situationalFilterLabels(filter);
  const sortText = shootSortLabel(columns.find(c => c.key === sortKey.key)?.label ?? "", sortKey.descending);
  const conditions = visibleConditionLabels(teamShootConditions({ scope: `${season} ${periodLabel}`, gameType: seasonGameTypeLabels(season)[gameType], view, division: activeDivision.length === 0 ? [] : [activeDivision.map(divisionLabel).join("・")], highlights: hl.labels, sort: sortText }));
  const baseDate = { kind: "season" as const, season, gameType };
  const toggleSort = (key: string) => setSort({ key, descending: sortKey.key === key ? !sortKey.descending : true });
  return <section aria-label="シュート成功率（チーム）">
    <FilterBar axes={axes} stateKey="figures:team-shoot-table" onClearAll={() => { setFilter(DEFAULT); setGameType("regular"); setDivision(NO_DIVISIONS); setView("own"); setSort(null); hl.setIds([]); }} />
    {request.loading ? <p role="status">読み込み中…</p> : request.error || request.data?.missing ? <p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p> : !model || !sorted.length ? <p className="empty-message">この条件で表示できるチームがありません。</p> : <>
      <FigureExportButton targetRef={target} filename={`チーム_${shootTitle(view)}_${conditions.join("_")}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export shoot-export" baseDate={baseDate}>
        <ConditionTitle title={shootTitle(view)} exportScope={`${season}シーズン`} conditions={conditions} />
        <ShootTableView rows={sorted} rowKey={r => r.teamId} columns={columns} sort={sortKey} onSort={toggleSort} ranks={ranks} nameHeader="TEAM" ariaLabel="シュート成功率（チーム）" highlight={r => hl.has([r.teamId])}
          renderName={r => <span className="shoot-team-line"><TeamLogo teamId={r.teamId} size={24} /><ResponsiveTeamName teamId={r.teamId} name={r.teamName} nowrap /></span>} />
        <ShootLegend reversed={!higher} />
      </ExportTarget>
    </>}
  </section>;
}
