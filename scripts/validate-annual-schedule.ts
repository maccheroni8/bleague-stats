import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEaslMatches } from './lib/easlSchedule.ts';
import { annualLeagueGames, calendarDates, calendarResult } from '../src/lib/annualSchedule.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';
import type { GameSummary } from '../shared/types.ts';
import type { AnnualCalendarFile } from '../shared/annualSchedule.ts';

const teams = [{ teamId: '706', teamName: 'アルバルク東京' }, { teamId: '701', teamName: '琉球ゴールデンキングス' }];
const upcoming = { scheduleKey: '1', date: '2026-10-01', homeTeamName: teams[0]!.teamName, awayTeamName: teams[1]!.teamName };
const result = { ...upcoming, homeTeamId: '706', awayTeamId: '701', homeScore: 20, awayScore: 0, gameType: 'regular' as const, reason: 'forfeit' as const };
const schedule: ScheduleFileExtended = { season: '2026-27', generatedAt: '', scheduleKeys: ['1'], upcomingGames: [upcoming], cancelledGames: [upcoming], resultOnlyGames: [result] };
const rows = annualLeagueGames([], schedule, teams);
assert.equal(rows.length, 1);
assert.equal(rows[0]!.note, '不戦勝／不戦敗');
assert.equal(rows[0]!.gameLink, undefined);
assert.equal(calendarResult(rows[0]!, true), '○');
assert.equal(calendarResult(rows[0]!, false), '●');
const summary = { ...result, gameEndedFlg: false } as unknown as GameSummary;
const live = annualLeagueGames([summary], schedule, teams);
assert.equal(live.length, 1);
assert.equal(live[0]!.status, 'live');
assert.equal(calendarResult(live[0]!, true), '試合中');
assert.equal(annualLeagueGames([], null, teams).length, 0);
assert.equal(calendarDates('2023-24').length, 366);
assert(calendarDates('2023-24').includes('2024-02-29'));
assert.equal(calendarDates('2026-27').length, 365);
const bounded = calendarDates('2026-27', '2026-09-22', '2027-06-01');
assert.equal(bounded[0], '2026-09-22');
assert.equal(bounded.at(-1), '2027-06-01');
assert(!bounded.includes('2026-09-21'));
assert(!bounded.includes('2027-06-02'));
const fixture = { fixtureId: 'example', startTimeUTC: '2026-10-14T23:10:00', status: 'CONFIRMED', stage: { nameLocal: 'Group Stage' }, competitors: [
  { isHome: true, nameFullLocal: '琉球ゴールデンキングス', score: '91' },
  { isHome: false, nameFullLatin: 'Opponent', codeLatin: 'OPP', score: '80' },
] };
const parsed = parseEaslMatches([fixture], '2026-27')[0]!;
assert.equal(parsed.date, '2026-10-15');
assert.equal(parsed.tipoff, '08:10');
assert.equal(parsed.home.id, '701');
assert.equal(parsed.status, 'final');
assert.equal(parsed.neutral, false);
const pending = parseEaslMatches([{ ...fixture, status: 'SCHEDULED' }], '2026-27')[0]!;
assert.equal(pending.homeScore, undefined);
assert.equal(calendarResult(pending, true), '');
assert.throws(() => parseEaslMatches({}, '2026-27'));
assert.throws(() => parseEaslMatches([{ ...fixture, startTimeUTC: 'invalid' }], '2026-27'));
const data: AnnualCalendarFile = JSON.parse(fs.readFileSync('data/annual-calendar.json','utf8'));
const current = data.seasons['2026-27']!;
assert.equal(new Set(current.games.map(g => g.id)).size, current.games.length);
assert(current.games.length >= 18);
for (const id of ['706','701','2488']) assert(current.games.filter(g => g.home.id === id || g.away.id === id).length >= 6);
for (const e of current.events) { assert(e.start <= e.end); assert(e.source.startsWith('https://')); }
console.log('年間スケジュール: 重複・結果のみ・試合中・閏日・UTC→JST・日英チーム名・EASL18試合の整合を確認');
