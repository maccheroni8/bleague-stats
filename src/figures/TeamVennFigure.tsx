import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchTeams, fetchTeamGameLogs, fetchDivisionHistory, teamLogoUrl } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import { enumParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { gameTypeAxis, situationalAxes, type FilterAxis } from '../lib/filterAxes';
import { GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import type { SituationalFilter } from '../lib/situational';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { situationalFilterLabels } from '../lib/conditionLabels';
import { teamShortName } from '../../shared/teamNames';
import { useTeamLabel } from '../lib/teamLabel';
import type { AllTeamsRow } from '../lib/teamStatsColumns';
import {
  DEFAULT_VENN_SELECTION, DEFAULT_VENN_TOP, VENN_CATEGORIES, VENN_PERSPECTIVES, VENN_TOP_OPTIONS, buildVennRows, computeTeamVenn, defaultVennThreshold, formatVennThreshold,
  itemHasPerspective, resolveVennSelection, vennColumn, vennItemLabel, vennItems, vennLeagueRow, type VennBasis, type VennPerspective, type VennSelection, type VennTop,
} from '../lib/figureVennItems';
import { VENN_CENTERS, VENN_DESIGN_HEIGHT, VENN_DESIGN_WIDTH, VENN_RADIUS, layoutVenn, vennEmphasisScales, vennLabelBoxes, type VennMask } from '../lib/figureVenn';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ConditionTitle } from '../components/ConditionTitle';
import { ResponsiveTeamName } from '../components/ResponsiveTeamName';
import { TeamLogo } from '../components/TeamLogo';
import { SortableTable, type Column } from '../components/SortableTable';
import { useNarrow } from '../lib/teamLabel';
import { FigureExportButton } from './FigureExport';
import type { FigureProps } from './catalog';
import { useHighlightClubs } from './highlightClubs';
import './RatingsScatterFigure.css';
import './TeamVennFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
const topCodec = enumParam<`${VennTop}`>('vtn', VENN_TOP_OPTIONS.map(String) as `${VennTop}`[], String(DEFAULT_VENN_TOP) as `${VennTop}`);
// 円ごとの項目と視点（vca・vcb・vcc。「カテゴリ.項目」または「カテゴリ.項目~opp」）
const SEL_KEYS = ['vca', 'vcb', 'vcc'] as const;
const selectionCodec: UrlCodec<VennSelection[]> = {
  keys: [...SEL_KEYS],
  read: p => {
    if (!SEL_KEYS.some(k => p.has(k))) return undefined;
    return SEL_KEYS.map((k, i) => {
      const raw = p.get(k);
      if (!raw) return DEFAULT_VENN_SELECTION[i]!;
      const [item, persp] = raw.split('~');
      return { item: item!, perspective: (VENN_PERSPECTIVES as readonly string[]).includes(persp ?? '') ? persp as VennPerspective : 'own' };
    });
  },
  write: (p, v) => v.forEach((s, i) => {
    const d = DEFAULT_VENN_SELECTION[i]!;
    if (s.item !== d.item || s.perspective !== d.perspective) p.set(SEL_KEYS[i]!, s.perspective === 'own' ? s.item : `${s.item}~${s.perspective}`);
  }),
};
const basisCodec = enumParam<VennBasis>('vbs', ['rank', 'value'], 'rank');
// 値で絞るときの円ごとの基準の値（vta・vtb・vtc。無ければその項目のリーグ平均）
const THR_KEYS = ['vta', 'vtb', 'vtc'] as const;
const NO_THRESHOLDS: (number | null)[] = [null, null, null];
const thresholdCodec: UrlCodec<(number | null)[]> = {
  keys: [...THR_KEYS],
  read: p => THR_KEYS.some(k => p.has(k)) ? THR_KEYS.map(k => { const v = Number(p.get(k)); return p.get(k) !== null && p.get(k) !== '' && Number.isFinite(v) ? v : null; }) : undefined,
  write: (p, v) => v.forEach((t, i) => { if (t !== null && Number.isFinite(t)) p.set(THR_KEYS[i]!, String(Number(t.toFixed(4)))); }),
};
const SLOT_NAMES = ['左上の円', '右上の円', '下の円'];
const SLOT_COLORS = ['venn-a', 'venn-b', 'venn-c'];

export default function TeamVennFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [topParam, setTop] = useUrlState(topCodec, String(DEFAULT_VENN_TOP) as `${VennTop}`);
  const [selParam, setSel] = useUrlState(selectionCodec, DEFAULT_VENN_SELECTION as unknown as VennSelection[]);
  const [basis, setBasis] = useUrlState(basisCodec, 'rank');
  const [thrParam, setThr] = useUrlState(thresholdCodec, NO_THRESHOLDS);
  const [hover, setHover] = useState<string | null>(null);
  const top = Number(topParam) as VennTop;
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = useJsonData(async () => {
    const teams = await fetchTeams(season, category);
    const divisions = await fetchDivisionHistory().catch(() => null);
    const entries = await Promise.all(teams.map(async team => {
      try { return [team.teamId, await fetchTeamGameLogs(season, team.teamId, category)] as const; } catch { return [team.teamId, null] as const; }
    }));
    return { teams, divisions, missing: entries.filter(([, l]) => l === null).length, logs: new Map(entries.map(([id, l]) => [id, l ?? []])) };
  }, [season, category]);
  const rows = useMemo(() => request.data && !request.data.missing ? buildVennRows(request.data.teams, request.data.logs, { category, range: filter.range, gameType }) : [], [request.data, category, filter, gameType]);
  const items = vennItems(season);
  const hl = useHighlightClubs({ season, category, teams: request.data?.teams ?? [], divisionOf: id => request.data?.divisions?.[category]?.[season]?.[id] });
  const perspectiveOk = useMemo(() => new Map(items.map(i => [i.id, itemHasPerspective(i, rows, season)])), [items, rows, season]);
  const selection = resolveVennSelection(selParam, season, id => perspectiveOk.get(id) ?? false);
  const itemOf = (id: string) => items.find(i => i.id === id)!;
  const labels = selection.map(s => vennItemLabel(itemOf(s.item), s.perspective));
  const league = useMemo(() => vennLeagueRow(rows), [rows]);
  // 値で絞るときの基準（指定が無ければ、その項目のリーグ平均）と、その表示の形
  const columns3 = selection.map(s => vennColumn(itemOf(s.item), s.perspective, season)!);
  const thresholds = selection.map((s, i) => thrParam[i] ?? defaultVennThreshold(itemOf(s.item), s.perspective, season, league));
  const higher = columns3.map(c => c.higherIsBetter ?? true);
  const sample = columns3.map(c => league ? (c.format ? c.format(league) : String(c.sortValue(league))) : '0');
  const thresholdText = thresholds.map((t, i) => t === null ? '—' : formatVennThreshold(t, sample[i]!));
  const circleNames = labels.map((l, i) => basis === 'rank' ? `${l} 上位${top}` : `${l} ${thresholdText[i]}${higher[i] ? '以上' : '以下'}`);
  const circleLines = labels.map((l, i) => basis === 'rank' ? [l, `上位${top}`] : [l, `${thresholdText[i]}${higher[i] ? '以上' : '以下'}`]);
  const model = useMemo(() => rows.length ? computeTeamVenn(rows, selection, season, { basis, top, thresholds }) : null, [rows, selection, season, basis, top, thresholds.join('|')]);
  const byId = new Map(rows.map(r => [r.team.teamId, r]));
  const textOf = (row: AllTeamsRow, i: number) => { const c = vennColumn(itemOf(selection[i]!.item), selection[i]!.perspective, season)!; return c.format ? c.format(row) : String(c.sortValue(row)); };
  const total = rows.length;
  const setSlot = (slot: number, next: Partial<VennSelection>) => {
    setSel(selection.map((s, i) => i === slot ? { ...s, ...next } : s));
    if (next.item !== undefined || next.perspective !== undefined) setThr(thrParam.map((t, i) => i === slot ? null : t));
  };
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)) } : { ...a, tier: 'primary' as const });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season), hl.axis];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = [`${season} ${periodLabel}`, seasonGameTypeLabels(season)[gameType], ...hl.labels];
  const baseDate = { kind: 'season' as const, season, gameType };
  const counts = model ? model.members.map(m => m.length) : [0, 0, 0];
  const tipRow = hover ? byId.get(hover) : undefined;
  const columns: Column<AllTeamsRow>[] = [
    { key: 'team', label: 'チーム', align: 'left', sortValue: r => r.team.teamName, render: r => <button className="ratings-team-button" onClick={() => setHover(r.team.teamId)}><TeamLogo teamId={r.team.teamId} size={20} /><ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} /></button> },
    ...selection.map((s, i): Column<AllTeamsRow> => ({ key: `c${i}`, label: labels[i]!, sortValue: r => { const v = Number(vennColumn(itemOf(s.item), s.perspective, season)!.sortValue(r)); return Number.isFinite(v) ? v : Number.NaN; },
      render: r => `${textOf(r, i)}（${model?.rankOf[i]!.get(r.team.teamId) ?? '—'}位）` })),
  ];
  const chartProps = { emphasized: hl.ids, model, selection, labels, circleNames, circleLines, counts, hover, setHover, teamLabel, byId, textOf, total, tipRow };
  return <section aria-label="上位チームのベン図">
    <FilterBar axes={axes} stateKey="figures:team-venn" onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setTop(String(DEFAULT_VENN_TOP) as `${VennTop}`); setSel([...DEFAULT_VENN_SELECTION]); setBasis('rank'); setThr(NO_THRESHOLDS); hl.setIds([]); setHover(null); }} />
    <div className="venn-pickers">
      {selection.map((s, i) => <div key={i} className={`venn-picker ${SLOT_COLORS[i]}`}>
        <span className="venn-dot" aria-hidden="true" />
        <label>{SLOT_NAMES[i]}の項目
          <select value={s.item} onChange={e => setSlot(i, { item: e.target.value, perspective: 'own' })}>
            {VENN_CATEGORIES.map(cat => <optgroup key={cat.key} label={cat.label}>
              {items.filter(it => it.category === cat.key).map(it => <option key={it.id} value={it.id} disabled={selection.some((o, j) => j !== i && o.item === it.id)}>{it.label}</option>)}
            </optgroup>)}
          </select>
        </label>
        {basis === 'value' && <label>基準の値（{higher[i] ? '以上' : '以下'}）
          <input type="number" step="any" className="venn-threshold" value={thrParam[i] ?? (thresholds[i] === null ? '' : Number(thresholds[i]!.toFixed(4)))} aria-label={`${labels[i]}の基準の値`}
            onChange={e => setThr(thrParam.map((t, j) => j === i ? (e.target.value === '' ? null : Number(e.target.value)) : t))} />
        </label>}
        {perspectiveOk.get(s.item) && <label>視点
          <select value={s.perspective} onChange={e => setSlot(i, { perspective: e.target.value as VennPerspective })}>
            <option value="own">自チーム</option><option value="opp">opp</option><option value="diff">+/-</option>
          </select>
        </label>}
      </div>)}
      <label className="venn-top">絞り方
        <select value={basis} onChange={e => setBasis(e.target.value as VennBasis)}><option value="rank">順位で絞る</option><option value="value">値で絞る</option></select>
      </label>
      {basis === 'rank' && <label className="venn-top">上位
        <select value={topParam} onChange={e => setTop(e.target.value as `${VennTop}`)}>{VENN_TOP_OPTIONS.map(n => <option key={n} value={n}>{n}チーム</option>)}</select>
      </label>}
    </div>
    {request.loading ? <p role="status">読み込み中…</p> : request.error || request.data?.missing ? <p role="alert">チームの試合データを読み込めませんでした。ページを読み直してください。</p> : !model ? <p className="empty-message">この条件で表示できるチームがありません。</p> : <>
      <FigureExportButton targetRef={target} filename={`ベン図_${circleNames.join('_')}_${conditions.slice(0, 2).join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export venn-export" baseDate={baseDate}>
        <ConditionTitle title={circleNames.join('・')} exportScope={`${season}シーズン`} conditions={conditions} />
        <div onPointerDown={e => { if (!(e.target as Element).closest('.venn-team')) setHover(null); }}>
          <VennChart {...chartProps} />
          <VennChart {...chartProps} exportOnly />
        </div>
      </ExportTarget>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="チーム一覧"><SortableTable columns={columns} rows={rows} rowKey={r => r.team.teamId} defaultSortKey="c0" statScope="team"
        rowHighlightColor={r => hover === r.team.teamId || hl.has([r.team.teamId]) ? 'var(--accent)' : undefined} rowHighlightStrength={() => 'half'} /></div>
    </>}
  </section>;
}

type ChartModel = NonNullable<ReturnType<typeof computeTeamVenn>>;
interface ChartProps {
  model: ChartModel | null; selection: VennSelection[]; labels: string[]; circleNames: string[]; circleLines: string[][]; counts: number[]; emphasized: string[]; hover: string | null; setHover: (id: string | null) => void;
  teamLabel: (id: string, name: string) => string; byId: Map<string, AllTeamsRow>; textOf: (row: AllTeamsRow, i: number) => string; total: number; tipRow?: AllTeamsRow; exportOnly?: boolean;
}

function VennChart({ model, labels, circleNames, circleLines, counts, emphasized, hover, setHover, teamLabel, byId, textOf, total, exportOnly = false }: ChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(exportOnly ? VENN_DESIGN_WIDTH : 640);
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
  const abbr = (r: AllTeamsRow) => teamShortName(r.team.teamId, r.team.teamName);
  const groups = useMemo(() => {
    const map = new Map<VennMask, { key: string; label: string }[]>();
    if (!model) return map;
    for (const [mask, list] of model.regions) {
      if (mask === 0) continue;
      const sorted = [...list].sort((a, b) => {
        const score = (r: AllTeamsRow) => [0, 1, 2].reduce((s, i) => s + (model.rankOf[i]!.get(r.team.teamId) ?? 99), 0);
        return score(a) - score(b) || a.team.teamId.localeCompare(b.team.teamId, undefined, { numeric: true });
      });
      map.set(mask, sorted.map(r => ({ key: r.team.teamId, label: abbr(r) })));
    }
    return map;
  }, [model]);
  const nameBoxes = useMemo(() => vennLabelBoxes(size, circleLines, labelFont + 1), [size, circleLines.join('|'), labelFont]);
  const layout = useMemo(() => layoutVenn(groups, { size, labelFont, obstacles: nameBoxes }), [groups, size, labelFont, nameBoxes]);
  const scales = useMemo(() => vennEmphasisScales(layout.placements, layout.box, new Set(emphasized), nameBoxes), [layout, emphasized, nameBoxes]);
  if (!model) return null;
  const none = model.regions.get(0) ?? [];
  const tipRow = hover ? byId.get(hover) : undefined;
  const place = layout.placements.get(hover ?? '');
  const logo = layout.logo;
  const renderTeam = (r: AllTeamsRow, style: React.CSSProperties, inVenn: boolean) => {
    const id = r.team.teamId;
    const showLabel = !inVenn || layout.labels;
    const logoSize = inVenn ? logo : Math.max(logo, 28);
    const emph = emphasized.includes(id);
    const scale = emph ? (inVenn ? scales.get(id) ?? 1 : 1.3) : 1;
    return <button key={id} className={`venn-team${emph ? ' is-emphasized' : ''}${hover === id ? ' is-expanded' : ''}`} style={{ ...style, width: inVenn ? layout.box.width : undefined, ...(emph ? { '--emph': scale } as React.CSSProperties : {}) }}
      aria-label={`${teamLabel(id, r.team.teamName)}：${[0, 1, 2].map(i => `${labels[i]} ${textOf(r, i)}（${model.rankOf[i]!.get(id)}位）`).join('、')}`}
      onPointerEnter={e => { if (e.pointerType === 'mouse') setHover(id); }} onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null); }} onFocus={() => setHover(id)} onBlur={() => setHover(null)} onClick={() => setHover(id)}>
      <VennLogo teamId={id} name={r.team.teamName} size={logoSize} />
      {showLabel && <span className="venn-team-label" style={{ fontSize: labelFont }}>{abbr(r)}</span>}
    </button>;
  };
  const height = size * VENN_DESIGN_HEIGHT / VENN_DESIGN_WIDTH;
  return <div className={`venn-chart ${exportOnly ? 'venn-export-chart' : 'venn-screen-chart'}`} ref={ref}>
    <div className="venn-names">
      {[0, 1, 2].map(i => <span key={i} className={`venn-name ${SLOT_COLORS[i]}`}><span className="venn-dot" aria-hidden="true" />{circleNames[i]}<span className="venn-count">（{counts[i]}チーム）</span></span>)}
    </div>
    <div className="venn-stage" style={{ height }}>
      {VENN_CENTERS.map((c, i) => <span key={i} className={`venn-circle ${SLOT_COLORS[i]}`} style={{ left: (c.x - VENN_RADIUS) * u, top: (c.y - VENN_RADIUS) * u, width: VENN_RADIUS * 2 * u, height: VENN_RADIUS * 2 * u }} />)}
      {nameBoxes.map((b, i) => <span key={`name${i}`} className={`venn-circle-name ${SLOT_COLORS[i]}`} style={{ left: b.x - b.width / 2, top: b.y - b.height / 2, width: b.width, height: b.height, fontSize: labelFont + 1 }}>{circleLines[i]!.map((l, j) => <span key={j}>{l}</span>)}</span>)}
      {[...groups.values()].flat().map(item => {
        const p = layout.placements.get(item.key)!, r = byId.get(item.key)!;
        return renderTeam(r, { left: p.x - layout.box.width / 2, top: p.y - layout.box.height / 2 }, true);
      })}
      {tipRow && place && <div role="tooltip" className="ratings-tooltip venn-tooltip" style={{ left: Math.max(0, Math.min(place.x - 120, size - 240)), top: Math.min(place.y + layout.box.height / 2 + 4, Math.max(0, height - 120)) }}>
        <strong>{teamLabel(tipRow.team.teamId, tipRow.team.teamName)}</strong>
        {[0, 1, 2].map(i => <span key={i}>{labels[i]} {textOf(tipRow, i)}（{model.rankOf[i]!.get(tipRow.team.teamId)}位／{total}チーム）</span>)}
      </div>}
    </div>
    <div className="venn-none">
      <p className="venn-none-title">どれにも入らない（{none.length}チーム）</p>
      <div className="venn-none-list">{none.map(r => renderTeam(r, { position: 'relative' }, false))}</div>
      {hover && !place && tipRow && <div role="tooltip" className="venn-none-tip"><strong>{teamLabel(tipRow.team.teamId, tipRow.team.teamName)}</strong>{[0, 1, 2].map(i => <span key={i}>{labels[i]} {textOf(tipRow, i)}（{model.rankOf[i]!.get(tipRow.team.teamId)}位／{total}チーム）</span>)}</div>}
    </div>
  </div>;
}

function VennLogo({ teamId, name, size }: { teamId: string; name: string; size: number }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="ratings-fallback venn-fallback" style={{ width: size, height: size }}>{teamShortName(teamId, name)}</span>
    : <img src={teamLogoUrl(teamId)} alt="" width={size} height={size} loading="eager" onError={() => setFailed(true)} />;
}
