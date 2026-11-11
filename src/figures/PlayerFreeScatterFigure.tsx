import { useMemo, useRef, useState } from 'react';
import { teamShortName } from '../../shared/teamNames';
import { TeamChipList } from '../components/TeamChip';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { enumParam, numberParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { classificationAxis, gameTypeAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import type { SituationalFilter } from '../lib/situational';
import { figureClassGroup } from '../lib/figureAge';
import { CLASSIFICATION_PARAM, GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import { classificationFilterLabel, splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from '../lib/classificationFilter';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { useTeamLabel } from '../lib/teamLabel';
import { usePlayerLabel } from '../lib/playerLabel';
import { formatPct100 } from '../lib/format';
import { playerCountLines } from '../lib/figurePlayerCounts';
import { buildPlayerFigurePoints, passesRatio, type PlayerFigurePoint } from '../lib/figurePlayerPoints';
import { freeAxisDomain, freeTickText, inferFreeAxis } from '../lib/figureTeamFree';
import {
  DEFAULT_PLAYER_FREE_X, DEFAULT_PLAYER_FREE_Y, isPlayerFreeSeasonTotal, PLAYER_FREE_ON_COURT_REASON, playerFreeColumn, playerFreeItemBlock, playerFreeItems, resolvePlayerFreeItem,
} from '../lib/figurePlayerFree';
import { ONE_RANKING_SHOOTING_REASON } from '../lib/leagueAvailability';
import { statJa } from '../lib/statNames';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ConditionTitle } from '../components/ConditionTitle';
import { SortableTable, type Column } from '../components/SortableTable';
import { FigureExportButton } from './FigureExport';
import { ratioEligibilityAxis } from './eligibilityAxis';
import { useFigureAchievable } from './useFigureAchievable';
import { eligibilityLabels } from '../lib/conditionLabels';

import { ScorerPhoto } from './TopScorersFigure';
import { AxisScatter } from './AxisScatter';
import { usePlayerFigureData } from './usePlayerFigureData';
import { usePlayerFigureFilter } from './usePlayerFigureFilter';
import { useHighlightClubs } from './highlightClubs';
import type { FigureProps } from './catalog';
import './RatingsScatterFigure.css';
import './TopScorersFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const DEFAULT_RATIO = 85;
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
const itemCodec = (key: string, fallback: string): UrlCodec<string> => ({
  keys: [key],
  read: p => p.get(key) ?? undefined,
  write: (p, v) => { if (v !== fallback) p.set(key, v); },
});
const yCodec = itemCodec('py', DEFAULT_PLAYER_FREE_Y);
const xCodec = itemCodec('px', DEFAULT_PLAYER_FREE_X);
const modeCodec = enumParam<'perGame' | 'total'>('pam', ['perGame', 'total'], 'perGame', { total: 'tot' });
const ratioCodec = numberParam('pag', DEFAULT_RATIO, { min: 0, max: 100 });

/** 平均線の値の文字（率は%、時間は分:秒、そのほかは小数第2位） */
const avgText = (v: number, kind: ReturnType<typeof inferFreeAxis>) => kind.unit === 'time' ? freeTickText(v, kind, { min: 0, max: 0, step: 1, ticks: [] }) : `${v.toFixed(2)}${kind.unit === 'percent' ? '%' : ''}`;

export default function PlayerFreeScatterFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [classification, setClassification] = useUrlState(CLASSIFICATION_PARAM, 'all');
  const [yId, setYId] = useUrlState(yCodec, DEFAULT_PLAYER_FREE_Y);
  const [xId, setXId] = useUrlState(xCodec, DEFAULT_PLAYER_FREE_X);
  const [mode, setMode] = useUrlState(modeCodec, 'perGame');
  const [minRatio, setMinRatio] = useUrlState(ratioCodec, DEFAULT_RATIO);
  const [hover, setHover] = useState<string | null>(null);
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = usePlayerFigureData(season, category);
  const players = request.data?.players ?? null;
  const reasons = { shooting: ONE_RANKING_SHOOTING_REASON, onCourt: (label: string) => PLAYER_FREE_ON_COURT_REASON(statJa(label)), none: 'このシーズンのデータには対応していません' };
  const blocked = (id: string) => { const item = playerFreeItems(season).find(i => i.id === id); return item ? playerFreeItemBlock(item, players, category, reasons, season) : undefined; };
  // URL の項目が選べない（古い・B.ONE で出せない）ときは、初期の項目で描く
  const xItem = resolvePlayerFreeItem(blocked(xId) ? undefined : xId, season, DEFAULT_PLAYER_FREE_X), yItem = resolvePlayerFreeItem(blocked(yId) ? undefined : yId, season, DEFAULT_PLAYER_FREE_Y);
  const seasonTotals = isPlayerFreeSeasonTotal(xItem) || isPlayerFreeSeasonTotal(yItem);
  const m = mode as 'perGame' | 'total';
  const base = useMemo(() => request.data ? buildPlayerFigurePoints(request.data, { season, category, range: seasonTotals ? { kind: 'all' } : filter.range, gameType: seasonTotals ? 'regular' : gameType, classification }) : [],
    [request.data, season, category, filter, gameType, classification, seasonTotals]);
  const teams = request.data?.teams ?? [];
  const divisionOf = (id: string) => request.data?.divisions?.[category]?.[season]?.[id];
  const ach = useFigureAchievable(season, category, { range: filter.range, gameType: seasonTotals ? 'regular' : gameType });
  const ratioPassed = useMemo(() => base.filter(p => passesRatio(p, minRatio, ach.remaining)), [base, minRatio, ach.remaining]);
  const pf = usePlayerFigureFilter({ season, category, teams, divisionOf, ratioPassed, clubKey: 'pcl', legacyDivisionKey: 'dv', axisId: 'pfreeClubs' });
  const eligible = pf.eligible;
  const xCol = playerFreeColumn(xItem, m, season)!, yCol = playerFreeColumn(yItem, m, season)!;
  const points = useMemo(() => eligible.flatMap(p => { const x = xCol.value(p), y = yCol.value(p); return x === null || y === null ? [] : [{ id: p.id, x, y, p }]; }), [eligible, xCol, yCol]);
  const xKind = inferFreeAxis(xCol, points.map(s => s.p)), yKind = inferFreeAxis(yCol, points.map(s => s.p));
  const items = points.map(s => ({ ...s, x: s.x * xKind.scale, y: s.y * yKind.scale }));
  const mean = (values: number[]) => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const avgX = mean(items.map(i => i.x)), avgY = mean(items.map(i => i.y));
  const xDomain = freeAxisDomain([...items.map(i => i.x), avgX], xKind, false), yDomain = freeAxisDomain([...items.map(i => i.y), avgY], yKind, false);
  const countLines = playerCountLines(items.map(i => i.p.playerId), players ?? [], request.data?.registrations, classification);
  const playerLabel = usePlayerLabel(eligible.map(p => p.name));
  const tip = items.find(i => i.id === hover);
  const hl = useHighlightClubs({ season, category, teams, divisionOf });
  const abbrOf = (id: string, p?: PlayerFigurePoint) => teamShortName(id, teams.find(t => t.teamId === id)?.teamName ?? p?.teamName ?? '');
  const abbr = (p: PlayerFigurePoint) => p.teamIds.map(id => teamShortName(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const names = (p: PlayerFigurePoint) => p.teamIds.map(id => teamLabel(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const yName = yItem.label, xName = xItem.label;
  const rangeReason = seasonTotals ? 'Shooting・PER はシーズン通算の値のため、期間・試合種別の絞り込みは効きません。' : undefined;
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)), disabledReason: rangeReason } : { ...a, tier: 'primary' as const, disabledReason: rangeReason });
  const itemAxis = (id: string, label: string, value: string, defaultValue: string, onChange: (v: string) => void): FilterAxis => ({
    kind: 'select', id, label, tier: 'primary', value, defaultValue,
    options: playerFreeItems(season).map(i => { const reason = playerFreeItemBlock(i, players, category, reasons, season); return { value: i.id, label: i.label, group: i.categoryLabel, disabled: !!reason, disabledReason: reason }; }),
    onChange,
  });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season, { disabledReason: rangeReason }),
    itemAxis('pfreeY', '縦軸', yItem.id, DEFAULT_PLAYER_FREE_Y, v => setYId(v)),
    itemAxis('pfreeX', '横軸', xItem.id, DEFAULT_PLAYER_FREE_X, v => setXId(v)),
    { kind: 'select', id: 'pfreeMode', label: '平均／合計', tier: 'primary', value: mode, defaultValue: 'perGame', options: [{ value: 'perGame', label: '1試合平均' }, { value: 'total', label: '合計' }], onChange: v => setMode(v as 'perGame' | 'total') },
    classificationAxis(classification, setClassification, { season }),
    pf.clubAxis, pf.positionAxis, hl.axis,
    ratioEligibilityAxis({ id: 'pfreeRatio', value: minRatio, defaultValue: DEFAULT_RATIO, onChange: setMinRatio, achievable: ach.axis })];
  const [periodLabel] = situationalFilterLabels(seasonTotals ? { range: { kind: 'all' } } : filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[seasonTotals ? 'regular' : gameType], mode === 'total' ? '合計' : '1試合平均', classificationFilterLabel(classification),
    ...pf.labels, ...eligibilityLabels({ gamesRatio: minRatio / 100, achievable: ach.achievable }), ...hl.labels].filter(Boolean);
  const baseDate = { kind: 'season' as const, season, gameType: seasonTotals ? 'regular' as const : gameType };
  const pick = (p: PlayerFigurePoint) => setHover(p.id);
  type Row = typeof items[number];
  const columns: Column<Row>[] = [
    { key: 'player', label: '選手名（チーム）', align: 'left', sortValue: s => s.p.name, render: s => <button className="ratings-team-button" onClick={() => pick(s.p)}>{playerLabel(s.p.name)}（<TeamChipList ids={s.p.teamIds} labelOf={abbrOf} />）{s.p.teamIds.length > 1 ? '合算' : ''}</button> },
    { key: 'g', label: 'G', sortValue: s => s.p.games },
    { key: 'ratio', label: '出場率', sortValue: s => s.p.ratio, render: s => formatPct100(s.p.ratio) },
    { key: 'y', label: yName, sortValue: s => s.y, render: s => yCol.text(s.p) },
    { key: 'x', label: xName, sortValue: s => s.x, render: s => xCol.text(s.p) },
  ];
  return <section aria-label={`${yName} × ${xName}`}>
    <FilterBar axes={axes} stateKey="figures:player-free-scatter" advancedExtra={pf.advancedExtra} onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setClassification('all'); setYId(DEFAULT_PLAYER_FREE_Y); setXId(DEFAULT_PLAYER_FREE_X); setMode('perGame'); pf.reset(); setMinRatio(DEFAULT_RATIO); ach.reset(); hl.setIds([]); setHover(null); }} />
    {splitClassificationBlocked(figureClassGroup(classification), season) ? <p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">選手の試合データを読み込み中…</p> : request.error ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : !items.length ? <p>この条件に該当する選手はいません。</p> : <>
      <p className="figure-count">{items.length}人を表示</p>
      <FigureExportButton targetRef={target} filename={`選手_${yName}_${xName}_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export scorers-export axis-scatter-export" baseDate={baseDate}>
        <ConditionTitle title={`${yName} × ${xName}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <AxisScatter points={items} xDomain={xDomain} yDomain={yDomain} xLabel={xName} yLabel={yName}
          xTick={v => freeTickText(v, xKind, xDomain)} yTick={v => freeTickText(v, yKind, yDomain)}
          avgX={avgX} avgY={avgY} avgXText={avgX === null ? '' : avgText(avgX, xKind)} avgYText={avgY === null ? '' : avgText(avgY, yKind)}
          countLines={countLines} onDismiss={() => setHover(null)}
          renderMarker={(i, left, top) => <ScorerPhoto key={i.id} point={{ playerId: i.p.playerId, name: i.p.name, division: i.p.division }}
            label={`${playerLabel(i.p.name)}：${yName} ${yCol.text(i.p)}、${xName} ${xCol.text(i.p)}`}
            selected={hl.has(i.p.teamIds)} expanded={i.id === hover} left={left} top={top} onSelect={() => pick(i.p)} onDismiss={() => setHover(null)} />}
          tooltip={tip ? { point: tip, node: <><strong>{playerLabel(tip.p.name)}（{names(tip.p)}）</strong><span>{yName} {yCol.text(tip.p)} / {xName} {xCol.text(tip.p)}</span><span>出場率 {formatPct100(tip.p.ratio)}</span><span>{tip.p.games}試合{tip.p.teamIds.length > 1 ? '・複数チームの合算' : ''}</span></> } : null} />
      </ExportTarget>
      <div className="table-scroll scorers-table" tabIndex={0} role="region" aria-label="選手一覧"><SortableTable columns={columns} rows={items} rowKey={s => s.p.id} defaultSortKey="y"
        rowHighlightColor={s => hl.has(s.p.teamIds) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}
