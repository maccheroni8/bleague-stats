// 図解「地区間の対戦数」の判定を確かめる。全シーズン・両リーグで、日程（試合の記録＋予定・中止・結果だけ）から数え直した値と一致すること、
// 2026-27（B.PREMIER）の「他地区と1試合だけ」の26組が調査メモの一覧と一致すること、ふつうの対戦数の決め方・H/A・中止の数え方を見る。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildDivisionMatchups, type TeamDeviation, matchupOutcome, matchupStatus, mostCommonCount, pairKey } from '../src/lib/divisionMatchups.ts';
import { teamShortName } from '../shared/teamNames.ts';
import type { Division, GameSummary, TeamSummary } from '../shared/types.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';

const rd = <T>(f: string): T => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
// 調査メモ 2章の一覧（試合ID, 日付, ホーム, アウェー）。2026-27 B.PREMIER で他地区と1試合だけの組み合わせ
const EXPECTED: [string, string, string, string][] = [
  ['506433','2026-10-07','富山','京都'],['506461','2026-10-12','大阪','A東京'],['506462','2026-10-12','佐賀','群馬'],
  ['506498','2026-10-23','大阪','東京SR'],['506502','2026-10-24','宇都宮','信州'],['506507','2026-10-24','広島','北海道'],
  ['506553','2026-11-07','横浜BC','神戸'],['506578','2026-11-12','琉球','東京SR'],['506594','2026-11-15','島根','宇都宮'],
  ['506621','2026-12-05','神戸','A千葉'],['506627','2026-12-06','長崎','北海道'],['506660','2026-12-16','千葉J','名古屋D'],
  ['506663','2026-12-16','三遠','秋田'],['506757','2027-01-22','群馬','広島'],['506777','2027-01-25','滋賀','富山'],
  ['506779','2027-01-26','三河','茨城'],['506881','2027-02-15','A東京','信州'],['506882','2027-02-15','川崎','京都'],
  ['506883','2027-02-15','横浜BC','長崎'],['506964','2027-03-17','仙台','滋賀'],['507011','2027-03-31','名古屋D','A千葉'],
  ['507027','2027-04-03','千葉J','三河'],['507041','2027-04-06','三遠','川崎'],['507091','2027-04-20','茨城','佐賀'],
  ['507096','2027-04-20','島根','秋田'],['507158','2027-05-02','琉球','仙台'],
];

const ORDER: Record<'premier' | 'one', Division[]> = { premier: ['east', 'central', 'west'], one: ['north', 'east', 'central', 'west', 'south'] };
const history = rd<Record<string, Record<string, Record<string, Division>>>>('data/division-history.json.gz');
let checked = 0;
const report: string[] = [];
for (const season of fs.readdirSync('data').filter(s => /^20\d\d-\d\d$/.test(s)).sort()) for (const league of ['premier', 'one'] as const) {
  const dir = league === 'one' ? `data/${season}/one` : `data/${season}`;
  if (!fs.existsSync(`${dir}/games-summary.json.gz`) || !fs.existsSync(`${dir}/teams.json.gz`)) continue;
  const divisions = history[league]?.[season];
  if (!divisions) continue;
  const summaries = rd<GameSummary[]>(`${dir}/games-summary.json.gz`);
  const schedule = fs.existsSync(`${dir}/schedule.json.gz`) ? rd<ScheduleFileExtended>(`${dir}/schedule.json.gz`) : null;
  const teams = rd<TeamSummary[]>(`${dir}/teams.json.gz`).map(t => ({ teamId: t.teamId, teamName: t.teamName }));
  const r = buildDivisionMatchups({ season, summaries, schedule, teams, divisions, divisionOrder: ORDER[league], today: '2026-11-06' });
  // 日程から数え直す（試合ID＝scheduleKey ごとに1試合。予定・中止は名前からクラブを特定）
  const idByName = new Map(teams.map(t => [t.teamName, t.teamId]));
  for (const g of summaries) { idByName.set(g.homeTeamName, g.homeTeamId); idByName.set(g.awayTeamName, g.awayTeamId); }
  const rawGames = new Map<string, [string | undefined, string | undefined]>();
  for (const g of schedule?.upcomingGames ?? []) rawGames.set(g.scheduleKey, [idByName.get(g.homeTeamName), idByName.get(g.awayTeamName)]);
  for (const g of schedule?.cancelledGames ?? []) rawGames.set(g.scheduleKey, [idByName.get(g.homeTeamName), idByName.get(g.awayTeamName)]);
  for (const g of schedule?.resultOnlyGames ?? []) rawGames.set(g.scheduleKey, [g.homeTeamId, g.awayTeamId]);
  for (const g of summaries) if (g.gameType === 'regular') rawGames.set(g.scheduleKey, [g.homeTeamId, g.awayTeamId]);
  for (const g of summaries) if (g.gameType !== 'regular') rawGames.delete(g.scheduleKey);
  const counts = new Map<string, number>();
  for (const [h, a] of rawGames.values()) { if (h && a && divisions[h] && divisions[a]) counts.set(pairKey(h, a), (counts.get(pairKey(h, a)) ?? 0) + 1); }
  if (r.kind === 'unsupported') { assert.equal([...counts].filter(([k]) => { const [a, b] = k.split('|'); return divisions[a!] !== divisions[b!]; }).length, 0, `${season} ${league}: 他地区の対戦があるのに対象外`); continue; }
  const expectedRows = new Map<string, Map<number, number>>();
  const cross: number[] = [];
  for (const [k, n] of counts) {
    const [a, b] = k.split('|') as [string, string];
    const [da, db] = [divisions[a]!, divisions[b]!];
    const key = da === db ? `same:${da}` : `cross:${[da, db].sort((x, y) => ORDER[league].indexOf(x) - ORDER[league].indexOf(y)).join('-')}`;
    const m = expectedRows.get(key) ?? new Map<number, number>();
    m.set(n, (m.get(n) ?? 0) + 1); expectedRows.set(key, m);
    if (da !== db) cross.push(n);
  }
  assert.equal(r.pairs.size, counts.size, `${season} ${league}: 組み合わせの数`);
  for (const [k, n] of counts) assert.equal(r.pairs.get(k)?.count, n, `${season} ${league}: ${k} の対戦数`);
  for (const row of r.rows) {
    const key = row.kind === 'same' ? `same:${row.divisions[0]}` : `cross:${row.divisions.join('-')}`;
    const e = expectedRows.get(key) ?? new Map<number, number>();
    assert.deepEqual(row.counts.map(c => [c.count, c.pairs]), [...e].sort((x, y) => x[0] - y[0]), `${season} ${league}: ${key} の対戦数ごとの組数`);
    report.push(`${season} ${league} ${key} ${row.counts.map(c => `${c.count}試合${c.pairs}組`).join(' ')}`);
  }
  assert.equal(r.rows.length, expectedRows.size, `${season} ${league}: 行の数`);
  // ふつう＝いちばん多い（同数は小さいほう）
  const tally = new Map<number, number>(); for (const n of cross) tally.set(n, (tally.get(n) ?? 0) + 1);
  const top = Math.max(...tally.values());
  assert.equal(r.normal, Math.min(...[...tally].filter(([, c]) => c === top).map(([n]) => n)), `${season} ${league}: ふつうの対戦数`);
  // チーム別＝ふつうと違う他地区の相手だけ。両クラブに同じ組が出る
  let deviating = 0;
  for (const [k, n] of counts) { const [a, b] = k.split('|') as [string, string]; if (divisions[a] !== divisions[b] && n !== r.normal) deviating++; }
  const listed = [...r.byTeam.values()].reduce((s, l) => s + l.length, 0);
  assert.equal(listed, deviating * 2, `${season} ${league}: チーム別の相手の数`);
  for (const [id, list] of r.byTeam) for (const d of list) {
    assert.notEqual(d.count, r.normal); assert.notEqual(divisions[id], divisions[d.opponentId]);
    assert.equal(d.games.length, d.count, `${season} ${league}: ${id}-${d.opponentId} の試合数`);
    assert.equal(d.direction, d.count < r.normal ? 'fewer' : 'more');
  }
  assert.equal(r.totalGames, rawGames.size - [...rawGames.values()].filter(([h, a]) => !h || !a || !divisions[h] || !divisions[a]).length, `${season} ${league}: 全試合数`);
  checked++;
}
assert(checked >= 12, `全シーズン・両リーグの確認が少なすぎる: ${checked}`);
fs.mkdirSync('node_modules/.cache', { recursive: true });
fs.writeFileSync('node_modules/.cache/division-matchups-report.txt', report.join('\n'));

// 2026-27 B.PREMIER: 他地区と1試合だけの26組が調査メモの一覧と一致。ふつうは2試合
const season = '2026-27';
const summaries = rd<GameSummary[]>(`data/${season}/games-summary.json.gz`);
const schedule = rd<ScheduleFileExtended>(`data/${season}/schedule.json.gz`);
const teams = rd<TeamSummary[]>(`data/${season}/teams.json.gz`).map(t => ({ teamId: t.teamId, teamName: t.teamName }));
const divisions = history.premier![season]!;
const input = { season, summaries, schedule, teams, divisions, divisionOrder: ORDER.premier, today: '2026-10-30' };
const r = buildDivisionMatchups(input);
assert.equal(r.kind, 'ready');
if (r.kind !== 'ready') throw new Error();
assert.equal(r.totalGames, 780);
assert.equal(r.teams.length, 26);
assert.equal(r.normal, 2);
assert.deepEqual(r.divisions, ['east', 'west']);
const ones = [...r.pairs.values()].filter(p => !p.sameDivision && p.count === 1).map(p => p.games[0]!).sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
const short = (id: string) => teamShortName(id, r.teams.find(t => t.teamId === id)!.teamName);
assert.deepEqual(ones.map(m => [m.id, m.date, short(m.homeId), short(m.awayId)]), EXPECTED);
for (const t of r.teams) { const list: TeamDeviation[] = r.byTeam.get(t.teamId)!; assert.equal(list.length, 2, `${t.teamName}の相手は2クラブ`); for (const d of list) assert.equal(d.direction, 'fewer'); }
// 状態: 日付が過ぎて結果が無い試合は「結果未収録」。結果を外して確かめる
const played = summaries.find(g => g.scheduleKey === '506498');
const asUpcoming = played ? [{ scheduleKey: '506498', date: played.date, homeTeamName: played.homeTeamName, awayTeamName: played.awayTeamName }] : [];
const without = buildDivisionMatchups({ ...input, summaries: summaries.filter(g => g.scheduleKey !== '506498'),
  schedule: { ...schedule, upcomingGames: [...schedule.upcomingGames.filter(g => g.scheduleKey !== '506498'), ...asUpcoming] } });
assert.equal(without.kind, 'ready');
if (without.kind === 'ready') {
  assert.equal(without.pairs.size, r.pairs.size, '結果が無くても組み合わせは数える');
  const g = [...without.pairs.values()].flatMap(p => p.games).find(x => x.id === '506498')!;
  assert.equal(g.status, 'unrecorded'); assert.equal(matchupOutcome(g, true), null);
}
// 中止の試合も当初の日程どおり1試合として数える（結果を外して中止に移しても対戦数は変わらない）
if (played) {
  const cancelled = buildDivisionMatchups({ ...input, summaries: summaries.filter(g => g.scheduleKey !== '506498'),
    schedule: { ...schedule, upcomingGames: schedule.upcomingGames.filter(g => g.scheduleKey !== '506498'), cancelledGames: [...(schedule.cancelledGames ?? []), ...asUpcoming] } as ScheduleFileExtended });
  assert.equal(cancelled.kind, 'ready');
  if (cancelled.kind === 'ready') {
    assert.equal(cancelled.pairs.size, r.pairs.size);
    assert.equal([...cancelled.pairs.values()].flatMap(p => p.games).find(x => x.id === '506498')!.status, 'cancelled');
    assert.deepEqual(cancelled.rows, r.rows);
  }
}
// 勝敗は「そのチームから見て」。506461 は大阪（ホーム）78-103 A東京
const byId = new Map([...r.pairs.values()].flatMap(p => p.games).map(g => [g.id, g]));
const g506461 = byId.get('506461')!;
assert.equal(g506461.homeScore, 78); assert.equal(g506461.awayScore, 103);
assert.equal(matchupOutcome(g506461, true), 'loss'); assert.equal(matchupOutcome(g506461, false), 'win');
assert.equal(matchupOutcome(byId.get('507158')!, true), null);
assert.equal(matchupOutcome({ ...g506461, status: 'live' }, true), null);
assert.equal(matchupOutcome({ ...g506461, status: 'cancelled' }, true), null);
assert.equal(matchupStatus({ id: 'x', date: '2026-10-23', competition: 'league', home: { name: 'a' }, away: { name: 'b' }, status: 'upcoming' }, '2026-10-23'), 'upcoming');
// ふつうの対戦数: いちばん多い。同数のときは小さいほう
assert.equal(mostCommonCount([2, 2, 1, 1]), 1);
assert.equal(mostCommonCount([2, 2, 2, 1, 4]), 2);
assert.equal(mostCommonCount([4, 4, 2, 2, 1]), 2);
assert.equal(mostCommonCount([]), null);
// 地区が分からない・他地区の対戦が無いときは対象外
assert.equal(buildDivisionMatchups({ ...input, divisions: undefined }).kind, 'unsupported');
const onlyEast = Object.fromEntries(Object.entries(divisions).map(([k]) => [k, 'east' as Division]));
assert.equal(buildDivisionMatchups({ ...input, divisions: onlyEast }).kind, 'unsupported');
console.log(`地区間の対戦数: ${checked}（シーズン×リーグ）で日程から数え直した組数・ふつうの対戦数・チーム別と一致、2026-27の1試合の26組が調査メモと一致、中止・ふつうの決め方を確認`);
