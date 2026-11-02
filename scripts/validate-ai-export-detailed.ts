// AI向けMarkdown（詳しい版）の検証（段階1の分）。build:data のあとに実行。使い方: npm run validate:ai-export-detailed
// 確かめること:
//  1. タームの選び方（全シーズン・全チーム）: 1シーズン＝勝＋敗・スタッツ＝試合数、直近5試合＝最後の min(5, 試合数) 試合、人工データ（5試合未満・結果だけの試合）
//  2. 対戦相手（勝率6割以上）の判定＝チームスタッツ等の絞り込み（matchesOpponentWinRateTier）が全試合で同じ。直近5試合×6割以上＝該当試合の最後の5試合、ほかは期間が先
//  3. 1シーズン・試合全体の値＝チームスタッツタブ（teams.json）／選手スタッツタブ（players.json 側の集計）と同じ（全シーズン・全チーム。md の表を読み戻して比べる）
//  4. 書式: NaN・undefined・Infinity・[object が無い。0試合の書き方。読み込みの失敗で完成版にしない
//  5. 今の短い書き出しのファイルを変えていない
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import type { TeamSummary, TeamGameLog, PlayerSummary, PlayerGameLog, GameSummary, TeamHistoryEntry } from '../shared/types.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';
import { buildDetailedExport, detailedTerms, type DetailedInput, type DetailedSeason } from '../src/lib/aiDetailedExport.ts';
import { loadDetailedExport, type AiDetailedSource } from '../src/lib/aiDetailedExportLoad.ts';
import { buildTermsWithOpponent, judgeOpponent, teamConfirmedGames, RECENT_GAMES, TIME_SLICE_CHOICES, TERM_CHOICES } from '../src/lib/aiExportScope.ts';
import { buildRecordsBeforeGame, matchesOpponentWinRateTier, buildGameTeamsByScheduleKey, resolveOwnTeam } from '../src/lib/situational.ts';
import { buildTeamSplitRowsFromPeriodSource } from '../src/lib/seasonPeriod.ts';
import { sumTeamGameLogsFor } from '../src/lib/playerSeasonBoxscore.ts';
import { sumPlayerGameLogs, buildSeasonBoxscoreCtx, EMPTY_TEAM_TOTALS, type TeamSeasonRawTotals } from '../src/lib/playerSeasonBoxscore.ts';
import { seasonBoxColumnsWithFtr } from '../src/lib/ftrColumn.ts';
import { normalizePlayerName } from '../shared/playerName.ts';
import { isRegularSeasonComplete } from '../shared/regularSeasonComplete.ts';
import type { PlayerGameIndexFile } from '../shared/gameIndex.ts';
import { viewPlayerGameIndex, playerGameAt } from '../src/lib/gameIndex.ts';

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = ''): void { checks++; if (!ok) { failures++; console.log(`NG ${label}\n   ${detail}`); } }
const read = <T>(path: string): T => {
  const p = `data/${path}.json`;
  return JSON.parse(existsSync(p) ? readFileSync(p, 'utf8') : gunzipSync(readFileSync(`${p}.gz`)).toString('utf8')) as T;
};
const seasons = readdirSync('data').filter(s => /^\d{4}-\d{2}$/.test(s)).sort();
const history = read<TeamHistoryEntry[]>('team-history');
const division = read<unknown>('division-history');

interface SD { teams: TeamSummary[]; summaries: GameSummary[]; schedule: ScheduleFileExtended; logs: Map<string, TeamGameLog[]> }
const cache = new Map<string, SD>();
function sd(season: string): SD {
  let v = cache.get(season);
  if (!v) {
    const teams = read<TeamSummary[]>(`${season}/teams`);
    v = { teams, summaries: read<GameSummary[]>(`${season}/games-summary`), schedule: read<ScheduleFileExtended>(`${season}/schedule`), logs: new Map(teams.map(t => [t.teamId, read<TeamGameLog[]>(`${season}/team-games/${t.teamId}`)])) };
    cache.set(season, v);
  }
  return v;
}
function seasonOf(season: string, teamId: string): DetailedSeason {
  const d = sd(season);
  const regular = d.logs.get(teamId)!.filter(g => g.gameType === 'regular').sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
  return { season, teams: d.teams, team: d.teams.find(t => t.teamId === teamId)!, regular, summaries: d.summaries, schedule: d.schedule, division };
}
const ids = (xs: { scheduleKey: string }[]) => xs.map(x => x.scheduleKey).join(',');
const prevOf = (s: string) => { const y = Number(s.slice(0, 4)) - 1; return `${y}-${String(y + 1).slice(2)}`; };

// ---- 1・2. タームの選び方と対戦相手 ----
let teamSeasons = 0, judged = 0;
for (const season of seasons) {
  const d = sd(season);
  const rec = buildRecordsBeforeGame(d.summaries);
  for (const t of d.teams) {
    teamSeasons++;
    const cur = seasonOf(season, t.teamId);
    const complete = isRegularSeasonComplete({ schedule: d.schedule, summaries: d.summaries });
    const input = { season, league: 'premier' as const, teamId: t.teamId, teamNames: [t.teamName], regularLogs: cur.regular, summaries: d.summaries, schedule: d.schedule, complete };
    const all = teamConfirmedGames(t.teamId, cur.regular, d.schedule);
    const one = (k: 'season' | 'recent5', o: 'all' | 'atLeast60') => { const r = buildTermsWithOpponent(k, o, input); if ('unavailable' in r) throw new Error(r.unavailable); return r.terms[0]!; };
    const s = one('season', 'all');
    check(`${season} ${t.teamName} 1シーズンの試合数＝勝＋敗`, s.games.length === t.wins + t.losses, `${s.games.length} vs ${t.wins}+${t.losses}`);
    check(`${season} ${t.teamName} スタッツの対象＝試合数`, s.statLogs.length === t.gamesPlayed, `${s.statLogs.length} vs ${t.gamesPlayed}`);
    const r5 = one('recent5', 'all');
    check(`${season} ${t.teamName} 直近5試合＝最後の min(5, 試合数)`, ids(r5.games) === ids(all.slice(-RECENT_GAMES)) && r5.games.length === Math.min(5, all.length));
    // 判定＝サイトの絞り込み（スタッツのある試合）
    const hits: typeof all = [];
    for (const g of all) {
      const mine = judgeOpponent('atLeast60', d.summaries, g) === 'in';
      if (mine) hits.push(g);
      if (!g.resultOnly) { judged++; const site = matchesOpponentWinRateTier(g.log, 'atLeast60', rec); check(`${season} ${t.teamName} ${g.scheduleKey} 判定がサイトと同じ`, site === mine); }
    }
    const s60 = one('season', 'atLeast60'), r60 = one('recent5', 'atLeast60');
    check(`${season} ${t.teamName} 1シーズン×6割以上＝該当試合`, ids(s60.games) === ids(hits) && s60.games.length + s60.excluded === s.games.length);
    check(`${season} ${t.teamName} 直近5試合×6割以上＝該当試合の最後の5試合（ある分だけ）`, ids(r60.games) === ids(hits.slice(-RECENT_GAMES)));
  }
}
console.log(`タームと対戦相手: ${teamSeasons}チームシーズン・サイトの判定と比べた延べ${judged}試合`);

// 人工データ: 5試合未満・結果だけの試合・同じ日
{
  const season = '2025-26', teamId = seasonOf(season, sd(season).teams[0]!.teamId).team.teamId;
  const cur = seasonOf(season, teamId);
  const few = cur.regular.slice(0, 3);
  const base = { season, league: 'premier' as const, teamId, teamNames: [cur.team.teamName], summaries: cur.summaries, schedule: cur.schedule, complete: true };
  const r3 = buildTermsWithOpponent('recent5', 'all', { ...base, regularLogs: few }) as { terms: { games: unknown[]; rule: string }[] };
  check('人工: 3試合しかないとき直近5試合は3試合（「3試合しかない」と書く）', r3.terms[0]!.games.length === 3 && /3試合しかない/.test(r3.terms[0]!.rule));
  const withRo = { ...cur.schedule, resultOnlyGames: [...(cur.schedule.resultOnlyGames ?? []), { scheduleKey: 'zz-ro', date: '2099-01-01', gameType: 'regular', homeTeamId: teamId, awayTeamId: cur.teams.find(t => t.teamId !== teamId)!.teamId, homeTeamName: cur.team.teamName, awayTeamName: 'x', homeScore: 80, awayScore: 70, reason: 'test' } as never] };
  const rr = buildTermsWithOpponent('recent5', 'all', { ...base, regularLogs: cur.regular, schedule: withRo }) as { terms: { games: { resultOnly: boolean }[]; statLogs: unknown[] }[] };
  check('人工: 結果だけの試合も直近5試合に数え、スタッツには入れない', rr.terms[0]!.games.length === 5 && rr.terms[0]!.games.at(-1)!.resultOnly && rr.terms[0]!.statLogs.length === 4);
  const none = { ...cur, summaries: [] as GameSummary[] };
  check('人工: 相手の勝敗が無い（5試合未満）ときは判定せず0試合', detailedTerms(none, 'recent5', 'atLeast60', teamId, history)[0]!.games.length === 0);
}

// ---- 3. 値（1シーズン・試合全体）----
const NOT_NUM = /NaN|undefined|Infinity|\[object/;
const cells = (line: string): string[] => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map(c => c.replace(/\\\|/g, '|').trim());
function mdTable(md: string, heading: RegExp): Map<string, string[]> {
  const lines = md.split('\n');
  const at = lines.findIndex(l => heading.test(l));
  const m = new Map<string, string[]>();
  if (at < 0) return m;
  for (let i = at + 2; i < lines.length && lines[i]!.startsWith('|'); i++) { if (i === at + 2 || i === at + 3) { if (/^\|[-| ]+\|$/.test(lines[i]!)) continue; } const c = cells(lines[i]!); m.set(c[0]!, c.slice(1)); }
  return m;
}
function inputFor(season: string, teamId: string, kind: 'team' | 'player', over: Partial<DetailedInput> = {}): DetailedInput {
  const cur = seasonOf(season, teamId);
  const players: DetailedInput['players'] = [];
  if (kind === 'player') {
    const list = read<PlayerSummary[]>(`${season}/players`);
    const view = viewPlayerGameIndex(read<PlayerGameIndexFile>(`${season}/player-game-index`));
    const pids = new Set<string>();
    for (let i = 0; i < view.size; i++) { const g = playerGameAt(view, i); if (g.teamId === teamId && g.gameType === 'regular' && g.min > 0) pids.add(g.playerId); }
    const home = new Map(cur.regular.map(g => [g.scheduleKey, g.isHome]));
    for (const id of pids) players.push({ player: list.find(p => p.playerId === id)!, logs: read<PlayerGameLog[]>(`${season}/player-games/${id}`).filter(g => g.gameType === 'regular' && g.min > 0 && home.get(g.scheduleKey) === g.isHome) });
  }
  return { kind, season, teamId, term: 'season', opp: 'all', timeSlice: 'game', compare: false, history, cur, prev: null, players, exportedAt: 'test', ...over };
}

/** teams.json（チームスタッツの元）から、md の項目名ごとの値（1試合平均・%は0〜100）を取り出す */
function teamsJsonValues(t: TeamSummary): Map<string, number> {
  const g = t.gamesPlayed, pg = t.perGame, sh = t.shooting, ad = t.advanced, tt = t.totals;
  return new Map<string, number>([
    ['PTS', pg.pts], ['OR', pg.oreb], ['DR', pg.dreb], ['TR', pg.reb], ['AST', pg.ast], ['STL', pg.stl], ['BLK', pg.blk], ['TOV', pg.tov], ['+/-', pg.pts - t.opponentPerGame.pts], // teams.json の plusMinus は未使用（0）。画面の +/- は得点−失点
    ['FGM', tt.fgm / g], ['FGA', tt.fga / g], ['3PM', tt.tpm / g], ['3PA', tt.tpa / g], ['FTM', tt.ftm / g], ['FTA', tt.fta / g],
    ['FG%', sh.fgPct * 100], ['3P%', sh.tpPct * 100], ['FT%', sh.ftPct * 100], ['2P%', sh.pt2Pct * 100], ['eFG%', sh.efgPct * 100], ['TS%', sh.tsPct * 100], ['FTR', sh.ftRate * 100],
    ['ORtg', ad.offRtg], ['DRtg', ad.defRtg], ['NetRtg', ad.netRtg], ['PACE', ad.pace], ['OR%', ad.orbPct], ['TOV%', ad.tovPct], ['EFF', ad.eff],
  ].filter(([, v]) => typeof v === 'number' && Number.isFinite(v as number)) as [string, number][]);
}
function oppJsonValues(t: TeamSummary): Map<string, number> {
  const pg = t.opponentPerGame, sh = t.opponentShooting, ad = t.advanced;
  return new Map<string, number>([
    ['PTS', pg.pts], ['OR', pg.oreb], ['DR', pg.dreb], ['TR', pg.reb], ['AST', pg.ast], ['STL', pg.stl], ['BLK', pg.blk], ['TOV', pg.tov],
    ['FG%', sh.fgPct * 100], ['3P%', sh.tpPct * 100], ['FT%', sh.ftPct * 100], ['2P%', sh.pt2Pct * 100], ['eFG%', sh.efgPct * 100], ['TS%', sh.tsPct * 100], ['FTR', sh.ftRate * 100],
    ['OR%', ad.opponentOrbPct], ['TOV%', ad.opponentTovPct],
  ].filter(([, v]) => typeof v === 'number' && Number.isFinite(v as number)) as [string, number][]);
}
const TEAM_LABELS = ['Traditional', 'Advanced', 'Misc', 'Scoring'];
// 選手スタッツタブ（全選手）は ORtg・DRtg・NetRtg・USG% の分母にチームのもっと多くの合計を使う別の経路なので、ここでは比べない（チーム詳細の選手表の式は同じ列の式）
const TEAM_TOTAL_DEPENDENT = new Set(['ORtg', 'DRtg', 'NetRtg', 'USG%']);
let valueCells = 0, playerCells = 0;
const gaps: string[] = [];
for (const season of seasons) {
  const foulSplit = season >= '2026-27', startYear = Number(season.slice(0, 4));
    const teamsJson = read<TeamSummary[]>(`${season}/teams`);
  const players = read<PlayerSummary[]>(`${season}/players`);
  for (const t of sd(season).teams) {
    const md = buildDetailedExport(inputFor(season, t.teamId, 'team')).markdown;
    check(`${season} ${t.teamName} チーム情報に NaN 等が無い`, !NOT_NUM.test(md));
    // 1シーズン・試合全体の値＝チームスタッツ（シーズン別成績の元の teams.json）
    const own = teamsJsonValues(t);
    const opp = oppJsonValues(t);
    const tab = new Map<string, string[]>();
    for (const label of TEAM_LABELS) for (const [k, v] of mdTable(md, new RegExp(`^### ${label}$`))) tab.set(k, v);
    for (const [key, want] of [...own].map(([k, v]) => [k, v] as const).concat([...opp].map(([k, v]) => [`opp ${k}`, v] as const))) {
      const got = tab.get(key);
      if (!got) continue;
      valueCells++;
      const num = Number(got[0]!.replace(/[%+]/g, ''));
      if (!(Math.abs(num - want) <= 0.0101 + Math.abs(want) * 1e-9)) gaps.push(`${season} ${t.teamName} ${key}: md=${got[0]} / teams.json=${want.toFixed(4)}`);
    }
    check(`${season} ${t.teamName} 比べられた項目が十分ある`, [...own.keys()].filter(k => tab.has(k)).length >= 20, String([...own.keys()].filter(k => tab.has(k)).length));
    const summary = mdTable(md, /^## 1\. チームのまとめ$/);
    void summary;
  }
  // 選手: このチームだけの選手の行が、選手スタッツタブの値と同じ
  const teamTotals = new Map(teamsJson.map(t => [t.teamId, t.totals]));
  for (const t of sd(season).teams) {
    const input = inputFor(season, t.teamId, 'player');
    const md = buildDetailedExport(input).markdown;
    check(`${season} ${t.teamName} 選手情報に NaN 等が無い`, !NOT_NUM.test(md));
    for (const tab of ['traditional', 'advanced', 'misc', 'scoring'] as const) {
      const tbl = mdTable(md, new RegExp(`^### ${tab[0]!.toUpperCase()}${tab.slice(1)}$`));
      const cols = seasonBoxColumnsWithFtr(tab, foulSplit);
      const lines = md.split('\n');
      const hi = lines.findIndex(l => l === `### ${tab[0]!.toUpperCase()}${tab.slice(1)}`);
      const labels = cells(lines[hi + 2]!).slice(1);
      for (const { player, logs } of input.players) {
        const p = players.find(x => x.playerId === player.playerId)!;
        const allLogs = read<PlayerGameLog[]>(`${season}/player-games/${player.playerId}`).filter(g => g.gameType === 'regular');
        if (p.teamId !== t.teamId || allLogs.length !== logs.length + allLogs.filter(g => g.min <= 0).length) continue; // 移籍・他チームの試合がある選手は対象外
        const row = [...tbl].find(([k]) => k.length > 0 && k === normalizePlayerName(player.name));
        if (!row) continue;
        const tt = teamTotals.get(t.teamId)!;
        const team: TeamSeasonRawTotals = p.transferredTeamTotals ?? { ...EMPTY_TEAM_TOTALS, pts: tt.pts, fgm: tt.fgm, fga: tt.fga, tpm: tt.tpm, tpa: tt.tpa, ftm: tt.ftm, fta: tt.fta };
        const ctx = buildSeasonBoxscoreCtx(sumPlayerGameLogs(allLogs), team, 'perGame', startYear);
        labels.forEach((lb, i) => {
          const c = cols.find(x => x.label === lb);
          if (!c || TEAM_TOTAL_DEPENDENT.has(lb)) return;
          playerCells++;
          const want = c.format(ctx, 'perGame');
          if (want !== row[1][i]) gaps.push(`${season} ${t.teamName} ${player.name} ${tab} ${lb}: md=${row[1][i]} / 選手スタッツ=${want}`);
        });
      }
    }
  }
}
// ---- 3b. ORtg・DRtg・NetRtg・USG%（と全列）: チーム詳細の「選手スタッツ」タブの経路をそのまま再現して比べる（移籍した選手も含む）。全選手スタッツとの違いは報告する ----
{
  const ADV = ['ORtg', 'DRtg', 'NetRtg', 'USG%'];
  let tabCells = 0, tabDiff = 0, allCells = 0, allDiff = 0, allTransDiff = 0, allTransCells = 0;
  let fullCells = 0, fullDiff = 0;
  const fullGaps: string[] = [];
  const tabGaps: string[] = [], allGaps: string[] = [], allBy = new Map<string, number>();
  for (const season of seasons) {
    const foulSplit = season >= '2026-27', startYear = Number(season.slice(0, 4));
    const list = read<PlayerSummary[]>(`${season}/players`);
    const gameTeams = buildGameTeamsByScheduleKey(sd(season).summaries);
    for (const t of sd(season).teams) {
      const input = inputFor(season, t.teamId, 'player');
      const md = buildDetailedExport(input).markdown;
      const lines = md.split('\n');
      const gameLogs = seasonOf(season, t.teamId).regular;
      for (const tab of ['traditional', 'advanced', 'misc', 'scoring'] as const) {
        const cols = seasonBoxColumnsWithFtr(tab, foulSplit);
        const hi = lines.findIndex(l => l === `### ${tab[0]!.toUpperCase()}${tab.slice(1)}`);
        const labels = cells(lines[hi + 2]!).slice(1);
        const tbl = mdTable(md, new RegExp(`^### ${tab[0]!.toUpperCase()}${tab.slice(1)}$`));
        for (const { player } of input.players) {
          const row = tbl.get(normalizePlayerName(player.name));
          if (!row) continue;
          // チーム詳細のタブと同じ手順（TeamDetailPage の playerStatsRows）
          const logs = read<PlayerGameLog[]>(`${season}/player-games/${player.playerId}`).filter(g => g.gameType === 'regular');
          const own = new Map<string, { teamId: string; teamName: string }>();
          for (const g of logs) { if (g.min <= 0) continue; const o = resolveOwnTeam(g, gameTeams); if (o) own.set(g.scheduleKey, o); }
          const keys = new Set(logs.filter(g => g.min > 0 && own.get(g.scheduleKey)?.teamId === t.teamId).map(g => g.scheduleKey));
          const split = buildTeamSplitRowsFromPeriodSource(player.playerId, logs, own as never, new Map([[t.teamId, sumTeamGameLogsFor(gameLogs, keys)]]), 'perGame', startYear, player.playerId, 'all', null).find(r => r.teamId === t.teamId);
          if (!split) continue;
          const pj = list.find(x => x.playerId === player.playerId);
          const moved = new Set(logs.filter(g => g.min > 0).map(g => own.get(g.scheduleKey)?.teamId)).size > 1;
          labels.forEach((lb, i) => {
            const c = cols.find(x => x.label === lb);
            if (!c) return;
            tabCells++;
            const want = c.format(split.ctx, 'perGame');
            if (want !== row[i]) { tabDiff++; if (tabGaps.length < 8) tabGaps.push(`${season} ${t.teamName} ${player.name} ${lb}: md=${row[i]} / チーム詳細の選手スタッツ=${want}`); }
          });
          // 全選手スタッツ（players.json の事前計算値。条件なしの表）
          if (tab === 'advanced' && pj && !(pj.teamId !== t.teamId || moved)) {
            const full = buildTeamSplitRowsFromPeriodSource(player.playerId, logs, own as never, new Map([[t.teamId, sumTeamGameLogsFor(gameLogs, new Set(gameLogs.map(g => g.scheduleKey)))]]), 'perGame', startYear, player.playerId, 'all', null).find(r => r.teamId === t.teamId);
            const cc = cols.filter(x => ADV.includes(x.label));
            const ad0 = pj.advanced as unknown as Record<string, number | undefined>;
            const o0 = ad0.ppp !== undefined ? ad0.ppp * 100 : undefined, d0 = ad0.individualDrtg;
            const exp: Record<string, string> = { ORtg: o0 !== undefined ? o0.toFixed(2) : '-', DRtg: d0 !== undefined ? d0.toFixed(2) : '-', NetRtg: o0 !== undefined && d0 !== undefined ? `${o0 - d0 > 0 ? '+' : ''}${(o0 - d0).toFixed(2)}` : '-', 'USG%': `${(ad0.usagePct ?? NaN).toFixed(2)}%` };
            for (const c of cc) { fullCells++; if (full && c.format(full.ctx, 'perGame') !== exp[c.label]) { fullDiff++; if (fullGaps.length < 5) fullGaps.push(`${season} ${t.teamName} ${player.name} ${c.label}: チームの全試合の合計で計算=${c.format(full.ctx, 'perGame')} / 全選手スタッツ=${exp[c.label]}`); } }
          }
          if (tab === 'advanced' && pj) {
            const ad = pj.advanced as unknown as Record<string, number | undefined>;
            const ortg = ad.ppp !== undefined ? ad.ppp * 100 : undefined, drtg = ad.individualDrtg;
            const pjv: Record<string, string> = { ORtg: ortg !== undefined ? ortg.toFixed(2) : '-', DRtg: drtg !== undefined ? drtg.toFixed(2) : '-', NetRtg: ortg !== undefined && drtg !== undefined ? `${ortg - drtg > 0 ? '+' : ''}${(ortg - drtg).toFixed(2)}` : '-', 'USG%': `${(ad.usagePct ?? NaN).toFixed(2)}%` };
            for (const lb of ADV) {
              const i = labels.indexOf(lb); if (i < 0) continue;
              const isMoved = pj.teamId !== t.teamId || moved;
              allCells++; if (isMoved) allTransCells++;
              if (pjv[lb] !== row[i]) { allDiff++; if (isMoved) allTransDiff++; allBy.set(`${isMoved ? '移籍あり' : '同一チームのみ'} ${lb}`, (allBy.get(`${isMoved ? '移籍あり' : '同一チームのみ'} ${lb}`) ?? 0) + 1); if (allGaps.length < 10 && !isMoved) allGaps.push(`${season} ${t.teamName} ${player.name} ${lb}: md=${row[i]} / 全選手スタッツ=${pjv[lb]}`); }
            }
          }
        }
      }
    }
  }
  console.log(`チーム詳細の選手スタッツと同じ経路: 比べた${tabCells}セル、食い違い${tabDiff}`);
  for (const g of tabGaps) console.log(`   ${g}`);
  check('選手の全列（ORtg・DRtg・NetRtg・USG% を含む）がチーム詳細の選手スタッツタブと同じ（移籍した選手も）', tabDiff === 0, `${tabDiff}件`);
  console.log(`参考: 全選手スタッツ（players.json の事前計算値）との比較 ORtg・DRtg・NetRtg・USG%: ${allCells}セル中 食い違い${allDiff}（うち移籍した選手の行 ${allTransDiff}／${allTransCells}）`);
  for (const [k, n] of [...allBy].sort()) console.log(`   ${k}: ${n}件`);
  for (const g of allGaps) console.log(`   例: ${g}`);
  console.log(`原因の確認: 同一チームのみの選手を「チームの全試合の合計」で割ると全選手スタッツと一致するか: ${fullCells}セル中 食い違い${fullDiff}`);
  for (const g of fullGaps) console.log(`   ${g}`);
}
console.log(`値の比較: チーム表${valueCells}セル・選手表${playerCells}セル、食い違い${gaps.length}`);
// 選手の合計で分母がチーム合計の項目（%PTS など）は、タブがチーム合計の一部の項目しか持たない経路があるので、食い違いは種類ごとにまとめて報告する
const byKind = new Map<string, number>();
for (const g of gaps) { const k = g.replace(/^\S+ \S+ /, '').replace(/^.*? (traditional|advanced|misc|scoring|Traditional|Advanced|Misc|Scoring) (\S+).*$/, '$1 $2').replace(/: md=.*/, ''); byKind.set(k, (byKind.get(k) ?? 0) + 1); }
for (const [k, n] of [...byKind].sort((a, b) => b[1] - a[1]).slice(0, 12)) console.log(`   食い違い ${n}件: ${k}`);
for (const g of gaps.slice(0, 8)) console.log(`   例: ${g}`);
check('1シーズン・試合全体の値がチームスタッツタブ・選手スタッツタブと同じ', gaps.length === 0, `${gaps.length}件`);

// ---- 4. 書式・0試合・読み込み ----
{
  const combos = [['team', 'season', 'all', false], ['team', 'season', 'atLeast60', true], ['team', 'recent5', 'all', true], ['team', 'recent5', 'atLeast60', true], ['player', 'season', 'all', false], ['player', 'season', 'atLeast60', false], ['player', 'recent5', 'all', false], ['player', 'recent5', 'atLeast60', false]] as const;
  let n = 0;
  for (const season of seasons) for (const t of sd(season).teams) for (const [kind, term, opp, compare] of combos) {
    if (season !== '2026-27' && season !== '2025-26' && t.teamId !== sd(season).teams[0]!.teamId) continue;
    const p = prevOf(season);
    const prev = compare && seasons.includes(p) && sd(p).teams.some(x => x.teamId === t.teamId) ? seasonOf(p, t.teamId) : null;
    const out = buildDetailedExport(inputFor(season, t.teamId, kind, { term, opp, compare, prev }));
    n++;
    check(`${season} ${t.teamName} ${kind}・${term}・${opp} に NaN 等が無い`, !NOT_NUM.test(out.markdown));
    check(`${season} ${t.teamName} ${kind}・${term}・${opp} にファイル名`, /\.md$/.test(out.filename) && !/\s/.test(out.filename));
  }
  console.log(`書式: ${n}通りで確認`);
  const t0 = sd('2026-27').teams[0]!;
  const noRec = inputFor('2026-27', t0.teamId, 'team', { term: 'recent5', opp: 'atLeast60' });
  noRec.cur = { ...noRec.cur, summaries: [] };
  const z = buildDetailedExport(noRec);
  check('0試合のとき「この条件に当てはまる試合はありません」だけを書く（表なし）', z.empty && /この条件に当てはまる試合はありません/.test(z.markdown) && !/## 1\. チームのまとめ/.test(z.markdown));
  const zp = buildDetailedExport({ ...noRec, kind: 'player' });
  check('0試合（選手情報）も同じ', zp.empty && /この条件に当てはまる試合はありません/.test(zp.markdown));
  const full = buildDetailedExport(inputFor('2026-27', t0.teamId, 'team', { term: 'recent5', opp: 'atLeast60' }));
  console.log(`今季（11月）の ${t0.teamName} 直近5試合×6割以上: ${full.empty ? '0試合' : '試合あり'}`);
  check('「準備中」の時間帯は書き出せない', (() => { try { buildDetailedExport(inputFor('2026-27', t0.teamId, 'team', { timeSlice: 'halves' })); return false; } catch { return true; } })());
  check('選択肢: 準備中はターム2・時間帯1', TERM_CHOICES.filter(c => !c.available).length === 2 && TIME_SLICE_CHOICES.filter(c => !c.available('2026-27')).length === 1);
}
{
  // 読み込み: 実データのとおりに作れる／失敗したら完成版にしない
  const src = (over: Partial<AiDetailedSource> = {}): AiDetailedSource => ({
    fetchSeasons: async () => seasons.map(season => ({ season })) as never,
    fetchTeams: async (s: string) => sd(s).teams, fetchSchedule: async (s: string) => sd(s).schedule, fetchGameSummaries: async (s: string) => sd(s).summaries,
    fetchTeamGameLogs: async (s: string, id: string) => sd(s).logs.get(id)!, fetchTeamHistory: async () => history, fetchDivisionHistory: async () => division as never,
    fetchPlayers: async (s: string) => read<PlayerSummary[]>(`${s}/players`), fetchPlayerGameIndex: async (s: string) => read<PlayerGameIndexFile>(`${s}/player-game-index`),
    fetchPlayerGameLogs: async (s: string, id: string) => read<PlayerGameLog[]>(`${s}/player-games/${id}`), ...over,
  } as AiDetailedSource);
  const t0 = sd('2026-27').teams[0]!;
  for (const kind of ['team', 'player'] as const) {
    const loaded = await loadDetailedExport('2026-27', t0.teamId, { kind, term: 'recent5', opp: 'atLeast60', timeSlice: 'game', compare: kind === 'team' }, src(), () => new Date('2026-11-03T10:00:00'));
    const a = buildDetailedExport(loaded).markdown;
    const b = buildDetailedExport(inputFor('2026-27', t0.teamId, kind, { term: 'recent5', opp: 'atLeast60', compare: kind === 'team', prev: kind === 'team' ? seasonOf('2025-26', t0.teamId) : null, exportedAt: '2026-11-03 10:00' })).markdown;
    check(`読み込み経由と直接で同じ内容（${kind}）`, a === b);
  }
  for (const [name, over] of [['チームの試合記録', { fetchTeamGameLogs: async () => { throw new Error('x'); } }], ['日程', { fetchSchedule: async () => { throw new Error('x'); } }], ['選手の試合記録', { fetchPlayerGameLogs: async () => { throw new Error('x'); } }]] as const) {
    let failed = false;
    try { await loadDetailedExport('2026-27', t0.teamId, { kind: 'player', term: 'season', opp: 'all', timeSlice: 'game', compare: false }, src(over as never)); } catch { failed = true; }
    check(`${name}の読み込みに失敗したら完成版を作らない`, failed);
  }
  let mismatch = false;
  try { await loadDetailedExport('2026-27', t0.teamId, { kind: 'team', term: 'season', opp: 'all', timeSlice: 'game', compare: false }, src({ fetchTeamGameLogs: async (s: string, id: string) => sd(s).logs.get(id)!.slice(1) })); } catch { mismatch = true; }
  check('集計と試合記録が揃わないときは作らない', mismatch);
}

// ---- 4b. 外国籍人数の名前・人数別の時間の表・用語の一覧 ----
{
  let rowsChecked = 0, bad = 0, noteBad = 0, labelBad = 0;
  for (const season of seasons) for (const t of sd(season).teams) {
    const md = buildDetailedExport(inputFor(season, t.teamId, 'team')).markdown;
    const logs = sd(season).logs.get(t.teamId)!.filter(g => g.gameType === 'regular');
    const lines = md.split('\n');
    const at = lines.findIndex(l => l.startsWith('#### 試合ごとの、コート上の外国籍・帰化・アジアの人数別の時間'));
    if (at < 0) { bad++; continue; }
    const rows = lines.slice(at).filter(l => /^\|\d{4}-\d{2}-\d{2}\|/.test(l)).map(cells);
    if (rows.length !== logs.length) bad++;
    const byDate = new Map(logs.map(g => [g.scheduleKey, g]));
    void byDate;
    const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
    sorted.forEach((g, i) => {
      const r = rows[i]; if (!r) return;
      rowsChecked++;
      const sec = g.foreignCourtSeconds;
      const want = [0, 1, 2, 3, 4].map(n => (sec?.[n] === undefined ? '-' : (sec[n]! / 60).toFixed(1)));
      if (r.slice(3, 8).join(',') !== want.join(',') || r[8] !== (g.foreignPlayerCount === undefined ? '-' : `${g.foreignPlayerCount}人`)) bad++;
    });
    const hasNote = lines.some(l => l.includes('2019-20以前のシーズンは、コートにいた選手を試合の記録から推定'));
    if (hasNote !== (season < '2020-21')) noteBad++;
    if (md.includes('自チーム外国籍人数') || !md.includes('コート上の外国籍・帰化・アジアの人数（最も長かった人数）') && logs.some(g => g.foreignPlayerCount !== undefined)) labelBad++;
    for (const w of ['1POS差以内（3点差以内）', '試合中の点差（試合中に一度でも', '対戦相手の強さ（相手の今の勝率', '#### 用語（数え方が名前から分かりにくい項目）']) if (!md.includes(w) && (w !== '1POS差以内（3点差以内）' || logs.some(g => Math.abs(g.teamScore - g.opponentScore) <= 3))) labelBad++;
  }
  console.log(`人数別の時間の表: ${rowsChecked}試合を試合ログと突き合わせた`);
  check('人数別の時間の表＝試合ごとの在コート秒数（分）・最長の人数が試合ログの値と同じ・行数＝スタッツのある試合数', bad === 0, `${bad}件`);
  check('2019-20以前のシーズンにだけ「推定」の注記がある', noteBad === 0, `${noteBad}件`);
  check('項目名（外国籍人数・1POS・試合中の点差・対戦相手の強さ）と用語の一覧が入っている・旧名が残らない', labelBad === 0, `${labelBad}件`);
  const t0 = sd('2026-27').teams.find(x => x.teamName.includes('宇都宮'))!;
  const player = buildDetailedExport(inputFor('2026-27', t0.teamId, 'player')).markdown;
  check('選手情報にも用語の一覧がある', player.includes('#### 用語（数え方が名前から分かりにくい項目）'));
  // 最長の人数＝在コート秒数が最も長い人数（同じ長さのときは先の人数）かの確認
  let argBad = 0, argTotal = 0, argTie = 0;
  for (const season of seasons) for (const t of sd(season).teams) for (const g of sd(season).logs.get(t.teamId)!.filter(x => x.gameType === 'regular')) {
    const sec = g.foreignCourtSeconds; if (!sec || g.foreignPlayerCount === undefined) continue;
    argTotal++;
    const max = Math.max(...sec);
    if (sec.filter(v => v === max).length > 1) argTie++;
    if (sec[g.foreignPlayerCount] !== max) argBad++;
  }
  console.log(`参考: 「最も長かった人数」の確認 ${argTotal}試合、最長でない人数が入っている ${argBad}、同じ長さで並んだ試合 ${argTie}`);
  check('「最も長かった人数」が人数別の時間の最長と同じ', argBad === 0, `${argBad}件`);
}

// ---- 5. 短い書き出しを変えていない ----
{
  let changed = '';
  try { changed = execFileSync('git', ['diff', '--name-only', 'origin/main', '--', 'src/lib/aiExport.ts', 'src/lib/aiExportLoad.ts', 'scripts/validate-ai-export.ts'], { encoding: 'utf8' }).trim(); } catch { changed = ''; }
  check('短い書き出しの本体・読み込みを変えていない（origin/main との差なし）', changed === '', changed);
}
assert.ok(checks > 0);
console.log(failures ? `\n失敗 ${failures}件（確認 ${checks}件）` : `\n全 ${checks} 件 ok`);
process.exit(failures ? 1 : 0);
