import { useMemo, useRef, useState } from 'react';
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory, teamLogoUrl } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import { enumParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { gameTypeAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import { GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import type { SituationalFilter } from '../lib/situational';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { DIVISION_RATING_COLORS } from '../lib/figureRatings';
import {
  buildFreeRows, DEFAULT_FREE_X, DEFAULT_FREE_Y, FREE_CATEGORIES, freeAxisDomain, freeCategoryBlock, freeColumn, freeItemName, freeItems, freeTickText,
  inferFreeAxis, resolveFreeItem, type FreeRow,
} from '../lib/figureTeamFree';
import { ONE_RANKING_FORCED_TOV_REASON, ONE_RANKING_SHOOTING_REASON } from '../lib/leagueAvailability';
import { TEAM_PERSPECTIVE_LABELS } from '../lib/teamStatsColumns';
import { useTeamLabel } from '../lib/teamLabel';
import { teamShortName } from '../../shared/teamNames';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ConditionTitle } from '../components/ConditionTitle';
import { ResponsiveTeamName } from '../components/ResponsiveTeamName';
import { TeamLogo } from '../components/TeamLogo';
import { SortableTable, type Column } from '../components/SortableTable';
import { FigureExportButton } from './FigureExport';
import { AxisScatter } from './AxisScatter';
import type { FigureProps } from './catalog';
import { useHighlightClubs } from './highlightClubs';
import './RatingsScatterFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
// 項目は `fx`（横軸）・`fy`（縦軸）。以前の「シュート% × 試投数」のURL（shx・shy・v）も同じ組み合わせで開く
const LEGACY_X: Record<string, string> = { fga: 'traditional.fga', '2pa': 'traditional.2pa', '3pa': 'traditional.3pa', fta: 'traditional.fta' };
const LEGACY_Y: Record<string, string> = { fg: 'traditional.fgpct', '2p': 'traditional.2ppct', '3p': 'traditional.3ppct', ft: 'traditional.ftpct', efg: 'advanced.efg', ts: 'advanced.ts' };
const itemCodec = (key: string, legacyKey: string, legacy: Record<string, string>, fallback: string): UrlCodec<string> => ({
  keys: [key, legacyKey],
  read: p => p.get(key) ?? legacy[p.get(legacyKey) ?? ''],
  write: (p, v) => { if (v !== fallback) p.set(key, v); },
});
const xCodec = itemCodec('fx', 'shx', LEGACY_X, DEFAULT_FREE_X);
const yCodec = itemCodec('fy', 'shy', LEGACY_Y, DEFAULT_FREE_Y);
type Persp = 'own' | 'opp' | 'diff';
const PERSPS: readonly Persp[] = ['own', 'opp', 'diff'];
interface PerspPair { x: Persp; y: Persp }
const DEFAULT_PERSP: PerspPair = { x: 'own', y: 'own' };
const perspCodec: UrlCodec<PerspPair> = {
  keys: ['fxv', 'fyv', 'v'],
  read: p => {
    const pick = (k: string) => PERSPS.find(v => v === p.get(k));
    const legacy = pick('v') ?? 'own';
    return { x: pick('fxv') ?? legacy, y: pick('fyv') ?? legacy };
  },
  write: (p, v) => { if (v.x !== 'own') p.set('fxv', v.x); if (v.y !== 'own') p.set('fyv', v.y); },
};
const modeCodec = enumParam<'perGame' | 'total'>('shm', ['perGame', 'total'], 'perGame', { total: 'tot' });

export function TeamLogoPoint({ teamId, teamName, division, label, emphasized = false, expanded, left, top, onSelect, onDismiss }: {
  teamId: string; teamName: string; division?: string; label: string; emphasized?: boolean; expanded: boolean; left: number; top: number; onSelect: () => void; onDismiss: () => void;
}) {
  const [failed, setFailed] = useState(false);
  return <button className={`ratings-point team-logo-point${emphasized ? ' is-emphasized' : ''}${expanded ? ' is-expanded' : ''}`} style={{ left: `${left}%`, top: `${top}%`, borderColor: DIVISION_RATING_COLORS[(division ?? 'unknown') as keyof typeof DIVISION_RATING_COLORS] }}
    aria-label={label} onPointerEnter={e => { if (e.pointerType === 'mouse') onSelect(); }} onPointerLeave={e => { if (e.pointerType === 'mouse') onDismiss(); }} onFocus={onSelect} onBlur={onDismiss} onClick={onSelect}>
    {failed ? <span className="ratings-fallback">{teamShortName(teamId, teamName)}</span> : <img src={teamLogoUrl(teamId)} alt="" loading="eager" onError={() => setFailed(true)} />}
  </button>;
}

export default function TeamFreeScatterFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [yId, setYId] = useUrlState(yCodec, DEFAULT_FREE_Y);
  const [xId, setXId] = useUrlState(xCodec, DEFAULT_FREE_X);
  const [persp, setPersp] = useUrlState(perspCodec, DEFAULT_PERSP);
  const [mode, setMode] = useUrlState(modeCodec, 'perGame');
  const [hover, setHover] = useState<string | null>(null);
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = useJsonData(async () => {
    const teams = await fetchTeams(season, category);
    const [divisions, entries] = await Promise.all([fetchDivisionHistory().catch(() => null), Promise.all(teams.map(async team => {
      try { return [team.teamId, await fetchTeamGameLogs(season, team.teamId, category)] as const; } catch { return [team.teamId, null] as const; }
    }))]);
    return { teams, divisions, missing: entries.filter(([, l]) => l === null).length, logs: new Map(entries.map(([id, l]) => [id, l ?? []])) };
  }, [season, category]);
  const reasons = { shooting: ONE_RANKING_SHOOTING_REASON, forcedTurnovers: ONE_RANKING_FORCED_TOV_REASON, none: 'このシーズンのデータには対応していません' };
  const blocked = (id: string) => { const item = freeItems(season).find(i => i.id === id); return item ? freeCategoryBlock(item.category, request.data?.teams ?? null, category, reasons) : undefined; };
  // URL の項目が選べない（古い・B.ONE で出せない）ときは、初期の項目で描く
  const xItem = resolveFreeItem(blocked(xId) ? undefined : xId, season, DEFAULT_FREE_X), yItem = resolveFreeItem(blocked(yId) ? undefined : yId, season, DEFAULT_FREE_Y);
  const seasonTotals = xItem.category === 'shooting' || yItem.category === 'shooting';
  const model = useMemo(() => request.data && !request.data.missing ? buildFreeRows(request.data.teams, request.data.logs, request.data.divisions, { season, category, range: filter.range, gameType, seasonTotals }) : null,
    [request.data, season, category, filter, gameType, seasonTotals]);
  const hl = useHighlightClubs({ season, category, teams: request.data?.teams ?? [], divisionOf: id => request.data?.divisions?.[category]?.[season]?.[id] });
  const fm = mode as 'perGame' | 'total';
  const xCol = freeColumn(xItem, persp.x, fm, season)!, yCol = freeColumn(yItem, persp.y, fm, season)!;
  const rows = model?.rows ?? [];
  const xKind = inferFreeAxis(xCol, rows), yKind = inferFreeAxis(yCol, rows);
  const points = rows.flatMap(r => { const x = xCol.value(r), y = yCol.value(r); return x === null || y === null ? [] : [{ id: r.teamId, x: x * xKind.scale, y: y * yKind.scale, team: r }]; });
  const leagueValue = (col: typeof xCol, kind: typeof xKind) => { const v = model?.league ? col.value(model.league) : null; return v === null ? null : v * kind.scale; };
  const avgX = leagueValue(xCol, xKind), avgY = leagueValue(yCol, yKind);
  const xDomain = freeAxisDomain([...points.map(p => p.x), avgX], xKind, persp.x === 'diff'), yDomain = freeAxisDomain([...points.map(p => p.y), avgY], yKind, persp.y === 'diff');
  const tip = points.find(p => p.id === hover);
  const yName = freeItemName(yItem, persp.y), xName = freeItemName(xItem, persp.x);
  const unitText = (kind: typeof xKind, p: Persp) => kind.unit === 'percent' ? (p === 'diff' ? '（差・ポイント）' : '') : '';
  const rangeReason = seasonTotals ? 'Shooting はレギュラーシーズン全体の値のため、期間・試合種別の絞り込みは効きません。' : undefined;
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)), disabledReason: rangeReason } : { ...a, tier: 'primary' as const, disabledReason: rangeReason });
  const itemAxis = (id: string, label: string, value: string, defaultValue: string, onChange: (v: string) => void): FilterAxis => ({
    kind: 'select', id, label, tier: 'primary', value, defaultValue,
    options: freeItems(season).map(i => { const reason = freeCategoryBlock(i.category, request.data?.teams ?? null, category, reasons); return { value: i.id, label: i.label, group: i.categoryLabel, disabled: !!reason, disabledReason: reason }; }),
    onChange,
  });
  const perspAxis = (id: string, label: string, value: Persp, onChange: (v: Persp) => void): FilterAxis => ({
    kind: 'select', id, label, tier: 'primary', value, defaultValue: 'own', options: PERSPS.map(v => ({ value: v, label: TEAM_PERSPECTIVE_LABELS[v] })), onChange: v => onChange(v as Persp),
  });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season, { disabledReason: rangeReason }),
    itemAxis('freeY', '縦軸', yItem.id, DEFAULT_FREE_Y, v => setYId(v)), perspAxis('freeYPersp', '縦軸の視点', persp.y, v => setPersp(p => ({ ...p, y: v }))),
    itemAxis('freeX', '横軸', xItem.id, DEFAULT_FREE_X, v => setXId(v)), perspAxis('freeXPersp', '横軸の視点', persp.x, v => setPersp(p => ({ ...p, x: v }))),
    { kind: 'select', id: 'freeMode', label: '平均／合計', tier: 'primary', value: mode, defaultValue: 'perGame', options: [{ value: 'perGame', label: '1試合平均' }, { value: 'total', label: '合計' }], onChange: v => setMode(v as 'perGame' | 'total') },
    hl.axis];
  const [periodLabel] = situationalFilterLabels(seasonTotals ? { range: { kind: 'all' } } : filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[seasonTotals ? 'regular' : gameType], mode === 'total' ? '合計' : '1試合平均', ...hl.labels];
  const baseDate = { kind: 'season' as const, season, gameType: seasonTotals ? 'regular' as const : gameType };
  const columns: Column<FreeRow>[] = [
    { key: 'team', label: 'チーム', align: 'left', sortValue: p => p.teamName, render: p => <button className="ratings-team-button" onClick={() => setHover(p.teamId)}><TeamLogo teamId={p.teamId} size={20} /><ResponsiveTeamName teamId={p.teamId} name={p.teamName} /></button> },
    { key: 'g', label: 'G', sortValue: p => p.games },
    { key: 'y', label: yName, sortValue: p => yCol.value(p) ?? Number.NaN, render: p => yCol.text(p) },
    { key: 'x', label: xName, sortValue: p => xCol.value(p) ?? Number.NaN, render: p => xCol.text(p) },
  ];
  const pointRows = points.map(p => p.team);
  return <section aria-label={`${yName} × ${xName}`}>
    <FilterBar axes={axes} stateKey="figures:team-free-scatter" onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setYId(DEFAULT_FREE_Y); setXId(DEFAULT_FREE_X); setPersp(DEFAULT_PERSP); setMode('perGame'); hl.setIds([]); setHover(null); }} />
    {request.loading ? <p role="status">読み込み中…</p> : request.error || request.data?.missing ? <p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p> : !points.length || !model?.league ? <p className="empty-message">この条件で表示できるチームがありません。</p> : <>
      <FigureExportButton targetRef={target} filename={`${yName}_${xName}_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export axis-scatter-export" baseDate={baseDate}>
        <ConditionTitle title={`${yName} × ${xName}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <AxisScatter points={points} xDomain={xDomain} yDomain={yDomain} xLabel={`${xName}${unitText(xKind, persp.x)}`} yLabel={`${yName}${unitText(yKind, persp.y)}`} zeroLines={persp.x === 'diff' || persp.y === 'diff'}
          xTick={v => freeTickText(v, xKind, xDomain)} yTick={v => freeTickText(v, yKind, yDomain)}
          avgX={avgX} avgY={avgY} avgXText={xCol.text(model.league)} avgYText={yCol.text(model.league)} onDismiss={() => setHover(null)}
          renderMarker={(p, left, top) => <TeamLogoPoint key={p.id} teamId={p.team.teamId} teamName={p.team.teamName} division={p.team.division} emphasized={hl.has([p.team.teamId])} label={`${teamLabel(p.team.teamId, p.team.teamName)}：${yName} ${yCol.text(p.team)}、${xName} ${xCol.text(p.team)}`}
            expanded={hover === p.id} left={left} top={top} onSelect={() => setHover(p.id)} onDismiss={() => setHover(null)} />}
          tooltip={tip ? { point: tip, node: <><strong>{teamLabel(tip.team.teamId, tip.team.teamName)}</strong><span>{yName} {yCol.text(tip.team)} / {xName} {xCol.text(tip.team)}</span><span>{tip.team.games}試合</span></> } : null} />
      </ExportTarget>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="チーム一覧"><SortableTable columns={columns} rows={pointRows} rowKey={p => p.teamId} defaultSortKey="y" statScope="team"
        rowHighlightColor={p => hover === p.teamId || hl.has([p.teamId]) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}
