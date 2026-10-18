import type { GameSummary } from '../../shared/types.ts';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames.ts';
import type { CalendarGame } from '../../shared/annualSchedule.ts';

/** 記録 > 結果のみ > 中止 > 開催予定。同一試合は必ず1件にする。 */
export function annualLeagueGames(summaries: GameSummary[], schedule: ScheduleFileExtended | null,
  teams: { teamId: string; teamName: string }[]): CalendarGame[] {
  const ids = new Map(teams.map(t => [t.teamName, t.teamId]));
  for (const g of summaries) { ids.set(g.homeTeamName, g.homeTeamId); ids.set(g.awayTeamName, g.awayTeamId); }
  const rows = new Map<string, CalendarGame>();
  for (const g of schedule?.upcomingGames ?? []) rows.set(g.scheduleKey, {
    id: g.scheduleKey, date: g.date, competition: 'league',
    home: { id: ids.get(g.homeTeamName), name: g.homeTeamName },
    away: { id: ids.get(g.awayTeamName), name: g.awayTeamName },
    status: 'upcoming', tipoff: g.tipoffTime, venue: g.venue,
  });
  for (const g of schedule?.cancelledGames ?? []) rows.set(g.scheduleKey, {
    id: g.scheduleKey, date: g.date, competition: 'league',
    home: { id: ids.get(g.homeTeamName), name: g.homeTeamName },
    away: { id: ids.get(g.awayTeamName), name: g.awayTeamName },
    status: 'cancelled', tipoff: g.tipoffTime, venue: g.venue,
  });
  for (const g of schedule?.resultOnlyGames ?? []) rows.set(g.scheduleKey, {
    id: g.scheduleKey, date: g.date, competition: 'league',
    home: { id: g.homeTeamId, name: g.homeTeamName }, away: { id: g.awayTeamId, name: g.awayTeamName },
    status: 'final', homeScore: g.homeScore, awayScore: g.awayScore, tipoff: g.tipoffTime, venue: g.venue,
    note: g.reason === 'forfeit' ? '不戦勝／不戦敗' : 'ボックススコアなし',
  });
  for (const g of summaries) rows.set(g.scheduleKey, {
    id: g.scheduleKey, date: g.date, competition: 'league',
    home: { id: g.homeTeamId, name: g.homeTeamName }, away: { id: g.awayTeamId, name: g.awayTeamName },
    status: g.gameEndedFlg ? 'final' : 'live', homeScore: g.homeScore, awayScore: g.awayScore,
    tipoff: g.tipoffTime, venue: g.venue, gameLink: `/games/${g.scheduleKey}`,
  });
  return [...rows.values()].sort((a,b) => a.date.localeCompare(b.date) || (a.tipoff ?? '99:99').localeCompare(b.tipoff ?? '99:99') || a.id.localeCompare(b.id));
}

export function calendarDates(season: string, start?: string, end?: string): string[] {
  const year = Number(season.slice(0, 4));
  const dates: string[] = [];
  const from = start ? Date.parse(`${start}T00:00:00Z`) : Date.UTC(year, 6, 1);
  const through = end ? Date.parse(`${end}T00:00:00Z`) : Date.UTC(year + 1, 5, 30);
  for (let ms = from; ms <= through; ms += 86400000) dates.push(new Date(ms).toISOString().slice(0, 10));
  return dates;
}
export function calendarResult(game: CalendarGame, isHome: boolean): string {
  if (game.status === 'cancelled') return '中止';
  if (game.status === 'live') return '試合中';
  if (game.status !== 'final' || game.homeScore === undefined || game.awayScore === undefined) return '';
  if (game.homeScore === game.awayScore) return '引分';
  return (game.homeScore > game.awayScore) === isHome ? '○' : '●';
}
