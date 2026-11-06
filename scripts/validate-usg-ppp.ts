import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { buildUsgPpp, usgPppAverage, usgPppDomain } from '../src/lib/figureUsgPpp';
import type { ScorerData } from '../src/lib/figureTopScorers';
import { sumPlayerGameLogs, sumTeamGameLogsFor, sumTeamSeasonTotals, EMPTY_TEAM_TOTALS, buildSeasonBoxscoreCtx, SEASON_ADVANCED_COLUMNS } from '../src/lib/playerSeasonBoxscore';
import { changedRegistrations, scopeLogsByClassification, scopedPlayerMatches } from '../src/lib/registrationScopeCore';
import { figureClassGroup } from '../src/lib/figureAge';
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from '../shared/types';
import type { UsgPppQuery } from '../src/lib/figureUsgPpp';
const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith('.gz') ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };
const close = (a: number | null | undefined, b: number | null | undefined, label: string) => {
  if (a == null || b == null) assert.equal(a ?? null, b ?? null, label);
  else assert(Math.abs(a - b) < 1e-8, `${label}: ${a} != ${b}`);
};
const reports: unknown[] = [];
for (const season of readdirSync('data').filter(s => /^20\d\d-\d\d$/.test(s)).sort()) for (const category of ['premier', 'one'] as const) {
  const dir = `data/${season}${category === 'one' ? '/one' : ''}`;
  if (!existsSync(`${dir}/players.json.gz`) && !existsSync(`${dir}/players.json`)) continue;
  const players = read<PlayerSummary[]>(`${dir}/players.json`), teams = read<ScorerData['teams']>(`${dir}/teams.json`);
  const data: ScorerData = { players, teams, playerLogs: new Map(players.map(p => [p.playerId, read<PlayerGameLog[]>(`${dir}/player-games/${p.playerId}.json`)])), teamLogs: new Map(teams.map(t => [t.teamId, read<TeamGameLog[]>(`${dir}/team-games/${t.teamId}.json`)])), divisions: null, registrations: existsSync(`${dir}/registrations.json`) ? read(`${dir}/registrations.json`) : null };
  const q: UsgPppQuery = { season, category, range: { kind: 'all' }, gameType: 'regular', classification: 'all' };
  const full = buildUsgPpp(data, q);
  assert.deepEqual(buildUsgPpp({ ...data, players: [] }, q), [], '選手なしでも動く');
  assert.deepEqual(buildUsgPpp(data, { ...q, range: { kind: 'dateRange', start: '2099-01-01', end: '2099-01-31' } }), [], '試合のない期間');
  const sourceWithGames = players.find(p => full.some(point => point.playerId === p.playerId));
  if (sourceWithGames) {
    const missing = buildUsgPpp({ ...data, players: [{ ...sourceWithGames, advanced: { ...sourceWithGames.advanced, ppp: undefined } }] }, q);
    assert.equal(missing[0]?.ppp, null, 'PPPのない古いデータは欠損で残す');
  }
  assert.equal(new Set(full.map(p => p.id)).size, full.length, '移籍選手も1人1点');
  for (const p of full) {
    const source = players.find(s => s.playerId === p.playerId)!;
    close(p.usg, source.advanced.usagePct, `${season} ${p.name} 一覧 USG%`);
    close(p.ppp, source.advanced.ppp, `${season} ${p.name} 一覧 PPP`);
  }
  const own = new Map<string, string>();
  for (const [id, logs] of data.teamLogs) for (const g of logs) own.set(`${g.scheduleKey}|${g.isHome}`, id);
  const ownTeamOf = (g: { scheduleKey: string; isHome: boolean }) => own.get(`${g.scheduleKey}|${g.isHome}`);
  // USG%・PPP の分母（DESIGN.md 333章）: 本人が出場した試合だけの、その試合の所属チームの合計（移籍した選手も同じ）。画面の共通関数を使わずに組み立てる
  const playedTeam = (logs: PlayerGameLog[]) => {
    const keysByTeam = new Map<string, Set<string>>();
    for (const g of logs) {
      if (!(g.min > 0)) continue;
      const id = ownTeamOf(g)!;
      if (!keysByTeam.has(id)) keysByTeam.set(id, new Set());
      keysByTeam.get(id)!.add(g.scheduleKey);
    }
    return [...keysByTeam].reduce((acc, [id, keys]) => sumTeamSeasonTotals(acc, sumTeamGameLogsFor(data.teamLogs.get(id)!, keys)), { ...EMPTY_TEAM_TOTALS });
  };
  // 期間の試合集合は画面関数に依存せず、直接切り出して比較する。
  const ranges: UsgPppQuery['range'][] = [{ kind: 'recent', n: 5 }, { kind: 'recent', n: 10 }, { kind: 'dateRange', start: `${season.slice(0,4)}-10-01`, end: `${season.slice(0,4)}-10-31` }];
  const samples: unknown[] = [];
  let scopedChecks = 0, detailChecks = 0, detailDifferent = 0;
  const detailExamples: unknown[] = [], transfers: unknown[] = [];
  for (const range of ranges) for (const gameType of ['regular', 'playoff', 'both'] as const) for (const classification of ['all', '日本人', '外国籍・帰化・アジア'] as const) {
    const scoped = buildUsgPpp(data, { ...q, range, gameType, classification });
    const scope = <T extends { min: number; date: string; gameType: string }>(logs: T[]) => {
      const played = logs.filter(g => g.min > 0);
      const period = range.kind === 'recent' ? played.slice(-range.n) : range.kind === 'dateRange' ? played.filter(g => g.date >= range.start && g.date <= range.end) : played;
      return period.filter(g => gameType === 'both' || g.gameType === gameType);
    };
    const group = figureClassGroup(classification), changed = changedRegistrations(data.registrations);
    for (const point of scoped) {
      const p = players.find(p => p.playerId === point.playerId)!;
      assert(scopedPlayerMatches(p, group, changed));
      const allLogs = scopeLogsByClassification(data.playerLogs.get(p.playerId)!, p.playerId, group, changed), logs = scope(allLogs);
      const raw = sumPlayerGameLogs(logs);
      const tt = playedTeam(logs);
      const ctx = buildSeasonBoxscoreCtx(raw, tt, 'perGame', Number(season.slice(0,4)));
      const expectedUsg = tt.min > 0 ? 100 * (raw.fga + 0.44 * raw.fta + raw.tov) * (tt.min / 5) / (raw.min * (tt.fga + 0.44 * tt.fta + tt.tov)) : null;
      close(point.usg, expectedUsg && Number.isFinite(expectedUsg) ? expectedUsg : expectedUsg === 0 ? 0 : null, `${season} ${point.name} 期間USG%`);
      const ortg = SEASON_ADVANCED_COLUMNS.find(c => c.key === 'ortg')!;
      close(point.ppp, ortg.format(ctx, 'perGame') === '-' ? null : ortg.value(ctx, 'perGame') / 100, `${season} ${point.name} 期間PPP`);
      close(point.pts, raw.pts / raw.gamesPlayed, '期間PTS');
      assert.equal(point.games, logs.length);
      if (range.kind === 'recent') assert(point.games <= range.n);
      if (classification === 'all' && gameType === 'regular' && range.kind === 'recent' && range.n === 5 && samples.length < 3) samples.push({ name: p.name, games: point.games, usg: point.usg, ppp: point.ppp });
      scopedChecks++;
    }
  }
  // 個人詳細の全期間は「本人が出た試合」が分母。一覧の全期間との差も隠さず記録する。
  for (const point of full) {
    const all = data.playerLogs.get(point.playerId)!;
    const logs = all.filter(g => g.min > 0 && g.gameType === 'regular');
    const raw = sumPlayerGameLogs(logs), p = players.find(p => p.playerId === point.playerId)!;
    void p;
    const team = playedTeam(logs);
    const ctx = buildSeasonBoxscoreCtx(raw, team, 'perGame', Number(season.slice(0,4)));
    const usg = SEASON_ADVANCED_COLUMNS.find(c => c.key === 'usg')!.value(ctx, 'perGame');
    const ortg = SEASON_ADVANCED_COLUMNS.find(c => c.key === 'ortg')!;
    const ppp = ortg.format(ctx, 'perGame') === '-' ? null : ortg.value(ctx, 'perGame') / 100;
    const same = (x: number | null, y: number | null) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) < 1e-8);
    if (same(point.usg, Number.isFinite(usg) ? usg : null) && same(point.ppp, ppp)) detailChecks++;
    else detailDifferent++;
    if (detailExamples.length < 5 && point.pts >= 15 && point.ratio >= 85) detailExamples.push({ name: point.name, games: point.games, teamGames: point.teamGames, usg: point.usg, ppp: point.ppp, detailUsg: usg, detailPpp: ppp });
    if (point.teamIds.length > 1 && transfers.length < 3) transfers.push({ name: point.name, teamIds: point.teamIds, games: point.games, teamGames: point.teamGames, ratio: point.ratio, usg: point.usg, ppp: point.ppp });
  }
  // 分母をそろえたので、一覧（保存した値）と個人詳細（本人が出た試合から計算）は全員で一致する（DESIGN.md 333章）
  assert.equal(detailDifferent, 0, `${season} ${category}: 一覧と個人詳細の USG%・PPP が食い違う選手 ${detailDifferent}人`);
  const counts = [0, 5, 8, 10, 12, 15].map(minPts => ({ minPts, count: full.filter(p => p.ratio >= 85 && p.pts >= minPts && p.usg !== null && p.ppp !== null).length }));
  const eligible = full.filter(p => p.ratio >= 85 && p.pts >= 15 && p.usg !== null && p.ppp !== null);
  const avg = usgPppAverage(eligible);
  close(avg.usg, eligible.length ? eligible.reduce((a,p) => a + p.usg!, 0) / eligible.length : null, '表示中の単純平均');
  const summary = { season, category, detailExamples, transfers, players: full.length, scopedChecks, detailChecks, detailDifferent, counts, domain: { usg: usgPppDomain(eligible.map(p => p.usg), 'usg'), ppp: usgPppDomain(eligible.map(p => p.ppp), 'ppp') }, average: avg, examples: eligible.slice(0,3), recent5: samples };
  reports.push(summary);
  console.log(`${season} ${category}: ${full.length} players, ${scopedChecks} period checks; detail ${detailChecks} match / ${detailDifferent} different`);
}
assert.deepEqual([usgPppDomain([35], 'usg').min, usgPppDomain([35], 'usg').max], [10, 40]);
assert.equal(usgPppDomain([8], 'usg').min, 5);
assert.deepEqual([usgPppDomain([1.4], 'ppp').min, usgPppDomain([1.4], 'ppp').max], [0.75, 1.5]);
assert.equal(usgPppDomain([0.8], 'ppp').min, 0.75);
assert(usgPppDomain([46], 'usg').max >= 46);
assert(usgPppDomain([0.42, 1.8], 'ppp').min <= 0.42);
assert.equal(usgPppAverage([]).ppp, null);
if (process.env.USG_PPP_REPORT) writeFileSync(process.env.USG_PPP_REPORT, JSON.stringify(reports, null, 2));
console.log('USG × PPP: PASS');
