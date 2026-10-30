// 図解「年間1試合の対戦」の判定を確かめる。調査メモ（調査依頼D）の26組と一致すること、
// 条件を満たさないときは断定しない（日程を確認中）こと、対象外の理由が出ることを見る。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { buildOneGameMatchups, matchupStatus, oneGameUnsupportedReason } from '../src/lib/oneGameMatchups.ts';
import { teamShortName } from '../shared/teamNames.ts';
import type { Division, GameSummary, TeamSummary } from '../shared/types.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';

const rd = <T>(f: string): T => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'));
// 調査メモ 2章の一覧（試合ID, 日付, ホーム, アウェー）
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

const season = '2026-27';
const summaries = rd<GameSummary[]>(`data/${season}/games-summary.json.gz`);
const schedule = rd<ScheduleFileExtended>(`data/${season}/schedule.json.gz`);
const teams = rd<TeamSummary[]>(`data/${season}/teams.json.gz`).map(t => ({ teamId: t.teamId, teamName: t.teamName }));
const divisions = rd<Record<string, Record<string, Record<string, Division>>>>('data/division-history.json.gz').premier?.[season];
const input = { season, league: 'premier' as const, summaries, schedule, teams, divisions, today: '2026-10-30' };

const r = buildOneGameMatchups(input);
assert.equal(r.kind, 'ready', r.kind === 'checking' ? r.problems.join(' / ') : r.kind);
if (r.kind !== 'ready') throw new Error();
assert.equal(r.matchups.length, 26);
assert.equal(r.teams.length, 26);
const short = (id: string) => teamShortName(id, r.teams.find(t => t.teamId === id)!.teamName);
const actual = r.matchups.map(m => [m.id, m.date, short(m.homeId), short(m.awayId)]);
assert.deepEqual(actual, EXPECTED);
for (const t of r.teams) assert.equal(r.byTeam.get(t.teamId)!.length, 2, `${t.teamName}の相手は2クラブ`);
// 各組は必ず東×西
for (const m of r.matchups) assert.notEqual(r.teams.find(t => t.teamId === m.homeId)!.division, r.teams.find(t => t.teamId === m.awayId)!.division);
// 状態: 506498 は日付が過ぎて結果が無いので「結果未収録」
const byId = new Map(r.matchups.map(m => [m.id, m]));
// 506498 は調査時点で結果が無かった。今のデータで結果があるかは問わず、結果を外した状態で「結果未収録」になることを見る
const played = summaries.find(g => g.scheduleKey === '506498');
const asUpcoming = played ? [{ scheduleKey: '506498', date: played.date, homeTeamName: played.homeTeamName, awayTeamName: played.awayTeamName }] : [];
const without = buildOneGameMatchups({ ...input, summaries: summaries.filter(g => g.scheduleKey !== '506498'),
  schedule: { ...schedule, upcomingGames: [...schedule.upcomingGames.filter(g => g.scheduleKey !== '506498'), ...asUpcoming] } });
assert.equal(without.kind, 'ready');
if (without.kind === 'ready') assert.equal(without.matchups.find(m => m.id === '506498')!.status, 'unrecorded');
assert.equal(byId.get('506433')!.status, 'final');
assert.equal(byId.get('507158')!.status, 'upcoming');
// 今日が前なら予定のまま（日付を過ぎたものだけ未収録）
assert.equal(matchupStatus({ id: 'x', date: '2026-10-23', competition: 'league', home: { name: 'a' }, away: { name: 'b' }, status: 'upcoming' }, '2026-10-23'), 'upcoming');

// 条件を満たさないとき: 試合が欠ける・地区が分からない・名前が解決できない → 日程を確認中
const missing = buildOneGameMatchups({ ...input, schedule: { ...schedule, upcomingGames: schedule.upcomingGames.slice(1) } });
assert.equal(missing.kind, 'checking');
const noDiv = buildOneGameMatchups({ ...input, divisions: undefined });
assert.equal(noDiv.kind, 'checking');
const dup = buildOneGameMatchups({ ...input, schedule: { ...schedule, upcomingGames: [...schedule.upcomingGames, { ...schedule.upcomingGames[0]!, scheduleKey: 'dup-1' }] } });
assert.equal(dup.kind, 'checking', '別IDの重複は断定しない');
// 同じ試合IDの再掲載は1件にまとまる（判定は変わらない）
const again = buildOneGameMatchups({ ...input, schedule: { ...schedule, upcomingGames: [...schedule.upcomingGames, schedule.upcomingGames[0]!] } });
assert.equal(again.kind, 'ready');
// 対象外
assert.equal(buildOneGameMatchups({ ...input, league: 'one' }).kind, 'unsupported');
assert.equal(buildOneGameMatchups({ ...input, season: '2025-26' }).kind, 'unsupported');
assert(oneGameUnsupportedReason('2026-27', 'one')!.includes('B.ONE'));
assert.equal(oneGameUnsupportedReason('2026-27', 'premier'), null);
console.log('年間1試合の対戦: 26組が調査メモの一覧と一致・各クラブ2相手・状態・確認中・対象外を確認');
