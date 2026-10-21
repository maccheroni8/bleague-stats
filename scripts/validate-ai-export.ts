import { loadAiExport, type AiExportSource } from '../src/lib/aiExportLoad.ts';
// 実データと独立した欠損・移籍・同率・重み付き平均の境界事例。build:dataの後に実行。
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { TeamSummary, TeamGameLog, PlayerSummary, PlayerGameLog, TeamHistoryEntry, GameSummary } from '../shared/types.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';
import { aiTeamRow, aiMetrics, aiRank, aiLeaders, aiDifference, buildAiExport, type AiExportInput, type AiExportSeason } from '../src/lib/aiExport.ts';
import { buildTraditionalColumns, buildAdvancedColumns, buildMiscColumns } from '../src/lib/teamStatsColumns.ts';
import { buildOpponentSplitRows } from '../src/lib/opponentSplit.ts';
import { previousSeason } from '../src/lib/seasonCompare.ts';
import { viewPlayerGameIndex, playerGameAt } from '../src/lib/gameIndex.ts';
import type { PlayerGameIndexFile } from '../shared/gameIndex.ts';
import { buildSeasonBoxscoreCtx, EMPTY_TEAM_TOTALS, sumPlayerGameLogs, seasonBoxColumnsFor } from '../src/lib/playerSeasonBoxscore.ts';
import { filterEligiblePlayers, EXTRA_ELIGIBILITY_RULES } from '../src/lib/playerRankingEligibility.ts';
function read<T>(path: string): T {
  const p = `data/${path}.json`;
  return JSON.parse(existsSync(p) ? readFileSync(p, 'utf8') : gunzipSync(readFileSync(p + '.gz')).toString('utf8')) as T;
}
const history = read<TeamHistoryEntry[]>('team-history');
const seasons = readdirSync('data').filter(s => /^\d{4}-\d{2}$/.test(s)).sort();
const cache = new Map<string, AiExportSeason>();
function seasonData(season: string): AiExportSeason {
  if (cache.has(season)) return cache.get(season)!;
  const teams = read<TeamSummary[]>(`${season}/teams`);
  const value = { season, teams, logs: new Map(teams.map(t => [t.teamId, read<TeamGameLog[]>(`${season}/team-games/${t.teamId}`)])), schedule: read<ScheduleFileExtended>(`${season}/schedule`), summaries: read<GameSummary[]>(`${season}/games-summary`) };
  cache.set(season, value); return value;
}
function inputFor(season: string, teamId: string, leaders = true): AiExportInput {
  const current = seasonData(season), p = previousSeason(season);
  const allPlayers = read<PlayerSummary[]>(`${season}/players`);
  const view = viewPlayerGameIndex(read<PlayerGameIndexFile>(`${season}/player-game-index`));
  const ids = new Set<string>();
  if (leaders) for (let i = 0; i < view.size; i++) { const g = playerGameAt(view, i); if (g.teamId === teamId && g.gameType === 'regular') ids.add(g.playerId); }
  return { current, previous: p && seasons.includes(p) ? seasonData(p) : null, teamId, history,
    players: allPlayers.filter(p => ids.has(p.playerId)).map(player => ({ player, logs: read<PlayerGameLog[]>(`${season}/player-games/${player.playerId}`) })) };
}
let valuesChecked = 0, teamsChecked = 0, leadersChecked = 0;
const metrics = aiMetrics();
assert.equal(metrics.length, 60);
for (const season of seasons) {
  const data = seasonData(season);
  for (const team of data.teams) {
    const row = aiTeamRow(team, data.logs.get(team.teamId)!);
    if (!row.gamesPlayed) continue;
    teamsChecked++;
    assert.equal(row.gamesPlayed, team.gamesPlayed);
    assert.equal(row.totals.pts, team.totals.pts);
    assert.equal(row.totals.fgm, team.totals.fgm);
    assert.equal(row.totals.paint2m, row.logs.reduce((n, g) => n + g.paint2m, 0));
    assert.equal(row.totals.pts / row.gamesPlayed, team.perGame.pts);
    for (const m of metrics) {
      if (m.value(row) === null) continue;
      const base = m.label.replace(/^opp /, '');
      const col = [...buildTraditionalColumns('perGame', m.side), ...buildAdvancedColumns('perGame', m.side), ...buildMiscColumns('perGame', m.side, true, false)].find(c => c.label === base);
      if (col) {
        // ランキング・全チーム表と表示まで一致（符号の+だけは出力側の数値表現との差として許容）。
        assert.equal(Number.parseFloat(m.text(row)), Number.parseFloat(col.format!(row)), `${season}/${team.teamId}/${m.label}`);
        valuesChecked++;
      } else {
        const prefix = m.side === 'opp' ? 'opponent' : '';
        const field = (name: string) => prefix ? prefix + name[0]!.toUpperCase() + name.slice(1) : name;
        const zone = base.startsWith('PAINT') ? 'paint2' : 'mid2';
        const made = row.logs.reduce((n, g) => n + Number(g[field(zone + 'm') as keyof TeamGameLog]), 0);
        const attempts = row.logs.reduce((n, g) => n + Number(g[field(zone + 'a') as keyof TeamGameLog]), 0);
        const expected = base.endsWith('%') ? 100 * made / attempts : (base.endsWith('M') ? made : attempts) / row.gamesPlayed;
        assert(Math.abs(m.value(row)! - expected) < 1e-9); valuesChecked++;
      }
    }
    // 対戦相手別との一致。各相手の勝敗・得失点を再び全体へ足して照合。
    const splits = buildOpponentSplitRows(team.teamId, row.logs);
    assert.equal(splits.rows.reduce((n, r) => n + r.wins, 0), row.wins);
    assert.equal(splits.rows.reduce((n, r) => n + r.totals.oppPts, 0), row.totals.oppPts);
  }
}
const input = inputFor('2026-27', '703');
const own = aiTeamRow(input.current.teams.find(t => t.teamId === input.teamId)!, input.current.logs.get(input.teamId)!);
assert(own.gamesPlayed > 0);
for (const season of ['2016-17', '2025-26', '2026-27']) {
  const x = inputFor(season, '703'), row = aiTeamRow(x.current.teams.find(t => t.teamId === '703')!, x.current.logs.get('703')!);
  const result = buildAiExport(x);
  assert(!/NaN|Infinity|undefined/.test(result.markdown));
  assert.equal(result.characters, Array.from(result.markdown).length);
  assert(result.markdown.includes(`/#/teams/703?season=${season}`));
  if (season === '2016-17') { assert(result.markdown.includes('栃木ブレックス')); assert(result.markdown.includes('前季：比較対象データなし')); }
  else assert(result.markdown.includes(season === '2025-26' ? '終了シーズン' : '途中経過'));
  const leaders = aiLeaders(x, row);
  assert(leaders.every(group => group.rows.length <= 3));
  const keys = new Map(row.logs.map(g => [g.scheduleKey, g.isHome]));
  for (const group of leaders) for (const entry of group.rows) {
    const p = x.players.find(p => p.player.playerId === entry.playerId)!;
    const logs = p.logs.filter(g => g.gameType === 'regular' && keys.get(g.scheduleKey) === g.isHome);
    const totals = sumPlayerGameLogs(logs);
    const ctx = buildSeasonBoxscoreCtx(totals, EMPTY_TEAM_TOTALS, 'perGame', Number(season.slice(0, 4)));
    const col = [...seasonBoxColumnsFor('traditional', false), ...seasonBoxColumnsFor('advanced', false)].find(c => c.label === group.label)!;
    assert.equal(col.format(ctx, 'perGame'), entry.text); assert.equal(totals.gamesPlayed, entry.games);
    const stat = ({ 'FG%': 'fgPct', 'eFG%': 'fgPct', '3P%': 'tpPct', '2P%': 'twoPct', 'FT%': 'ftPct' } as Record<string, string>)[group.label];
    if (stat) {
      const summary = { ...p.player, teamId: '703', gamesPlayed: totals.gamesPlayed, totals: { ...p.player.totals, ...totals } };
      assert.equal(filterEligiblePlayers([summary], [{ teamId: '703', gamesPlayed: row.gamesPlayed }], .85, stat, EXTRA_ELIGIBILITY_RULES[stat]!.defaultValue).length, 1);
    }
    leadersChecked++;
  }
  // 全文は明示した環境変数があるときだけ、Git管理外の成果物として保存。
  if (process.env.AI_EXPORT_SAMPLES) {
    mkdirSync(process.env.AI_EXPORT_SAMPLES, { recursive: true });
    writeFileSync(`${process.env.AI_EXPORT_SAMPLES}/${result.filename}`, result.markdown);
    const opponent = x.current.teams.find(t => t.teamId !== '703')!;
    const compared = buildAiExport({ ...x, opponentId: opponent.teamId });
    writeFileSync(`${process.env.AI_EXPORT_SAMPLES}/相手比較_${compared.filename}`, compared.markdown);
    console.log(`${season}: ${result.characters}文字 / 比較あり ${compared.characters}文字`);
  }
}
// 開幕前年に同リーグの記録がない参入チームを実データから選ぶ。
let newTeamChecked = false;
for (const season of seasons.slice(1)) {
  const p = seasonData(previousSeason(season)!);
  const team = seasonData(season).teams.find(t => !p.teams.some(o => o.teamId === t.teamId));
  if (!team) continue;
  const text = buildAiExport(inputFor(season, team.teamId)).markdown;
  assert(text.includes('前季：比較対象データなし')); newTeamChecked = true; break;
}
assert(newTeamChecked);
// 欠損と0を区別。oppベンチの旧データが0へフォールバックされても書き出しでは未収録。
const g = own.logs[0]!;
const missing = { ...g }; delete (missing as Partial<TeamGameLog>).opponentBenchPoints;
const missingRow = aiTeamRow(own.team, [missing]);
assert.equal(metrics.find(m => m.label === 'opp BENCH PTS')!.text(missingRow), '未収録');
assert.equal(metrics.find(m => m.label === 'STL')!.text(aiTeamRow(own.team, [{ ...g, stl: 0 }])), '0.0');
const pts = metrics.find(m => m.label === 'PTS')!;
const a = aiTeamRow(own.team, [{ ...g, teamScore: 100 }]);
const b = aiTeamRow(own.team, [{ ...g, teamScore: 60 }, { ...g, teamScore: 60 }]);
assert.equal(pts.value(aiTeamRow(own.team, [...a.logs, ...b.logs])), 220 / 3);
const tied = [10, 9, 9, 8].map(n => aiTeamRow(own.team, [{ ...g, teamScore: n }]));
assert.deepEqual(tied.map(r => aiRank(pts, r, tied)), ['1位／4チーム', '2位／4チーム', '2位／4チーム', '4位／4チーム']);
assert.equal(aiDifference(52.1, 50.4, true), '+1.7ポイント');
assert.equal(aiDifference(10.01, 10.02, false), '0.0');
// 結果だけの試合は直接対決の本文を変えず、該当時だけ別記。中止もスタッツに入らない。
const opp = g.opponentTeamId;
const extra = { scheduleKey: 'test-result-only', date: g.date, homeTeamId: '703', homeTeamName: own.team.teamName, awayTeamId: opp, awayTeamName: g.opponentTeamName, homeScore: 20, awayScore: 0, gameType: 'regular' as const, reason: 'forfeit' as const };
const base = buildAiExport({ ...input, opponentId: opp }).markdown;
const withExtra = buildAiExport({ ...input, opponentId: opp, current: { ...input.current, schedule: { ...input.current.schedule, resultOnlyGames: [extra] } } }).markdown;
assert(!base.includes('結果だけの試合1試合を含む勝敗：'));
assert(withExtra.includes('結果だけの試合1試合を含む勝敗：'));
assert.equal(base.split('### 直接対決')[1]!.split('## 定義')[0]!.trim(), withExtra.split('### 直接対決')[1]!.split('結果だけの試合1試合を含む勝敗：')[0]!.trim());
assert.throws(() => buildAiExport({ ...input, current: { ...input.current, logs: new Map() } }));
const unplayed = input.current.teams.find(t => t.teamId !== '703' && !own.logs.some(g => g.opponentTeamId === t.teamId));
if (unplayed) assert(buildAiExport({ ...input, opponentId: unplayed.teamId }).markdown.includes('未対戦'));
// 移籍後の所属が違っても、当該チームの試合だけを使う（相手側の同じ試合IDも混ぜない）。
const player = input.players[0]!.player;
const pg = input.players[0]!.logs.find(p => p.gameType === 'regular' && own.logs.some(g => g.scheduleKey === p.scheduleKey && g.isHome === p.isHome) && p.min > 0)!;
const transfer = { ...input, players: [{ player: { ...player, teamId: 'other' }, logs: [pg, { ...pg, isHome: !pg.isHome, pts: 999 }, { ...pg, scheduleKey: 'other-game', pts: 999 }] }] };
const leader = aiLeaders(transfer, own).find(g => g.label === 'PTS')!.rows[0]!;
assert.equal(leader.games, 1); assert.equal(leader.value, pg.pts);
// 小数表示での同率とeFG%のFGM基準、該当なし。
const small = aiTeamRow(own.team, [g]);
const tieInput = { ...input, players: [1, 2, 2, 4].map((n, i) => ({ player: { ...player, playerId: String(i) }, logs: [{ ...pg, scheduleKey: g.scheduleKey, isHome: g.isHome, pts: 5 - n, fgm: 0, fga: 1, tpm: 0 }] })) };
assert.deepEqual(aiLeaders(tieInput, small).find(g => g.label === 'PTS')!.rows.map(r => r.rank), [1, 2, 2]);
assert.equal(aiLeaders(tieInput, small).find(g => g.label === 'eFG%')!.rows.length, 0);
console.log(`OK: ${teamsChecked}チーム・${valuesChecked}値・${leadersChecked}リーダー。欠損・同率・移籍・前季なし・旧名・未対戦・結果だけの試合を検証`);

// 通信境界：失敗を「記録なし」として公開しない。全データが同じ版なら純粋な生成処理と一致。
const source: AiExportSource = {
  fetchSeasons: async () => read('seasons'),
  fetchTeams: async s => read(`${s}/teams`),
  fetchSchedule: async s => read(`${s}/schedule`),
  fetchGameSummaries: async s => read(`${s}/games-summary`),
  fetchTeamHistory: async () => history,
  fetchPlayers: async s => read(`${s}/players`),
  fetchTeamGameLogs: async (s, id) => read(`${s}/team-games/${id}`),
  fetchPlayerGameLogs: async (s, id) => read(`${s}/player-games/${id}`),
  fetchPlayerGameIndex: async s => read(`${s}/player-game-index`),
};
const loaded = await loadAiExport('2026-27', '703', source);
assert.equal(buildAiExport(loaded).markdown, buildAiExport(input).markdown);
await assert.rejects(loadAiExport('2026-27', '703', { ...source, fetchTeamGameLogs: async () => { throw new Error('offline'); } }));
await assert.rejects(loadAiExport('2026-27', '703', { ...source, fetchPlayerGameLogs: async () => { throw new Error('offline'); } }));
await assert.rejects(loadAiExport('2026-27', '703', { ...source, fetchPlayerGameIndex: async () => null }));
await assert.rejects(loadAiExport('2026-27', '703', { ...source, fetchTeamGameLogs: async (s, id) => (await source.fetchTeamGameLogs(s, id)).slice(1) }));
await assert.rejects(loadAiExport('2026-27', '703', { ...source, fetchTeams: async s => { if (s === '2025-26') throw new Error('previous offline'); return source.fetchTeams(s); } }));
await assert.rejects(loadAiExport('2026-27', '703', { ...source, fetchSchedule: async () => { throw new Error('schedule offline'); } }));
console.log('OK: 読み込みの完全性・前季の失敗・索引の欠落・更新途中のデータを検出');

for (const [season, teamId] of [['2016-17', '703'], ['2025-26', '703'], ['2023-24', '2488']] as const) {
  const data = await loadAiExport(season, teamId, source);
  const output = buildAiExport(data);
  assert(output.markdown.includes(teamId === '2488' ? '前季：比較対象データなし' : season === '2016-17' ? '栃木ブレックス' : '終了シーズン'));
}
console.log('OK: 旧形式の日程・前季なし・旧名称の読み込み');
