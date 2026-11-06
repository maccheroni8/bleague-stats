// AI向けMarkdown（詳しい版）の検証（段階1の分）。build:data のあとに実行。使い方: npm run validate:ai-export-detailed
// 確かめること:
//  1. タームの選び方（全シーズン・全チーム）: 1シーズン＝勝＋敗・スタッツ＝試合数、直近5試合＝最後の min(5, 試合数) 試合、人工データ（5試合未満・結果だけの試合）
//  2. 対戦相手（勝率6割以上）の判定＝チームスタッツ等の絞り込み（matchesOpponentWinRateTier）が全試合で同じ。直近5試合×6割以上＝該当試合の最後の5試合、ほかは期間が先
//  3. 1シーズン・試合全体の値＝チームスタッツタブ（teams.json）／選手スタッツタブ（players.json 側の集計）と同じ（全シーズン・全チーム。md の表を読み戻して比べる）
//  4. 書式: NaN・undefined・Infinity・[object が無い。0試合の書き方。読み込みの失敗で完成版にしない
//  5. 今の短い書き出しのファイルを変えていない
//  6. 段階2：ターム分け・オンザコート別・Time to Shot・Streaks・リーグ順位とリーグ平均・選手のプロフィール
//  7. 段階3：Shooting・Forced TOV（値・順位・リーグ平均＝teams.json／league-average.json、ターム・絞り込み＝記録の生データ、記録の無い試合の人工データ、選手 Shooting＝players.json、記録の無いシーズンの理由）
//  8. 段階3：B.ONE（読み込みから書き出し・リーグを通している・記録を読みに行かない・3ターム不可・前季の有無・値と順位）
//  9. 段階3：スポーツナビの記録の読み込み（必要な試合だけ・進み具合・失敗・中止）
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import type { TeamSummary, TeamGameLog, PlayerSummary, PlayerGameLog, GameSummary, TeamHistoryEntry, YahooGamePbp } from '../shared/types.ts';
import type { ScheduleFileExtended } from '../shared/resultOnlyGames.ts';
import { buildDetailedExport, buildDetailedWhole, detailedTerms, type DetailedInput, type DetailedSeason } from '../src/lib/aiDetailedExport.ts';
import { loadDetailedExport, LoadAborted, type AiDetailedSource } from '../src/lib/aiDetailedExportLoad.ts';
import { threeTermBreaks, buildTermsWithOpponent, judgeOpponent, teamConfirmedGames, RECENT_GAMES, TIME_SLICE_CHOICES, TERM_CHOICES } from '../src/lib/aiExportScope.ts';
import { buildRecordsBeforeGame, matchesOpponentWinRateTier, buildGameTeamsByScheduleKey, resolveOwnTeam } from '../src/lib/situational.ts';
import { buildTeamSplitRowsFromPeriodSource } from '../src/lib/seasonPeriod.ts';
import { sumTeamGameLogsFor } from '../src/lib/playerSeasonBoxscore.ts';
import { sumPlayerGameLogs, buildSeasonBoxscoreCtx, EMPTY_TEAM_TOTALS, type TeamSeasonRawTotals } from '../src/lib/playerSeasonBoxscore.ts';
import { seasonBoxColumnsWithFtr } from '../src/lib/ftrColumn.ts';
import { normalizePlayerName } from '../shared/playerName.ts';
import { sumForeignCourt, type ForeignPeriodValue } from '../src/lib/teamForeignCourt.ts';
import { sumTtsTotals, loadTtsSource, type TtsSource } from '../src/lib/teamTts.ts';
import { loadTeamPeriodSource, sumTeamPeriodTotals, type TeamPeriodSource } from '../src/lib/teamPeriodTotals.ts';
import { loadSeasonPeriodSource, seasonPeriodTotalsOf, type SeasonPeriodSource } from '../src/lib/seasonPeriod.ts';
import { positionText, heightText, weightText } from '../src/lib/profileMark.ts';
import { ageForSeason, ageBaseDate } from '../src/lib/age.ts';
import { registrationLabel } from '../src/lib/registrationLabel.ts';
import type { SeasonRegistrationFile } from '../shared/registration.ts';
import { seasonRuleFor } from '../shared/seasonRules.ts';
import { isRegularSeasonComplete } from '../shared/regularSeasonComplete.ts';
import type { PlayerGameIndexFile } from '../shared/gameIndex.ts';
import { viewPlayerGameIndex, playerGameAt } from '../src/lib/gameIndex.ts';
import { shotTypeEntityColumns, shotTypeDiffColumns, sortShotTypeKeys } from '../src/lib/shotTypeBreakdown.ts';
import { forcedTurnoverColumns } from '../src/lib/opponentSplit.ts';
import { rankPositions } from '../src/lib/seasonCompare.ts';
import { sumShotPair, sumTovPair, playerShots, shotPairInPeriods, tovPairInPeriods, type ShotPair } from '../src/lib/aiDetailedYahoo.ts';
import { buildQuarterRows } from '../src/lib/teamQuarterSplit.ts';
import { seasonPeriodFormatters, seasonPeriodCell } from '../src/lib/teamSeasonPeriod.ts';
import { teamSeasonColumnLabels } from '../src/pages/TeamDetailPage.tsx';
import { shotTypeLabel, buildShotTypeBreakdown } from '../src/lib/shotTypeBreakdown.ts';
import { sumTeamGameLogs } from '../src/lib/teamStatsColumns.ts';
import { gameOvertimes } from '../src/lib/gameFacts.ts';
import { sumForeignDetail } from '../src/lib/teamForeignCourt.ts';
import { ONE_PERIOD_REASON } from '../src/lib/leagueAvailability.ts';
import { ONE_THREE_TERMS_REASON } from '../src/lib/aiExportScope.ts';
import type { TeamPerspective } from '../src/lib/teamStatsColumns.ts';

let failures = 0, checks = 0;
function check(label: string, ok: boolean, detail = ''): void { checks++; if (!ok) { failures++; console.log(`NG ${label}\n   ${detail}`); } }
const read = <T>(path: string): T => {
  const p = `data/${path}.json`;
  return JSON.parse(existsSync(p) ? readFileSync(p, 'utf8') : gunzipSync(readFileSync(`${p}.gz`)).toString('utf8')) as T;
};
const seasons = readdirSync('data').filter(s => /^\d{4}-\d{2}$/.test(s)).sort();
const history = read<TeamHistoryEntry[]>('team-history');
// 区間の索引・Time to Shot の読み込み（製品と同じ読み込み部品）は fetch を使うので、data/ を読む fetch を用意する
(globalThis as unknown as { fetch: unknown }).fetch = async (url: string) => {
  const file = `${process.cwd()}/${decodeURIComponent(String(url).split('?')[0]!).replace(/^\//, '').replace(/^bleague-stats\//, '')}`;
  return existsSync(file) ? new Response(readFileSync(file), { status: 200 }) : new Response(null, { status: 404 });
};
const periodSources = new Map<string, TeamPeriodSource | null>();
const ttsSources = new Map<string, TtsSource | null>();
for (const season of readdirSync('data').filter(x => /^\d{4}-\d{2}$/.test(x)).sort()) { periodSources.set(season, await loadTeamPeriodSource(season, 'premier')); ttsSources.set(season, await loadTtsSource(season, 'premier')); }
const seasonPeriods = new Map<string, SeasonPeriodSource | null>();
for (const season of readdirSync('data').filter(x => /^\d{4}-\d{2}$/.test(x)).sort()) seasonPeriods.set(season, await loadSeasonPeriodSource(season, 'premier'));
const seasonRules = read<Parameters<typeof seasonRuleFor>[0]>('season-rules');
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
  let start = at + 1;
  while (start < lines.length && !lines[start]!.startsWith('|') && !lines[start]!.startsWith('#')) start++; // 表の前の注記の行は飛ばす
  for (let i = start; i < lines.length && lines[i]!.startsWith('|'); i++) { if (i === start || i === start + 1) { if (/^\|[-| ]+\|$/.test(lines[i]!)) continue; } const c = cells(lines[i]!); m.set(c[0]!, c.slice(1)); }
  return m;
}
/** その年のスポーツナビの記録（レギュラーシーズンで、試合ログに shotTypes がある試合）を全部読む（検証用。製品は必要な試合だけ読む） */
const pbpCache = new Map<string, Map<string, YahooGamePbp>>();
function pbpsOfSeason(season: string): Map<string, YahooGamePbp> {
  let m = pbpCache.get(season);
  if (!m) {
    m = new Map();
    const keys = new Set<string>();
    for (const logs of sd(season).logs.values()) for (const g of logs) if (g.gameType === 'regular' && g.shotTypes) keys.add(g.scheduleKey);
    for (const k of keys) m.set(k, read<YahooGamePbp>(`${season}/yahoo/${k}`));
    pbpCache.set(season, m);
  }
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
    for (const id of pids) {
      const all = read<PlayerGameLog[]>(`${season}/player-games/${id}`);
      players.push({ player: list.find(p => p.playerId === id)!, logs: all.filter(g => g.gameType === 'regular' && g.min > 0 && home.get(g.scheduleKey) === g.isHome), zeroMinKeys: all.filter(g => g.gameType === 'regular' && g.min <= 0 && home.get(g.scheduleKey) === g.isHome).map(g => g.scheduleKey) });
    }
  }
  const leagueLogs = new Map(sd(season).teams.map(t => [t.teamId, seasonOf(season, t.teamId).regular] as const));
  const registrations = kind === 'player' && season >= '2026-27' ? read<SeasonRegistrationFile>(`${season}/registrations`) : null;
  return { kind, season, teamId, term: 'season', opp: 'all', timeSlice: 'game', compare: false, history, cur, prev: null, players, registrations, leagueLogs: kind === 'team' ? leagueLogs : undefined,
    periodSource: kind === 'team' ? periodSources.get(season) ?? null : null, ttsSource: kind === 'team' ? ttsSources.get(season) ?? null : null, maxForeignOnCourt: seasonRuleFor(seasonRules, season, 'premier')?.maxForeignOnCourt ?? 4,
    pbps: sd(season).teams.some(t => !!t.shotTypes) ? pbpsOfSeason(season) : undefined, pbpsScope: 'league', seasonPeriod: kind === 'player' ? seasonPeriods.get(season) ?? null : null, exportedAt: 'test', ...over };
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
      const num = Number(got[0]!.replace(/（\d+位）$/, '').replace(/[%+]/g, ''));
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
            const o0 = ad0.individualOrtg, d0 = ad0.individualDrtg;
            const exp: Record<string, string> = { ORtg: o0 !== undefined ? o0.toFixed(2) : '-', DRtg: d0 !== undefined ? d0.toFixed(2) : '-', NetRtg: o0 !== undefined && d0 !== undefined ? `${o0 - d0 > 0 ? '+' : ''}${(o0 - d0).toFixed(2)}` : '-', 'USG%': `${(ad0.usagePct ?? NaN).toFixed(2)}%` };
            for (const c of cc) { fullCells++; if (full && c.format(full.ctx, 'perGame') !== exp[c.label]) { fullDiff++; if (fullGaps.length < 5) fullGaps.push(`${season} ${t.teamName} ${player.name} ${c.label}: チームの全試合の合計で計算=${c.format(full.ctx, 'perGame')} / 全選手スタッツ=${exp[c.label]}`); } }
          }
          if (tab === 'advanced' && pj) {
            const ad = pj.advanced as unknown as Record<string, number | undefined>;
            const ortg = ad.individualOrtg, drtg = ad.individualDrtg;
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
  // 分母を「本人が出場した試合の所属チームの合計」にそろえたので、1チームだけの選手は md と全選手スタッツが一致する（DESIGN.md 333章）
  check('md の選手の ORtg・DRtg・NetRtg・USG%（1チームだけの選手）が全選手スタッツと同じ', [...allBy].filter(([k]) => k.startsWith('同一チームのみ')).every(([, n]) => n === 0), [...allBy].map(([k, n]) => `${k} ${n}`).join('、'));
  console.log(`参考: 同一チームのみの選手を「チームの全試合の合計」で割ったときの全選手スタッツとの差（出場していない試合がある選手は今は違って当然）: ${fullCells}セル中 ${fullDiff}`);
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
  check('選択肢: ターム4つ・時間帯2つ（試合全体だけ／前半・後半も含める）がすべて選べる（準備中なし）', TERM_CHOICES.every(c => c.available) && TERM_CHOICES.length === 4 && TIME_SLICE_CHOICES.length === 2 && TIME_SLICE_CHOICES.every(c => c.available('2026-27') && c.available('2016-17')));
}
{
  // 読み込み: 実データのとおりに作れる／失敗したら完成版にしない
  const src = (over: Partial<AiDetailedSource> = {}): AiDetailedSource => ({
    fetchSeasons: async () => seasons.map(season => ({ season })) as never,
    fetchTeams: async (s: string) => sd(s).teams, fetchSchedule: async (s: string) => sd(s).schedule, fetchGameSummaries: async (s: string) => sd(s).summaries,
    fetchTeamGameLogs: async (s: string, id: string) => sd(s).logs.get(id)!, fetchTeamHistory: async () => history, fetchDivisionHistory: async () => division as never,
    fetchPlayers: async (s: string) => read<PlayerSummary[]>(`${s}/players`), fetchPlayerGameIndex: async (s: string) => read<PlayerGameIndexFile>(`${s}/player-game-index`),
    fetchPlayerGameLogs: async (s: string, id: string) => read<PlayerGameLog[]>(`${s}/player-games/${id}`),
    fetchYahooGamePbp: async (sn: string, key: string) => pbpsOfSeason(sn).get(key) ?? null,
    fetchSeasonRules: async () => seasonRules, loadTeamPeriodSource: async (s: string) => periodSources.get(s) ?? null, loadTtsSource: async (s: string) => ttsSources.get(s) ?? null,
    loadSeasonPeriodSource: async (s: string) => seasonPeriods.get(s) ?? null,
    loadSeasonRegistrations: async (s: string) => (s >= '2026-27' ? read<SeasonRegistrationFile>(`${s}/registrations`) : null), ...over,
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
    for (const w of ['3点差以内', '試合中の点差（試合中に一度でも', '対戦相手の強さ（相手の今の勝率', '#### 用語（数え方が名前から分かりにくい項目）']) if (!md.includes(w) && (w !== '3点差以内' || logs.some(g => Math.abs(g.teamScore - g.opponentScore) <= 3))) labelBad++;
  }
  console.log(`人数別の時間の表: ${rowsChecked}試合を試合ログと突き合わせた`);
  check('人数別の時間の表＝試合ごとの在コート秒数（分）・最長の人数が試合ログの値と同じ・行数＝スタッツのある試合数', bad === 0, `${bad}件`);
  check('2019-20以前のシーズンにだけ「推定」の注記がある', noteBad === 0, `${noteBad}件`);
  check('項目名（外国籍人数・3点差以内・試合中の点差・対戦相手の強さ）と用語の一覧が入っている・旧名が残らない', labelBad === 0, `${labelBad}件`);
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

// ---- 6. 段階2：ターム分け・オンザコート別・Time to Shot・Streaks・リーグ順位とリーグ平均・選手のプロフィール ----
{
  // 6-1. 3タームの境目が設計書2章の一覧と一致（前の最後の試合日 → 明けの最初の試合日）
  const EXPECT: Record<string, [string, string, string, string]> = {
    '2016-17': ['2016-11-07', '2016-11-18', '2017-02-05', '2017-02-17'], '2017-18': ['2017-11-21', '2017-12-01', '2018-02-18', '2018-03-02'],
    '2018-19': ['2018-11-24', '2018-12-07', '2019-02-11', '2019-03-02'], '2019-20': ['2019-11-25', '2019-12-07', '2020-02-17', '2020-03-14'],
    '2020-21': ['2020-11-15', '2020-12-02', '2021-02-14', '2021-02-26'], '2021-22': ['2021-11-14', '2021-12-04', '2022-02-14', '2022-02-26'],
    '2022-23': ['2022-10-26', '2022-11-19', '2023-02-12', '2023-03-08'], '2023-24': ['2023-11-12', '2023-11-30', '2024-02-11', '2024-03-01'],
    '2024-25': ['2024-11-12', '2024-11-30', '2025-02-09', '2025-02-28'], '2025-26': ['2025-11-16', '2025-12-05', '2026-02-15', '2026-03-07'],
    '2026-27': ['2026-11-18', '2026-12-04', '2027-02-17', '2027-03-05'],
  };
  for (const season of seasons) {
    const d = sd(season);
    const br = threeTermBreaks(season, 'premier', d.summaries, d.schedule);
    const e = EXPECT[season];
    check(`${season} 3タームの境目が設計書の一覧と一致`, br.ok && !!e && [br.nov.before, br.nov.after, br.feb.before, br.feb.after].join() === e.join(), br.ok ? `${br.nov.before},${br.nov.after},${br.feb.before},${br.feb.after}` : br.reason);
  }
  check('B.ONE は3タームを選べない', !threeTermBreaks('2026-27', 'one', sd('2026-27').summaries, sd('2026-27').schedule).ok);

  // 6-2. 全シーズン・全チームで、ターム分けの試合の取りこぼし・重複なし。前半戦・後半戦の試合数
  let partChecks = 0;
  for (const season of seasons) {
    const d = sd(season);
    const complete = isRegularSeasonComplete({ schedule: d.schedule, summaries: d.summaries });
    for (const t of d.teams) {
      const ds = seasonOf(season, t.teamId);
      const all = detailedTerms(ds, 'season', 'all', t.teamId, history)[0]!;
      for (const kind of ['threeTerms', 'halves'] as const) {
        const terms = detailedTerms(ds, kind, 'all', t.teamId, history);
        const keys = terms.flatMap(x => x.games.map(g => g.scheduleKey));
        const stat = terms.flatMap(x => x.statLogs.map(g => g.scheduleKey));
        partChecks++;
        check(`${season} ${t.teamName} ${kind} 試合の取りこぼし・重複なし`, keys.length === all.games.length && new Set(keys).size === keys.length && ids(terms.flatMap(x => x.games)) === ids(all.games) && stat.length === all.statLogs.length && new Set(stat).size === stat.length);
        if (kind === 'halves') {
          const n = all.games.length;
          const want = complete ? Math.ceil(n / 2) : Math.min(n, 30);
          check(`${season} ${t.teamName} 前半戦の試合数（終わった＝半分・奇数は前半戦が多い／進行中＝30）`, terms[0]!.games.length === want, `${terms[0]!.games.length} vs ${want}`);
          if (complete && season === '2025-26') check(`${season} ${t.teamName} 60試合は 30／30`, n !== 60 || (terms[0]!.games.length === 30 && terms[1]!.games.length === 30));
        }
      }
      // 勝率6割以上と組み合わせ：期間を決めてから絞る（絞ったあとの合計＝シーズンを絞ったもの）
      const s60 = detailedTerms(ds, 'season', 'atLeast60', t.teamId, history)[0]!;
      for (const kind of ['threeTerms', 'halves'] as const) {
        const terms = detailedTerms(ds, kind, 'atLeast60', t.teamId, history);
        check(`${season} ${t.teamName} ${kind}×6割以上：各ターム＝期間の試合を絞ったもの・合計＝シーズンを絞ったもの`, ids(terms.flatMap(x => x.games)) === ids(s60.games));
      }
    }
  }
  console.log(`ターム分け: ${partChecks}通り（3ターム・前半戦後半戦）で取りこぼし・重複なし`);
  // 人工データ: 候補なし・同じ長さ・奇数・進行中30固定・結果だけの試合
  {
    const season = '2025-26', teamId = sd(season).teams[0]!.teamId;
    const cur = seasonOf(season, teamId);
    const base = { season, league: 'premier' as const, teamId, teamNames: [cur.team.teamName], regularLogs: cur.regular, summaries: cur.summaries, schedule: cur.schedule, complete: true };
    const noGap = { ...cur.schedule, resultOnlyGames: [], upcomingGames: [] } as ScheduleFileExtended;
    const dense = cur.summaries.map((g, k) => ({ ...g, date: `2025-${String(10 + Math.floor(k / 28)).padStart(2, '0')}-${String(1 + (k % 28)).padStart(2, '0')}` })) as GameSummary[];
    const r1 = buildTermsWithOpponent('threeTerms', 'all', { ...base, summaries: dense, schedule: noGap });
    check('人工: 中断の候補が無いとき3タームは選べない（理由つき）', 'unavailable' in r1 && /見つからない/.test(r1.unavailable), JSON.stringify(r1).slice(0, 120));
    const odd = buildTermsWithOpponent('halves', 'all', { ...base, regularLogs: cur.regular.slice(0, 59) }) as { terms: { games: unknown[] }[] };
    check('人工: 59試合は前半戦30・後半戦29（奇数は前半戦に多い）', odd.terms[0]!.games.length === 30 && odd.terms[1]!.games.length === 29);
    const prog = buildTermsWithOpponent('halves', 'all', { ...base, regularLogs: cur.regular.slice(0, 12), complete: false }) as { terms: { games: unknown[]; rule: string }[] };
    check('人工: 進行中は30試合目までを前半戦に固定（12試合なら前半戦12・後半戦0）', prog.terms[0]!.games.length === 12 && prog.terms[1]!.games.length === 0 && /30試合目まで/.test(prog.terms[0]!.rule));
    const prog2 = buildTermsWithOpponent('halves', 'all', { ...base, regularLogs: cur.regular.slice(0, 33), complete: false }) as { terms: { games: unknown[] }[] };
    check('人工: 進行中で33試合なら前半戦30・後半戦3', prog2.terms[0]!.games.length === 30 && prog2.terms[1]!.games.length === 3);
  }

  // 6-3. オンザコート別・Time to Shot：画面の値（teams.json の人数別の秒数）と一致、タームの合計＝シーズン全体
  let ocChecks = 0;
  for (const season of seasons) {
    const tp = periodSources.get(season) ?? null, tts = ttsSources.get(season) ?? null;
    check(`${season} 区間の索引が読める`, !!tp);
    for (const t of sd(season).teams) {
      const ds = seasonOf(season, t.teamId);
      const all = detailedTerms(ds, 'season', 'all', t.teamId, history)[0]!;
      const own = sumForeignCourt(tp, all.statLogs, 'all' as ForeignPeriodValue, 'own');
      if (own && t.foreignPlayerCourtSeconds) { ocChecks++; check(`${season} ${t.teamName} オンザコート別の人数別の秒数＝チームスタッツ（teams.json）`, own.seconds.join() === t.foreignPlayerCourtSeconds.join(), `${own.seconds.join()} vs ${t.foreignPlayerCourtSeconds.join()}`); }
      for (const kind of ['threeTerms', 'halves'] as const) {
        const terms = detailedTerms(ds, kind, 'all', t.teamId, history);
        const sumSec = [0, 0, 0, 0, 0];
        const ttsSum: Record<string, number> = {};
        for (const x of terms) {
          const o = sumForeignCourt(tp, x.statLogs, 'all' as ForeignPeriodValue, 'own');
          o?.seconds.forEach((v, k) => { sumSec[k]! += v; });
          if (tts) for (const side of ['own', 'opp'] as const) { const v = sumTtsTotals(tts, x.statLogs, 'all', side); ttsSum[`${side}.games`] = (ttsSum[`${side}.games`] ?? 0) + v.games; ttsSum[`${side}.excluded`] = (ttsSum[`${side}.excluded`] ?? 0) + v.excluded; for (const [c, nv] of Object.entries(v.byCategory)) { ttsSum[`${side}.${c}.n`] = (ttsSum[`${side}.${c}.n`] ?? 0) + nv.n; ttsSum[`${side}.${c}.s`] = (ttsSum[`${side}.${c}.s`] ?? 0) + nv.s; } }
        }
        if (own) check(`${season} ${t.teamName} ${kind} オンザコート別の合計＝シーズン全体`, sumSec.join() === own.seconds.join());
        if (tts) {
          const seasonSum: Record<string, number> = {};
          for (const side of ['own', 'opp'] as const) { const v = sumTtsTotals(tts, all.statLogs, 'all', side); seasonSum[`${side}.games`] = v.games; seasonSum[`${side}.excluded`] = v.excluded; for (const [c, nv] of Object.entries(v.byCategory)) { seasonSum[`${side}.${c}.n`] = nv.n; seasonSum[`${side}.${c}.s`] = nv.s; } }
          check(`${season} ${t.teamName} ${kind} Time to Shot の合計＝シーズン全体`, JSON.stringify(Object.entries(ttsSum).sort()) === JSON.stringify(Object.entries(seasonSum).sort()));
        }
      }
    }
  }
  console.log(`オンザコート別: ${ocChecks}チームシーズンの人数別の秒数を teams.json と突き合わせた`);
  // md に入っている（宇都宮 2025-26・3ターム）
  {
    const t0 = sd('2025-26').teams.find(x => x.teamName.includes('宇都宮'))!;
    const md = buildDetailedExport(inputFor('2025-26', t0.teamId, 'team', { term: 'threeTerms' })).markdown;
    for (const h of ['### オンザコート別', '### Time to Shot', '### Streaks', '#### 第1ターム（', '|第1ターム|第1ターム リーグ平均|']) check(`3ターム見本に「${h}」がある`, md.includes(h));
    const oneTerm = buildDetailedExport(inputFor('2025-26', t0.teamId, 'team', { term: 'season' })).markdown;
    const cell = (m: string, label: string, col: number) => cells(m.split('\n').find(l => l.startsWith(`|${label}|`))!)[col];
    check('3ターム表の「シーズン全体」列＝1シーズンの表の値（順位つき）', cell(md, 'PTS（得点）', 7) === cell(oneTerm, 'PTS（得点）', 1) && cell(md, 'eFG%', 7) === cell(oneTerm, 'eFG%', 1), `${cell(md, 'PTS（得点）', 7)} vs ${cell(oneTerm, 'PTS（得点）', 1)}`);
  }

  // 6-4. Streaks：タームの境目で切れた連続の書き方
  {
    let n = 0, bad = 0;
    for (const season of seasons) for (const t of sd(season).teams) {
      const ds = seasonOf(season, t.teamId);
      const terms = detailedTerms(ds, 'threeTerms', 'all', t.teamId, history);
      const all = detailedTerms(ds, 'season', 'all', t.teamId, history)[0]!.games;
      const md = buildDetailedExport(inputFor(season, t.teamId, 'team', { term: 'threeTerms' })).markdown;
      const rows = md.split('\n').filter(l => /^\|第[123]ターム\|.*\|(.*)\|$/.test(l) && l.split('|').length === 9 && /連勝|連敗|なし|-/.test(l.split('|')[7] ?? ''));
      terms.forEach((x, k) => {
        const row = rows.find(r => r.startsWith(`|${x.label}|`)); if (!row || !x.games.length) return;
        const text = cells(row)[6]!;
        const first = x.games[0]!, last = x.games.at(-1)!;
        const before = all[all.findIndex(g => g.scheduleKey === first.scheduleKey) - 1], after = all[all.findIndex(g => g.scheduleKey === last.scheduleKey) + 1];
        n++;
        if (text.includes('前のタームから続く') !== !!(before && before.win === first.win) || text.includes('次のタームへ続く') !== !!(after && after.win === last.win)) bad++;
      });
    }
    console.log(`Streaks の境目の書き方: ${n}タームを確認`);
    check('「境目で切れた連続」が、境目の前後の試合の勝敗と合っている', bad === 0, `${bad}件`);
  }

  // 6-5. リーグ順位・リーグ平均（1シーズン・対戦相手なし）：チームスタッツ（teams.json）の値から独立に順位を出して比べる
  {
    const LOWER_OWN = new Set(['TOV', 'F', 'BSR', 'TOV%', 'DRtg']);
    let cellsChecked = 0, bad = 0; const badEx: string[] = [];
    let avgChecked = 0, avgBad = 0;
    const rankFrom = (vals: Map<string, number>, lowerBetter: boolean, teamId: string): number => {
      const arr = [...vals].sort((a, b) => (lowerBetter ? a[1] - b[1] : b[1] - a[1]));
      const texts = arr.map(([, v]) => v.toFixed(2));
      let r = 0; arr.forEach(([id], k) => { if (id === teamId) r = k > 0 && texts[k] === texts[k - 1] ? -1 : k + 1; });
      if (r === -1) { const k = arr.findIndex(([id]) => id === teamId); let j = k; while (j > 0 && texts[j - 1] === texts[k]) j--; r = j + 1; }
      return r;
    };
    for (const season of seasons) {
      const teams = sd(season).teams;
      const own = new Map(teams.map(t => [t.teamId, teamsJsonValues(t)])), opp = new Map(teams.map(t => [t.teamId, oppJsonValues(t)]));
      for (const t of teams) {
        const md = buildDetailedExport(inputFor(season, t.teamId, 'team')).markdown;
        const tab = new Map<string, string>();
        for (const label of TEAM_LABELS) for (const [k, v] of mdTable(md, new RegExp(`^### ${label}$`))) tab.set(k, v[0]!);
        for (const [persp, src] of [['', own], ['opp ', opp]] as const) {
          for (const label of new Set(teams.flatMap(x => [...src.get(x.teamId)!.keys()]))) {
            if (label === 'EFF') continue;
            const text = tab.get(`${persp}${label}`); if (!text) continue;
            if (['PACE', 'POSS', 'MIN', 'G'].includes(label)) { cellsChecked++; if (/（\d+位）$/.test(text)) { bad++; if (badEx.length < 6) badEx.push(`${season} ${t.teamName} ${persp}${label}: 順位を付けない項目に順位がある ${text}`); } continue; }
            const m = /（(\d+)位）$/.exec(text);
            const vals = new Map(teams.filter(x => src.get(x.teamId)!.has(label)).map(x => [x.teamId, src.get(x.teamId)!.get(label)!] as const));
            if (!m) { bad++; if (badEx.length < 6) badEx.push(`${season} ${t.teamName} ${persp}${label}: 順位なし ${text}`); continue; }
            const lower = persp === '' ? LOWER_OWN.has(label) : !LOWER_OWN.has(label) ? true : false;
            cellsChecked++;
            const want = rankFrom(vals, lower, t.teamId);
            if (Number(m[1]) !== want) { bad++; if (badEx.length < 6) badEx.push(`${season} ${t.teamName} ${persp}${label}: md=${m[1]}位 / 独立=${want}位（${text}）`); }
          }
        }
        // リーグ平均（PTS）＝全チームの得点の合計÷全チームの試合数
        const g = teams.reduce((a, x) => a + x.gamesPlayed, 0), pts = teams.reduce((a, x) => a + x.totals.pts, 0);
        const avg = cells(md.split('\n').find(l => l.startsWith('|PTS（得点）|'))!)[2];
        avgChecked++; if (avg !== (pts / g).toFixed(2)) { avgBad++; if (badEx.length < 6) badEx.push(`${season} リーグ平均 PTS: md=${avg} / 合計から=${(pts / g).toFixed(2)}`); }
      }
    }
    console.log(`リーグ順位: ${cellsChecked}セルを teams.json から独立に出した順位と比べた（食い違い${bad}）・リーグ平均 ${avgChecked}件（食い違い${avgBad}）`);
    for (const e of badEx) console.log(`   ${e}`);
    check('1シーズンのリーグ順位がチームのスタッツ（teams.json）から出した順位と同じ（向き・同率の飛ばし方を含む）', bad === 0, `${bad}件`);
    check('リーグ平均（PTS）＝全チームの合計÷全試合数', avgBad === 0, `${avgBad}件`);
  }

  // 6-6. 選手のプロフィール：個人詳細の表示と同じ（ポジション・身長・体重・年齢・登録区分）。移籍した選手はどのチームの行でも同じ
  {
    let n = 0, bad = 0; const badEx: string[] = [];
    const seen = new Map<string, string>();
    let transferChecks = 0, transferBad = 0;
    for (const season of seasons) {
      const list = read<PlayerSummary[]>(`${season}/players`);
      const regs = season >= '2026-27' ? read<SeasonRegistrationFile>(`${season}/registrations`) : null;
      for (const t of sd(season).teams) {
        const input = inputFor(season, t.teamId, 'player');
        const md = buildDetailedExport(input).markdown;
        const tbl = mdTable(md, /^### 選手のプロフィール$/);
        check(`${season} ${t.teamName} 選手のプロフィールの表がある・基準日が書いてある`, tbl.size > 0 && /年齢は \*\*\d{4}\/\d{2}\/\d{2}時点\*\*/.test(md), '');
        for (const { player } of input.players) {
          const row = tbl.get(normalizePlayerName(player.name)); if (!row) continue;
          const p = list.find(x => x.playerId === player.playerId)!;
          const want = [positionText(p) ?? '-', heightText(p) ?? '-', weightText(p) ?? '-', p.birthDate ? `${ageForSeason(p.birthDate, season)}歳` : '-', registrationLabel(season, p.classification, regs?.players[p.playerId])];
          n++;
          if (row.join('|') !== want.join('|')) { bad++; if (badEx.length < 5) badEx.push(`${season} ${t.teamName} ${player.name}: md=${row.join('|')} / 個人詳細=${want.join('|')}`); }
          const k = `${season}|${player.playerId}`;
          if (seen.has(k)) { transferChecks++; if (seen.get(k) !== row.join('|')) transferBad++; } else seen.set(k, row.join('|'));
        }
      }
    }
    console.log(`プロフィール: ${n}行を個人詳細の表示（同じ関数）と比べた（食い違い${bad}）・移籍した選手の別チームの行 ${transferChecks}件（食い違い${transferBad}）`);
    for (const e of badEx) console.log(`   ${e}`);
    check('選手のプロフィールが個人詳細の表示と同じ', bad === 0, `${bad}件`);
    check('移籍した選手は、どのチームの行にも同じプロフィール', transferBad === 0, `${transferBad}件`);
    // 年齢の基準日：個人詳細・図解と同じ関数（終わったシーズンは6月30日、進行中は今日）
    check('年齢の基準日が終わったシーズンは翌年6月30日', ageBaseDate('2024-25').year === 2025 && ageBaseDate('2024-25').month === 6 && ageBaseDate('2024-25').day === 30);
    // 値が無い選手は「-」・移籍した選手の区分の変更の書き方
    const noBirth = buildDetailedExport({ ...inputFor('2025-26', sd('2025-26').teams[0]!.teamId, 'player'), players: [{ player: { ...read<PlayerSummary[]>('2025-26/players')[0]!, birthDate: undefined, heightCm: 0, weightKg: undefined, position: undefined } as PlayerSummary, logs: inputFor('2025-26', sd('2025-26').teams[0]!.teamId, 'player').players[0]!.logs }] }).markdown;
    check('人工: 生年月日・身長・体重・ポジションが無い選手は「-」', /\|-\|-\|-\|-\|/.test(noBirth), '');
  }
}

const tovTotal = (d: { offensiveFoul: number; violation24sec: number; backcourtViolation: number; violation5sec: number; violation8sec: number; otherDead: number; live: number }) => d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live;
const stripRank = (v: string | undefined) => (v ?? '').replace(/（\d+位）$/, '');
const rankOf = (v: string | undefined) => { const m = /（(\d+)位）$/.exec(v ?? ''); return m ? Number(m[1]) : undefined; };
// ---- 7. 段階3：Shooting・Forced TOV（スポーツナビの記録）・B.ONE ----
{
  const ys = seasons.filter(s => sd(s).teams.some(t => !!t.shotTypes));
  const PERS: [TeamPerspective, string][] = [['own', ''], ['opp', 'opp '], ['diff', '差 ']];
  const ownTeam = (season: string) => sd(season).teams;
  type LeagueAvg = { team: TeamSummary };
  const bad: string[] = [];
  const miss = (m: string) => { if (bad.length < 12) bad.push(m); };
  let cellsS = 0, ranksS = 0, avgS = 0, cellsF = 0, ranksF = 0, avgF = 0, recChecks = 0, denomChecks = 0;

  // 7-1. 1シーズン・全チーム：値・順位・リーグ平均・記録がある試合の数を teams.json（全チームスタッツの Shooting・Forced TOV の元）と突き合わせる
  for (const season of ys) {
    const d = sd(season);
    const lgAvg = read<LeagueAvg>(`${season}/league-average`).team;
    for (const t of d.teams) denomChecks += (t.shotTypeGames === t.gamesPlayed && t.forcedTurnovers?.gamesWithData === t.gamesPlayed ? 1 : (miss(`${season} ${t.teamName}: 記録のある試合数と出場試合数が違う（平均の分母の食い違いが起きうる）`), 0));
    const keys = sortShotTypeKeys([...new Set(d.teams.flatMap(t => [...Object.keys(t.shotTypes ?? {}), ...Object.keys(t.opponentShotTypes ?? {})]))]);
    const games = (t: TeamSummary) => t.shotTypeGames ?? 0;
    // 画面（全チームスタッツ）の列：視点ごとの { ラベル → { text(t), sort(t) } }
    const shotCols = (p: TeamPerspective) => (p === 'diff' ? shotTypeDiffColumns<TeamSummary>(keys, t => t.shotTypes, t => t.opponentShotTypes, 'perGame', games) : shotTypeEntityColumns<TeamSummary>(keys, t => (p === 'opp' ? t.opponentShotTypes : t.shotTypes), 'perGame', games));
    const tovCols = (p: TeamPerspective, t: TeamSummary) => forcedTurnoverColumns(new Map([[t.teamId, { forced: t.forcedTurnovers!, committed: t.turnoversCommitted! }]]), 'perGame', p).filter(c => c.key !== 'gamesWithData');
    // 順位（teams.json から出す。向き：自チーム・差は多い順、opp は少ない順。同じ表示は同じ順位）
    const ranksFor = (texts: Map<string, string>, vals: Map<string, number>, desc: boolean) => {
      const es = [...texts].filter(([, tx]) => tx !== '-').map(([id, tx]) => ({ id, tx, v: vals.get(id)! })).sort((a, b) => (desc ? b.v - a.v : a.v - b.v));
      const pos = rankPositions(es.map(e => e.tx));
      return new Map(es.map((e, k) => [e.id, pos[k]!]));
    };
    const expShot = new Map<string, { texts: Map<string, string>; ranks: Map<string, number>; avg: string }>();
    for (const [p, pre] of PERS) {
      const cols = shotCols(p);
      cols.forEach((c, k) => {
        const texts = new Map(d.teams.map(t => [t.teamId, c.format!(t)] as const));
        const vals = new Map(d.teams.map(t => [t.teamId, Number(c.sortValue(t))] as const));
        expShot.set(pre + c.label, { texts, ranks: ranksFor(texts, vals, p !== 'opp'), avg: shotCols(p)[k]!.format!(lgAvg) });
      });
    }
    const expTov = new Map<string, { texts: Map<string, string>; ranks: Map<string, number>; avg: string }>();
    const tovWith = d.teams.filter(t => t.forcedTurnovers && t.turnoversCommitted);
    for (const [p, pre] of PERS) {
      const labels = tovCols(p, tovWith[0]!).map(c => c.label);
      labels.forEach((label, k) => {
        const texts = new Map(tovWith.map(t => { const c = tovCols(p, t)[k]!; return [t.teamId, c.format!({ key: t.teamId } as never)] as const; }));
        const vals = new Map(tovWith.map(t => { const c = tovCols(p, t)[k]!; return [t.teamId, Number(c.sortValue({ key: t.teamId } as never))] as const; }));
        const c = tovCols(p, lgAvg)[k]!;
        expTov.set(pre + label, { texts, ranks: ranksFor(texts, vals, p !== 'opp'), avg: c.format!({ key: lgAvg.teamId } as never) });
      });
    }
    for (const t of d.teams) {
      const md = buildDetailedExport(inputFor(season, t.teamId, 'team')).markdown;
      const sh = mdTable(md, /^### Shooting$/), tv = mdTable(md, /^### Forced TOV$/);
      recChecks++;
      if (sh.get('記録がある試合／スタッツの対象試合')?.[0] !== `${t.shotTypeGames}／${t.gamesPlayed}`) miss(`${season} ${t.teamName}: Shooting の記録がある試合 ${sh.get('記録がある試合／スタッツの対象試合')?.[0]}`);
      if (tv.get('データあり試合数')?.[0] !== String(t.forcedTurnovers!.gamesWithData)) miss(`${season} ${t.teamName}: Forced TOV のデータあり試合数 ${tv.get('データあり試合数')?.[0]}`);
      for (const [label, e] of expShot) {
        const row = sh.get(label);
        const want = e.texts.get(t.teamId)!;
        cellsS++;
        if (!row) { if (want !== '-' || e.avg !== '-') miss(`${season} ${t.teamName} Shooting「${label}」の行が無い（期待 ${want}）`); continue; }
        if (stripRank(row[0]) !== want) miss(`${season} ${t.teamName} Shooting「${label}」md=${row[0]} 期待=${want}`);
        ranksS++;
        if (want !== '-' && rankOf(row[0]) !== e.ranks.get(t.teamId)) miss(`${season} ${t.teamName} Shooting「${label}」順位 md=${rankOf(row[0])} 期待=${e.ranks.get(t.teamId)}`);
        if (want === '-' && rankOf(row[0]) !== undefined) miss(`${season} ${t.teamName} Shooting「${label}」値が無いのに順位`);
        avgS++;
        if (row[1] !== e.avg) miss(`${season} ${t.teamName} Shooting「${label}」リーグ平均 md=${row[1]} 期待=${e.avg}`);
      }
      for (const [label, e] of expTov) {
        const row = tv.get(label);
        const want = e.texts.get(t.teamId)!;
        cellsF++;
        if (!row) { miss(`${season} ${t.teamName} Forced TOV「${label}」の行が無い`); continue; }
        if (stripRank(row[0]) !== want) miss(`${season} ${t.teamName} Forced TOV「${label}」md=${row[0]} 期待=${want}`);
        ranksF++;
        if (rankOf(row[0]) !== e.ranks.get(t.teamId)) miss(`${season} ${t.teamName} Forced TOV「${label}」順位 md=${rankOf(row[0])} 期待=${e.ranks.get(t.teamId)}`);
        avgF++;
        if (row[1] !== e.avg) miss(`${season} ${t.teamName} Forced TOV「${label}」リーグ平均 md=${row[1]} 期待=${e.avg}`);
      }
    }
  }
  console.log(`Shooting: ${cellsS}セル（順位${ranksS}・リーグ平均${avgS}）・Forced TOV: ${cellsF}セル（順位${ranksF}・リーグ平均${avgF}）を teams.json・league-average.json から独立に出した値と比べた・記録がある試合の数 ${recChecks}チーム`);
  for (const b of bad) console.log(`   ${b}`);
  check('Shooting・Forced TOV の1シーズンの値・順位・リーグ平均が全チームスタッツ（teams.json）と同じ', bad.length === 0, `${bad.length}件`);
  check('記録のある試合数＝出場試合数（今のデータでは記録の無い試合が無い）', denomChecks > 0);

  // 7-2. 1シーズン・全チームの teams.json の値を使う経路（読み込みを省く）と、記録から数える経路が同じ書き出しになる
  let sameN = 0, diffEx = '';
  for (const season of ys) for (const t of sd(season).teams) {
    const a = buildDetailedExport(inputFor(season, t.teamId, 'team')).markdown;
    const b = buildDetailedExport(inputFor(season, t.teamId, 'team', { pbps: undefined })).markdown;
    sameN++;
    if (a !== b && !diffEx) diffEx = `${season} ${t.teamName}`;
  }
  check(`teams.json の値の経路と記録から数える経路が同じ書き出し（${sameN}チームシーズン）`, !diffEx, diffEx);
  // 試合全体の Forced TOV は試合ログの値なので、条件を付けても記録なしで作れ、記録を読んだときと同じ内容（DESIGN.md 333章）
  let thrown = false;
  {
    const tid0 = sd('2025-26').teams[0]!.teamId;
    const withPbp = buildDetailedExport(inputFor('2025-26', tid0, 'team', { term: 'recent5' })).markdown;
    const without = buildDetailedExport(inputFor('2025-26', tid0, 'team', { term: 'recent5', pbps: undefined })).markdown;
    check('直近5試合のチーム情報は、記録を読まなくても同じ内容で作れる', withPbp === without);
    // 古いデータ（記録はあるのに試合ごとの Forced TOV が無い）は作らない（0件で補わない）
    const base = inputFor('2025-26', tid0, 'team', { term: 'recent5', pbps: undefined });
    const old = (g: TeamGameLog): TeamGameLog => ({ ...g, forcedTurnovers: undefined, turnoversCommitted: undefined });
    try { buildDetailedExport({ ...base, cur: { ...base.cur, regular: base.cur.regular.map(old) } }); } catch { thrown = true; }
    check('試合ごとの Forced TOV が無い古いデータでは作らない', thrown);
  }
  thrown = false;
  try { buildDetailedExport(inputFor('2025-26', sd('2025-26').teams[0]!.teamId, 'player', { pbps: undefined })); } catch { thrown = true; }
  check('選手の Shooting で記録が読まれていないときは作らない', thrown);

  // 7-3. ターム・絞り込み：記録がある試合の中で正しく数える。ターム合計＝シーズン全体。スポーツナビの記録（生）から数え直した値と一致
  let termCells = 0;
  const rawTotals = (keys: string[], pbps: Map<string, YahooGamePbp>, teamId: string) => {
    let m2 = 0, a2 = 0, m3 = 0, a3 = 0, forced = 0, committed = 0, games = 0;
    for (const k of keys) {
      const p = pbps.get(k); if (!p) continue;
      games++;
      for (const s of p.shots) if (s.teamId === teamId) { if (s.shotValue === 3) { a3++; if (s.made) m3++; } else { a2++; if (s.made) m2++; } }
      for (const to of p.turnovers) { if (to.teamId === teamId) committed++; else forced++; }
    }
    return { m2, a2, m3, a3, forced, committed, games };
  };
  const pairTotals = (pair: ReturnType<typeof sumShotPair>) => {
    let m2 = 0, a2 = 0, m3 = 0, a3 = 0;
    for (const sp of Object.values(pair.own)) { m2 += sp.twoPoint.made; a2 += sp.twoPoint.attempted; m3 += sp.threePoint.made; a3 += sp.threePoint.attempted; }
    return { m2, a2, m3, a3 };
  };
  const tovTotal = (d: { offensiveFoul: number; violation24sec: number; backcourtViolation: number; violation5sec: number; violation8sec: number; otherDead: number; live: number }) => d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live;
  for (const season of ys) {
    const pbps = pbpsOfSeason(season);
    for (const t of sd(season).teams) {
      const ds = seasonOf(season, t.teamId);
      const season1 = detailedTerms(ds, 'season', 'all', t.teamId, history)[0]!;
      for (const [kind, opp] of [['season', 'atLeast60'], ['recent5', 'all'], ['recent5', 'atLeast60'], ['halves', 'all'], ['halves', 'atLeast60'], ['threeTerms', 'all']] as const) {
        const br = kind === 'threeTerms' ? threeTermBreaks(season, 'premier', ds.summaries, ds.schedule) : null;
        if (br && !br.ok) continue;
        const terms = detailedTerms(ds, kind, opp, t.teamId, history);
        let sumGames = 0, sumRec = 0, sumShot = { m2: 0, a2: 0, m3: 0, a3: 0 }, sumForced = 0, sumCommitted = 0;
        for (const term of terms) {
          const pair = sumShotPair(term.statLogs), tov = sumTovPair(term.statLogs);
          const raw = rawTotals(term.statLogs.map(g => g.scheduleKey), pbps, t.teamId);
          const tt = pairTotals(pair);
          termCells++;
          if (JSON.stringify(tt) !== JSON.stringify({ m2: raw.m2, a2: raw.a2, m3: raw.m3, a3: raw.a3 }) || pair.games !== raw.games || tov.forced.gamesWithData !== raw.games || tovTotal(tov.forced) !== raw.forced || tovTotal(tov.committed) !== raw.committed) miss(`${season} ${t.teamName} ${kind}・${opp} ${term.label}: 記録の生の数え直しと違う`);
          sumGames += term.statLogs.length; sumRec += pair.games; sumShot = { m2: sumShot.m2 + tt.m2, a2: sumShot.a2 + tt.a2, m3: sumShot.m3 + tt.m3, a3: sumShot.a3 + tt.a3 }; sumForced += tovTotal(tov.forced); sumCommitted += tovTotal(tov.committed);
        }
        if (kind === 'halves' || kind === 'threeTerms') {
          const all = opp === 'all' ? season1 : detailedTerms(ds, 'season', opp, t.teamId, history)[0]!;
          const pair = sumShotPair(all.statLogs), tov = sumTovPair(all.statLogs);
          const tt = pairTotals(pair);
          if (sumGames !== all.statLogs.length || sumRec !== pair.games || JSON.stringify(sumShot) !== JSON.stringify(tt) || sumForced !== tovTotal(tov.forced) || sumCommitted !== tovTotal(tov.committed)) miss(`${season} ${t.teamName} ${kind}・${opp}: ターム合計≠シーズン全体`);
        }
      }
    }
  }
  console.log(`ターム・絞り込み: ${termCells}ターム（勝率6割以上・直近5試合・前半戦後半戦・3ターム）でスポーツナビの生の記録と数え直して比べた`);
  check('ターム・絞り込みでも Shooting・Forced TOV が記録がある試合の中で正しく数えられ、ターム合計＝シーズン全体', bad.length === 0, bad.slice(0, 5).join(' / '));

  // 7-4. 人工データ：記録が無い試合を 0 として扱わない（分母から外し、記録のある試合の数を書く）
  {
    const season = '2025-26', teamId = sd(season).teams.find(t => t.teamName.includes('宇都宮'))!.teamId;
    const base = inputFor(season, teamId, 'team');
    const drop = new Set(base.cur.regular.slice(5, 8).map(g => g.scheduleKey));
    const strip = (g: TeamGameLog): TeamGameLog =>
      drop.has(g.scheduleKey) ? { ...g, shotTypes: undefined, opponentShotTypes: undefined, forcedTurnovers: undefined, turnoversCommitted: undefined } : g;
    const reg = base.cur.regular.map(strip);
    const pbps = new Map([...pbpsOfSeason(season)].filter(([k]) => !drop.has(k)));
    const inp: DetailedInput = { ...base, cur: { ...base.cur, regular: reg }, leagueLogs: new Map([...base.leagueLogs!, [teamId, reg]]), pbps };
    const md = buildDetailedExport(inp).markdown;
    const sh = mdTable(md, /^### Shooting$/), tv = mdTable(md, /^### Forced TOV$/);
    check('人工: 記録が3試合無い → Shooting の記録がある試合 57／60', sh.get('記録がある試合／スタッツの対象試合')?.[0] === '57／60');
    check('人工: 記録が3試合無い → Forced TOV のデータあり試合数 57', tv.get('データあり試合数')?.[0] === '57');
    const pair = sumShotPair(reg);
    const key = Object.keys(pair.own).sort((a, b) => (pair.own[b]!.twoPoint.attempted) - (pair.own[a]!.twoPoint.attempted))[0]!;
    const att = pair.own[key]!.twoPoint.attempted;
    const lab = `${shotTypeEntityColumns<ShotPair>([key], r => r.own, 'perGame', r => r.games)[1]!.label}`;
    check('人工: 平均の分母は記録がある57試合（60試合で割らない）', stripRank(sh.get(lab)?.[0]) === (att / 57).toFixed(2) && (att / 57).toFixed(2) !== (att / 60).toFixed(2), `${lab}: ${sh.get(lab)?.[0]} / 期待 ${(att / 57).toFixed(2)}`);
    const tvPair = sumTovPair(reg);
    check('人工: Forced TOV の合計も57試合の平均', stripRank(tv.get('合計')?.[0]) === (tovTotal(tvPair.forced) / 57).toFixed(2), `${tv.get('合計')?.[0]} / 期待 ${(tovTotal(tvPair.forced) / 57).toFixed(2)}`);
    check('人工: 記録が無い試合があるときの注記がある', /記録が無い試合があるため、その試合は Shooting・Forced TOV の平均・成功率に入れていない/.test(md));
    check('人工: NaN 等が無い', !NOT_NUM.test(md));
    // 選手
    const pin = inputFor(season, teamId, 'player');
    const pmd = buildDetailedExport({ ...pin, cur: { ...pin.cur, regular: reg }, pbps }).markdown;
    const ps = mdTable(pmd, /^### Shooting$/);
    const rowsNo = [...ps].filter(([k]) => k !== '選手' && k !== '---');
    check('人工: 選手の「記録のある試合／出場」が記録の無い試合を除く', rowsNo.some(([, v]) => /^(\d+)／(\d+)$/.test(v[0]!) && Number(v[0]!.split('／')[0]) < Number(v[0]!.split('／')[1])) && rowsNo.every(([, v]) => Number(v[0]!.split('／')[0]) <= Number(v[0]!.split('／')[1])));
    // 全部の試合に記録が無いチーム（空の表にならず、0 ではなく「-」）
    const none = new Map<string, TeamGameLog[]>([...base.leagueLogs!].map(([k, v]) => [k, v.map(g => ({ ...g, shotTypes: undefined, opponentShotTypes: undefined }))]));
    const noneMd = buildDetailedExport({ ...base, cur: { ...base.cur, regular: none.get(teamId)! }, leagueLogs: none, pbps: new Map() }).markdown;
    const nsh = mdTable(noneMd, /^### Shooting$/);
    check('人工: 記録が1試合も無いとき、値は「-」で順位を付けず、記録がある試合は 0／60', nsh.get('記録がある試合／スタッツの対象試合')?.[0] === '0／60' && ![...nsh].some(([k, v]) => k !== '記録がある試合／スタッツの対象試合' && k !== '項目' && v[0] !== '-' ) && !NOT_NUM.test(noneMd));
  }

  // 7-5. 選手の Shooting：選手スタッツ（players.json）と同じ値。移籍した選手はチームごとの合計が players.json と同じ
  {
    let rowsChecked = 0, transferChecked = 0, singleBreakdown = 0;
    for (const season of ys) {
      const list = read<PlayerSummary[]>(`${season}/players`);
      const view = viewPlayerGameIndex(read<PlayerGameIndexFile>(`${season}/player-game-index`));
      const pbps = pbpsOfSeason(season);
      const byPlayerTeam = new Map<string, Map<string, Set<string>>>();
      for (let i = 0; i < view.size; i++) {
        const g = playerGameAt(view, i);
        if (g.gameType !== 'regular') continue;
        const m = byPlayerTeam.get(g.playerId) ?? new Map<string, Set<string>>(); byPlayerTeam.set(g.playerId, m);
        const ks = m.get(g.teamId) ?? new Set<string>(); ks.add(g.scheduleKey); m.set(g.teamId, ks);
      }
      const norm = (b: unknown) => JSON.stringify(Object.entries((b ?? {}) as Record<string, { twoPoint: { made: number; attempted: number }; threePoint: { made: number; attempted: number } }>).filter(([, v]) => v.twoPoint.attempted + v.threePoint.attempted > 0).sort(([a], [b2]) => a.localeCompare(b2)));
      for (const p of list) {
        const teamsOf = byPlayerTeam.get(p.playerId); if (!teamsOf) continue;
        // チームごとの合計を足すと players.json の shotTypes と同じ
        const sum: Record<string, { twoPoint: { made: number; attempted: number }; threePoint: { made: number; attempted: number } }> = {};
        const plogs = read<PlayerGameLog[]>(`${season}/player-games/${p.playerId}`);
        for (const [tid, ks] of teamsOf) {
          const home = new Map(sd(season).logs.get(tid)!.filter(g => g.gameType === 'regular').map(g => [g.scheduleKey, g.isHome] as const));
          const zero = plogs.filter(g => g.gameType === 'regular' && g.min <= 0 && home.get(g.scheduleKey) === g.isHome).map(g => g.scheduleKey);
          const ps = playerShots(p.playerId, ks, pbps, zero);
          for (const [k, v] of Object.entries(ps.breakdown)) { const c = sum[k] ?? { twoPoint: { made: 0, attempted: 0 }, threePoint: { made: 0, attempted: 0 } }; c.twoPoint.made += v.twoPoint.made; c.twoPoint.attempted += v.twoPoint.attempted; c.threePoint.made += v.threePoint.made; c.threePoint.attempted += v.threePoint.attempted; sum[k] = c; }
        }
        transferChecked++;
        if (norm(sum) !== norm(p.shotTypes)) miss(`${season} ${p.name}: チーム別の合計が players.json の shotTypes と違う`);
        if (teamsOf.size === 1) singleBreakdown++;
      }
      // md の表の値＝選手スタッツの Shooting の列の式（players.json の値）
      for (const t of sd(season).teams) {
        const input = inputFor(season, t.teamId, 'player');
        const md = buildDetailedExport(input).markdown;
        const tbl = mdTable(md, /^### Shooting$/);
        const head = tbl.get('選手') ?? [];
        for (const { player, logs } of input.players) {
          if ((byPlayerTeam.get(player.playerId)?.size ?? 0) !== 1) continue;
          const row = tbl.get(normalizePlayerName(player.name)); if (!row) continue;
          const p = list.find(x => x.playerId === player.playerId)!;
          const cols = shotTypeEntityColumns<PlayerSummary>(sortShotTypeKeys(Object.keys(p.shotTypes ?? {})), x => x.shotTypes, 'perGame', () => logs.length);
          rowsChecked++;
          if (row[0] !== `${logs.length}／${logs.length}`) miss(`${season} ${t.teamName} ${player.name}: 記録のある試合／出場=${row[0]}`);
          for (const c of cols) {
            const k = head.indexOf(c.label); const want = c.format!(p);
            if (k < 0) { if (want !== '-') miss(`${season} ${t.teamName} ${player.name} 「${c.label}」の列が無い`); continue; }
            if (row[k] !== want) miss(`${season} ${t.teamName} ${player.name} 「${c.label}」md=${row[k]} 画面=${want}`);
          }
        }
      }
    }
    console.log(`選手の Shooting: ${rowsChecked}行（1チームだけの選手）を選手スタッツ（players.json）の列の式と比べた・移籍の有無にかかわらず ${transferChecked}選手のチーム別の合計＝players.json（うち1チームだけ ${singleBreakdown}）`);
    check('選手の Shooting が選手スタッツ（players.json）と同じ・チーム別の合計も同じ', bad.length === 0, bad.slice(0, 5).join(' / '));
  }

  // 7-6. 記録が無いシーズン（2022-23以前）は表を出さず理由を書く
  {
    const noYahoo = seasons.filter(s => !ys.includes(s));
    let n = 0;
    for (const season of noYahoo) for (const kind of ['team', 'player'] as const) {
      const t = sd(season).teams[0]!;
      const md = buildDetailedExport(inputFor(season, t.teamId, kind)).markdown;
      n++;
      check(`${season} ${kind}: Shooting・Forced TOV の表が無く、理由が書いてある`, !/^### (Shooting|Forced TOV)/m.test(md) && /この版で出せなかった表/.test(md) && /スポーツナビの記録は2023-24以降/.test(md));
    }
    console.log(`記録が無いシーズン: ${n}通りで、表を出さず理由を書いた`);
  }
}

// ---- 8. 段階3：B.ONE ----
{
  const oneRead = <T>(season: string, name: string): T => read<T>(`${season}/one/${name}`);
  const calls: string[] = [];
  const note = (fn: string, league: unknown) => { calls.push(`${fn}:${String(league)}`); };
  const oneSeasons = ['2025-26', '2026-27'];
  const oneSrc = (): AiDetailedSource => ({
    fetchSeasons: async () => seasons.map(season => ({ season })) as never,
    fetchTeams: async (s: string, l: unknown) => { note('teams', l); return oneRead<TeamSummary[]>(s, 'teams'); },
    fetchSchedule: async (s: string, l: unknown) => { note('schedule', l); return oneRead<ScheduleFileExtended>(s, 'schedule'); },
    fetchGameSummaries: async (s: string, l: unknown) => { note('summaries', l); return oneRead<GameSummary[]>(s, 'games-summary'); },
    fetchTeamGameLogs: async (s: string, id: string, l: unknown) => { note('teamGames', l); return oneRead<TeamGameLog[]>(s, `team-games/${id}`); },
    fetchTeamHistory: async () => history, fetchDivisionHistory: async () => division as never,
    fetchPlayers: async (s: string, l: unknown) => { note('players', l); return oneRead<PlayerSummary[]>(s, 'players'); },
    fetchPlayerGameIndex: async (s: string, l: unknown) => { note('playerIndex', l); return oneRead<PlayerGameIndexFile>(s, 'player-game-index'); },
    fetchPlayerGameLogs: async (s: string, id: string, l: unknown) => { note('playerGames', l); return oneRead<PlayerGameLog[]>(s, `player-games/${id}`); },
    fetchYahooGamePbp: async (_s: string, _k: string, l: unknown) => { note('yahoo', l); return null; },
    fetchSeasonRules: async () => seasonRules,
    loadTeamPeriodSource: async (s: string, l: unknown) => { note('period', l); return loadTeamPeriodSource(s, l as never); },
    loadTtsSource: async (s: string, l: unknown) => { note('tts', l); return loadTtsSource(s, l as never); },
    loadSeasonRegistrations: async (s: string, l: unknown) => { note('registrations', l); return existsSync(`data/${s}/one/registrations.json.gz`) ? oneRead<SeasonRegistrationFile>(s, 'registrations') : null; },
  } as AiDetailedSource);
  const now = () => new Date('2026-11-03T10:00:00');
  let built = 0;
  for (const season of oneSeasons) {
    const teams = oneRead<TeamSummary[]>(season, 'teams');
    for (const t of teams) {
      for (const [kind, term, opp] of [['team', 'season', 'all'], ['team', 'recent5', 'atLeast60'], ['team', 'halves', 'all'], ['player', 'season', 'all'], ['player', 'halves', 'atLeast60']] as const) {
        if (season === '2025-26' && t !== teams[0] && kind === 'player') continue;
        calls.length = 0;
        const input = await loadDetailedExport(season, t.teamId, { league: 'one', kind, term, opp, timeSlice: 'game', compare: kind === 'team' }, oneSrc(), now);
        const md = buildDetailedExport(input);
        built++;
        const label = `B.ONE ${season} ${t.teamName} ${kind}・${term}・${opp}`;
        if (md.empty) { check(`${label}: 条件に当てはまる試合が無いときは表を出さず理由だけ書く`, /この条件に当てはまる試合はありません/.test(md.markdown) && !NOT_NUM.test(md.markdown)); continue; }
        check(`${label}: リーグを通して読んでいる（B.PREMIER の置き場所を読まない）`, calls.length > 0 && calls.every(c => c.endsWith(':one')), calls.filter(c => !c.endsWith(':one')).join(','));
        check(`${label}: スポーツナビの記録を読みに行かない・Shooting・Forced TOV の表が無く理由がある`, !calls.some(c => c.startsWith('yahoo')) && !/^### (Shooting|Forced TOV)/m.test(md.markdown) && /B\.ONE にはスポーツナビの記録が無いため出せない/.test(md.markdown));
        check(`${label}: リーグ名・NaN 等`, new RegExp(season >= '2026-27' ? '\\|リーグ\\|B\\.ONE（' : '\\|リーグ\\|B2（').test(md.markdown) && !NOT_NUM.test(md.markdown) && !/B\.PREMIER/.test(md.markdown));
        check(`${label}: ファイル名に B.ONE`, /B\.ONE/.test(md.filename));
      }
    }
  }
  console.log(`B.ONE: ${built}通りを読み込みから書き出しまで確認（リーグを通している・記録を読みに行かない・理由つき）`);
  // 3ターム：選べない（理由を出す）
  for (const season of oneSeasons) {
    let msg = '';
    try { buildDetailedExport(await loadDetailedExport(season, oneRead<TeamSummary[]>(season, 'teams')[0]!.teamId, { league: 'one', kind: 'team', term: 'threeTerms', opp: 'all', timeSlice: 'game', compare: false }, oneSrc(), now)); } catch (e) { msg = e instanceof Error ? e.message : ''; }
    check(`B.ONE ${season}: 3タームは理由つきで選べない`, /B\.ONE は3タームを選べません/.test(msg), msg);
  }
  check('B.ONE の3ターム不可の理由を画面にも出せる（定数）', /B\.ONE/.test(ONE_THREE_TERMS_REASON) && /3ターム/.test(ONE_THREE_TERMS_REASON));
  // 値：B.ONE のチーム情報の1シーズン＝チームスタッツ（teams.json）の得点・失点・順位
  {
    let n = 0;
    for (const season of oneSeasons) {
      const teams = oneRead<TeamSummary[]>(season, 'teams');
      const gp = (t: TeamSummary) => t.gamesPlayed;
      const pts = new Map(teams.map(t => [t.teamId, (oneRead<TeamGameLog[]>(season, `team-games/${t.teamId}`).filter(g => g.gameType === 'regular').reduce((a, g) => a + g.teamScore, 0)) / gp(t)] as const));
      const texts = new Map([...pts].map(([id, v]) => [id, v.toFixed(2)] as const));
      const sorted = [...pts].filter(([id]) => teams.find(t => t.teamId === id)!.gamesPlayed > 0).sort((a, b) => b[1] - a[1]);
      const pos = rankPositions(sorted.map(([id]) => texts.get(id)!));
      const rank = new Map(sorted.map(([id], k) => [id, pos[k]!] as const));
      for (const t of teams) {
        if (t.gamesPlayed === 0) continue;
        const input = await loadDetailedExport(season, t.teamId, { league: 'one', kind: 'team', term: 'season', opp: 'all', timeSlice: 'game', compare: false }, oneSrc(), now);
        const tbl = mdTable(buildDetailedExport(input).markdown, /^## 1\. チームのまとめ$/);
        const row = tbl.get('PTS（得点）');
        n++;
        check(`B.ONE ${season} ${t.teamName}: 得点の値と順位がチームスタッツ（teams.json・試合ログ）と同じ`, !!row && stripRank(row[0]) === texts.get(t.teamId) && rankOf(row[0]) === rank.get(t.teamId), `${row?.[0]} / ${texts.get(t.teamId)}（${rank.get(t.teamId)}位）`);
      }
    }
    console.log(`B.ONE の値: ${n}チームの得点と順位を teams.json 側から出して比べた`);
  }
  // 前季（旧B2）の有無
  {
    const prevTeams = new Set(oneRead<TeamSummary[]>('2025-26', 'teams').map(t => t.teamId));
    const cur = oneRead<TeamSummary[]>('2026-27', 'teams');
    const withPrev = cur.find(t => prevTeams.has(t.teamId))!, noPrev = cur.find(t => !prevTeams.has(t.teamId))!;
    const a = buildDetailedExport(await loadDetailedExport('2026-27', withPrev.teamId, { league: 'one', kind: 'team', term: 'season', opp: 'all', timeSlice: 'game', compare: true }, oneSrc(), now)).markdown;
    const b = buildDetailedExport(await loadDetailedExport('2026-27', noPrev.teamId, { league: 'one', kind: 'team', term: 'season', opp: 'all', timeSlice: 'game', compare: true }, oneSrc(), now)).markdown;
    check('B.ONE: 前季（旧B2）にいたチームは前季全体と比べる', /前季全体（2025-26・旧B2）/.test(a));
    check('B.ONE: 前季に B.ONE の記録が無いチームは、その理由を書く', /B\.ONE の前季（旧B2）にこのチームの記録がない/.test(b) && !/前季全体（/.test(b));
  }
}

// ---- 9. 段階3：スポーツナビの記録の読み込み（必要な試合だけ・進捗・中止・失敗） ----
{
  const season = '2025-26';
  const tid = sd(season).teams.find(t => t.teamName.includes('宇都宮'))!.teamId;
  const yahooCalls: string[] = [];
  const progress: [number, number][] = [];
  const mk = (over: Partial<AiDetailedSource> = {}): AiDetailedSource => ({
    fetchSeasons: async () => seasons.map(s => ({ season: s })) as never,
    fetchTeams: async (s: string) => sd(s).teams, fetchSchedule: async (s: string) => sd(s).schedule, fetchGameSummaries: async (s: string) => sd(s).summaries,
    fetchTeamGameLogs: async (s: string, id: string) => sd(s).logs.get(id)!, fetchTeamHistory: async () => history, fetchDivisionHistory: async () => division as never,
    fetchPlayers: async (s: string) => read<PlayerSummary[]>(`${s}/players`), fetchPlayerGameIndex: async (s: string) => read<PlayerGameIndexFile>(`${s}/player-game-index`),
    fetchPlayerGameLogs: async (s: string, id: string) => read<PlayerGameLog[]>(`${s}/player-games/${id}`),
    fetchYahooGamePbp: async (s: string, k: string) => { yahooCalls.push(k); return pbpsOfSeason(s).get(k) ?? null; },
    fetchSeasonRules: async () => seasonRules, loadTeamPeriodSource: async (s: string) => periodSources.get(s) ?? null, loadTtsSource: async (s: string) => ttsSources.get(s) ?? null,
    loadSeasonRegistrations: async (s: string) => (s >= '2026-27' ? read<SeasonRegistrationFile>(`${s}/registrations`) : null), ...over,
  } as AiDetailedSource);
  const run = (kind: 'team' | 'player', term: 'season' | 'recent5' | 'halves', opp: 'all' | 'atLeast60', over: Partial<AiDetailedSource> = {}, hooks = {}) =>
    loadDetailedExport(season, tid, { kind, term, opp, timeSlice: 'game', compare: false }, mk(over), () => new Date('2026-11-03T10:00:00'), hooks);
  // チーム情報（試合全体）は、試合ログに保存した試合ごとの Forced TOV と Shooting を使うので、条件を付けてもスポーツナビの記録を読まない（DESIGN.md 333章）
  for (const [term, opp] of [['season', 'all'], ['recent5', 'all'], ['halves', 'all'], ['season', 'atLeast60']] as const) {
    yahooCalls.length = 0; progress.length = 0;
    const r = await run('team', term, opp, {}, { onProgress: (d: number, t: number) => progress.push([d, t]) });
    check(`チーム情報（${term}・${opp}・試合全体）は、スポーツナビの記録を1件も読まない`, yahooCalls.length === 0, String(yahooCalls.length));
    check(`読み込み経由と直接で同じ内容（チーム・${term}・${opp}）`, buildDetailedExport(r).markdown === buildDetailedExport(inputFor(season, tid, 'team', { term, opp, pbps: undefined, exportedAt: r.exportedAt })).markdown);
  }
  // 選手情報は選手の Shooting のために、自チームの記録がある試合だけ読む（進み具合・失敗・中止もここで確かめる）
  const own = seasonOf(season, tid).regular.filter(g => g.shotTypes).length;
  yahooCalls.length = 0; progress.length = 0;
  await run('player', 'season', 'all', {}, { onProgress: (d: number, t: number) => progress.push([d, t]) });
  check(`選手情報は自チームの記録がある試合（${own}試合）だけ読む`, yahooCalls.length === own, String(yahooCalls.length));
  check('進み具合を知らせる（0から全体まで）', progress.length === own + 1 && progress[0]![0] === 0 && progress.at(-1)![0] === own && progress.every(p => p[1] === own));
  // 失敗・中止
  let failed = false;
  try { await run('player', 'season', 'all', { fetchYahooGamePbp: async () => null }); } catch { failed = true; }
  check('記録が1件でも読めなかったら完成版を作らない（全部読めない）', failed);
  failed = false;
  const ownKey = seasonOf(season, tid).regular.filter(g => g.shotTypes)[3]!.scheduleKey;
  try { await run('player', 'season', 'all', { fetchYahooGamePbp: async (s: string, k: string) => (k === ownKey ? null : pbpsOfSeason(s).get(k) ?? null) }); } catch { failed = true; }
  check('記録が1件でも読めなかったら完成版を作らない（1件だけ読めない）', failed);
  failed = false;
  try { await run('player', 'season', 'all', { fetchYahooGamePbp: async () => { throw new Error('x'); } }); } catch { failed = true; }
  check('記録の読み込みで例外が出ても完成版を作らない', failed);
  let aborted = false;
  yahooCalls.length = 0;
  try { await run('player', 'season', 'all', {}, { signal: { aborted: true } }); } catch (e) { aborted = e instanceof LoadAborted; }
  check('中止すると、記録を読まずに止まる', aborted && yahooCalls.length === 0);
  const sig = { aborted: false };
  yahooCalls.length = 0; aborted = false;
  try { await run('player', 'season', 'all', {}, { signal: sig, onProgress: (d: number) => { if (d >= 10) sig.aborted = true; } }); } catch (e) { aborted = e instanceof LoadAborted; }
  check('読み込みの途中で中止すると、残りを読まずに止まる', aborted && yahooCalls.length < own, String(yahooCalls.length));
}

// ---- 10. 段階4：前半・後半・2ファイル ----
{
  const H1 = '前半（1Q・2Q）', H2 = '後半（3Q・4Q）';
  const bad: string[] = [];
  const miss = (m: string) => { if (bad.length < 12) bad.push(m); };
  const PRE: [TeamPerspective, string][] = [['own', ''], ['opp', 'opp '], ['diff', '差 ']];
  const parseLabel = (l: string): [TeamPerspective, string] => (l.startsWith('opp ') ? ['opp', l.slice(4)] : l.startsWith('差 ') ? ['diff', l.slice(2)] : ['own', l]);

  // 10-1. チーム：Traditional・Advanced・Misc・Scoring の前半・後半の値＝チーム詳細の Q別タブ・チームスタッツタブで前半・後半を選んだときの値
  //   （Q別タブ＝buildQuarterRows、チームスタッツ＝seasonPeriodFormatters・seasonPeriodCell。1シーズン・前半戦後半戦・3ターム・6割以上）
  let teamCells = 0, rowsBuilt = 0;
  for (const season of seasons) {
    const src = periodSources.get(season); if (!src) continue;
    const foulSplit = season >= '2026-27';
    const fms = new Map(PRE.map(([p]) => [p, seasonPeriodFormatters('perGame', p, foulSplit)] as const));
    for (const t of sd(season).teams) {
      const ds = seasonOf(season, t.teamId);
      for (const [term, opp] of [['season', 'all'], ['halves', 'all'], ['threeTerms', 'all'], ['season', 'atLeast60']] as const) {
        if (term === 'threeTerms' && !threeTermBreaks(season, 'premier', ds.summaries, ds.schedule).ok) continue;
        if (opp === 'atLeast60' && t !== sd(season).teams[0]) continue;
        const terms = detailedTerms(ds, term, opp, t.teamId, history);
        const colLogs = [...terms.map(x => x.statLogs), ...(terms.length > 1 ? [detailedTerms(ds, 'season', opp, t.teamId, history)[0]!.statLogs] : [])];
        const md = buildDetailedExport(inputFor(season, t.teamId, 'team', { term, opp, timeSlice: 'halves' })).markdown;
        rowsBuilt++;
        for (const cat of Object.keys(teamSeasonColumnLabels())) {
          for (const [slice, word] of [['h1', H1], ['h2', H2]] as const) {
            const tbl = mdTable(md, new RegExp(`^### ${cat}・${word.replace(/[（）]/g, m => `\\${m}`)}$`));
            if (!tbl.size) { if (colLogs.some(l => l.length)) miss(`${season} ${t.teamName} ${term}・${opp}: ${cat}・${word} の表が無い`); continue; }
            const qrows = colLogs.map(l => buildQuarterRows(season, src, false, l).find(q => q.value === slice)!);
            for (const [label, vals] of tbl) {
              if (label === '項目') continue;
              if (label === '対象試合（勝敗）') {
                qrows.forEach((q, k) => { teamCells++; if (vals[k] !== `${q.games.length}（${q.wins}-${q.losses}）`) miss(`${season} ${t.teamName} ${cat}・${word} 対象試合 md=${vals[k]} Q別=${q.games.length}（${q.wins}-${q.losses}）`); });
                continue;
              }
              const [p, base] = parseLabel(label);
              qrows.forEach((q, k) => {
                teamCells++;
                const want = seasonPeriodCell(fms.get(p)!, base, q, t.teamId, t.teamName);
                if (vals[k] !== want) miss(`${season} ${t.teamName} ${term}・${opp} ${cat}・${word} 「${label}」col${k} md=${vals[k]} 画面=${want}`);
              });
              if (vals.length !== qrows.length) miss(`${season} ${t.teamName} ${cat}・${word} 「${label}」: 列に順位・平均が付いている（${vals.length}列）`);
            }
          }
        }
      }
    }
  }
  console.log(`前半・後半（チーム）: ${rowsBuilt}通り・${teamCells}セルを Q別タブ・チームスタッツタブの値（buildQuarterRows・seasonPeriodCell）と比べた`);
  for (const b of bad) console.log(`   ${b}`);
  check('チームの前半・後半の値が Q別タブ・チームスタッツタブの前半・後半と同じ（順位・平均は付かない）', bad.length === 0, `${bad.length}件`);
  bad.length = 0;

  // 10-2. 前半＋後半が試合全体と合う項目（延長の無い試合で、加算できる項目の合計）。チームの索引・Shooting・Forced TOV・オンザコート別・Time to Shot
  const ADD_KEYS = ['pts', 'oppPts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'ast', 'stl', 'blk', 'tov', 'pf', 'oppFgm', 'oppFga', 'oppTpm', 'oppTpa', 'oppFtm', 'oppFta', 'oppOreb', 'oppDreb', 'oppAst', 'oppStl', 'oppBlk', 'oppTov', 'oppPf'] as const;
  let addChecks = 0, shotAdd = 0, ocAdd = 0, ttsAdd = 0;
  const OT = Array.from({ length: 12 }, (_, k) => k + 5);
  const normB = (b: unknown) => JSON.stringify(Object.entries((b ?? {}) as Record<string, unknown>).sort(([a], [c]) => a.localeCompare(c)));
  const sumB = (...bs: Record<string, { twoPoint: { made: number; attempted: number }; threePoint: { made: number; attempted: number } }>[]) => { const r: typeof bs[0] = {}; for (const b of bs) for (const [k, v] of Object.entries(b)) { const c = r[k] ?? { twoPoint: { made: 0, attempted: 0 }, threePoint: { made: 0, attempted: 0 } }; c.twoPoint.made += v.twoPoint.made; c.twoPoint.attempted += v.twoPoint.attempted; c.threePoint.made += v.threePoint.made; c.threePoint.attempted += v.threePoint.attempted; r[k] = c; } return r; };
  for (const season of seasons) {
    const src = periodSources.get(season); const tts = ttsSources.get(season);
    for (const t of sd(season).teams) {
      const logs = seasonOf(season, t.teamId).regular.filter(g => !(g as TeamGameLog & { resultOnly?: boolean }).resultOnly);
      const noOt = logs.filter(g => gameOvertimes(g) === 0);
      if (src && noOt.length) {
        const a = sumTeamPeriodTotals(src, noOt, 'h1'), b = sumTeamPeriodTotals(src, noOt, 'h2');
        const same = a.games.map(g => g.scheduleKey).join() === b.games.map(g => g.scheduleKey).join();
        const all = a.games.length ? sumTeamGameLogs(a.games) : null;
        addChecks++;
        if (!same) miss(`${season} ${t.teamName}: 前半と後半で数えた試合が違う`);
        else if (all) for (const k of ADD_KEYS) if ((a.totals as never)[k] + (b.totals as never)[k] !== (all as never)[k]) miss(`${season} ${t.teamName}: 前半＋後半≠試合全体 ${k} ${(a.totals as never)[k]}+${(b.totals as never)[k]}≠${(all as never)[k]}`);
      }
      if (src) {
        // オンザコート別（人数別の時間・得点・失点）・Time to Shot：前半＋後半＋延長＝試合全体
        const ocAll = sumForeignDetail(src, logs, 'all' as ForeignPeriodValue);
        const parts = (['h1', 'h2', 'ot'] as const).map(v => sumForeignDetail(src, logs, v as ForeignPeriodValue));
        if (ocAll && parts.every(Boolean)) {
          ocAdd++;
          // 試合全体の時間は試合ログの出場時間÷5。区間は索引の合計。人数別の時間は索引どうしで合う（延長は延長に出た試合だけが分母）
          for (let n = 0; n < 5; n++) { const sec = parts.reduce((s, x) => s + x!.byCount[n]!.seconds, 0); const ref = ocAll.byCount[n]!.seconds; if (Math.abs(sec - ref) > 2) miss(`${season} ${t.teamName}: オンザコート別 ${n}人の時間 前半＋後半＋延長=${sec} 試合全体=${ref}`); }
        }
      }
      if (tts) {
        const a = sumTtsTotals(tts, logs, 'all', 'own');
        const ps = (['h1', 'h2', 'ot'] as const).map(v => sumTtsTotals(tts, logs, v, 'own'));
        ttsAdd++;
        for (const [cat, v] of Object.entries(a.byCategory)) { const n = ps.reduce((s, x) => s + (x.byCategory as never as Record<string, { n: number }>)[cat]!.n, 0); if (n !== v.n) miss(`${season} ${t.teamName}: Time to Shot ${cat} の本数 前半＋後半＋延長=${n} 試合全体=${v.n}`); }
      }
      if (sd(season).teams.some(x => !!x.shotTypes)) {
        const pbps = pbpsOfSeason(season);
        const all = sumShotPair(logs);
        const h1 = shotPairInPeriods(logs, pbps, t.teamId, [1, 2]), h2 = shotPairInPeriods(logs, pbps, t.teamId, [3, 4]), ot = shotPairInPeriods(logs, pbps, t.teamId, OT);
        shotAdd++;
        if (normB(sumB(h1.own, h2.own, ot.own)) !== normB(all.own) || normB(sumB(h1.opp, h2.opp, ot.opp)) !== normB(all.opp)) miss(`${season} ${t.teamName}: Shooting 前半＋後半＋延長≠試合全体`);
        const tAll = sumTovPair(logs), tp = [[1, 2], [3, 4], OT].map(pp => tovPairInPeriods(logs, pbps, t.teamId, pp));
        if (tovTotal(tAll.forced) !== tp.reduce((s, x) => s + tovTotal(x.forced), 0) || tovTotal(tAll.committed) !== tp.reduce((s, x) => s + tovTotal(x.committed), 0)) miss(`${season} ${t.teamName}: Forced TOV 前半＋後半＋延長≠試合全体`);
      }
    }
  }
  console.log(`前半＋後半＋延長＝試合全体: 索引の加算項目 ${addChecks}チームシーズン・オンザコート別 ${ocAdd}・Time to Shot ${ttsAdd}・Shooting・Forced TOV ${shotAdd}`);
  for (const b of bad) console.log(`   ${b}`);
  check('前半＋後半（＋延長）が試合全体と合う項目はすべて合う', bad.length === 0, `${bad.length}件`);
  bad.length = 0;

  // 10-3. Shooting・Forced TOV の前半・後半：スポーツナビの生の記録から数え直した値と一致（自チームだけの記録・記録がある試合の数）
  let sfCells = 0, noLeagueOk = 0;
  const f2 = (v: number) => v.toFixed(2);
  for (const season of seasons.filter(s => sd(s).teams.some(t => !!t.shotTypes))) {
    const pbps = pbpsOfSeason(season);
    for (const t of sd(season).teams) {
      const logs = seasonOf(season, t.teamId).regular;
      const rec = logs.filter(g => g.shotTypes);
      const md = buildDetailedExport(inputFor(season, t.teamId, 'team', { timeSlice: 'halves', pbpsScope: 'league' })).markdown;
      for (const [slice, word, periods] of [['h1', H1, [1, 2]], ['h2', H2, [3, 4]]] as const) {
        const sh = mdTable(md, new RegExp(`^### Shooting・${word.replace(/[（）]/g, m => `\\${m}`)}$`));
        const tv = mdTable(md, new RegExp(`^### Forced TOV・${word.replace(/[（）]/g, m => `\\${m}`)}$`));
        if (sh.get('記録がある試合／スタッツの対象試合')?.[0] !== `${rec.length}／${logs.length}`) miss(`${season} ${t.teamName} ${slice}: 記録がある試合 ${sh.get('記録がある試合／スタッツの対象試合')?.[0]}`);
        if (tv.get('データあり試合数')?.[0] !== String(rec.length)) miss(`${season} ${t.teamName} ${slice}: Forced のデータあり試合数 ${tv.get('データあり試合数')?.[0]}`);
        // 生の記録から（共通の関数を使わず）数える
        const own = new Map<string, number[]>(), opp = new Map<string, number[]>();
        let forced = 0, committed = 0;
        for (const g of rec) {
          const p = pbps.get(g.scheduleKey)!;
          for (const s of p.shots) { if (!periods.includes(s.period as never)) continue; const m = (s.teamId === t.teamId ? own : opp); const a = m.get(s.shotType) ?? [0, 0, 0, 0]; m.set(s.shotType, a); const o = s.shotValue === 3 ? 2 : 0; a[o + 1]!++; if (s.made) a[o]!++; }
          for (const x of p.turnovers) { if (!periods.includes(x.period as never)) continue; if (x.teamId === t.teamId) committed++; else forced++; }
        }
        const n = rec.length;
        for (const [pre, m] of [['', own], ['opp ', opp]] as const) for (const [type, a] of m) {
          const label = shotTypeLabel(type);
          const pairs: [string, number, number][] = [['2PM', a[0]!, a[1]!], ['2PA', a[0]!, a[1]!], ['2P%', a[0]!, a[1]!], ['3PM', a[2]!, a[3]!], ['3PA', a[2]!, a[3]!], ['3P%', a[2]!, a[3]!]];
          for (const [suf, made, att] of pairs) {
            const fct = 1 / n; // 画面の列と同じく、成功数・試投数を 1/試合数 倍してから成功率を出す
            const want = att === 0 ? '-' : suf.endsWith('M') ? f2(made * fct) : suf.endsWith('A') ? f2(att * fct) : `${((100 * (made * fct)) / (att * fct)).toFixed(2)}%`;
            const row = sh.get(`${pre}${label} ${suf}`);
            sfCells++;
            if ((row?.[0] ?? '-') !== want) miss(`${season} ${t.teamName} ${slice} Shooting「${pre}${label} ${suf}」md=${row?.[0]} 生の記録=${want}`);
          }
        }
        const row = tv.get('合計'), orow = tv.get('opp 合計');
        sfCells += 2;
        if (n > 0 && (row?.[0] !== f2(forced / n) || orow?.[0] !== f2(committed / n))) miss(`${season} ${t.teamName} ${slice} Forced TOV 合計 md=${row?.[0]}/${orow?.[0]} 生の記録=${f2(forced / n)}/${f2(committed / n)}`);
        // リーグ順位・リーグ平均は付けない
        if (/リーグ平均|（\d+位）/.test(`${[...sh].map(([k, v]) => k + v.join()).join()}${[...tv].map(([k, v]) => k + v.join()).join()}`)) miss(`${season} ${t.teamName} ${slice}: 前半・後半の Shooting・Forced TOV に順位・平均がある`); else noLeagueOk++;
      }
    }
  }
  console.log(`前半・後半の Shooting・Forced TOV: ${sfCells}セルをスポーツナビの生の記録から数え直して比べた（順位・平均なし ${noLeagueOk}表）`);
  for (const b of bad) console.log(`   ${b}`);
  check('前半・後半の Shooting・Forced TOV が生の記録の数え直しと同じ・順位とリーグ平均を付けない', bad.length === 0, `${bad.length}件`);
  bad.length = 0;

  // 10-4. 試合全体の列は今までどおり順位・リーグ平均が付く（前半・後半を含めても）
  {
    const t = sd('2025-26').teams[0]!;
    const md = buildDetailedExport(inputFor('2025-26', t.teamId, 'team', { timeSlice: 'halves' })).markdown;
    const full = mdTable(md, /^### Traditional・試合全体$/), h = mdTable(md, /^### Traditional・前半（1Q・2Q）$/);
    check('試合全体の表には順位とリーグ平均が付き、前半・後半の表には付かない', full.get('項目')?.includes('シーズン全体 リーグ平均') === true && /（\d+位）/.test(full.get('PTS')?.[0] ?? '') && !h.get('項目')?.some(x => /リーグ平均/.test(x)) && !/（\d+位）/.test(h.get('PTS')?.join() ?? ''));
    const tbls = [...md.matchAll(/^### (.+)$/gm)].map(m => m[1]!);
    check('前半・後半を含めると、チームのまとめ・得点失点構成・Streaks は試合全体だけ、出す表は区間ごとにある', !tbls.some(x => /^(チームのまとめ)/.test(x)) && (md.match(/^### Shooting・/gm) ?? []).length === 3 && (md.match(/^### Time to Shot・/gm) ?? []).length === 3 && (md.match(/^### オンザコート別.*・/gm) ?? []).length === 3 && !/^## 1\. チームのまとめ[\s\S]*?・前半/m.test(md.split('## 2.')[0]!));
    check('1Q〜4Q・延長の区間は出さない', !/^### .*・(1Q|2Q|3Q|4Q|延長)$/m.test(md) && !/\|(1Q|2Q|3Q|4Q)\|/.test(md.split('## 4.')[1] ?? ''));
  }

  // 10-5. 選手：前半・後半の表＝チーム詳細の選手スタッツタブの期間指定（buildTeamSplitRowsFromPeriodSource）。前半＋後半＝試合全体（延長の無い試合の個人の得点など）
  let pCells = 0, pGames = 0;
  for (const season of seasons) {
    const sp = seasonPeriods.get(season); if (!sp) continue;
    const foulSplit = season >= '2026-27', startYear = Number(season.slice(0, 4));
    const gameTeams = buildGameTeamsByScheduleKey(sd(season).summaries);
    for (const t of sd(season).teams) {
      const input = inputFor(season, t.teamId, 'player', { timeSlice: 'halves' });
      const md = buildDetailedExport(input).markdown;
      const gameLogs = seasonOf(season, t.teamId).regular;
      for (const tab of ['traditional', 'advanced', 'misc', 'scoring'] as const) {
        const cols = seasonBoxColumnsWithFtr(tab, foulSplit);
        const T = `${tab[0]!.toUpperCase()}${tab.slice(1)}`;
        for (const [slice, word] of [['h1', H1], ['h2', H2]] as const) {
          const tbl = mdTable(md, new RegExp(`^### ${T}・${word.replace(/[（）]/g, m => `\\${m}`)}$`));
          const head = tbl.get('選手') ?? [];
          for (const { player } of input.players) {
            const row = tbl.get(normalizePlayerName(player.name));
            const logs = read<PlayerGameLog[]>(`${season}/player-games/${player.playerId}`).filter(g => g.gameType === 'regular');
            const own = new Map<string, { teamId: string; teamName: string }>();
            for (const g of logs) { if (g.min <= 0) continue; const o = resolveOwnTeam(g, gameTeams); if (o) own.set(g.scheduleKey, o); }
            const keys = new Set(logs.filter(g => g.min > 0 && own.get(g.scheduleKey)?.teamId === t.teamId).map(g => g.scheduleKey));
            const split = buildTeamSplitRowsFromPeriodSource(player.playerId, logs, own as never, new Map([[t.teamId, sumTeamGameLogsFor(gameLogs, keys)]]), 'perGame', startYear, player.playerId, slice, sp).find(r => r.teamId === t.teamId);
            if (!split) { if (row) miss(`${season} ${t.teamName} ${player.name} ${T}・${slice}: 画面に行が無いのに md にある`); continue; }
            if (!row) { miss(`${season} ${t.teamName} ${player.name} ${T}・${slice}: md に行が無い`); continue; }
            head.forEach((lb, i) => { const c = cols.find(x => x.label === lb); if (!c) return; pCells++; const want = c.format(split.ctx, 'perGame'); if (row[i] !== want) miss(`${season} ${t.teamName} ${player.name} ${T}・${slice} ${lb}: md=${row[i]} / 選手スタッツ=${want}`); });
          }
        }
      }
      // 前半＋後半＝試合全体（延長の無い試合の個人の記録）
      for (const { player, logs } of input.players) {
        for (const g of logs) {
          if (gameOvertimes(g) !== 0 || sp.shortGames.has(g.scheduleKey)) continue;
          const a = seasonPeriodTotalsOf(sp, player.playerId, g.scheduleKey, g.isHome, 'h1'), b = seasonPeriodTotalsOf(sp, player.playerId, g.scheduleKey, g.isHome, 'h2');
          if (!a || !b) continue;
          pGames++;
          for (const k of ['pts', 'pt2m', 'pt2a', 'pt3m', 'pt3a', 'ftm', 'fta', 'ast', 'stl', 'blk', 'tov'] as const) if ((a.player as never)[k] + (b.player as never)[k] !== (g as never)[k === 'pt2m' ? 'fgm' : k === 'pt2a' ? 'fga' : k === 'pt3m' ? 'tpm' : k === 'pt3a' ? 'tpa' : k] - (k === 'pt2m' ? (g as never)['tpm'] : k === 'pt2a' ? (g as never)['tpa'] : 0)) { miss(`${season} ${player.name} ${g.scheduleKey}: 前半＋後半≠試合全体 ${k}`); break; }
        }
      }
    }
  }
  console.log(`前半・後半（選手）: ${pCells}セルを選手スタッツタブの期間指定の値と比べた・前半＋後半＝試合全体 ${pGames}選手試合（延長の無い試合）`);
  for (const b of bad) console.log(`   ${b}`);
  check('選手の前半・後半の値が選手スタッツタブの前半・後半と同じ・前半＋後半が試合全体と合う', bad.length === 0, `${bad.length}件`);
  bad.length = 0;
}

// ---- 10b. 段階4：選手の Shooting（前半・後半）・2ファイル・読み込み・B.ONE ----
{
  const H1 = '前半（1Q・2Q）', H2 = '後半（3Q・4Q）';
  const esc = (w: string) => w.replace(/[（）]/g, m => `\\${m}`);
  const bad: string[] = [];
  const miss = (m: string) => { if (bad.length < 12) bad.push(m); };

  // 10-6. 選手の Shooting の前半・後半：生の記録（ピリオドで絞る）から数え直した値と一致。出場0分の試合のシュートの扱いは試合全体と同じ
  let cells = 0;
  for (const season of seasons.filter(s => sd(s).teams.some(t => !!t.shotTypes))) {
    const pbps = pbpsOfSeason(season);
    for (const t of sd(season).teams) {
      const input = inputFor(season, t.teamId, 'player', { timeSlice: 'halves' });
      const md = buildDetailedExport(input).markdown;
      for (const [slice, word, periods] of [['h1', H1, [1, 2]], ['h2', H2, [3, 4]]] as const) {
        const tbl = mdTable(md, new RegExp(`^### Shooting・${esc(word)}$`));
        const head = tbl.get('選手') ?? [];
        for (const { player, logs, zeroMinKeys } of input.players) {
          const row = tbl.get(normalizePlayerName(player.name)); if (!row) { miss(`${season} ${t.teamName} ${player.name} ${slice}: Shooting の行が無い`); continue; }
          const played = logs.map(g => g.scheduleKey).filter(k => pbps.has(k));
          const shots = [...played, ...(zeroMinKeys ?? [])].flatMap(k => (pbps.get(k)?.shots ?? []).filter(s => s.playerId === player.playerId && periods.includes(s.period as never)));
          const cols = shotTypeEntityColumns<{ b: ReturnType<typeof buildShotTypeBreakdown>; n: number }>(sortShotTypeKeys(Object.keys(buildShotTypeBreakdown(shots))), r => r.b, 'perGame', r => r.n);
          const r0 = { b: buildShotTypeBreakdown(shots), n: played.length };
          if (row[0] !== `${played.length}／${logs.length}`) miss(`${season} ${t.teamName} ${player.name} ${slice}: 記録のある試合／出場 ${row[0]}`);
          for (const c of cols) { const k = head.indexOf(c.label); const want = played.length ? c.format!(r0) : '-'; cells++; if (k < 1 ? want !== '-' : row[k] !== want) miss(`${season} ${t.teamName} ${player.name} ${slice} 「${c.label}」md=${row[k]} 生の記録=${want}`); }
        }
      }
    }
  }
  console.log(`選手の Shooting（前半・後半）: ${cells}セルを生の記録から数え直して比べた`);
  for (const b of bad) console.log(`   ${b}`);
  check('選手の前半・後半の Shooting が生の記録の数え直しと同じ', bad.length === 0, `${bad.length}件`);
  bad.length = 0;

  // 10-7. 10万字を超える組み合わせは時間帯で2ファイル。10万字以下は分けない。2つで1ファイル版と同じ表がそろい、各ファイルが10万字以下
  const tablesOf = (md: string) => { const out: string[] = []; let cur: string[] = []; for (const l of md.split('\n')) { if (l.startsWith('|')) cur.push(l); else if (cur.length) { out.push(cur.join('\n')); cur = []; } } if (cur.length) out.push(cur.join('\n')); return out.filter(x => !x.startsWith('|項目|内容|')); };
  let n = 0, splits = 0, maxWhole = 0, maxPart = 0, unsplit = 0, maxUnsplit = 0;
  const splitEx: string[] = [];
  for (const season of seasons) {
    const ts = sd(season).teams;
    for (const t of ts) {
      if (season !== '2025-26' && season !== '2026-27' && season !== '2023-24' && t !== ts[0]) continue;
      const ds = seasonOf(season, t.teamId);
      for (const kind of ['team', 'player'] as const) for (const [term, opp] of [['threeTerms', 'all'], ['halves', 'all'], ['season', 'all'], ['recent5', 'atLeast60'], ['halves', 'atLeast60']] as const) {
        if (term === 'threeTerms' && !threeTermBreaks(season, 'premier', ds.summaries, ds.schedule).ok) continue;
        const prev = kind === 'team' && seasons.includes(prevOf(season)) && sd(prevOf(season)).teams.some(x => x.teamId === t.teamId) ? seasonOf(prevOf(season), t.teamId) : null;
        const inp = inputFor(season, t.teamId, kind, { term, opp, timeSlice: 'halves', compare: kind === 'team', prev });
        const whole = buildDetailedWhole(inp), out = buildDetailedExport(inp);
        n++;
        maxWhole = Math.max(maxWhole, whole.characters);
        if (whole.empty) { if (out.parts) miss(`${season} ${t.teamName} ${kind}・${term}・${opp}: 0試合なのに分けた`); continue; }
        if (whole.characters <= 100_000) {
          unsplit++; maxUnsplit = Math.max(maxUnsplit, whole.characters);
          if (out.parts || out.markdown !== whole.markdown) miss(`${season} ${t.teamName} ${kind}・${term}・${opp}: ${whole.characters}字なのに分けた`);
          continue;
        }
        splits++;
        const label = `${season} ${t.teamName} ${kind}・${term}・${opp}（${whole.characters}字）`;
        if (!out.parts || out.parts.length !== 2) { miss(`${label}: 10万字を超えるのに2ファイルに分けていない`); continue; }
        const [a, b] = out.parts as [typeof out.parts[0], typeof out.parts[0]];
        maxPart = Math.max(maxPart, a.characters, b.characters);
        if (splitEx.length < 3) splitEx.push(`${label} → ${a.label} ${a.characters}字・${b.label} ${b.characters}字`);
        if (a.characters > 100_000 || b.characters > 100_000) miss(`${label}: 分けたあとも10万字を超える（${a.characters}・${b.characters}）`);
        if (!/_試合全体\.md$/.test(a.filename) || !/_前半後半\.md$/.test(b.filename) || !a.markdown.includes(b.filename) || !b.markdown.includes(a.filename)) miss(`${label}: ファイル名・もう1つのファイル名の書き方`);
        const want = tablesOf(whole.markdown).sort(), got = [...tablesOf(a.markdown), ...tablesOf(b.markdown)].sort();
        // 両方のファイルにある表（対象試合・プロフィール）は1つにまとめて比べる
        const dedup = (xs: string[]) => [...new Set(xs)].sort();
        if (JSON.stringify(dedup(want)) !== JSON.stringify(dedup(got))) miss(`${label}: 2ファイルの表が1ファイル版と同じにそろわない`);
        if (/^### .*・(前半|後半)/m.test(a.markdown)) miss(`${label}: 試合全体のファイルに前半・後半の表がある`);
        if (/### Traditional・試合全体|^### Shooting・試合全体/m.test(b.markdown)) miss(`${label}: 前半後半のファイルに試合全体の表がある`);
        if (NOT_NUM.test(a.markdown) || NOT_NUM.test(b.markdown)) miss(`${label}: NaN 等`);
      }
    }
  }
  console.log(`2ファイル: ${n}通りを確認（分けた ${splits}・分けない ${unsplit}、1ファイル版の最大 ${maxWhole}字、分けたあとの最大 ${maxPart}字、分けない最大 ${maxUnsplit}字）`);
  for (const e of splitEx) console.log(`   例: ${e}`);
  for (const b of bad) console.log(`   ${b}`);
  check('10万字を超える組み合わせだけ2ファイルに分け、2つで同じ表がそろい、各ファイルが10万字以下', bad.length === 0 && splits > 0, `${bad.length}件・分けた${splits}`);
  bad.length = 0;

  // 10-8. 読み込み：前半・後半の Shooting・Forced TOV は自チームの記録だけ読む。選手の区間の索引。B.ONE は前半・後半を選べない
  {
    const season = '2025-26', tid = sd(season).teams.find(t => t.teamName.includes('宇都宮'))!.teamId;
    const calls: string[] = [];
    const mk = (over: Partial<AiDetailedSource> = {}): AiDetailedSource => ({
      fetchSeasons: async () => seasons.map(s => ({ season: s })) as never,
      fetchTeams: async (s: string) => sd(s).teams, fetchSchedule: async (s: string) => sd(s).schedule, fetchGameSummaries: async (s: string) => sd(s).summaries,
      fetchTeamGameLogs: async (s: string, id: string) => sd(s).logs.get(id)!, fetchTeamHistory: async () => history, fetchDivisionHistory: async () => division as never,
      fetchPlayers: async (s: string) => read<PlayerSummary[]>(`${s}/players`), fetchPlayerGameIndex: async (s: string) => read<PlayerGameIndexFile>(`${s}/player-game-index`),
      fetchPlayerGameLogs: async (s: string, id: string) => read<PlayerGameLog[]>(`${s}/player-games/${id}`),
      fetchYahooGamePbp: async (s: string, k: string) => { calls.push(k); return pbpsOfSeason(s).get(k) ?? null; },
      fetchSeasonRules: async () => seasonRules, loadTeamPeriodSource: async (s: string) => periodSources.get(s) ?? null, loadTtsSource: async (s: string) => ttsSources.get(s) ?? null,
      loadSeasonPeriodSource: async (s: string) => { calls.push(`period:${s}`); return seasonPeriods.get(s) ?? null; },
      loadSeasonRegistrations: async (s: string) => (s >= '2026-27' ? read<SeasonRegistrationFile>(`${s}/registrations`) : null), ...over,
    } as AiDetailedSource);
    const run = (kind: 'team' | 'player', term: 'season' | 'halves' | 'threeTerms', opp: 'all' | 'atLeast60', over: Partial<AiDetailedSource> = {}) =>
      loadDetailedExport(season, tid, { kind, term, opp, timeSlice: 'halves', compare: false }, mk(over), () => new Date('2026-11-03T10:00:00'));
    const own = seasonOf(season, tid).regular.filter(g => g.shotTypes).length;
    calls.length = 0; const a = await run('team', 'season', 'all');
    check(`チーム情報・1シーズン・前半後半は、自チームの記録（${own}試合）だけ読む（全チームの記録は読まない）`, calls.length === own && a.pbpsScope === 'own', `${calls.length}・${a.pbpsScope}`);
    check('読み込み経由と直接で同じ内容（チーム・1シーズン・前半後半）', buildDetailedExport(a).markdown === buildDetailedExport(inputFor(season, tid, 'team', { term: 'season', timeSlice: 'halves', exportedAt: a.exportedAt })).markdown);
    calls.length = 0; const b = await run('team', 'halves', 'all');
    // 試合全体の Forced TOV は試合ログに保存した値を使うので、全チームの記録は読まない（DESIGN.md 333章）
    check(`チーム情報・前半戦後半戦も、自チームの記録（${own}試合）だけ読む（全チームの記録は読まない）`, calls.length === own && b.pbpsScope === 'own', `${calls.length}・${b.pbpsScope}`);
    calls.length = 0;
    const g = await loadDetailedExport(season, tid, { kind: 'team', term: 'halves', opp: 'atLeast60', timeSlice: 'game', compare: false }, mk(), () => new Date('2026-11-03T10:00:00'));
    check('チーム情報・試合全体だけなら、条件を付けてもスポーツナビの記録を1つも読まない', calls.length === 0 && g.pbps === undefined, `${calls.length}`);
    check('読み込み経由と直接で同じ内容（チーム・前半戦後半戦・勝率6割以上・試合全体）', buildDetailedExport(g).markdown === buildDetailedExport(inputFor(season, tid, 'team', { term: 'halves', opp: 'atLeast60', timeSlice: 'game', pbps: undefined, exportedAt: g.exportedAt })).markdown);
    check('読み込み経由と直接で同じ内容（チーム・前半戦後半戦・前半後半）', buildDetailedExport(b).markdown === buildDetailedExport(inputFor(season, tid, 'team', { term: 'halves', timeSlice: 'halves', exportedAt: b.exportedAt })).markdown);
    calls.length = 0; const c = await run('player', 'season', 'all');
    check('選手情報は選手の区間の索引を読み、自チームの記録だけ読む', calls.includes(`period:${season}`) && calls.filter(k => !k.startsWith('period')).length === own && !!c.seasonPeriod);
    check('読み込み経由と直接で同じ内容（選手・前半後半）', buildDetailedExport(c).markdown === buildDetailedExport(inputFor(season, tid, 'player', { timeSlice: 'halves', exportedAt: c.exportedAt })).markdown);
    let failed = false;
    try { await run('player', 'season', 'all', { loadSeasonPeriodSource: async () => null }); } catch { failed = true; }
    check('選手の区間の索引が読めなければ完成版を作らない', failed);
    failed = false;
    try { await run('team', 'season', 'all', { loadTeamPeriodSource: async () => null }); } catch { failed = true; }
    check('チームの区間の索引が読めなければ完成版を作らない', failed);
    let msg = '';
    try { const oneT = read<TeamSummary[]>('2026-27/one/teams')[0]!; buildDetailedExport({ ...inputFor('2026-27', sd('2026-27').teams[0]!.teamId, 'team'), league: 'one', cur: { ...seasonOf('2026-27', sd('2026-27').teams[0]!.teamId) }, timeSlice: 'halves' }); void oneT; } catch (e) { msg = e instanceof Error ? e.message : ''; }
    check('B.ONE では前半・後半を選べない（理由つき）', /B\.ONE ではまだ選べません/.test(msg) && /B\.ONE/.test(ONE_PERIOD_REASON), msg);
  }

  // 10-9. 前半・後半を含む組み合わせで NaN 等が無い・0試合の書き方（2ファイルも）
  {
    let m = 0;
    for (const season of seasons) for (const t of sd(season).teams.slice(0, 2)) for (const kind of ['team', 'player'] as const) for (const [term, opp] of [['season', 'all'], ['recent5', 'all'], ['halves', 'atLeast60'], ['threeTerms', 'all']] as const) {
      const ds = seasonOf(season, t.teamId);
      if (term === 'threeTerms' && !threeTermBreaks(season, 'premier', ds.summaries, ds.schedule).ok) continue;
      const o = buildDetailedExport(inputFor(season, t.teamId, kind, { term, opp, timeSlice: 'halves' }));
      m++;
      for (const f of o.parts ?? [o]) check(`${season} ${t.teamName} ${kind}・${term}・${opp}・前半後半 に NaN 等が無い`, !NOT_NUM.test(f.markdown) && /\.md$/.test(f.filename) && !/\s/.test(f.filename));
    }
    console.log(`書式（前半・後半を含む）: ${m}通りで確認`);
  }
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
