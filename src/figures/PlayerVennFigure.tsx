import { useEffect, useMemo, useRef, useState } from 'react';
import { numberParam, situationalParam, statConditionsParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { classificationAxis, gameTypeAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import { CLASSIFICATION_PARAM, GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import { enumParam } from '../lib/urlState';
import type { SituationalFilter } from '../lib/situational';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { classificationFilterLabel, splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from '../lib/classificationFilter';
import { figureClassGroup } from '../lib/figureAge';
import { teamShortName } from '../../shared/teamNames';
import { usePlayerLabel } from '../lib/playerLabel';
import { useTeamLabel, useNarrow } from '../lib/teamLabel';
import { formatPct100 } from '../lib/format';
import { buildPlayerFigurePoints, type PlayerFigurePoint } from '../lib/figurePlayerPoints';
import {
  availablePlayerVennItems, computePlayerVenn, defaultPlayerVennThreshold, DEFAULT_PLAYER_VENN_ITEMS, playerVennCtx, playerVennHigher, playerVennItems,
  playerVennValue, PLAYER_VENN_CATEGORIES, resolvePlayerVennSelection, playerVennColumn, playerVennConditionDefs,
} from '../lib/figurePlayerVenn';
import { buildStatConditionItems, DEFAULT_STAT_CONDITIONS, filterByStatConditions, statConditionLabels } from '../lib/statConditions';
import { statConditionsBarExtra } from '../components/StatConditionsEditor';
import { formatVennThreshold } from '../lib/figureVennItems';
import { VENN_CENTERS, VENN_DESIGN_HEIGHT, VENN_DESIGN_WIDTH, VENN_RADIUS, layoutVennNames, vennEmphasisScales, vennLabelBoxes, type VennMask } from '../lib/figureVenn';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ConditionTitle } from '../components/ConditionTitle';
import { SortableTable, type Column } from '../components/SortableTable';
import { FigureExportButton } from './FigureExport';
import { ratioEligibilityAxis } from './eligibilityAxis';
import { usePlayerFigureData } from './usePlayerFigureData';
import { useHighlightClubs } from './highlightClubs';
import type { FigureProps } from './catalog';
import './RatingsScatterFigure.css';
import './TeamVennFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const DEFAULT_RATIO = 85;
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
const ratioCodec = numberParam('vpr', DEFAULT_RATIO, { min: 0, max: 100 });
// 円ごとの項目（vca・vcb・vcc。「カテゴリ.項目」）と基準の値（vta・vtb・vtc）
const SEL_KEYS = ['vca', 'vcb', 'vcc'] as const;
const NO_SELECTION: (string | undefined)[] = [undefined, undefined, undefined];
const selectionCodec: UrlCodec<(string | undefined)[]> = {
  keys: [...SEL_KEYS],
  read: p => SEL_KEYS.some(k => p.has(k)) ? SEL_KEYS.map(k => p.get(k) || undefined) : undefined,
  write: (p, v) => v.forEach((s, i) => { if (s && s !== DEFAULT_PLAYER_VENN_ITEMS[i]) p.set(SEL_KEYS[i]!, s); }),
};
const THR_KEYS = ['vta', 'vtb', 'vtc'] as const;
const NO_THRESHOLDS: (number | null)[] = [null, null, null];
const thresholdCodec: UrlCodec<(number | null)[]> = {
  keys: [...THR_KEYS],
  read: p => THR_KEYS.some(k => p.has(k)) ? THR_KEYS.map(k => { const v = Number(p.get(k)); return p.get(k) !== null && p.get(k) !== '' && Number.isFinite(v) ? v : null; }) : undefined,
  write: (p, v) => v.forEach((t, i) => { if (t !== null && Number.isFinite(t)) p.set(THR_KEYS[i]!, String(Number(t.toFixed(4)))); }),
};
const SLOT_NAMES = ['左上の円', '右上の円', '下の円'];
const SLOT_COLORS = ['venn-a', 'venn-b', 'venn-c'];

export default function PlayerVennFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [classification, setClassification] = useUrlState(CLASSIFICATION_PARAM, 'all');
  const [minRatio, setMinRatio] = useUrlState(ratioCodec, DEFAULT_RATIO);
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);
  const [selParam, setSel] = useUrlState(selectionCodec, NO_SELECTION);
  const [thrParam, setThr] = useUrlState(thresholdCodec, NO_THRESHOLDS);
  const [hover, setHover] = useState<string | null>(null);
  const [openMask, setOpenMask] = useState<VennMask | null>(null);
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = usePlayerFigureData(season, category);
  const teams = request.data?.teams ?? [];
  const hl = useHighlightClubs({ season, category, teams, divisionOf: id => request.data?.divisions?.[category]?.[season]?.[id] });
  const blocked = splitClassificationBlocked(figureClassGroup(classification), season);
  const base = useMemo(() => request.data && !blocked ? buildPlayerFigurePoints(request.data, { season, category, range: filter.range, gameType, classification }) : [], [request.data, blocked, season, category, filter, gameType, classification]);
  const ratioPassed = useMemo(() => base.filter(p => p.ratio >= minRatio), [base, minRatio]);
  // 詳細フィルター（スタッツの条件）。円の中の選手・人数・一覧・保存画像のすべてに効く
  const conditionItems = useMemo(() => buildStatConditionItems(playerVennConditionDefs(season), ratioPassed, 'perGame'), [ratioPassed, season]);
  const eligible = useMemo(() => filterByStatConditions(ratioPassed, statConditions, conditionItems), [ratioPassed, statConditions, conditionItems]);
  const items = playerVennItems(season);
  const available = useMemo(() => availablePlayerVennItems(eligible, season), [eligible, season]);
  const itemIds = resolvePlayerVennSelection(selParam, available.size ? available : new Set(items.map(i => i.id)), items.map(i => i.id));
  const itemOf = (id: string) => items.find(i => i.id === id)!;
  const columns3 = itemIds.map(id => playerVennColumn(itemOf(id), season)!);
  const labels = itemIds.map(id => itemOf(id).label);
  // 基準の値（指定が無ければ初期値）と、その表示の形
  const sampleValues = useMemo(() => itemIds.map((id, i) => eligible.map(p => playerVennValue(playerVennCtx(p, season), columns3[i]!)).filter((v): v is NonNullable<typeof v> => !!v)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eligible, season, itemIds.join('|')]);
  const thresholds = itemIds.map((id, i) => thrParam[i] ?? defaultPlayerVennThreshold(id, sampleValues[i]!));
  const higher = columns3.map(playerVennHigher);
  const thresholdText = thresholds.map((t, i) => t === null || !sampleValues[i]![0] ? '—' : formatVennThreshold(t, sampleValues[i]![0]!.text));
  const circleNames = labels.map((l, i) => `${l} ${thresholdText[i]}${higher[i] ? '以上' : '以下'}`);
  const circleLines = labels.map((l, i) => [l, `${thresholdText[i]}${higher[i] ? '以上' : '以下'}`]);
  const computed = useMemo(() => eligible.length ? computePlayerVenn(eligible, itemIds, season, thresholds) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [eligible, season, itemIds.join('|'), thresholds.join('|')]);
  const model = computed?.model ?? null;
  const valueText = (p: PlayerFigurePoint, i: number) => computed?.valueOf(p.id, i)?.text ?? '-';
  const playerLabel = usePlayerLabel(eligible.map(p => p.name));
  const byId = useMemo(() => new Map(eligible.map(p => [p.id, p])), [eligible]);
  const emphIds = useMemo(() => new Set(eligible.filter(p => hl.has(p.teamIds)).map(p => p.id)), [eligible, hl.ids.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const abbr = (p: PlayerFigurePoint) => p.teamIds.map(id => teamShortName(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const teamNames = (p: PlayerFigurePoint) => p.teamIds.map(id => teamLabel(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const counts = model ? model.members.map(m => m.length) : [0, 0, 0];
  const setSlot = (slot: number, id: string) => {
    setSel(itemIds.map((s, i) => i === slot ? id : s));
    setThr(thrParam.map((t, i) => i === slot ? null : t));
  };
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)) } : { ...a, tier: 'primary' as const });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season), classificationAxis(classification, setClassification, { season }),
    hl.axis, ratioEligibilityAxis({ id: 'vennRatio', value: minRatio, defaultValue: DEFAULT_RATIO, onChange: setMinRatio })];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[gameType], classificationFilterLabel(classification), `出場率${minRatio}%以上`, ...statConditionLabels(statConditions, conditionItems), ...hl.labels].filter(Boolean);
  const baseDate = { kind: 'season' as const, season, gameType };
  const columns: Column<PlayerFigurePoint>[] = [
    { key: 'player', label: '選手名（チーム）', align: 'left', sortValue: p => p.name, render: p => <button className="ratings-team-button" onClick={() => setHover(p.id)}>{playerLabel(p.name)}（{abbr(p)}）{p.teamIds.length > 1 ? '合算' : ''}</button> },
    { key: 'g', label: 'G', sortValue: p => p.games },
    { key: 'ratio', label: '出場率', sortValue: p => p.ratio, render: p => formatPct100(p.ratio) },
    ...itemIds.map((_, i): Column<PlayerFigurePoint> => ({ key: `c${i}`, label: labels[i]!, sortValue: p => computed?.valueOf(p.id, i)?.value ?? Number.NaN, render: p => valueText(p, i) })),
  ];
  const chartProps = { emphIds, model, labels, circleNames, circleLines, counts, hover, setHover, byId, valueText, playerLabel, abbr, teamNames, total: eligible.length, openMask, setOpenMask };
  return <section aria-label="ベン図">
    <FilterBar axes={axes} stateKey="figures:player-venn" advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, conditionItems, { defaultKey: 'min' })} onClearAll={() => { setStatConditions(DEFAULT_STAT_CONDITIONS); setFilter(DEFAULT); setGameType('regular'); setClassification('all'); setMinRatio(DEFAULT_RATIO); setSel(NO_SELECTION); setThr(NO_THRESHOLDS); hl.setIds([]); setHover(null); setOpenMask(null); }} />
    <div className="venn-pickers">
      {itemIds.map((id, i) => <div key={i} className={`venn-picker ${SLOT_COLORS[i]}`}>
        <span className="venn-dot" aria-hidden="true" />
        <label>{SLOT_NAMES[i]}の項目
          <select value={id} onChange={e => setSlot(i, e.target.value)}>
            {PLAYER_VENN_CATEGORIES.map(cat => <optgroup key={cat.key} label={cat.label}>
              {items.filter(it => it.category === cat.key && available.has(it.id)).map(it => <option key={it.id} value={it.id} disabled={itemIds.some((o, j) => j !== i && o === it.id)}>{it.label}</option>)}
            </optgroup>)}
          </select>
        </label>
        <label>基準の値（{higher[i] ? '以上' : '以下'}）
          <input type="number" step="any" className="venn-threshold" value={thrParam[i] ?? (thresholds[i] === null ? '' : Number(thresholds[i]!.toFixed(4)))} aria-label={`${labels[i]}の基準の値`}
            onChange={e => setThr(thrParam.map((t, j) => j === i ? (e.target.value === '' ? null : Number(e.target.value)) : t))} />
        </label>
      </div>)}
    </div>
    {blocked ? <p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">選手の試合データを読み込み中…</p> : request.error ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : !model ? <p className="empty-message">この条件で表示できる選手がいません。</p> : <>
      <FigureExportButton targetRef={target} filename={`選手_ベン図_${circleNames.join('_')}_${conditions.slice(0, 2).join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export venn-export" baseDate={baseDate}>
        <ConditionTitle title={circleNames.join('・')} exportScope={`${season}シーズン`} conditions={conditions} />
        <div onPointerDown={e => { if (!(e.target as Element).closest('.venn-team')) setHover(null); }}>
          <VennChart {...chartProps} />
          <VennChart {...chartProps} exportOnly />
        </div>
      </ExportTarget>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="選手一覧"><SortableTable columns={columns} rows={eligible} rowKey={p => p.id} defaultSortKey="c0" statScope="player"
        rowHighlightColor={p => hover === p.id || hl.has(p.teamIds) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}

type ChartModel = NonNullable<ReturnType<typeof computePlayerVenn>>['model'];
interface ChartProps {
  model: ChartModel | null; labels: string[]; circleNames: string[]; circleLines: string[][]; counts: number[]; emphIds: ReadonlySet<string>;
  hover: string | null; setHover: (id: string | null) => void; byId: Map<string, PlayerFigurePoint>; valueText: (p: PlayerFigurePoint, i: number) => string;
  playerLabel: (name: string) => string; abbr: (p: PlayerFigurePoint) => string; teamNames: (p: PlayerFigurePoint) => string; total: number;
  openMask: VennMask | null; setOpenMask: (m: VennMask | null) => void; exportOnly?: boolean;
}

/** 領域の呼び名（「PTSだけ」「PTSとAST」「3つとも」） */
function regionTitle(mask: VennMask, labels: readonly string[]): string {
  const names = labels.filter((_, i) => mask & (1 << i));
  return names.length === 3 ? '3つとも' : names.length === 1 ? `${names[0]}だけ` : names.join('と');
}

function VennChart({ model, labels, circleNames, circleLines, counts, emphIds, hover, setHover, byId, valueText, playerLabel, abbr, teamNames, total, openMask, setOpenMask, exportOnly = false }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(exportOnly ? VENN_DESIGN_WIDTH : 640);
  const [showNone, setShowNone] = useState(false);
  useEffect(() => {
    if (exportOnly || !ref.current) return;
    const observer = new ResizeObserver(entries => { const w = entries[0]?.contentRect.width; if (w) setWidth(w); });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [exportOnly]);
  const narrow = useNarrow();
  const size = exportOnly ? VENN_DESIGN_WIDTH : Math.min(width, 760);
  const u = size / VENN_DESIGN_WIDTH;
  const labelFont = exportOnly ? 11 : narrow ? 9 : 11;
  const sorted = (list: PlayerFigurePoint[]) => [...list].sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  const groups = useMemo(() => {
    const map = new Map<VennMask, { key: string; label: string }[]>();
    if (!model) return map;
    for (const [mask, list] of model.regions) {
      if (mask === 0) continue;
      map.set(mask, sorted(list).map(p => ({ key: p.id, label: playerLabel(p.name) })));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, narrow]);
  const nameBoxes = useMemo(() => vennLabelBoxes(size, circleLines, labelFont + 1), [size, circleLines.join('|'), labelFont]);
  const layout = useMemo(() => layoutVennNames(groups, { size, font: labelFont, obstacles: nameBoxes }), [groups, size, labelFont, nameBoxes]);
  const scales = useMemo(() => vennEmphasisScales(layout.placements, layout.box, emphIds, nameBoxes), [layout, emphIds, nameBoxes]);
  if (!model) return null;
  const none = sorted(model.regions.get(0) ?? []);
  const tipRow = hover ? byId.get(hover) : undefined;
  const place = layout.placements.get(hover ?? '');
  const height = size * VENN_DESIGN_HEIGHT / VENN_DESIGN_WIDTH;
  const tipText = (p: PlayerFigurePoint) => [0, 1, 2].map(i => `${labels[i]} ${valueText(p, i)}`).join('、');
  const tooltip = (p: PlayerFigurePoint) => <><strong>{playerLabel(p.name)}（{teamNames(p)}）</strong>{[0, 1, 2].map(i => <span key={i}>{labels[i]} {valueText(p, i)}</span>)}<span>{p.games}試合・出場率 {formatPct100(p.ratio)}{p.teamIds.length > 1 ? '・複数チームの合算' : ''}</span></>;
  const chip = (p: PlayerFigurePoint, style: React.CSSProperties) => {
    const emph = emphIds.has(p.id), scale = emph ? scales.get(p.id) ?? 1 : 1;
    return <button key={p.id} className={`venn-team venn-player${emph ? ' is-emphasized' : ''}${hover === p.id ? ' is-expanded' : ''}`} style={{ ...style, ...(emph ? { '--emph': scale } as React.CSSProperties : {}) }}
      aria-label={`${playerLabel(p.name)}（${abbr(p)}）：${tipText(p)}`}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(p.id); }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }} onFocus={() => setHover(p.id)} onBlur={() => setHover(null)} onClick={() => setHover(p.id)}>
      <span className="venn-player-label" style={{ fontSize: layout.font }}>{playerLabel(p.name)}</span>
    </button>;
  };
  const list = (title: string, players: PlayerFigurePoint[]) => <div className="venn-region-list" key={title}>
    <p className="venn-none-title">{title}（{players.length}人）</p>
    <div className="venn-none-list">{players.map(p => chip(p, { position: 'relative' }))}</div>
  </div>;
  const regionPlayers = (mask: VennMask) => sorted(model.regions.get(mask) ?? []);
  const collapsedMasks = [...layout.collapsed.keys()];
  const shownMasks = exportOnly ? collapsedMasks : collapsedMasks.filter(m => m === openMask);
  return <div className={`venn-chart ${exportOnly ? 'venn-export-chart' : 'venn-screen-chart'}`} ref={ref}>
    <div className="venn-names">
      {[0, 1, 2].map(i => <span key={i} className={`venn-name ${SLOT_COLORS[i]}`}><span className="venn-dot" aria-hidden="true" />{circleNames[i]}<span className="venn-count">（{counts[i]}人）</span></span>)}
    </div>
    <div className="venn-stage" style={{ height }}>
      {VENN_CENTERS.map((c, i) => <span key={i} className={`venn-circle ${SLOT_COLORS[i]}`} style={{ left: (c.x - VENN_RADIUS) * u, top: (c.y - VENN_RADIUS) * u, width: VENN_RADIUS * 2 * u, height: VENN_RADIUS * 2 * u }} />)}
      {nameBoxes.map((b, i) => <span key={`name${i}`} className={`venn-circle-name ${SLOT_COLORS[i]}`} style={{ left: b.x - b.width / 2, top: b.y - b.height / 2, width: b.width, height: b.height, fontSize: labelFont + 1 }}>{circleLines[i]!.map((l, j) => <span key={j}>{l}</span>)}</span>)}
      {[...layout.placements].map(([id, p]) => chip(byId.get(id)!, { left: p.x - layout.box.width / 2, top: p.y - layout.box.height / 2, width: layout.box.width, height: layout.box.height }))}
      {[...layout.collapsed].map(([mask, p]) => {
        const players = regionPlayers(mask), hasEmph = players.some(x => emphIds.has(x.id));
        return <button key={`n${mask}`} className={`venn-team venn-player venn-badge${hasEmph ? ' is-emphasized' : ''}${openMask === mask ? ' is-open' : ''}`} style={{ left: p.x - layout.box.width / 2, top: p.y - layout.box.height / 2, width: layout.box.width, height: layout.box.height, ...(hasEmph ? { '--emph': 1 } as React.CSSProperties : {}) }}
          aria-expanded={openMask === mask} aria-label={`${regionTitle(mask, labels)}：${players.length}人。押すと名前の一覧が出ます`}
          onClick={() => setOpenMask(openMask === mask ? null : mask)}>
          <span className="venn-player-label" style={{ fontSize: layout.font }}>{players.length}人</span>
        </button>;
      })}
      {tipRow && place && <div role="tooltip" className="ratings-tooltip venn-tooltip" style={{ left: Math.max(0, Math.min(place.x - 120, size - 240)), top: Math.min(place.y + layout.box.height / 2 + 4, Math.max(0, height - 120)) }}>{tooltip(tipRow)}</div>}
    </div>
    {shownMasks.map(mask => list(regionTitle(mask, labels), regionPlayers(mask)))}
    <div className="venn-none">
      <p className="venn-none-title">どれにも入らない（{none.length}人）
        {!exportOnly && none.length > 0 && <button type="button" className="venn-none-toggle" aria-expanded={showNone} onClick={() => setShowNone(v => !v)}>{showNone ? '名前を閉じる' : '名前を見る'}</button>}
      </p>
      {!exportOnly && showNone && <div className="venn-none-list">{none.map(p => chip(p, { position: 'relative' }))}</div>}
      {hover && !place && tipRow && <div role="tooltip" className="venn-none-tip">{tooltip(tipRow)}</div>}
    </div>
  </div>;
}
