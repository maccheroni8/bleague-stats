// 図解（チーム）「歴代最強ラインナップ」（figure=best-lineup。DESIGN.md 370章）。B.PREMIER（旧B1）2020-21〜今季の、1シーズン×1クラブ×同じ組み合わせ（2〜5人）を
// NetRtg・ORtg・DRtg・出場時間の順に並べる。材料は人数ごとの導出データ（data/best-lineups-{人数}.json。選んだ人数の分だけ読む）。計算は src/lib/bestLineups.ts。
import { useMemo, useRef, type CSSProperties } from 'react';
import { fetchBestLineups } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import { enumParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { gameTypeAxis, type FilterAxis } from '../lib/filterAxes';
import { GAME_TYPE_PARAM } from '../lib/urlFilterParams';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { BEST_LINEUP_MIN_POSS_DEFAULT, BEST_LINEUP_SIZES, type BestLineupSize } from '../../shared/bestLineups';
import {
  BEST_LINEUP_SLIDER, BEST_LINEUP_SORTS, BEST_LINEUP_SORT_LABELS, bestLineupGroups, bestLineupGroupsInSeason, clampBestLineupMin, highlightedBest, ocChoices, queryBestLineups, topBestLineups, type BestLineupSort, type RankedBestLineup,
} from '../lib/bestLineups';
import { formatDecimal } from '../lib/format';
import { formatMinutesFromSeconds } from '../lib/boxscoreAggregate';
import { teamShortName } from '../../shared/teamNames';
import { usePlayerLabel } from '../lib/playerLabel';
import { teamChipColor, useTeamColorsForChip } from '../lib/teamChipColors';
import { EligibilitySlider } from '../components/EligibilitySlider';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ConditionTitle } from '../components/ConditionTitle';
import { PlayerPhoto } from '../components/PlayerPhoto';
import { TeamChip } from '../components/TeamChip';
import { TeamLogo } from '../components/TeamLogo';
import { NameText } from '../components/NameText';
import { FigureExportButton } from './FigureExport';
import type { FigureProps } from './catalog';
import { useHighlightClubs } from './highlightClubs';
import './BestLineupFigure.css';

const SIZE_VALUES = BEST_LINEUP_SIZES.map(String) as `${BestLineupSize}`[];
const sizeCodec = enumParam<`${BestLineupSize}`>('bls', SIZE_VALUES, '5');
const sortCodec = enumParam<BestLineupSort>('blm', BEST_LINEUP_SORTS, 'net');
const gameCodec = { ...enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular'), read: GAME_TYPE_PARAM.read };
const topCodec = enumParam<'10' | '20'>('bln', ['10', '20'], '10');
/** 下限（攻守それぞれのポゼッション）。人数ごとに選べる値が違うので、読めない値は人数の最初の値にする */
const minCodec: UrlCodec<number | null> = {
  keys: ['blp'],
  read: p => { const v = Number(p.get('blp')); return p.get('blp') && Number.isFinite(v) ? v : undefined; },
  write: (p, v) => { if (v !== null) p.set('blp', String(v)); },
};
/** 範囲。無ければ歴代（2020-21〜）、あればそのシーズンだけ（例 2025-26） */
const rangeCodec: UrlCodec<string | null> = {
  keys: ['blse'],
  read: p => { const v = p.get('blse'); return v && /^\d{4}-\d{2}$/.test(v) ? v : undefined; },
  write: (p, v) => { if (v !== null) p.set('blse', v); },
};
/** OC（組の中の外国籍・帰化・アジア特別枠の人数）。無ければすべて */
const ocCodec: UrlCodec<number | null> = {
  keys: ['bloc'],
  read: p => { const v = Number(p.get('bloc')); return p.get('bloc') !== null && p.get('bloc') !== '' && Number.isInteger(v) && v >= 0 ? v : undefined; },
  write: (p, v) => { if (v !== null) p.set('bloc', String(v)); },
};

/** 並び順の書き方（↓＝値の大きい順、↑＝小さい順。ほかの図と同じ） */
const sortLabel = (s: BestLineupSort) => `${BEST_LINEUP_SORT_LABELS[s]}${s === 'def' ? '↑' : '↓'}`;
const signed = (v: number | null) => v === null ? '-' : `${v > 0 ? '+' : ''}${formatDecimal(v)}`;

export default function BestLineupFigure({ season, category }: FigureProps) {
  const [sizeParam, setSize] = useUrlState(sizeCodec, '5');
  const [sort, setSort] = useUrlState(sortCodec, 'net');
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [topParam, setTop] = useUrlState(topCodec, '10');
  const [minParam, setMin] = useUrlState(minCodec, null);
  const [rangeParam, setRange] = useUrlState(rangeCodec, null);
  const [ocParam, setOc] = useUrlState(ocCodec, null);
  const size = Number(sizeParam) as BestLineupSize;
  const slider = BEST_LINEUP_SLIDER[size];
  const minPoss = minParam !== null ? clampBestLineupMin(size, minParam) : BEST_LINEUP_MIN_POSS_DEFAULT[size];
  const top = Number(topParam);
  const target = useRef<HTMLDivElement>(null);
  const request = useJsonData(() => category === 'premier' ? fetchBestLineups(size) : Promise.resolve(null), [size, category], { discardStale: true });
  const allGroups = useMemo(() => request.data ? bestLineupGroups(request.data) : [], [request.data]);
  const seasons = request.data?.seasons ?? [];
  // 読み込む前は、URL の範囲をそのまま使う。読み込んだあと、ファイルに無いシーズンは歴代に戻す
  const rangeSeason = rangeParam !== null && (!request.data || seasons.includes(rangeParam)) ? rangeParam : null;
  const groups = useMemo(() => bestLineupGroupsInSeason(allGroups, rangeSeason), [allGroups, rangeSeason]);
  const ocValues = useMemo(() => ocChoices(groups, size), [groups, size]);
  const oc = ocParam !== null && ocValues.includes(ocParam) ? ocParam : null;
  const ranked = useMemo(() => queryBestLineups(groups, { gameType, oc, minPoss, sort }), [groups, gameType, oc, minPoss, sort]);
  const shown = useMemo(() => topBestLineups(ranked, top), [ranked, top]);
  // 強調するクラブの選択肢は、対象期間に組があったすべてのクラブ（名前は最後のシーズンの名称）
  const clubs = useMemo(() => {
    const byId = new Map<string, { teamId: string; teamName: string; season: string }>();
    for (const g of groups) { const c = byId.get(g.teamId); if (!c || g.season > c.season) byId.set(g.teamId, { teamId: g.teamId, teamName: g.teamName, season: g.season }); }
    return [...byId.values()].sort((a, b) => a.teamId.localeCompare(b.teamId, undefined, { numeric: true }));
  }, [groups]);
  const hl = useHighlightClubs({ season, category, teams: clubs, divisionOf: () => undefined, allTime: true });
  const outside = useMemo(() => highlightedBest(ranked, shown, hl.ids), [ranked, shown, hl.ids]);
  const colors = useTeamColorsForChip();
  const colorOf = (teamId: string) => teamChipColor(teamId, colors)?.split('|')[0] ?? 'var(--accent)';
  const names = useMemo(() => [...shown, ...outside.flatMap(o => o.best ? [o.best] : [])].flatMap(r => r.row.group.players.map(p => p.name)), [shown, outside]);
  const playerLabel = usePlayerLabel(names);

  const range = rangeSeason !== null ? `${rangeSeason}シーズン` : seasons.length ? `${seasons[0]}〜${seasons[seasons.length - 1]}` : '2020-21〜';
  const isCurrent = rangeSeason !== null && seasons.length > 0 && rangeSeason === seasons[seasons.length - 1];
  const rangeOptions = [{ value: 'all', label: '歴代（2020-21〜）' }, ...(seasons.length ? [...seasons].reverse() : rangeParam ? [rangeParam] : []).map(v => ({ value: v, label: v }))];
  const gameLabels = seasonGameTypeLabels(null);
  const axes: FilterAxis[] = [
    { kind: 'select', id: 'blRange', label: '範囲', tier: 'primary', value: rangeSeason ?? 'all', defaultValue: 'all', options: rangeOptions, onChange: v => { setRange(v === 'all' ? null : v); setOc(null); } },
    { kind: 'select', id: 'blSize', label: '人数', tier: 'primary', value: sizeParam, defaultValue: '5', options: SIZE_VALUES.map(v => ({ value: v, label: `${v}人` })), onChange: v => { setSize(v as `${BestLineupSize}`); setMin(null); setOc(null); } },
    { kind: 'select', id: 'blSort', label: '並び順', tier: 'primary', value: sort, defaultValue: 'net', options: BEST_LINEUP_SORTS.map(s => ({ value: s, label: s === 'def' ? `${BEST_LINEUP_SORT_LABELS[s]}（低い順）` : `${BEST_LINEUP_SORT_LABELS[s]}（${s === 'min' ? '長い' : '高い'}順）` })), onChange: v => setSort(v as BestLineupSort) },
    gameTypeAxis(gameType, setGameType, null),
    { kind: 'popover', id: 'blMin', label: '下限', tier: 'primary', value: String(minPoss), defaultValue: String(BEST_LINEUP_MIN_POSS_DEFAULT[size]), onChange: () => setMin(null), summary: `攻守とも${minPoss}ポゼッション以上`, chipValue: `攻守とも${minPoss}ポゼッション以上`,
      content: <EligibilitySlider label="ポゼッション（攻守とも）" value={minPoss} min={slider.min} max={slider.max} step={slider.step} format={v => String(v)} onChange={v => setMin(v === BEST_LINEUP_MIN_POSS_DEFAULT[size] ? null : v)} /> },
    { kind: 'select', id: 'blOc', label: 'オンザコート', tier: 'primary', value: oc === null ? 'all' : String(oc), defaultValue: 'all', options: [{ value: 'all', label: 'すべて' }, ...ocValues.map(v => ({ value: String(v), label: `OC${v}` }))], onChange: v => setOc(v === 'all' ? null : Number(v)) },
    { kind: 'select', id: 'blTop', label: '表示', tier: 'primary', value: topParam, defaultValue: '10', options: [{ value: '10', label: '上位10組' }, { value: '20', label: '上位20組' }], onChange: v => setTop(v as '10' | '20') },
    hl.axis,
  ];
  const conditions = [range, `${size}人`, gameLabels[gameType], `攻守とも${minPoss}ポゼッション以上`, ...(oc === null ? [] : [`OC${oc}`]), sortLabel(sort), ...hl.labels];
  const title = '最強ラインナップ';
  const baseDate = rangeSeason === null ? { kind: 'allTime' as const, gameType } : isCurrent ? { kind: 'season' as const, season: rangeSeason, gameType } : undefined;
  const reset = () => { setRange(null); setSize('5'); setSort('net'); setGameType('regular'); setTop('10'); setMin(null); setOc(null); hl.setIds([]); };

  if (category !== 'premier') return <section aria-label="最強ラインナップ"><p className="empty-message">この図は B.PREMIER（旧B1）だけです。</p></section>;
  const card = (r: RankedBestLineup) => <LineupCard key={r.row.group.key} item={r} size={size} sort={sort} highlighted={hl.ids.includes(r.row.group.teamId)} color={colorOf(r.row.group.teamId)} playerLabel={playerLabel} />;
  return <section aria-label="最強ラインナップ">
    <FilterBar axes={axes} stateKey="figures:best-lineup" onClearAll={reset} />
    {request.loading ? <p role="status">読み込み中…</p> : request.error || !request.data ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : <>
      <p className="figure-count">対象 {ranked.length}組</p>
      <FigureExportButton targetRef={target} filename={`最強ラインナップ_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="best-lineup-export" baseDate={baseDate}>
        <ConditionTitle title={title} exportScope={rangeSeason === null ? '歴代' : `${rangeSeason}シーズン`} conditions={conditions} />
        {shown.length === 0 ? <p className="empty-message">この条件に当てはまる組はありません。</p> : <ol className={`best-lineup-list best-lineup-size-${size}`}>{shown.map(card)}</ol>}
        {outside.length > 0 && <div className="best-lineup-outside">
          {outside.map(o => <div key={o.teamId} className="best-lineup-outside-item">
            <p className="best-lineup-outside-title"><TeamChip teamId={o.teamId}>{teamShortName(o.teamId, clubs.find(c => c.teamId === o.teamId)?.teamName ?? o.teamId)}</TeamChip>の最上位：{o.best ? `全体${o.best.rank}位` : 'この条件の組はありません'}</p>
            {o.best && <ol className={`best-lineup-list best-lineup-size-${size}`}>{card(o.best)}</ol>}
          </div>)}
        </div>}
      </ExportTarget>
    </>}
  </section>;
}

function LineupCard({ item, size, sort, highlighted, color, playerLabel }: {
  item: RankedBestLineup; size: BestLineupSize; sort: BestLineupSort; highlighted: boolean; color: string; playerLabel: (name: string) => string;
}) {
  const { row, rank } = item;
  const g = row.group;
  const metric = (key: 'net' | 'off' | 'def', label: string, text: string) =>
    <span className={`best-lineup-metric${sort === key ? ' is-active' : ''}`}><span className="best-lineup-metric-label">{label}</span><span className="best-lineup-metric-value">{text}</span></span>;
  return <li className={`best-lineup-card${highlighted ? ' is-highlighted' : ''}`} style={highlighted ? { '--hl-color': color } as CSSProperties : undefined}>
    <span className="best-lineup-rank">{rank}</span>
    <span className="best-lineup-club">
      <span className="best-lineup-club-name"><TeamLogo teamId={g.teamId} size={20} /><TeamChip teamId={g.teamId}>{teamShortName(g.teamId, g.teamName)}</TeamChip><span className="best-lineup-season">{g.season}</span></span>
      <span className={`best-lineup-sub${sort === 'min' ? ' is-active' : ''}`}>{formatMinutesFromSeconds(row.seconds)}・{row.games}試合・POSS {row.ownPoss}／{row.oppPoss}</span>
    </span>
    <span className="best-lineup-players" style={{ '--bl-size': size } as CSSProperties}>
      {g.players.map(p => <span key={p.id} className="best-lineup-player">
        <PlayerPhoto playerId={p.id} size={44} className="best-lineup-photo" placeholder />
        <span className="best-lineup-player-name"><NameText name={playerLabel(p.name)} /></span>
      </span>)}
    </span>
    <span className="best-lineup-metrics">
      {metric('net', 'NetRtg', signed(row.net))}
      {metric('off', 'ORtg', row.off === null ? '-' : formatDecimal(row.off))}
      {metric('def', 'DRtg', row.def === null ? '-' : formatDecimal(row.def))}
    </span>
  </li>;
}
