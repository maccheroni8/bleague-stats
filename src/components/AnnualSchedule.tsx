import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CalendarGame } from '../../shared/annualSchedule';
import { cupGameUrl, cupRoundText, easlGameUrl, fetchCalendar } from '../lib/easlCalendar';
import { CupClubName, CupLogo, EaslLogo } from './EaslLogo';
import { annualLeagueGames, calendarDates, calendarResult } from '../lib/annualSchedule';
import { fetchGameSummaries, fetchSchedule, fetchTeams, fetchDivisionHistory, fetchStandingsHistory, fetchPlayoffRace } from '../lib/data';
import { teamDivisionForSeason } from '../../scripts/lib/divisions';
import { statDescription } from '../lib/statDescriptions';
import { formatWinPct, formatDecimal } from '../lib/format';
import type { League } from '../lib/league';
import { useJsonData } from '../lib/useJsonData';
import { TeamLogo } from './TeamLogo';
import { ResponsiveTeamName } from './ResponsiveTeamName';
import { SeasonLink } from './SeasonLink';
import { DIVISION_LABELS, divisionOrder } from '../lib/divisionGroups';
import { ConditionTitle } from './ConditionTitle';
import { ExportTarget } from './ExportTarget';
import { ExportImageButton } from './ExportImageButton';
import { HeaderActions } from './HeaderActions';
import { buildExportFilename } from '../lib/conditionLabels';
import './AnnualSchedule.css';

/** 画像として保存できる期間の上限（日数）。1日の幅が42pxなので、これを超えると画像が横に長くなりすぎる */
const SAVE_MAX_DAYS = 62;
const ymdSlash = (d: string) => d.replaceAll('-', '/');

const STANDING_LABELS = ['試合数', '勝', '負', '勝率', '残', 'ゲーム差'];
const statStyle = (i: number) => ({ '--annual-stat-offset': `${i * 42}px` }) as CSSProperties;
const COMPETITIONS = { league: 'リーグ戦', easl: 'EASL', cup: '天皇杯' };
export function AnnualSchedule({ season, league }: { season: string; league: League }) {
  // シーズン変更時は親のkeyで再作成。古いシーズンの読み込み結果を表示しない。
  const { data, loading, error } = useJsonData(async () => {
    const [games, schedule, teams, divisions, history, race] = await Promise.all([fetchGameSummaries(season, league), fetchSchedule(season, league), fetchTeams(season, league), fetchDivisionHistory(), fetchStandingsHistory(season, league), fetchPlayoffRace(season, league).catch(() => null)]);
    const ranks = new Map(history[history.length - 1]?.teams.map(t => [t.teamId, t]));
    const remaining = new Map(race?.teams.map(t => [t.teamId, t.remaining]));
    return { games, schedule, asOf: history[history.length - 1]?.date, teams: teams.map(t => ({ ...t, division: teamDivisionForSeason(divisions, t.teamId, season, league), divisionRank: ranks.get(t.teamId)?.divisionRank, standing: ranks.get(t.teamId), remaining: remaining.get(t.teamId) })) };
  }, [season, league]);
  const external = useJsonData(fetchCalendar, []);
  const scrolls = useRef(new Map<string, HTMLDivElement>());
  const [selected, setSelected] = useState<{ game: CalendarGame; teamId: string } | null>(null);
  /** 表示する期間（YYYY-MM-DD。空は端なし）。画像として保存する範囲もこの期間 */
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  /** 画像として保存する期間・地区（保存の窓の中で選ぶ。null は「いま画面に出ている期間」のまま） */
  const [saveFrom, setSaveFrom] = useState<string | null>(null);
  const [saveTo, setSaveTo] = useState<string | null>(null);
  const [saveDivision, setSaveDivision] = useState('all');
  const saveRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSaveFrom(null); setSaveTo(null); }, [from, to]);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Tokyo' }).format(new Date());
  const supplement = external.data?.seasons[season];
  const games = useMemo(() => data ? [...annualLeagueGames(data.games, data.schedule, data.teams), ...(supplement?.games ?? [])] : [], [data, supplement]);
  const dates = useMemo(() => {
    const leagueDates = games.filter(g => g.competition === 'league').map(g => g.date).sort();
    const first = leagueDates[0];
    const last = supplement?.finalsEnd ?? leagueDates[leagueDates.length - 1];
    return calendarDates(season, first, last);
  }, [season, games, supplement?.finalsEnd]);
  const months = useMemo(() => [...new Set(dates.map(d => d.slice(0, 7)))], [dates]);
  const shownDates = useMemo(() => dates.filter(d => (!from || d >= from) && (!to || d <= to)), [dates, from, to]);
  const shownMonths = useMemo(() => [...new Set(shownDates.map(d => d.slice(0, 7)))], [shownDates]);
  const index = useMemo(() => {
    const map = new Map<string, CalendarGame[]>();
    for (const g of games) for (const id of new Set([g.home.id, g.away.id])) {
      if (!id) continue;
      const key = `${id}:${g.date}`;
      map.set(key, [...(map.get(key) ?? []), g]);
    }
    return map;
  }, [games]);
  function jump(date: string) {
    for (const root of scrolls.current.values()) {
      const cell = root.querySelector<HTMLElement>(`[data-date="${date}"]`);
      if (cell) root.scrollTo({ left: cell.offsetLeft - (root.querySelector('.annual-team-col')?.getBoundingClientRect().width ?? 150) - (window.matchMedia('(min-width: 761px)').matches ? 252 : 0), behavior: 'auto' });
    }
  }
  useEffect(() => {
    if (loading || !data || external.loading) return;
    const first = games.map(g => g.date).filter(d => dates.includes(d)).sort()[0];
    const frame = requestAnimationFrame(() => jump(dates.includes(today) ? today : first ?? dates[0]!));
    return () => cancelAnimationFrame(frame);
  }, [loading, data, external.loading, dates, today]);
  if (loading) return <p className="loading">年間スケジュールを読み込み中...</p>;
  if (error || !data) return <p className="error-message">日程を取得できませんでした。再読み込みしてください。</p>;
  const groups = divisionOrder(league).map(division => ({ label: DIVISION_LABELS[division], teams: data.teams.filter(t => t.division === division).sort((a, b) => (a.divisionRank ?? Infinity) - (b.divisionRank ?? Infinity)) })).filter(g => g.teams.length);
  const ungrouped = data.teams.filter(t => !t.division);
  if (ungrouped.length) groups.push({ label: 'チーム', teams: ungrouped });
  const events = supplement?.events ?? [];
  const periodOf = (ds: string[], f: string, t: string) => ds.length === 0 ? '期間: 該当なし' : f || t ? `期間: ${ymdSlash(ds[0]!)}〜${ymdSlash(ds[ds.length - 1]!)}` : '期間: 全期間';
  const periodLabel = periodOf(shownDates, from, to);
  const monthRange = (m: string) => { const days = dates.filter(d => d.startsWith(m)); setFrom(days[0]!); setTo(days[days.length - 1]!); };
  // 画像として保存する期間（窓で選ぶ。最初は画面に出ている期間）
  const effSaveFrom = saveFrom ?? from;
  const effSaveTo = saveTo ?? to;
  const saveDates = dates.filter(d => (!effSaveFrom || d >= effSaveFrom) && (!effSaveTo || d <= effSaveTo));
  const saveMonths = [...new Set(saveDates.map(d => d.slice(0, 7)))];
  const saveGroups = saveDivision === 'all' ? groups : groups.filter(g => g.label === saveDivision);
  const saveEvents = events.filter(e => saveDates.some(d => d >= e.start && d <= e.end));
  const saveHasCup = saveEvents.some(e => e.competition === 'cup') || games.some(g => g.competition === 'cup' && saveDates.includes(g.date));
  const savePeriodLabel = periodOf(saveDates, effSaveFrom, effSaveTo);
  const tooLong = saveDates.length > SAVE_MAX_DAYS;
  const saveOptions = <>
    <span className="export-option-group annual-save-period">
      <span className="export-option-label">期間</span>
      <label><input type="date" value={effSaveFrom || dates[0]} min={dates[0]} max={effSaveTo || dates[dates.length - 1]} onChange={e => e.target.value && setSaveFrom(e.target.value)} aria-label="保存する期間の開始日" /></label>
      <span>〜</span>
      <label><input type="date" value={effSaveTo || dates[dates.length - 1]} min={effSaveFrom || dates[0]} max={dates[dates.length - 1]} onChange={e => e.target.value && setSaveTo(e.target.value)} aria-label="保存する期間の終了日" /></label>
      <select value="" onChange={e => { if (e.target.value) { const days = dates.filter(d => d.startsWith(e.target.value)); setSaveFrom(days[0]!); setSaveTo(days[days.length - 1]!); } }} aria-label="月を選んで保存する期間にする">
        <option value="">月で選ぶ</option>
        {months.map(m => <option key={m} value={m}>{m.replace('-', '年')}月</option>)}
      </select>
      <button type="button" onClick={() => { setSaveFrom(''); setSaveTo(''); }} disabled={!effSaveFrom && !effSaveTo}>全期間</button>
    </span>
    <span className="export-option-group" role="group" aria-label="保存する地区">
      <span className="export-option-label">地区</span>
      {[{ label: '全地区', value: 'all' }, ...groups.map(g => ({ label: g.label, value: g.label }))].map(o =>
        <button type="button" key={o.value} className={saveDivision === o.value ? 'active' : ''} onClick={() => setSaveDivision(o.value)}>{o.label}</button>)}
    </span>
    <span className="annual-save-range">{savePeriodLabel.replace('期間: ', '')}（{saveDates.length}日間）</span>
  </>;
  const saveDisabledReason = tooLong ? `画像として保存できるのは${SAVE_MAX_DAYS}日分までです。期間を短くしてください（いまは${saveDates.length}日分）` : saveDates.length === 0 ? '期間に当てはまる日がありません' : undefined;
  type BlockOpts = { dates: string[]; months: string[]; groups: typeof groups; events: typeof events; periodLabel: string; showCupNote: boolean; interactive: boolean };
  const block = (o: BlockOpts) => <>
    <ConditionTitle title={`${season}シーズン 年間スケジュール`} conditions={['レギュラーシーズン' + (data.asOf ? `（${ymdSlash(data.asOf)}時点の成績）` : ''), o.periodLabel]} />
    <p className="annual-legend"><span className="annual-home">H ホーム</span><span className="annual-away">A アウェー</span><span>N 中立会場</span><span>○ 勝ち　● 負け</span>{o.showCupNote && <span className="annual-projected-key">薄い表示＝天皇杯で勝ち上がった場合の予定</span>}<span className="export-hide">マスを選ぶと試合の詳細を表示</span></p>
    {o.groups.map(group => <section className="annual-division-section" key={group.label}>
    <h3>{group.label}</h3>
    <div className="annual-scroll" ref={o.interactive ? (node => { if (node) scrolls.current.set(group.label, node); else scrolls.current.delete(group.label); }) : undefined} tabIndex={o.interactive ? 0 : -1} role="region" aria-label={`${group.label}の年間スケジュール。左右にスクロールできます`}>
      <table className="annual-grid">
        <caption className="annual-sr-only">{season}シーズン。日付別・チーム別の対戦相手と勝敗。日付は日本時間。</caption>
        <colgroup><col className="annual-team-col" />{STANDING_LABELS.map(label => <col key={label} className="annual-stat-col" />)}{o.dates.map(d => <col key={d} className="annual-day-col" />)}</colgroup>
        <thead>
          <tr><th className="annual-corner" scope="col" colSpan={7}>レギュラーシーズン{data.asOf ? `・${data.asOf}時点` : ""}</th>{o.months.map(m => <th key={m} scope="colgroup" colSpan={o.dates.filter(d => d.startsWith(m)).length}>{m.replace('-', '年')}月</th>)}</tr>
          <tr><th className="annual-corner" scope="col">チーム</th>{STANDING_LABELS.map((label, i) => <th key={label} scope="col" className="annual-stat" style={statStyle(i)} title={statDescription(label === "残" ? "残り試合数" : label, "team")}>{label}</th>)}{o.dates.map(d => { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th scope="col" data-date={d} key={d} className={`${d === today ? 'annual-today' : ''} ${dow === 0 || dow === 6 ? 'annual-weekend' : ''}`}><span>{Number(d.slice(8))}</span><small>{'日月火水木金土'[dow]}</small></th>; })}</tr>
        </thead>
        <tbody>
          {o.events.map(e => <tr key={e.id} className="annual-event"><th scope="row" colSpan={7}>{e.competition === 'cup' ? '天皇杯' : 'オールスター'}</th>{o.dates.map(date => {
            const active = date >= e.start && date <= e.end;
            return <td key={date} className={`${date === today ? 'annual-today' : ''} ${active ? 'annual-event-span' : ''}`}>
              {active && date === o.dates.find(d => d >= e.start && d <= e.end) && <a style={{ width: `${o.dates.filter(d => d >= e.start && d <= e.end).length * 42 - 1}px` }} href={e.source} target="_blank" rel="noreferrer" title={`${e.label} ${e.start}〜${e.end} ${e.note ?? ''}`}>{e.label}</a>}
            </td>;
          })}</tr>)}
          {group.teams.map((team, teamIndex) => <tr key={team.teamId} className={teamIndex === group.teams.length - 1 ? "annual-last-team" : undefined}>
              <th scope="row"><span className="annual-rank">{team.divisionRank ?? "−"}</span><TeamLogo teamId={team.teamId} size={34} /><ResponsiveTeamName teamId={team.teamId} name={team.teamName} always /></th>
              {(() => {
                const t = team.standing;
                const gb = t?.division ? t.divisionGamesBehind : t?.gamesBehind;
                const values = [t ? t.wins + t.losses : 0, t?.wins ?? 0, t?.losses ?? 0,
                  t && t.wins + t.losses > 0 ? formatWinPct(t.winPct) : '−', team.remaining ?? '−',
                  gb === undefined || gb === 0 ? '−' : formatDecimal(gb)];
                return values.map((value, i) => <td key={i} className="annual-stat" style={statStyle(i)}>{value}</td>);
              })()}
              {o.dates.map(date => <td key={date} className={date === today ? 'annual-today' : undefined}>{(index.get(`${team.teamId}:${date}`) ?? []).map(g => {
                const home = g.home.id === team.teamId;
                const opp = home ? g.away : g.home;
                const side = g.neutral ? 'N' : home ? 'H' : 'A';
                const result = calendarResult(g, home);
                const label = `${date} ${COMPETITIONS[g.competition]}${g.competition === 'cup' ? ' ' + cupRoundText(g) : ''} ${team.teamName} 対 ${opp.name} ${side} ${result} ${g.tipoff ?? ''}`;
                return <button type="button" key={`${g.competition}:${g.id}`} className={`annual-game ${g.neutral ? 'annual-neutral' : home ? 'annual-home' : 'annual-away'} ${g.status === 'cancelled' ? 'annual-cancelled' : ''} ${g.projected ? 'annual-projected' : ''}`} onClick={o.interactive ? () => setSelected({ game: g, teamId: team.teamId }) : undefined} title={label} aria-label={label}>
                  <small>{g.competition === 'league' ? side : `${g.competition === 'cup' ? '天皇杯' : 'EASL'} ${side}`}</small>
                  {opp.id ? <TeamLogo teamId={opp.id} size={30} /> : g.competition === 'cup' ? <CupLogo club={opp} size={30} /> : <EaslLogo club={opp} size={30} />}
                  <span>{result || (g.projected ? '予定' : '·')}</span>
                </button>;
              })}</td>)}
            </tr>)}
        </tbody>
      </table>
    </div>
    </section>)}
    <p className="annual-note">試合数・勝・負・勝率・残・ゲーム差はレギュラーシーズンの成績です。ゲーム差は地区首位との差、残は残り試合数です。</p>
    <p className="annual-note">{o.dates[0]}〜{o.dates[o.dates.length - 1]}・日本時間。リーグ戦はポストシーズンを含みます。空欄は収録した日程に試合がない日です。大会期間の帯は各チームの出場を示すものではありません。</p>
  </>;
  return <section className="annual-schedule">
    <div className="annual-toolbar">
      <button type="button" onClick={() => jump(today)} disabled={!dates.includes(today)}>今日</button>
      {months.map(m => <button type="button" key={m} onClick={() => jump(dates.find(d => d.startsWith(m))!)}>{Number(m.slice(5))}月</button>)}
    </div>
    <div className="annual-toolbar annual-period">
      <label>期間 <input type="date" value={from} min={dates[0]} max={to || dates[dates.length - 1]} onChange={e => setFrom(e.target.value)} aria-label="期間の開始日" /></label>
      <span>〜</span>
      <label><input type="date" value={to} min={from || dates[0]} max={dates[dates.length - 1]} onChange={e => setTo(e.target.value)} aria-label="期間の終了日" /></label>
      <select value="" onChange={e => { if (e.target.value) monthRange(e.target.value); }} aria-label="月を選んで期間にする">
        <option value="">月で選ぶ</option>
        {months.map(m => <option key={m} value={m}>{m.replace('-', '年')}月</option>)}
      </select>
      <button type="button" onClick={() => { setFrom(''); setTo(''); }} disabled={!from && !to}>全期間</button>
    </div>
    {external.error && <p role="alert">大会日程を取得できませんでした。リーグ戦のみ表示しています。</p>}
    {!external.loading && !external.error && !supplement && <p>このシーズンの天皇杯・EASL・オールスターの日程は未収録です。</p>}
    <div className="savable-block">
      <HeaderActions>
        <div className="savable-bar">
          <ExportImageButton targetRef={saveRef} filename={buildExportFilename([`${season}シーズン`, '年間スケジュール', savePeriodLabel.replaceAll('/', '-'), ...(saveDivision === 'all' ? [] : [saveDivision])])} baseDate={{ kind: 'season', season, gameType: 'regular' }} options={saveOptions} disabledReason={saveDisabledReason} />
        </div>
      </HeaderActions>
      <ExportTarget className="export-target-annual" baseDate={{ kind: 'season', season, gameType: 'regular' }}>
        {block({ dates: shownDates, months: shownMonths, groups, events, periodLabel, showCupNote: true, interactive: true })}
      </ExportTarget>
      {/* 画像として保存する範囲。画面には出さず（見えない位置に置く）、保存のときだけ複製して描く。窓で選んだ期間・地区だけを持つ */}
      <ExportTarget ref={saveRef} className="export-target-annual annual-save-target" baseDate={{ kind: 'season', season, gameType: 'regular' }}>
        <div aria-hidden="true">
          {block({ dates: saveDates, months: saveMonths, groups: saveGroups, events: saveEvents, periodLabel: savePeriodLabel, showCupNote: saveHasCup, interactive: false })}
        </div>
      </ExportTarget>
    </div>
    {supplement?.finalsSource && <p className="annual-note">終端はFINALSの最終戦予定日です。<a href={supplement.finalsSource} target="_blank" rel="noreferrer">公式日程</a></p>}
    {supplement?.notes.map(n => <p className="annual-note" key={n}>{n}</p>)}
    {supplement?.easlUpdatedAt && <p className="annual-note">EASLの日程・結果の更新：{supplement.easlUpdatedAt.slice(0, 10)}　<a href="https://www.easl.basketball/schedule-results" target="_blank" rel="noreferrer">公式日程</a></p>}
    {supplement?.cupUpdatedAt && <p className="annual-note">天皇杯の日程・結果の更新：{supplement.cupUpdatedAt.slice(0, 10)}　<a href="https://zennihon.japanbasketball.jp/" target="_blank" rel="noreferrer">公式サイト</a></p>}
    {selected && <GameDialog game={selected.game} teamId={selected.teamId} close={() => setSelected(null)} />}
  </section>;
}

function GameDialog({ game: g, teamId, close }: { game: CalendarGame; teamId: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const result = calendarResult(g, g.home.id === teamId);
  return <dialog ref={ref} className="annual-dialog" onClose={close} aria-labelledby="annual-game-title">
    <h3 id="annual-game-title">{COMPETITIONS[g.competition]}{g.competition === 'cup' && g.round ? ' ' + g.round : ''} · {g.date} {g.tipoff}</h3>
    {g.projected && <p>勝ち上がった場合の予定の試合です。</p>}
    <p>{g.competition === 'cup' ? <><CupClubName club={g.home} /> vs <CupClubName club={g.away} /></> : <><ResponsiveTeamName teamId={g.home.id ?? ''} name={g.home.name} /> vs <ResponsiveTeamName teamId={g.away.id ?? ''} name={g.away.name} /></>}</p>
    <p>{g.status === 'final' || g.status === 'live' ? `${g.homeScore ?? '-'} − ${g.awayScore ?? '-'}` : g.status === 'cancelled' ? '中止' : '開催予定'} {result}</p>
    <p>{g.venue ?? '会場未定'}{g.neutral ? '（中立会場）' : ''}</p>
    {g.note && <p>{g.note}</p>}
    {g.gameLink && <p><SeasonLink to={g.gameLink}>試合詳細へ</SeasonLink></p>}
    {g.competition === 'easl' ? <p><a href={easlGameUrl(g)} target="_blank" rel="noreferrer">EASL公式の試合ページへ</a></p> : g.competition === 'cup' ? <p><a href={cupGameUrl(g)} target="_blank" rel="noopener noreferrer">天皇杯公式サイトの試合ページへ</a></p> : g.source && <p><a href={g.source} target="_blank" rel="noreferrer">公式情報へ</a></p>}
    <form method="dialog"><button type="submit">閉じる</button></form>
  </dialog>;
}
