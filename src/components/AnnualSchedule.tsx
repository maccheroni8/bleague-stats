import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AnnualCalendarFile, CalendarGame } from '../../shared/annualSchedule';
import { annualLeagueGames, calendarDates, calendarResult } from '../lib/annualSchedule';
import { fetchGameSummaries, fetchSchedule, fetchTeams, fetchDivisionHistory, fetchStandingsHistory, fetchPlayoffRace } from '../lib/data';
import { teamDivisionForSeason } from '../../scripts/lib/divisions';
import { statDescription } from '../lib/statDescriptions';
import { formatWinPct, formatDecimal } from '../lib/format';
import { pendingUpcomingGames } from '../lib/pendingUpcoming';
import { useJsonData } from '../lib/useJsonData';
import { TeamLogo } from './TeamLogo';
import { ResponsiveTeamName } from './ResponsiveTeamName';
import { SeasonLink } from './SeasonLink';
import { DIVISION_LABELS, DIVISION_ORDER } from '../lib/divisionGroups';
import './AnnualSchedule.css';

const STANDING_LABELS = ['試合数', '勝', '負', '勝率', '残', 'GB'];
const statStyle = (i: number) => ({ '--annual-stat-offset': `${i * 42}px` }) as CSSProperties;
const COMPETITIONS = { league: 'リーグ戦', easl: 'EASL', cup: '天皇杯' };
async function fetchCalendar(): Promise<AnnualCalendarFile> {
  const res = await fetch(`${import.meta.env.BASE_URL}data/annual-calendar.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error('大会日程を取得できませんでした。');
  return res.json();
}

export function AnnualSchedule({ season }: { season: string }) {
  // シーズン変更時は親のkeyで再作成。古いシーズンの読み込み結果を表示しない。
  const { data, loading, error } = useJsonData(async () => {
    const [games, schedule, teams, divisions, history, race] = await Promise.all([fetchGameSummaries(season), fetchSchedule(season), fetchTeams(season), fetchDivisionHistory(), fetchStandingsHistory(season), fetchPlayoffRace(season).catch(() => null)]);
    const ranks = new Map(history[history.length - 1]?.teams.map(t => [t.teamId, t]));
    const remaining = new Map(race?.teams.map(t => [t.teamId, t.remaining]));
    const excluded = [...games, ...(schedule.resultOnlyGames ?? []), ...(schedule.cancelledGames ?? [])];
    const pending = pendingUpcomingGames(schedule.upcomingGames, excluded);
    return { games, schedule, asOf: history[history.length - 1]?.date, teams: teams.map(t => ({ ...t, division: teamDivisionForSeason(divisions, t.teamId, season), divisionRank: ranks.get(t.teamId)?.divisionRank, standing: ranks.get(t.teamId), remaining: remaining.get(t.teamId) ?? pending.filter(g => g.homeTeamName === t.teamName || g.awayTeamName === t.teamName).length })) };
  }, [season]);
  const external = useJsonData(fetchCalendar, []);
  const scrolls = useRef(new Map<string, HTMLDivElement>());
  const [selected, setSelected] = useState<{ game: CalendarGame; teamId: string } | null>(null);
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
  const groups = DIVISION_ORDER.map(division => ({ label: DIVISION_LABELS[division], teams: data.teams.filter(t => t.division === division).sort((a, b) => (a.divisionRank ?? Infinity) - (b.divisionRank ?? Infinity)) })).filter(g => g.teams.length);
  const ungrouped = data.teams.filter(t => !t.division);
  if (ungrouped.length) groups.push({ label: 'チーム', teams: ungrouped });
  const events = supplement?.events ?? [];
  return <section className="annual-schedule">
    <h2>{season}シーズン 年間スケジュール</h2>
    <div className="annual-toolbar">
      <button type="button" onClick={() => jump(today)} disabled={!dates.includes(today)}>今日</button>
      {months.map(m => <button type="button" key={m} onClick={() => jump(dates.find(d => d.startsWith(m))!)}>{Number(m.slice(5))}月</button>)}
    </div>
    <p className="annual-legend"><span className="annual-home">H ホーム</span><span className="annual-away">A アウェー</span><span>N 中立会場</span><span>○ 勝ち　● 負け</span><span>マスを選ぶと試合の詳細を表示</span></p>
    {external.error && <p role="alert">大会日程を取得できませんでした。リーグ戦のみ表示しています。</p>}
    {!external.loading && !external.error && !supplement && <p>このシーズンの天皇杯・EASL・オールスターの日程は未収録です。</p>}
    {groups.map(group => <section className="annual-division-section" key={group.label}>
    <h3>{group.label}</h3>
    <div className="annual-scroll" ref={node => { if (node) scrolls.current.set(group.label, node); else scrolls.current.delete(group.label); }} tabIndex={0} role="region" aria-label={`${group.label}の年間スケジュール。左右にスクロールできます`}>
      <table className="annual-grid">
        <caption className="annual-sr-only">{season}シーズン。日付別・チーム別の対戦相手と勝敗。日付は日本時間。</caption>
        <colgroup><col className="annual-team-col" />{STANDING_LABELS.map(label => <col key={label} className="annual-stat-col" />)}{dates.map(d => <col key={d} className="annual-day-col" />)}</colgroup>
        <thead>
          <tr><th className="annual-corner" scope="col" colSpan={7}>レギュラーシーズン{data.asOf ? `・${data.asOf}時点` : ""}</th>{months.map(m => <th key={m} scope="colgroup" colSpan={dates.filter(d => d.startsWith(m)).length}>{m.replace('-', '年')}月</th>)}</tr>
          <tr><th className="annual-corner" scope="col">チーム</th>{STANDING_LABELS.map((label, i) => <th key={label} scope="col" className="annual-stat" style={statStyle(i)} title={statDescription(label === "残" ? "残り試合数" : label, "team")}>{label}</th>)}{dates.map(d => { const dow = new Date(`${d}T00:00:00Z`).getUTCDay(); return <th scope="col" data-date={d} key={d} className={`${d === today ? 'annual-today' : ''} ${dow === 0 || dow === 6 ? 'annual-weekend' : ''}`}><span>{Number(d.slice(8))}</span><small>{'日月火水木金土'[dow]}</small></th>; })}</tr>
        </thead>
        <tbody>
          {events.map(e => <tr key={e.id} className="annual-event"><th scope="row" colSpan={7}>{e.competition === 'cup' ? '天皇杯' : 'オールスター'}</th>{dates.map(date => {
            const active = date >= e.start && date <= e.end;
            return <td key={date} className={`${date === today ? 'annual-today' : ''} ${active ? 'annual-event-span' : ''}`}>
              {active && date === dates.find(d => d >= e.start && d <= e.end) && <a style={{ width: `${dates.filter(d => d >= e.start && d <= e.end).length * 42 - 1}px` }} href={e.source} target="_blank" rel="noreferrer" title={`${e.label} ${e.start}〜${e.end} ${e.note ?? ''}`}>{e.label}</a>}
            </td>;
          })}</tr>)}
          {group.teams.map((team, teamIndex) => <tr key={team.teamId} className={teamIndex === group.teams.length - 1 ? "annual-last-team" : undefined}>
              <th scope="row"><span className="annual-rank">{team.divisionRank ?? "−"}</span><TeamLogo teamId={team.teamId} size={34} /><ResponsiveTeamName teamId={team.teamId} name={team.teamName} always /></th>
              {(() => {
                const t = team.standing;
                const gb = t?.division ? t.divisionGamesBehind : t?.gamesBehind;
                const values = [t ? t.wins + t.losses : 0, t?.wins ?? 0, t?.losses ?? 0,
                  t && t.wins + t.losses > 0 ? formatWinPct(t.winPct) : '−', team.remaining,
                  gb === undefined || gb === 0 ? '−' : formatDecimal(gb)];
                return values.map((value, i) => <td key={i} className="annual-stat" style={statStyle(i)}>{value}</td>);
              })()}
              {dates.map(date => <td key={date} className={date === today ? 'annual-today' : undefined}>{(index.get(`${team.teamId}:${date}`) ?? []).map(g => {
                const home = g.home.id === team.teamId;
                const opp = home ? g.away : g.home;
                const side = g.neutral ? 'N' : home ? 'H' : 'A';
                const result = calendarResult(g, home);
                const label = `${date} ${COMPETITIONS[g.competition]} ${team.teamName} 対 ${opp.name} ${side} ${result} ${g.tipoff ?? ''}`;
                return <button type="button" key={`${g.competition}:${g.id}`} className={`annual-game ${g.neutral ? 'annual-neutral' : home ? 'annual-home' : 'annual-away'} ${g.status === 'cancelled' ? 'annual-cancelled' : ''}`} onClick={() => setSelected({ game: g, teamId: team.teamId })} title={label} aria-label={label}>
                  <small>{g.competition === 'league' ? side : `${g.competition === 'cup' ? '天皇杯' : 'EASL'} ${side}`}</small>
                  {opp.id ? <TeamLogo teamId={opp.id} size={30} /> : <span className="annual-opponent">{opp.shortName ?? opp.name}</span>}
                  <span>{result || '·'}</span>
                </button>;
              })}</td>)}
            </tr>)}
        </tbody>
      </table>
    </div>
    </section>)}
    <p className="annual-note">試合数・勝・負・勝率・残・GBはレギュラーシーズンの成績です。GBは地区首位との差、残は残り試合数です。</p>
    <p className="annual-note">{dates[0]}〜{dates[dates.length - 1]}・日本時間。リーグ戦はポストシーズンを含みます。空欄は収録した日程に試合がない日です。大会期間の帯は各チームの出場を示すものではありません。</p>
    {supplement?.finalsSource && <p className="annual-note">終端はFINALSの最終戦予定日です。<a href={supplement.finalsSource} target="_blank" rel="noreferrer">公式日程</a></p>}
    {supplement?.notes.map(n => <p className="annual-note" key={n}>{n}</p>)}
    {supplement?.easlUpdatedAt && <p className="annual-note">EASLの日程・結果の更新：{supplement.easlUpdatedAt.slice(0, 10)}　<a href="https://www.easl.basketball/schedule-results" target="_blank" rel="noreferrer">公式日程</a></p>}
    {selected && <GameDialog game={selected.game} teamId={selected.teamId} close={() => setSelected(null)} />}
  </section>;
}

function GameDialog({ game: g, teamId, close }: { game: CalendarGame; teamId: string; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  const result = calendarResult(g, g.home.id === teamId);
  return <dialog ref={ref} className="annual-dialog" onClose={close} aria-labelledby="annual-game-title">
    <h3 id="annual-game-title">{COMPETITIONS[g.competition]} · {g.date} {g.tipoff}</h3>
    <p><ResponsiveTeamName teamId={g.home.id ?? ''} name={g.home.name} /> vs <ResponsiveTeamName teamId={g.away.id ?? ''} name={g.away.name} /></p>
    <p>{g.status === 'final' || g.status === 'live' ? `${g.homeScore ?? '-'} − ${g.awayScore ?? '-'}` : g.status === 'cancelled' ? '中止' : '開催予定'} {result}</p>
    <p>{g.venue ?? '会場未定'}{g.neutral ? '（中立会場）' : ''}</p>
    {g.note && <p>{g.note}</p>}
    {g.gameLink && <p><SeasonLink to={g.gameLink}>試合詳細へ</SeasonLink></p>}
    {g.source && <p><a href={g.source} target="_blank" rel="noreferrer">公式情報へ</a></p>}
    <form method="dialog"><button type="submit">閉じる</button></form>
  </dialog>;
}
