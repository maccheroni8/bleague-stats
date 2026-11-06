import { useMemo, useRef, useState } from 'react';
import { teamShortName } from '../../shared/teamNames';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { enumParam, listParam, numberParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { classificationAxis, gameTypeAxis, situationalAxes, teamMultiAxis, type FilterAxis } from '../lib/filterAxes';
import { usePlayoffZonePresets } from '../lib/playoffZone';
import type { SituationalFilter } from '../lib/situational';
import { figureClassGroup } from '../lib/figureAge';
import { CLASSIFICATION_PARAM, GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import { classificationFilterLabel, splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from '../lib/classificationFilter';
import { divisionPresets } from '../lib/divisionGroups';
import { clubSelectionLabels, situationalFilterLabels } from '../lib/conditionLabels';
import { useTeamLabel } from '../lib/teamLabel';
import { usePlayerLabel } from '../lib/playerLabel';
import { formatDecimal, formatPct100 } from '../lib/format';
import { axisDomain, totalBase } from '../lib/figureAxis';
import { buildPlayerFigurePoints, playerColumnText, type PlayerFigurePoint } from '../lib/figurePlayerPoints';
import { meanOf, PTS_AST_BASE, PTS_AST_MIN, ptsAstPoints, type PtsAstPoint } from '../lib/figureShooting';
import { EligibilitySlider } from '../components/EligibilitySlider';
import type { SeasonDisplayMode } from '../lib/playerSeasonBoxscore';
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
import type { FigureProps } from './catalog';
import './RatingsScatterFigure.css';
import './TopScorersFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const EMPTY: string[] = [];
const DEFAULT_RATIO = 85;
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
const modeCodec = enumParam<'perGame' | 'total'>('pam', ['perGame', 'total'], 'perGame', { total: 'tot' });
const ratioCodec = numberParam('pag', DEFAULT_RATIO, { min: 0, max: 100 });
const clubsCodec = listParam('pcl');
const minPtsCodec = numberParam('pmp', 0, { min: 0, max: 100 });
const minAstCodec = numberParam('pma', 0, { min: 0, max: 100 });

export default function PtsAstFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [classification, setClassification] = useUrlState(CLASSIFICATION_PARAM, 'all');
  const [mode, setMode] = useUrlState(modeCodec, 'perGame');
  const [minRatio, setMinRatio] = useUrlState(ratioCodec, DEFAULT_RATIO);
  const [clubs, setClubs] = useUrlState(clubsCodec, EMPTY);
  const [minPts, setMinPts] = useUrlState(minPtsCodec, 0);
  const [minAst, setMinAst] = useUrlState(minAstCodec, 0);
  const [hover, setHover] = useState<string | null>(null);
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = usePlayerFigureData(season, category);
  const playoffZonePresets = usePlayoffZonePresets(season, category);
  const m = mode as SeasonDisplayMode;
  const base = useMemo(() => request.data ? buildPlayerFigurePoints(request.data, { season, category, range: filter.range, gameType, classification }) : [], [request.data, season, category, filter, gameType, classification]);
  const eligible = useMemo(() => base.filter(p => p.ratio >= minRatio && (!clubs.length || p.teamIds.some(id => clubs.includes(id)))), [base, minRatio, clubs]);
  const plotted = useMemo(() => ptsAstPoints(eligible, season, m, minPts, minAst), [eligible, season, m, minPts, minAst]);
  const items = plotted.map(s => ({ ...s, id: s.p.id }));
  const playerLabel = usePlayerLabel(eligible.map(p => p.name));
  const avgX = meanOf(plotted.map(s => s.x)), avgY = meanOf(plotted.map(s => s.y));
  const maxGames = Math.max(0, ...plotted.map(s => s.p.teamGames));
  const xDomain = axisDomain([...plotted.map(s => s.x), avgX], mode === 'total' ? totalBase(PTS_AST_BASE.ast, maxGames) : PTS_AST_BASE.ast);
  const yDomain = axisDomain([...plotted.map(s => s.y), avgY], mode === 'total' ? totalBase(PTS_AST_BASE.pts, maxGames) : PTS_AST_BASE.pts);
  const tip = items.find(i => i.id === hover);
  const teams = request.data?.teams ?? [];
  const divisionOf = (id: string) => request.data?.divisions?.[category]?.[season]?.[id];
  const hl = useHighlightClubs({ season, category, teams, divisionOf });
  const abbr = (p: PlayerFigurePoint) => p.teamIds.map(id => teamShortName(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const names = (p: PlayerFigurePoint) => p.teamIds.map(id => teamLabel(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const txt = (p: PlayerFigurePoint, key: string) => playerColumnText(p, key, m, season);
  const groups = divisionPresets(teams.map(t => t.teamId), divisionOf, category).map(g => ({ label: g.label, values: g.teamIds }));
  const clubLabels = clubSelectionLabels('表示クラブ', clubs, teams.map(t => ({ value: t.teamId, label: teamLabel(t.teamId, t.teamName) })), groups);
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)) } : { ...a, tier: 'primary' as const });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season),
    { kind: 'select', id: 'pastMode', label: '平均／合計', tier: 'primary', value: mode, defaultValue: 'perGame', options: [{ value: 'perGame', label: '1試合平均' }, { value: 'total', label: '合計' }], onChange: v => setMode(v as 'perGame' | 'total') },
    classificationAxis(classification, setClassification, { season }),
    teamMultiAxis({ id: 'pastClubs', label: '表示するクラブ', options: teams, selected: clubs.length ? new Set(clubs) : null, onChange: v => setClubs(v ? [...v] : []), divisionOf, league: category, presets: playoffZonePresets }),
    { kind: 'popover', id: 'pastMinPts', label: '得点の下限', tier: 'primary', value: String(minPts), defaultValue: '0', onChange: () => setMinPts(0), summary: `得点 ${formatDecimal(minPts, 1)}以上（1試合）`, chipValue: `得点 ${formatDecimal(minPts, 1)}以上（1試合）`,
      content: <EligibilitySlider label="得点（1試合平均）" value={minPts} min={0} max={PTS_AST_MIN.pts.max} step={PTS_AST_MIN.pts.step} format={v => formatDecimal(v, 1)} onChange={setMinPts} /> },
    { kind: 'popover', id: 'pastMinAst', label: 'アシストの下限', tier: 'primary', value: String(minAst), defaultValue: '0', onChange: () => setMinAst(0), summary: `アシスト ${formatDecimal(minAst, 1)}以上（1試合）`, chipValue: `アシスト ${formatDecimal(minAst, 1)}以上（1試合）`,
      content: <EligibilitySlider label="アシスト（1試合平均）" value={minAst} min={0} max={PTS_AST_MIN.ast.max} step={PTS_AST_MIN.ast.step} format={v => formatDecimal(v, 1)} onChange={setMinAst} /> },
    hl.axis,
    ratioEligibilityAxis({ id: 'pastRatio', value: minRatio, defaultValue: DEFAULT_RATIO, onChange: setMinRatio })];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[gameType], mode === 'total' ? '合計' : '1試合平均', classificationFilterLabel(classification),
    ...(clubs.length ? clubLabels : []), `出場率${minRatio}%以上`, ...(minPts > 0 ? [`得点 ${formatDecimal(minPts, 1)}以上（1試合）`] : []), ...(minAst > 0 ? [`アシスト ${formatDecimal(minAst, 1)}以上（1試合）`] : []), ...hl.labels].filter(Boolean);
  const baseDate = { kind: 'season' as const, season, gameType };
  const pick = (p: PlayerFigurePoint) => { setHover(p.id); };
  const yName = mode === 'total' ? '得点（合計）' : '得点（1試合平均）', xName = mode === 'total' ? 'アシスト（合計）' : 'アシスト（1試合平均）';
  const columns: Column<PtsAstPoint>[] = [
    { key: 'player', label: '選手名（チーム）', align: 'left', sortValue: s => s.p.name, render: s => <button className="ratings-team-button" onClick={() => pick(s.p)}>{playerLabel(s.p.name)}（{abbr(s.p)}）{s.p.teamIds.length > 1 ? '合算' : ''}</button> },
    { key: 'g', label: 'G', sortValue: s => s.p.games },
    { key: 'ratio', label: '出場率', sortValue: s => s.p.ratio, render: s => formatPct100(s.p.ratio) },
    { key: 'pts', label: 'PTS', sortValue: s => s.y, render: s => txt(s.p, 'pts') },
    { key: 'ast', label: 'AST', sortValue: s => s.x, render: s => txt(s.p, 'ast') },
  ];
  return <section aria-label="得点 × アシスト">
    <FilterBar axes={axes} stateKey="figures:pts-ast" onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setClassification('all'); setMode('perGame'); setClubs(EMPTY); setMinPts(0); setMinAst(0); setMinRatio(DEFAULT_RATIO); hl.setIds([]); setHover(null); }} />
    {splitClassificationBlocked(figureClassGroup(classification), season) ? <p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">選手の試合データを読み込み中…</p> : request.error ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : !plotted.length ? <p>この条件に該当する選手はいません。</p> : <>
      <p className="figure-count">{plotted.length}人を表示</p>
      <FigureExportButton targetRef={target} filename={`得点_アシスト_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export scorers-export axis-scatter-export" baseDate={baseDate}>
        <ConditionTitle title="得点 × アシスト" exportScope={`${season}シーズン`} conditions={conditions} />
        <AxisScatter points={items} xDomain={xDomain} yDomain={yDomain} xLabel={xName} yLabel={yName}
          xTick={v => formatDecimal(v, 0)} yTick={v => formatDecimal(v, 0)}
          avgX={avgX} avgY={avgY} avgXText={formatDecimal(avgX!)} avgYText={formatDecimal(avgY!)}
          renderMarker={(i, left, top) => <ScorerPhoto key={i.id} point={{ playerId: i.p.playerId, name: i.p.name, division: i.p.division }}
            label={`${playerLabel(i.p.name)}：得点 ${txt(i.p, 'pts')}、アシスト ${txt(i.p, 'ast')}`}
            selected={hl.has(i.p.teamIds)} expanded={i.id === hover} left={left} top={top} onSelect={() => pick(i.p)} onDismiss={() => setHover(null)} />}
          tooltip={tip ? { point: tip, node: <><strong>{playerLabel(tip.p.name)}（{names(tip.p)}）</strong><span>PTS {txt(tip.p, 'pts')} / AST {txt(tip.p, 'ast')}</span><span>出場率 {formatPct100(tip.p.ratio)}</span><span>{tip.p.games}試合{tip.p.teamIds.length > 1 ? '・複数チームの合算' : ''}</span></> } : null} />
      </ExportTarget>
      <div className="table-scroll scorers-table" tabIndex={0} role="region" aria-label="選手一覧"><SortableTable columns={columns} rows={items} rowKey={s => s.p.id} defaultSortKey="pts"
        rowHighlightColor={s => hl.has(s.p.teamIds) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}
