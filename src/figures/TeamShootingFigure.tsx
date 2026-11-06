import { useMemo, useRef, useState } from 'react';
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory, teamLogoUrl } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import { enumParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import type { TeamPerspective } from '../lib/teamStatsColumns';
import { gameTypeAxis, perspectiveAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import { GAME_TYPE_PARAM, PERSPECTIVE_PARAM } from '../lib/urlFilterParams';
import type { SituationalFilter } from '../lib/situational';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { DIVISION_RATING_COLORS } from '../lib/figureRatings';
import { axisDomain, totalBase } from '../lib/figureAxis';
import {
  buildShootTeams, teamColumnText, DEFAULT_SHOOT_X, DEFAULT_SHOOT_Y, SHOOT_X, shootTeamXBase, shootTeamYBase, SHOOT_X_COLUMN, SHOOT_X_LABELS,
  SHOOT_Y, SHOOT_Y_COLUMN, SHOOT_Y_LABELS, type ShootTeamPoint, type ShootX, type ShootY,
} from '../lib/figureShooting';
import type { SeasonDisplayMode } from '../lib/playerSeasonBoxscore';
import { formatDecimal, formatPct100 } from '../lib/format';
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
const yCodec = enumParam<ShootY>('shy', SHOOT_Y, DEFAULT_SHOOT_Y);
const xCodec = enumParam<ShootX>('shx', SHOOT_X, DEFAULT_SHOOT_X);
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

export default function TeamShootingFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [yAxis, setY] = useUrlState(yCodec, DEFAULT_SHOOT_Y);
  const [xAxis, setX] = useUrlState(xCodec, DEFAULT_SHOOT_X);
  const [mode, setMode] = useUrlState(modeCodec, 'perGame');
  const [perspective, setPerspective] = useUrlState(PERSPECTIVE_PARAM, 'own');
  const persp = perspective as TeamPerspective;
  const [hover, setHover] = useState<string | null>(null);
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = useJsonData(async () => {
    const teams = await fetchTeams(season, category);
    const [divisions, entries] = await Promise.all([fetchDivisionHistory().catch(() => null), Promise.all(teams.map(async team => {
      try { return [team.teamId, await fetchTeamGameLogs(season, team.teamId, category)] as const; } catch { return [team.teamId, null] as const; }
    }))]);
    return { teams, divisions, missing: entries.filter(([, l]) => l === null).length, logs: new Map(entries.map(([id, l]) => [id, l ?? []])) };
  }, [season, category]);
  const model = useMemo(() => request.data && !request.data.missing ? buildShootTeams(request.data.teams, request.data.logs, request.data.divisions, { season, category, range: filter.range, gameType, mode: mode as SeasonDisplayMode, perspective: persp }) : null,
    [request.data, season, category, filter, gameType, mode, persp]);
  const hl = useHighlightClubs({ season, category, teams: request.data?.teams ?? [], divisionOf: id => request.data?.divisions?.[category]?.[season]?.[id] });
  const points = (model?.points ?? []).filter(p => p.x[xAxis] !== null && p.y[yAxis] !== null);
  const plot = points.map(p => ({ id: p.teamId, x: p.x[xAxis]!, y: p.y[yAxis]!, team: p }));
  const maxGames = Math.max(0, ...points.map(p => p.games));
  const xBase0 = shootTeamXBase(xAxis, persp), xBase = mode === 'total' ? totalBase(xBase0, maxGames) : xBase0;
  const avgY = model?.league?.y[yAxis] ?? null, avgX = model?.league?.x[xAxis] ?? null;
  const xDomain = axisDomain([...plot.map(p => p.x), avgX], xBase), yDomain = axisDomain([...plot.map(p => p.y), avgY], shootTeamYBase(yAxis, persp));
  const tip = plot.find(p => p.id === hover);
  const yName = SHOOT_Y_LABELS[yAxis], xName = SHOOT_X_LABELS[xAxis];
  const diff = persp === 'diff';
  const perspLabel = persp === 'opp' ? '相手' : diff ? '+/-' : '';
  const xTitle = `${perspLabel === '相手' ? '相手の' : ''}${xName}${diff ? ' の差' : ''}（${mode === 'total' ? '合計' : '1試合平均'}）`;
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)) } : { ...a, tier: 'primary' as const });
  const select = (id: string, label: string, value: string, defaultValue: string, options: { value: string; label: string }[], onChange: (v: string) => void): FilterAxis =>
    ({ kind: 'select', id, label, tier: 'primary', value, defaultValue, options, onChange });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season),
    select('shootY', '縦軸', yAxis, DEFAULT_SHOOT_Y, SHOOT_Y.map(k => ({ value: k, label: SHOOT_Y_LABELS[k] })), v => setY(v as ShootY)),
    select('shootX', '横軸', xAxis, DEFAULT_SHOOT_X, SHOOT_X.map(k => ({ value: k, label: SHOOT_X_LABELS[k] })), v => setX(v as ShootX)),
    perspectiveAxis(persp, v => setPerspective(v)),
    select('shootMode', '平均／合計', mode, 'perGame', [{ value: 'perGame', label: '1試合平均' }, { value: 'total', label: '合計' }], v => setMode(v as 'perGame' | 'total')), hl.axis];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[gameType], mode === 'total' ? '合計' : '1試合平均', ...(perspLabel ? [persp === 'opp' ? '視点：相手（opp）' : '視点：+/-（自チーム − 相手）'] : []), ...hl.labels];
  const baseDate = { kind: 'season' as const, season, gameType };
  const columns: Column<ShootTeamPoint>[] = [
    { key: 'team', label: 'チーム', align: 'left', sortValue: p => p.teamName, render: p => <button className="ratings-team-button" onClick={() => setHover(p.teamId)}><TeamLogo teamId={p.teamId} size={20} /><ResponsiveTeamName teamId={p.teamId} name={p.teamName} /></button> },
    { key: 'g', label: 'G', sortValue: p => p.games },
    { key: 'y', label: yName, sortValue: p => p.y[yAxis] ?? Number.NaN, render: p => teamColumnText(p.row, SHOOT_Y_COLUMN[yAxis], mode as SeasonDisplayMode, persp) },
    { key: 'x', label: xName, sortValue: p => p.x[xAxis] ?? Number.NaN, render: p => teamColumnText(p.row, SHOOT_X_COLUMN[xAxis], mode as SeasonDisplayMode, persp) },
  ];
  return <section aria-label={`${yName} × ${xName}`}>
    <FilterBar axes={axes} stateKey="figures:team-shooting" onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setY(DEFAULT_SHOOT_Y); setX(DEFAULT_SHOOT_X); setMode('perGame'); setPerspective('own'); hl.setIds([]); setHover(null); }} />
    {request.loading ? <p role="status">読み込み中…</p> : request.error || request.data?.missing ? <p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p> : !plot.length || !model?.league ? <p className="empty-message">この条件で表示できるチームがありません。</p> : <>
      <FigureExportButton targetRef={target} filename={`シュート率_試投数_${yName}_${xName}_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export axis-scatter-export" baseDate={baseDate}>
        <ConditionTitle title={`${yName} × ${xName}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <AxisScatter points={plot} xDomain={xDomain} yDomain={yDomain} xLabel={xTitle} yLabel={diff ? `${yName}（差・ポイント）` : yName} zeroLines={diff}
          xTick={v => `${diff && v > 0 ? '+' : ''}${mode === 'total' ? formatDecimal(v, 0) : formatDecimal(v, step(xDomain.step))}`} yTick={v => diff ? `${v > 0 ? '+' : ''}${v}` : `${v}%`}
          avgX={avgX} avgY={avgY} avgXText={teamColumnText(model.leagueRow!, SHOOT_X_COLUMN[xAxis], mode as SeasonDisplayMode, persp)} avgYText={(diff ? formatDecimal(avgY!) : formatPct100(avgY!))}
          renderMarker={(p, left, top) => <TeamLogoPoint key={p.id} teamId={p.team.teamId} teamName={p.team.teamName} division={p.team.division} emphasized={hl.has([p.team.teamId])} label={`${teamLabel(p.team.teamId, p.team.teamName)}：${yName} ${teamColumnText(p.team.row, SHOOT_Y_COLUMN[yAxis], mode as SeasonDisplayMode, persp)}、${xName} ${teamColumnText(p.team.row, SHOOT_X_COLUMN[xAxis], mode as SeasonDisplayMode, persp)}`}
            expanded={hover === p.id} left={left} top={top} onSelect={() => setHover(p.id)} onDismiss={() => setHover(null)} />}
          tooltip={tip ? { point: tip, node: <><strong>{teamLabel(tip.team.teamId, tip.team.teamName)}</strong><span>{yName} {teamColumnText(tip.team.row, SHOOT_Y_COLUMN[yAxis], mode as SeasonDisplayMode, persp)} / {xName} {teamColumnText(tip.team.row, SHOOT_X_COLUMN[xAxis], mode as SeasonDisplayMode, persp)}</span><span>{tip.team.games}試合</span></> } : null} />
      </ExportTarget>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="チーム一覧"><SortableTable columns={columns} rows={points} rowKey={p => p.teamId} defaultSortKey="y" statScope="team"
        rowHighlightColor={p => hover === p.teamId || hl.has([p.teamId]) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}
// 目盛りの小数の桁数（刻み幅が整数なら0桁）
const step = (s: number) => Number.isInteger(s) ? 0 : 1;
