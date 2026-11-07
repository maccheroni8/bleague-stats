import { playerCountLines } from '../lib/figurePlayerCounts';
import { useMemo, useRef, useState } from 'react';
import { teamShortName } from '../../shared/teamNames';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import type { Division } from '../../shared/types';
import { divisionListParam, enumParam, numberParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { classificationAxis, divisionMultiAxis, gameTypeAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import type { SituationalFilter } from '../lib/situational';
import { figureClassGroup } from '../lib/figureAge';
import { CLASSIFICATION_PARAM, GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import { classificationFilterLabel, splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from '../lib/classificationFilter';
import { DIVISION_LABELS, divisionOrder } from '../lib/divisionGroups';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { useTeamLabel } from '../lib/teamLabel';
import { usePlayerLabel } from '../lib/playerLabel';
import { formatDecimal, formatPct100 } from '../lib/format';
import { axisDomain, totalBase } from '../lib/figureAxis';
import { buildPlayerFigurePoints, playerColumnText, type PlayerFigurePoint } from '../lib/figurePlayerPoints';
import {
  DEFAULT_SHOOT_X, DEFAULT_SHOOT_Y, meanOf, SHOOT_MIN_ATTEMPTS, SHOOT_X, SHOOT_X_BASE, SHOOT_X_COLUMN, SHOOT_X_LABELS, SHOOT_Y, SHOOT_Y_BASE,
  SHOOT_Y_COLUMN, SHOOT_Y_LABELS, shootPlayerPoints, type ShootPlayerPoint, type ShootX, type ShootY,
} from '../lib/figureShooting';
import type { SeasonDisplayMode } from '../lib/playerSeasonBoxscore';
import { EligibilitySlider } from '../components/EligibilitySlider';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ConditionTitle } from '../components/ConditionTitle';
import { SortableTable, type Column } from '../components/SortableTable';
import { FigureExportButton } from './FigureExport';
import { ratioEligibilityAxis } from './eligibilityAxis';
import { ScorerPhoto } from './TopScorersFigure';
import { AxisScatter } from './AxisScatter';
import { usePlayerFigureData } from './usePlayerFigureData';
import { useHighlightClubs } from './highlightClubs';
import { usePlayerFigureFilter } from './usePlayerFigureFilter';
import type { FigureProps } from './catalog';
import './RatingsScatterFigure.css';
import './TopScorersFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const EMPTY: Division[] = [];
const DEFAULT_RATIO = 85;
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
const yCodec = enumParam<ShootY>('shy', SHOOT_Y, DEFAULT_SHOOT_Y);
const xCodec = enumParam<ShootX>('shx', SHOOT_X, DEFAULT_SHOOT_X);
const modeCodec = enumParam<'perGame' | 'total'>('shm', ['perGame', 'total'], 'perGame', { total: 'tot' });
const ratioCodec = numberParam('shr', DEFAULT_RATIO, { min: 0, max: 100 });
/** 試投数の下限。-1 ＝ 横軸の項目ごとの初期値 */
const minCodec = numberParam('shn', -1, { min: -1, max: 50 });

export default function PlayerShootingFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [classification, setClassification] = useUrlState(CLASSIFICATION_PARAM, 'all');
  const [yAxis, setY] = useUrlState(yCodec, DEFAULT_SHOOT_Y);
  const [xAxis, setX] = useUrlState(xCodec, DEFAULT_SHOOT_X);
  const [mode, setMode] = useUrlState(modeCodec, 'perGame');
  const [minRatio, setMinRatio] = useUrlState(ratioCodec, DEFAULT_RATIO);
  const [minParam, setMin] = useUrlState(minCodec, -1);
  const [hover, setHover] = useState<string | null>(null);
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = usePlayerFigureData(season, category);
  const m = mode as SeasonDisplayMode;
  const minLimit = SHOOT_MIN_ATTEMPTS[xAxis];
  const minAttempts = minParam < 0 ? minLimit.default : Math.min(minParam, minLimit.max);
  const base = useMemo(() => request.data ? buildPlayerFigurePoints(request.data, { season, category, range: filter.range, gameType, classification }) : [], [request.data, season, category, filter, gameType, classification]);
  const teams = request.data?.teams ?? [];
  const divisionOf = (id: string) => request.data?.divisions?.[category]?.[season]?.[id];
  const ratioPassed = useMemo(() => base.filter(p => p.ratio >= minRatio), [base, minRatio]);
  const pf = usePlayerFigureFilter({ season, category, teams, divisionOf, ratioPassed, clubKey: 'shl', legacyDivisionKey: 'dv', axisId: 'pshClubs' });
  const eligible = pf.eligible;
  const plotted = useMemo(() => shootPlayerPoints(eligible, season, m, xAxis, yAxis, minAttempts), [eligible, season, m, xAxis, yAxis, minAttempts]);
  const items = plotted.map(s => ({ id: s.p.id, x: s.x, y: s.y, s }));
  const countLines = playerCountLines(plotted.map(s => s.p.playerId), request.data?.players ?? [], request.data?.registrations, classification);
  const playerLabel = usePlayerLabel(eligible.map(p => p.name));
  const avgX = meanOf(plotted.map(s => s.x)), avgY = meanOf(plotted.map(s => s.y));
  const maxGames = Math.max(0, ...plotted.map(s => s.p.teamGames));
  const xBase = mode === 'total' ? totalBase(SHOOT_X_BASE.player[xAxis], maxGames) : SHOOT_X_BASE.player[xAxis];
  const xDomain = axisDomain([...plotted.map(s => s.x), avgX], xBase), yDomain = axisDomain([...plotted.map(s => s.y), avgY], SHOOT_Y_BASE.player[yAxis]);
  const tip = items.find(i => i.id === hover);
  const yName = SHOOT_Y_LABELS[yAxis], xName = SHOOT_X_LABELS[xAxis];
  const xTitle = `${xName}（${mode === 'total' ? '合計' : '1試合平均'}）`;
  const hl = useHighlightClubs({ season, category, teams, divisionOf });
  const abbr = (p: PlayerFigurePoint) => p.teamIds.map(id => teamShortName(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const names = (p: PlayerFigurePoint) => p.teamIds.map(id => teamLabel(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const txt = (p: PlayerFigurePoint, key: string) => playerColumnText(p, key, m, season);
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)) } : { ...a, tier: 'primary' as const });
  const select = (id: string, label: string, value: string, defaultValue: string, options: { value: string; label: string }[], onChange: (v: string) => void): FilterAxis =>
    ({ kind: 'select', id, label, tier: 'primary', value, defaultValue, options, onChange });
  const minSummary = `${xName} ${formatDecimal(minAttempts, 1)}以上（1試合）`;
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season),
    select('pshY', '縦軸', yAxis, DEFAULT_SHOOT_Y, SHOOT_Y.map(k => ({ value: k, label: SHOOT_Y_LABELS[k] })), v => setY(v as ShootY)),
    select('pshX', '横軸', xAxis, DEFAULT_SHOOT_X, SHOOT_X.map(k => ({ value: k, label: SHOOT_X_LABELS[k] })), v => { setX(v as ShootX); setMin(-1); }),
    select('pshMode', '平均／合計', mode, 'perGame', [{ value: 'perGame', label: '1試合平均' }, { value: 'total', label: '合計' }], v => setMode(v as 'perGame' | 'total')),
    classificationAxis(classification, setClassification, { season }),
    pf.clubAxis, pf.positionAxis,
    { kind: 'popover', id: 'pshMin', label: '試投数の下限', tier: 'primary', value: String(minAttempts), defaultValue: String(minLimit.default), onChange: () => setMin(-1), summary: minSummary, chipValue: minSummary,
      content: <EligibilitySlider label={`${xName}（1試合平均）`} value={minAttempts} min={0} max={minLimit.max} step={minLimit.step} format={v => formatDecimal(v, 1)} onChange={v => setMin(v)} /> },
    hl.axis,
    ratioEligibilityAxis({ id: 'pshRatio', value: minRatio, defaultValue: DEFAULT_RATIO, onChange: setMinRatio })];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[gameType], mode === 'total' ? '合計' : '1試合平均', classificationFilterLabel(classification),
    ...pf.labels, `出場率${minRatio}%以上`, `${xName} ${formatDecimal(minAttempts, 1)}以上（1試合）`, ...hl.labels].filter(Boolean);
  const baseDate = { kind: 'season' as const, season, gameType };
  const select_ = (p: PlayerFigurePoint) => { setHover(p.id); };
  const columns: Column<ShootPlayerPoint>[] = [
    { key: 'player', label: '選手名（チーム）', align: 'left', sortValue: s => s.p.name, render: s => <button className="ratings-team-button" onClick={() => select_(s.p)}>{playerLabel(s.p.name)}（{abbr(s.p)}）{s.p.teamIds.length > 1 ? '合算' : ''}</button> },
    { key: 'g', label: 'G', sortValue: s => s.p.games },
    { key: 'ratio', label: '出場率', sortValue: s => s.p.ratio, render: s => formatPct100(s.p.ratio) },
    { key: 'y', label: yName, sortValue: s => s.y, render: s => txt(s.p, SHOOT_Y_COLUMN[yAxis]) },
    { key: 'x', label: xName, sortValue: s => s.x, render: s => txt(s.p, SHOOT_X_COLUMN[xAxis]) },
  ];
  return <section aria-label={`${yName} × ${xName}`}>
    <FilterBar axes={axes} stateKey="figures:player-shooting" advancedExtra={pf.advancedExtra} onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setClassification('all'); setY(DEFAULT_SHOOT_Y); setX(DEFAULT_SHOOT_X); setMode('perGame'); pf.reset(); setMin(-1); setMinRatio(DEFAULT_RATIO); hl.setIds([]); setHover(null); }} />
    {splitClassificationBlocked(figureClassGroup(classification), season) ? <p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">選手の試合データを読み込み中…</p> : request.error ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : !plotted.length ? <p>この条件に該当する選手はいません。</p> : <>
      <p className="figure-count">{plotted.length}人を表示</p>
      <FigureExportButton targetRef={target} filename={`選手_${yName}_${xName}_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export scorers-export axis-scatter-export" baseDate={baseDate}>
        <ConditionTitle title={`${yName} × ${xName}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <AxisScatter points={items} xDomain={xDomain} yDomain={yDomain} xLabel={xTitle} yLabel={yName}
          xTick={v => mode === 'total' ? formatDecimal(v, 0) : Number.isInteger(xDomain.step) ? formatDecimal(v, 0) : formatDecimal(v, 1)} yTick={v => `${v}%`}
          avgX={avgX} avgY={avgY} avgXText={formatDecimal(avgX!)} avgYText={formatPct100(avgY!)} countLines={countLines} onDismiss={() => setHover(null)}
          renderMarker={(i, left, top) => <ScorerPhoto key={i.id} point={{ playerId: i.s.p.playerId, name: i.s.p.name, division: i.s.p.division }}
            label={`${playerLabel(i.s.p.name)}：${yName} ${txt(i.s.p, SHOOT_Y_COLUMN[yAxis])}、${xName} ${txt(i.s.p, SHOOT_X_COLUMN[xAxis])}`}
            selected={hl.has(i.s.p.teamIds)} expanded={i.id === hover} left={left} top={top} onSelect={() => select_(i.s.p)} onDismiss={() => setHover(null)} />}
          tooltip={tip ? { point: tip, node: <><strong>{playerLabel(tip.s.p.name)}（{names(tip.s.p)}）</strong><span>{yName} {txt(tip.s.p, SHOOT_Y_COLUMN[yAxis])} / {xName} {txt(tip.s.p, SHOOT_X_COLUMN[xAxis])}</span><span>出場率 {formatPct100(tip.s.p.ratio)}</span><span>{tip.s.p.games}試合{tip.s.p.teamIds.length > 1 ? '・複数チームの合算' : ''}</span></> } : null} />
      </ExportTarget>
      <div className="table-scroll scorers-table" tabIndex={0} role="region" aria-label="選手一覧"><SortableTable columns={columns} rows={plotted} rowKey={s => s.p.id} defaultSortKey="x"
        rowHighlightColor={s => hl.has(s.p.teamIds) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}
