import { useMemo, useRef } from "react";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { teamShortName } from "../../shared/teamNames";
import { TeamChip } from "../components/TeamChip";
import { enumParam, numberParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { classificationAxis, gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import type { SituationalFilter } from "../lib/situational";
import { figureClassGroup } from "../lib/figureAge";
import { CLASSIFICATION_PARAM, GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from "../lib/classificationFilter";
import { classificationLabels, eligibilityLabels, situationalFilterLabels, visibleConditionLabels } from "../lib/conditionLabels";
import { buildPlayerFigurePoints, passesRatio, type PlayerFigurePoint } from "../lib/figurePlayerPoints";
import { playerShootCells, shootReference } from "../lib/figureShootTableData";
import {
  DEFAULT_SHOOT_MIN_PTS, DEFAULT_SHOOT_TOP_N, PLAYER_SHOOT_COLUMNS, percentileLevel, playerShootConditions, shootSelectionLabel, shootSortLabel, shootTitle, selectByPoints, sharedRanks, sortByValue, type ShootSelection,
} from "../lib/figureShootTable";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { NumberTextInput } from "../components/NumberTextInput";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { PlayerNamePool } from "../components/PlayerNamePool";
import { ResponsivePlayerName } from "../components/ResponsivePlayerName";
import { FigureExportButton } from "./FigureExport";
import { ratioEligibilityAxis } from "./eligibilityAxis";
import { useFigureAchievable } from "./useFigureAchievable";
import { usePlayerFigureData } from "./usePlayerFigureData";
import { usePlayerFigureFilter } from "./usePlayerFigureFilter";
import { useHighlightClubs } from "./highlightClubs";
import { ShootLegend, ShootTableView, type ShootSort, type ShootViewColumn } from "./ShootTableView";
import type { FigureProps } from "./catalog";
import "./RatingsScatterFigure.css";

const DEFAULT: SituationalFilter = { range: { kind: "all" } };
const DEFAULT_RATIO = 85;
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ["rng"],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== "recent" || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>("gt", ["regular", "playoff", "both"], "regular"), read: GAME_TYPE_PARAM.read };
const ratioCodec = numberParam("stg", DEFAULT_RATIO, { min: 0, max: 100 });
const kindCodec = enumParam<"min" | "top">("stm", ["min", "top"], "min");
const minCodec = numberParam("stv", DEFAULT_SHOOT_MIN_PTS, { min: 0, max: 100 });
const topCodec = numberParam("stn", DEFAULT_SHOOT_TOP_N, { min: 1, max: 500 });
const DEFAULT_SORT: ShootSort = { key: "pts", descending: true };
// 並べ替え（sts=列 または 列:asc）。初期値（得点の多い順）は URL に載せない
const sortCodec: UrlCodec<ShootSort> = {
  keys: ["sts"],
  read: p => {
    const [key, dir] = (p.get("sts") ?? "").split(":");
    const found = PLAYER_SHOOT_COLUMNS.find(c => c.key === key);
    return found ? { key: found.key, descending: dir !== "asc" } : undefined;
  },
  write: (p, v) => { p.delete("sts"); if (v.key !== DEFAULT_SORT.key || !v.descending) p.set("sts", v.descending ? v.key : `${v.key}:asc`); },
};
export default function PlayerShootTableFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const [classification, setClassification] = useUrlState(CLASSIFICATION_PARAM, "all");
  const [minRatio, setMinRatio] = useUrlState(ratioCodec, DEFAULT_RATIO);
  const [kind, setKind] = useUrlState(kindCodec, "min");
  const [minPts, setMinPts] = useUrlState(minCodec, DEFAULT_SHOOT_MIN_PTS);
  const [topN, setTopN] = useUrlState(topCodec, DEFAULT_SHOOT_TOP_N);
  const [sort, setSort] = useUrlState(sortCodec, DEFAULT_SORT);
  const target = useRef<HTMLDivElement>(null);
  const request = usePlayerFigureData(season, category);
  const teams = request.data?.teams ?? [];
  const divisionOf = (id: string) => request.data?.divisions?.[category]?.[season]?.[id];
  const base = useMemo(() => request.data ? buildPlayerFigurePoints(request.data, { season, category, range: filter.range, gameType, classification }) : [], [request.data, season, category, filter, gameType, classification]);
  // 掲載基準（出場率）を満たした全員。色の基準はこの全員の中での位置で、表示する人を絞っても変わらない
  const ach = useFigureAchievable(season, category, { range: filter.range, gameType });
  const ratioPassed = useMemo(() => base.filter(p => passesRatio(p, minRatio, ach.remaining)), [base, minRatio, ach.remaining]);
  const pf = usePlayerFigureFilter({ season, category, teams, divisionOf, ratioPassed, clubKey: "stcl", axisId: "shootClubs" });
  const hl = useHighlightClubs({ season, category, teams, divisionOf });

  const cells = useMemo(() => playerShootCells(ratioPassed, season), [ratioPassed, season]);
  const reference = useMemo(() => shootReference(cells.values(), PLAYER_SHOOT_COLUMNS.map(d => d.key)), [cells]);

  const selection: ShootSelection = kind === "min" ? { kind: "min", value: minPts } : { kind: "top", n: topN };
  const selected = useMemo(() => selectByPoints(pf.eligible, p => cells.get(p.id)?.pts?.value ?? null, selection), [pf.eligible, cells, kind, minPts, topN]);
  const sorted = useMemo(() => sortByValue(selected, p => cells.get(p.id)![sort.key]!.value, sort.descending), [selected, cells, sort]);
  const ranks = useMemo(() => sharedRanks(sorted, p => cells.get(p.id)![sort.key]!.value, sort.descending), [sorted, cells, sort]);
  // 値が1人もいない列（記録が無いシーズン）は出さない
  const shown = PLAYER_SHOOT_COLUMNS.filter(def => sorted.some(p => cells.get(p.id)![def.key]!.value !== null));
  const sortKey = shown.some(c => c.key === sort.key) ? sort : DEFAULT_SORT;

  const columns: ShootViewColumn<PlayerFigurePoint>[] = shown.map(def => ({
    key: def.key, label: def.label, stat: def.label, scope: "player", groupStart: def.key === "efg",
    text: p => cells.get(p.id)![def.key]!.text,
    level: p => { const v = cells.get(p.id)![def.key]!.value; return def.color && v !== null ? percentileLevel(v, reference[def.key]!, def.higherIsBetter) : null; },
  }));
  const names = sorted.map(p => p.name);
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === "s.range" || (filter.range.kind === "dateRange" && (a.id === "s.dateStart" || a.id === "s.dateEnd")))
    .map(a => a.kind === "select" ? { ...a, options: a.options.filter(o => ["all", "recent:5", "recent:10", "custom"].includes(o.value)) } : { ...a, tier: "primary" as const });
  const selectionSummary = shootSelectionLabel(selection);
  const selectionAxis: FilterAxis = {
    kind: "popover", id: "shootSelect", label: "対象の選手", tier: "primary", value: `${kind}:${kind === "min" ? minPts : topN}`, defaultValue: `min:${DEFAULT_SHOOT_MIN_PTS}`,
    summary: selectionSummary, chipValue: selectionSummary,
    onChange: () => { setKind("min"); setMinPts(DEFAULT_SHOOT_MIN_PTS); setTopN(DEFAULT_SHOOT_TOP_N); },
    content: <div className="shoot-select">
      <label><input type="radio" name="shoot-kind" checked={kind === "min"} onChange={() => setKind("min")} /> 得点が <NumberTextInput kind="number" aria-label="得点の下限" disabled={kind !== "min"} value={String(minPts)} onCommit={t => { const n = Number(t); if (Number.isFinite(n) && n >= 0) setMinPts(n); }} size={4} /> 以上</label>
      <label><input type="radio" name="shoot-kind" checked={kind === "top"} onChange={() => setKind("top")} /> 得点の上位 <NumberTextInput kind="count" aria-label="人数" disabled={kind !== "top"} value={String(topN)} onCommit={t => { const n = Math.floor(Number(t)); if (Number.isFinite(n) && n >= 1) setTopN(n); }} size={3} /> 人</label>
    </div>,
  };
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season), selectionAxis,
    classificationAxis(classification, setClassification, { season }), pf.clubAxis, pf.positionAxis, hl.axis,
    ratioEligibilityAxis({ id: "shootRatio", value: minRatio, defaultValue: DEFAULT_RATIO, onChange: setMinRatio, achievable: ach.axis })];
  const [periodLabel] = situationalFilterLabels(filter);
  const sortText = shootSortLabel(shown.find(c => c.key === sortKey.key)?.label ?? "PTS", sortKey.descending);
  const conditions = visibleConditionLabels(playerShootConditions({ scope: `${season} ${periodLabel}`, gameType: seasonGameTypeLabels(season)[gameType], selection, classification: classificationLabels(classification), filters: pf.labels, eligibility: eligibilityLabels({ gamesRatio: minRatio / 100, achievable: ach.achievable }), highlights: hl.labels, sort: sortText }));
  const baseDate = { kind: "season" as const, season, gameType };
  const toggleSort = (key: string) => setSort(prev => ({ key, descending: prev.key === key ? !prev.descending : true }));
  // 移籍した選手は、表示中の範囲で最後に出場した試合のチームの略称
  const teamAbbr = (p: PlayerFigurePoint) => teamShortName(p.lastTeamId, teams.find(t => t.teamId === p.lastTeamId)?.teamName ?? p.teamName);
  return <section aria-label="シュート成功率（選手）">
    <FilterBar axes={axes} stateKey="figures:player-shoot-table" advancedExtra={pf.advancedExtra} onClearAll={() => { setFilter(DEFAULT); setGameType("regular"); setClassification("all"); setKind("min"); setMinPts(DEFAULT_SHOOT_MIN_PTS); setTopN(DEFAULT_SHOOT_TOP_N); setSort(DEFAULT_SORT); pf.reset(); setMinRatio(DEFAULT_RATIO); ach.reset(); hl.setIds([]); }} />
    {splitClassificationBlocked(figureClassGroup(classification), season) ? <p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">選手の試合データを読み込み中…</p> : request.error ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : !sorted.length ? <p className="empty-message">この条件に該当する選手はいません。</p> : <>
      <p className="figure-count">{sorted.length}人を表示</p>
      <FigureExportButton targetRef={target} filename={`シュート成功率_${conditions.join("_")}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export shoot-export" baseDate={baseDate}>
        <ConditionTitle title={shootTitle(null)} exportScope={`${season}シーズン`} conditions={conditions} />
        <PlayerNamePool names={names}>
          <ShootTableView rows={sorted} rowKey={p => p.id} columns={columns} sort={sortKey} onSort={toggleSort} ranks={ranks} nameHeader="PLAYER" highlight={p => hl.has(p.teamIds)} ariaLabel="シュート成功率（選手）"
            renderName={p => <div className="shoot-who">
              <PlayerPhoto playerId={p.playerId} size={44} className="player-cell-photo" placeholder season={season} teamId={p.lastTeamId} />
              <span className="shoot-who-line"><ResponsivePlayerName name={p.name} among={names} /><span className="shoot-abbr">（<TeamChip teamId={p.lastTeamId}>{teamAbbr(p)}</TeamChip>）</span></span>
            </div>} />
        </PlayerNamePool>
        <ShootLegend />
      </ExportTarget>
    </>}
  </section>;
}
