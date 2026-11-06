import { useMemo, useRef, useState } from 'react';
import { fetchPlayers, fetchTeams, fetchPlayerGameLogs, fetchTeamGameLogs, fetchDivisionHistory, fetchSeasonRegistrations } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import { enumParam, listParam, numberParam, situationalParam, useUrlState, type UrlCodec } from '../lib/urlState';
import { classificationAxis, gameTypeAxis, situationalAxes, teamMultiAxis, type FilterAxis } from '../lib/filterAxes';
import type { SituationalFilter } from '../lib/situational';
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from '../../shared/gameType';
import { figureClassGroup } from '../lib/figureAge';
import { CLASSIFICATION_PARAM } from '../lib/urlFilterParams';
import { classificationFilterLabel, splitClassificationBlocked, SPLIT_CLASSIFICATION_UNAVAILABLE_REASON } from '../lib/classificationFilter';
import { buildUsgPpp, usgPppAverage, usgPppDomain, type UsgPppPoint } from '../lib/figureUsgPpp';
import { divisionPresets } from '../lib/divisionGroups';
import { clubSelectionLabels, situationalFilterLabels } from '../lib/conditionLabels';
import { useTeamLabel } from '../lib/teamLabel';
import { usePlayerLabel } from '../lib/playerLabel';
import { canonicalStatLabel } from '../lib/statNames';
import { statDescription } from '../lib/statDescriptions';
import { formatDecimal, formatPct100 } from '../lib/format';
import { EligibilitySlider } from '../components/EligibilitySlider';
import { FilterBar } from '../components/FilterBar';
import { ExportTarget } from '../components/ExportTarget';
import { ExportImageButton } from '../components/ExportImageButton';
import { ConditionTitle } from '../components/ConditionTitle';
import { ScorerPhoto } from './TopScorersFigure';
import type { FigureProps } from './catalog';
import './UsgPppFigure.css';

const DEFAULT: SituationalFilter = { range: { kind: 'all' } };
const EMPTY: string[] = [];
const DEFAULT_PTS = 15;
const DEFAULT_RATIO = 85;
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ['rng'],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== 'recent' || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = enumParam<SeasonGameTypeFilter>('gt', ['regular', 'playoff', 'both'], 'regular');
const clsCodec = CLASSIFICATION_PARAM;
const ratioCodec = numberParam('ugp', DEFAULT_RATIO, { min: 0, max: 100 });
const ptsCodec = numberParam('upts', DEFAULT_PTS, { min: 0, max: 50 });
const clubsCodec = listParam('ucl');
const USG = canonicalStatLabel('USG%'), PPP = canonicalStatLabel('PPP'), PTS = canonicalStatLabel('PTS');
type SortKey = 'team' | 'games' | 'ratio' | 'pts' | 'usg' | 'ppp';
const text = (v: number | null, percent = false) => v === null ? '—' : percent ? formatPct100(v) : formatDecimal(v);
const major = (v: number, step: number) => Math.abs(v / (step * 2) - Math.round(v / (step * 2))) < 1e-6;

export default function UsgPppFigure({ season, category }: FigureProps) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, 'regular');
  const [classification, setClassification] = useUrlState(clsCodec, 'all');
  const [minRatio, setMinRatio] = useUrlState(ratioCodec, DEFAULT_RATIO);
  const [minPts, setMinPts] = useUrlState(ptsCodec, DEFAULT_PTS);
  const [clubs, setClubs] = useUrlState(clubsCodec, EMPTY);
  const [team, setTeam] = useState('all'), [hover, setHover] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'pts', desc: true });
  const target = useRef<HTMLDivElement>(null), teamLabel = useTeamLabel();
  const request = useJsonData(async () => {
    const [players, teams, divisions, registrations] = await Promise.all([
      fetchPlayers(season, category), fetchTeams(season, category), fetchDivisionHistory(),
      season >= '2026-27' ? fetchSeasonRegistrations(season, category) : Promise.resolve(null),
    ]);
    const [playerLogs, teamLogs] = await Promise.all([
      Promise.all(players.map(async p => [p.playerId, await fetchPlayerGameLogs(season, p.playerId, category)] as const)),
      Promise.all(teams.map(async t => [t.teamId, await fetchTeamGameLogs(season, t.teamId, category)] as const)),
    ]);
    return { players, teams, divisions, registrations, playerLogs: new Map(playerLogs), teamLogs: new Map(teamLogs) };
  }, [season, category]);
  const points = useMemo(() => request.data ? buildUsgPpp(request.data, { season, category, range: filter.range, gameType, classification }) : [], [request.data, season, category, filter, gameType, classification]);
  const visible = useMemo(() => points.filter(p => p.ratio >= minRatio && p.pts >= minPts && (!clubs.length || p.teamIds.some(id => clubs.includes(id)))), [points, minRatio, minPts, clubs]);
  const plotted = visible.filter(p => p.usg !== null && p.ppp !== null);
  const average = usgPppAverage(plotted), playerLabel = usePlayerLabel(visible.map(p => p.name));
  // 固定範囲を基本に、表示する選手がはみ出すときだけ広げる。
  const xd = usgPppDomain([...plotted.map(p => p.usg), average.usg], 'usg');
  const yd = usgPppDomain([...plotted.map(p => p.ppp), average.ppp], 'ppp');
  const x = (v: number) => 100 * (v - xd.min) / (xd.max - xd.min);
  const y = (v: number) => 100 * (yd.max - v) / (yd.max - yd.min);
  const tip = plotted.find(p => p.id === hover);
  const teams = request.data?.teams ?? [];
  const divisionOf = (id: string) => request.data?.divisions?.[category]?.[season]?.[id];
  const namesOf = (p: UsgPppPoint) => p.teamIds.map(id => teamLabel(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・');
  const groups = divisionPresets(teams.map(t => t.teamId), divisionOf, category).map(g => ({ label: g.label, values: g.teamIds }));
  const clubLabels = clubSelectionLabels('対象クラブ', clubs, teams.map(t => ({ value: t.teamId, label: teamLabel(t.teamId, t.teamName) })), groups);
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range }))
    .filter(a => a.id === 's.range' || (filter.range.kind === 'dateRange' && (a.id === 's.dateStart' || a.id === 's.dateEnd')))
    .map(a => a.kind === 'select' ? { ...a, options: a.options.filter(o => ['all', 'recent:5', 'recent:10', 'custom'].includes(o.value)) } : { ...a, tier: 'primary' as const });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season),
    classificationAxis(classification, setClassification, { season }),
    teamMultiAxis({ id: 'usgClubs', options: teams, selected: clubs.length ? new Set(clubs) : null, onChange: v => setClubs(v ? [...v] : []), divisionOf, league: category }),
    { kind: 'popover', id: 'usgPts', label: '平均得点', tier: 'primary', value: String(minPts), defaultValue: String(DEFAULT_PTS), onChange: () => setMinPts(DEFAULT_PTS), summary: `平均得点${minPts}以上`, chipValue: `平均得点${minPts}以上`, content: <EligibilitySlider label="平均得点" value={minPts} min={0} max={50} step={0.5} format={v => `${v}点`} onChange={setMinPts} /> },
    { kind: 'popover', id: 'usgRatio', label: '出場率', tier: 'primary', value: String(minRatio), defaultValue: String(DEFAULT_RATIO), onChange: () => setMinRatio(DEFAULT_RATIO), summary: `出場率${minRatio}%以上`, chipValue: `出場率${minRatio}%以上`, content: <EligibilitySlider label="出場率" value={minRatio} min={0} max={100} step={1} format={v => `${v}%`} onChange={setMinRatio} /> },
  ];
  const conditions = [season, seasonGameTypeLabels(season)[gameType], ...situationalFilterLabels(filter), classificationFilterLabel(classification),
    ...(clubs.length ? clubLabels : []), `平均得点${minPts}以上`, `出場率${minRatio}%以上`];
  const baseDate = { kind: 'season' as const, season, gameType };
  const sorted = [...visible].sort((a, b) => {
    if (sort.key === 'team') return (namesOf(a).localeCompare(namesOf(b), 'ja') || b.pts - a.pts) * (sort.desc ? -1 : 1);
    const av = a[sort.key], bv = b[sort.key];
    return av === null ? bv === null ? 0 : 1 : bv === null ? -1 : (av - bv) * (sort.desc ? -1 : 1);
  });
  const select = (p: UsgPppPoint) => { setTeam(p.teamIds.includes(team) ? team : p.teamIds[0] ?? 'all'); setHover(p.id); };
  const sortButton = (key: SortKey, label: string) => <button title={statDescription(label)} onClick={() => setSort(s => ({ key, desc: s.key === key ? !s.desc : true }))}>{label}{sort.key === key ? sort.desc ? ' ↓' : ' ↑' : ' ↕'}</button>;
  return <section aria-label={`${USG} × ${PPP}`}>
    <FilterBar axes={axes} stateKey="figures:usg-ppp" onClearAll={() => { setFilter(DEFAULT); setGameType('regular'); setClassification('all'); setClubs(EMPTY); setMinPts(DEFAULT_PTS); setMinRatio(DEFAULT_RATIO); setTeam('all'); setHover(null); }} />
    {splitClassificationBlocked(figureClassGroup(classification), season) ? <p>{SPLIT_CLASSIFICATION_UNAVAILABLE_REASON}</p> : request.loading ? <p role="status">選手の試合データを読み込み中…</p> : request.error ? <p role="alert">データを読み込めませんでした。ページを読み直してください。</p> : !visible.length ? <p>この条件に該当する選手はいません。</p> : <>
      <div className="figures-controls"><label>手前に表示するチーム<select value={team} onChange={e => { setTeam(e.target.value); setHover(null); }}><option value="all">指定なし</option>{teams.filter(t => visible.some(p => p.teamIds.includes(t.teamId))).map(t => <option key={t.teamId} value={t.teamId}>{teamLabel(t.teamId, t.teamName)}</option>)}</select></label><span>{plotted.length}人を表示</span></div>
      <ExportImageButton targetRef={target} filename={`USG_PPP_${conditions.join('_')}`} baseDate={baseDate} />
      <ExportTarget ref={target} className="ratings-export scorers-export usg-ppp-export" baseDate={baseDate}>
        <ConditionTitle title={`${USG} × ${PPP}`} exportScope={`${season}シーズン`} conditions={conditions} />
        <div className="ratings-chart"><div className="ratings-plot-wrap">
          <span className="ratings-y-label">↑ {PPP}</span>
          <div className="ratings-plot">
            {xd.ticks.map(t => <span key={`x${t}`} className={`ratings-grid-v scoring-grid ${major(t, xd.step) ? 'is-major' : 'is-minor'}`} style={{ left: `${x(t)}%` }} />)}
            {yd.ticks.map(t => <span key={`y${t}`} className={`ratings-grid-h scoring-grid ${major(t, yd.step) ? 'is-major' : 'is-minor'}`} style={{ top: `${y(t)}%` }} />)}
            {average.usg !== null && <span className="ratings-average-v" style={{ left: `${x(average.usg)}%` }} />}
            {average.ppp !== null && <span className="ratings-average-h" style={{ top: `${y(average.ppp)}%` }} />}
            {plotted.map(p => <ScorerPhoto key={p.id} point={p} label={`${playerLabel(p.name)}：${USG} ${text(p.usg, true)}、${PPP} ${text(p.ppp)}`} selected={p.teamIds.includes(team)} expanded={p.id === hover} left={x(p.usg!)} top={y(p.ppp!)} onSelect={() => setHover(p.id)} onDismiss={() => setHover(null)} />)}
            {tip && <div className="ratings-tooltip scoring-tooltip" role="tooltip" style={{ left: `clamp(0px, calc(${x(tip.usg!)}% - 130px), calc(100% - 260px))`, top: `clamp(0px, calc(${y(tip.ppp!)}% + 24px), calc(100% - 130px))` }}><strong>{playerLabel(tip.name)}（{namesOf(tip)}）</strong><span>{USG} {text(tip.usg, true)} / {PPP} {text(tip.ppp)}</span><span>平均得点 {text(tip.pts)} / 出場率 {text(tip.ratio, true)}</span><span>{tip.games}試合{tip.teamIds.length > 1 ? '・複数チームの合算' : ''}</span></div>}
          </div>
          {xd.ticks.filter(t => major(t, xd.step)).map(t => <span className="ratings-tick-x" key={t} style={{ left: `${x(t)}%` }}>{text(t)}</span>)}
          {yd.ticks.filter(t => major(t, yd.step)).map(t => <span className={`ratings-tick-y${major(t, yd.step * 2) ? '' : ' usg-tick-secondary'}`} key={t} style={{ top: `${y(t)}%` }}>{text(t)}</span>)}
          <span className="ratings-x-label">{USG} →</span>
        </div></div>
      </ExportTarget>
      <div className="figure-notes"><p>平均線は表示中の選手の単純平均：{USG} {text(average.usg, true)}、{PPP} {text(average.ppp)}。どちらかの値がない選手は図と平均線から外し、一覧には「—」で残します。</p><p>期間と試合種別は全選手スタッツと同じ選び方です。直近5・10試合は選手ごとの試合ログで選び、その後に試合種別を絞ります。出場率の分母は対象期間のチーム試合数。移籍選手は所属期間のチーム試合数を合算します。</p><p>移籍選手は1人1点の合算で、対象クラブと手前表示はその期間に出場した所属先のいずれかに当てはまれば対象です。写真は保存されている1枚で、当時のユニフォームとは限りません。写真のない選手は影と名字で表示します。重なる点はチーム選択または一覧から選べます。</p><p>{PPP}は個人の{canonicalStatLabel('ORtg')}÷100。全期間のレギュラーシーズンは全選手スタッツと同じ値で、期間指定時は同画面の期間指定・個人詳細のシチュエーション別成績と同じ計算です。全期間の個人詳細は本人が出場した試合だけを分母にするため、値が異なる場合があります。</p></div>
      <div className="ratings-table-scroll scorers-table" tabIndex={0} role="region" aria-label="選手一覧"><table className="ratings-table"><thead><tr><th>{sortButton('team', '選手／チーム')}</th><th>{sortButton('games', 'G')}</th><th>{sortButton('pts', PTS)}</th><th>{sortButton('ratio', '出場率')}</th><th>{sortButton('usg', USG)}</th><th>{sortButton('ppp', PPP)}</th></tr></thead><tbody>{sorted.map(p => <tr key={p.id} className={p.teamIds.includes(team) ? 'is-selected' : ''}><td><button onClick={() => select(p)}>{playerLabel(p.name)} / {namesOf(p)}{p.teamIds.length > 1 ? '（合算）' : ''}</button></td><td>{p.games}</td><td>{text(p.pts)}</td><td>{text(p.ratio, true)}</td><td>{text(p.usg, true)}</td><td>{text(p.ppp)}</td></tr>)}</tbody></table></div>
    </>}
  </section>;
}
