import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseEaslMatches, easlLinkSlugs, easlLogoSources } from './lib/easlSchedule.ts';
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

// --- EASL の試合ページのリンク（日時＋日本のクラブ名で選ぶ。時の0埋めがあるものとないものがある） ---
const linkHtml = '<a href="/schedules/alvarktokyovsbroncos-oct142026071000pm"></a><a href="/ja/schedules/macauhouchonvsnagasakivelca-oct32026040000pm"></a><a href="/schedules/alvarktokyovsbroncos-oct142026071000pm-cc9ec248-b040-11f1-84eb-7df2cf21e877"></a>';
assert.deepEqual(easlLinkSlugs(linkHtml).length, 3);
const linkFixture = { fixtureId: 'l1', startTimeUTC: '2026-10-14T10:10:00', startTimeLocal: '2026-10-14T19:10:00', status: 'SCHEDULED', stage: { nameLocal: 'Group Stage' }, competitors: [
  { isHome: true, nameFullLatin: 'Alvark Tokyo', teamId: 't1' }, { isHome: false, nameFullLatin: 'South Gobi Broncos', teamId: 't2', primaryColor: '00AAFF', logo: 'https://example.com/b.png' }] };
assert.equal(parseEaslMatches([linkFixture], '2026-27', easlLinkSlugs(linkHtml))[0]!.link, 'https://www.easl.basketball/schedules/alvarktokyovsbroncos-oct142026071000pm');
const unpadded = { ...linkFixture, fixtureId: 'l2', startTimeUTC: '2026-10-03T08:00:00', startTimeLocal: '2026-10-03T16:00:00', competitors: [{ isHome: true, nameFullLatin: 'Macau Hou Chon' }, { isHome: false, nameFullLocal: '長崎ヴェルカ' }] };
assert.equal(parseEaslMatches([unpadded], '2026-27', easlLinkSlugs(linkHtml))[0]!.link, 'https://www.easl.basketball/schedules/macauhouchonvsnagasakivelca-oct32026040000pm');
assert.equal(parseEaslMatches([linkFixture], '2026-27', [])[0]!.link, 'https://www.easl.basketball/schedule-results');
const foreign = parseEaslMatches([linkFixture], '2026-27')[0]!.away;
assert.equal(foreign.easlTeamId, 't2');
assert.equal(foreign.color, '00aaff');
assert.equal(easlLogoSources([linkFixture]).get('t2')?.url, 'https://example.com/b.png');
assert(!easlLogoSources([linkFixture]).has('t1'));

// --- 保存した大会日程: リンク・海外クラブのロゴ ---
const ledger: Record<string, { name: string; source: string }> = JSON.parse(fs.readFileSync('data/logos/easl/sources.json', 'utf8'));
const easlGames = current.games.filter(g => g.competition === 'easl');
for (const g of easlGames) {
  assert(g.id.startsWith('easl:'), 'EASLの試合IDは easl: で始める');
  assert(g.link?.startsWith('https://www.easl.basketball/'), `EASLの試合ページのリンクが無い: ${g.id}`);
  for (const club of [g.home, g.away]) {
    if (club.id) continue;
    assert(club.easlTeamId, `海外クラブにEASLのチームIDが無い: ${club.name}`);
    const file = path.join('data/logos/easl', `${club.easlTeamId}.png`);
    assert(fs.existsSync(file), `海外クラブのロゴが無い: ${club.name}`);
    const png = fs.readFileSync(file);
    assert.equal(png.readUInt32BE(16), 400); assert.equal(png.readUInt32BE(20), 400);
    assert(ledger[club.easlTeamId!]?.source.startsWith('https://'), `ロゴの取り先が台帳に無い: ${club.name}`);
  }
}

// --- EASL の試合は B.LEAGUE の成績・順位・ランキング・図解・スタッツに入れない ---
// ①読む場所を限る（画面は日程タブと年間スケジュールだけ。集計・共有のコードは大会日程を読まない）
function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const readers = new Set(['src/components/AnnualSchedule.tsx', 'src/components/EaslLogo.tsx', 'src/pages/SchedulePage.tsx', 'src/lib/easlCalendar.ts', 'src/lib/annualSchedule.ts', 'scripts/lib/dataLayout.ts']); // dataLayout は元データの一覧にファイル名を書くだけ
for (const f of [...listFiles('src'), ...listFiles('shared'), ...listFiles('scripts').filter(x => !x.includes('annual-schedule') && !x.includes('easl'))]) {
  if (!/\.(ts|tsx)$/.test(f) || readers.has(f.replaceAll(path.sep, '/'))) continue;
  const text = fs.readFileSync(f, 'utf8');
  assert(!/annual-calendar|easlCalendar|easlSchedule|competition:\s*'easl'/.test(text), `EASLの大会日程をB.LEAGUEの集計・画面で読んでいる: ${f}`);
}
// ②作った集計・日程にEASLの試合が混ざっていない
for (const file of ['data/2026-27/schedule.json', 'data/2026-27/one/schedule.json']) {
  if (fs.existsSync(file)) assert(!fs.readFileSync(file, 'utf8').includes('easl:'), `${file} にEASLの試合が入っている`);
}
for (const file of ['games-summary.json.gz', 'teams.json.gz', 'players.json.gz', 'standings-history.json.gz', 'playoff-race.json.gz']) {
  const full = path.join('data/2026-27', file);
  if (!fs.existsSync(full)) continue; // 導出データは build:data のあとだけある
  const text = zlib.gunzipSync(fs.readFileSync(full)).toString('utf8');
  assert(!/easl/i.test(text), `${full} にEASLの試合が入っている`);
}
console.log('年間スケジュール: 重複・結果のみ・試合中・閏日・UTC→JST・日英チーム名・EASL18試合の整合を確認');
