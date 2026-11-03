// AI向けMarkdown（詳しい版）の読み込み。必要なものだけを読み、失敗・食い違いを空の値に置き換えず作成を止める。
import { fetchTeams, fetchTeamGameLogs, fetchSchedule, fetchGameSummaries, fetchPlayers, fetchPlayerGameLogs, fetchTeamHistory, fetchPlayerGameIndex, fetchSeasons, fetchDivisionHistory, fetchSeasonRules, fetchYahooGamePbp } from './data';
import { ONE_SEASONS, type League } from './league';
import { loadSeasonRegistrations } from './registrationScope';
import { splitClassificationSeason } from './classificationFilter';
import { loadTeamPeriodSource } from './teamPeriodTotals';
import { loadSeasonPeriodSource } from './seasonPeriod';
import { TIME_SLICE_CHOICES } from './aiExportScope';
import { loadTtsSource } from './teamTts';
import { seasonRuleFor } from '../../shared/seasonRules';
import { isSupportedGameIndex, playerGameAt, viewPlayerGameIndex } from './gameIndex';
import { previousSeason } from './seasonCompare';
import type { TeamGameLog, YahooGamePbp } from '../../shared/types';
import { detailedTerms, type DetailedInput, type DetailedKind, type DetailedSeason } from './aiDetailedExport';
import type { OpponentKind, TermKind } from './aiExportScope';

export const aiDetailedSource = { fetchTeams, fetchTeamGameLogs, fetchSchedule, fetchGameSummaries, fetchPlayers, fetchPlayerGameLogs, fetchTeamHistory, fetchPlayerGameIndex, fetchSeasons, fetchDivisionHistory, fetchSeasonRules, fetchYahooGamePbp, loadTeamPeriodSource, loadSeasonPeriodSource, loadTtsSource, loadSeasonRegistrations };
export type AiDetailedSource = typeof aiDetailedSource;
export interface DetailedChoice { league?: League; kind: DetailedKind; term: TermKind; opp: OpponentKind; timeSlice: string; compare: boolean }

/** 読み込みの途中経過と中止（画面から渡す） */
export interface LoadHooks {
  /** スポーツナビの記録を読み込む進み具合（読み終えた数／全体の数） */
  onProgress?: (done: number, total: number) => void;
  /** aborted が true になったら、これから読むものを読まずに止める */
  signal?: { aborted: boolean };
}
export class LoadAborted extends Error { constructor() { super('中止しました。'); } }

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = 4, signal?: { aborted: boolean }): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new LoadAborted();
      const i = next++; results[i] = await fn(items[i]!);
    }
  }));
  return results;
}

/** B.ONE のデータがあるシーズン（前季比較に使う。画面に出すのは ONE_SEASONS だけ） */
const ONE_DATA_SEASONS: readonly string[] = ['2025-26', ...ONE_SEASONS];
/** スポーツナビの記録を同時に読む数（B.PREMIER のサイトは HTTP/2 で配信される） */
const YAHOO_CONCURRENCY = 16;

async function loadDetailedSeason(source: AiDetailedSource, season: string, teamId: string, division: unknown, league: League): Promise<DetailedSeason | null> {
  const [teams, schedule, summaries, logs] = await Promise.all([
    source.fetchTeams(season, league), source.fetchSchedule(season, league), source.fetchGameSummaries(season, league), source.fetchTeamGameLogs(season, teamId, league).catch(() => null),
  ]);
  if (!Array.isArray(teams) || !Array.isArray(summaries) || !schedule || schedule.season !== season || (schedule.upcomingGames !== undefined && !Array.isArray(schedule.upcomingGames))) throw new Error('データの形式を確認できません。');
  const team = teams.find(t => t.teamId === teamId);
  if (!team) return null;
  if (!Array.isArray(logs)) throw new Error('チームの試合記録を確認できません。');
  const regular = logs.filter(g => g.gameType === 'regular').sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
  const keys = new Set(regular.map(g => g.scheduleKey));
  const recorded = summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg && (g.homeTeamId === teamId || g.awayTeamId === teamId));
  if (regular.length !== team.gamesPlayed || keys.size !== regular.length || recorded.length !== regular.length || recorded.some(g => !keys.has(g.scheduleKey))) {
    throw new Error('集計と試合記録が揃っていません。時間をおいて読み直してください。');
  }
  return { season, teams, team, regular, summaries, schedule, division };
}

export async function loadDetailedExport(season: string, teamId: string, choice: DetailedChoice, source: AiDetailedSource = aiDetailedSource, now: () => Date = () => new Date(), hooks: LoadHooks = {}): Promise<DetailedInput> {
  const league: League = choice.league ?? 'premier';
  const seasons = await source.fetchSeasons();
  const known = league === 'one' ? ONE_DATA_SEASONS.includes(season) : seasons.some(s => s.season === season);
  if (!known) throw new Error('対象シーズンが見つかりません。');
  const prevName = choice.kind === 'team' && choice.compare ? previousSeason(season) : null;
  const prevSeason = prevName && (league === 'one' ? ONE_DATA_SEASONS.includes(prevName) : seasons.some(s => s.season === prevName)) ? prevName : null;
  const [history, division] = await Promise.all([source.fetchTeamHistory(), source.fetchDivisionHistory()]);
  const [cur, prev] = await Promise.all([loadDetailedSeason(source, season, teamId, division, league), prevSeason ? loadDetailedSeason(source, prevSeason, teamId, division, league) : Promise.resolve(null)]);
  if (!cur) throw new Error('対象チームの記録がありません。');
  // オンザコート別・Time to Shot の索引（チーム情報だけ）。読めないときは空の表にせず止める（Time to Shot は2020-21より前は無い）
  let periodSource: DetailedInput['periodSource'] = null, ttsSource: DetailedInput['ttsSource'] = null, maxForeignOnCourt: number | undefined;
  if (choice.kind === 'team') {
    const [tp, tts, rules] = await Promise.all([source.loadTeamPeriodSource(season, league), source.loadTtsSource(season, league), source.fetchSeasonRules()]);
    if (!tp) throw new Error('チームの区間の索引を確認できません。');
    if (season >= '2020-21' && !tts) throw new Error('Time to Shot の記録を確認できません。');
    periodSource = tp; ttsSource = tts;
    maxForeignOnCourt = seasonRuleFor(rules, season, league)?.maxForeignOnCourt ?? 4;
  }
  // リーグ順位・リーグ平均のため、全チームの試合記録を読む（チーム情報だけ。1チームでも読めなければ止める）
  let leagueLogs: Map<string, TeamGameLog[]> | undefined;
  if (choice.kind === 'team') {
    const loaded = await mapLimited(cur.teams, async t => {
      if (t.teamId === teamId) return [t.teamId, cur.regular] as const;
      const logs = await source.fetchTeamGameLogs(season, t.teamId, league);
      if (!Array.isArray(logs)) throw new Error('チームの試合記録を確認できません。');
      const regular = logs.filter(g => g.gameType === 'regular').sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
      const keys = new Set(regular.map(g => g.scheduleKey));
      const recorded = cur.summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg && (g.homeTeamId === t.teamId || g.awayTeamId === t.teamId));
      if (regular.length !== t.gamesPlayed || keys.size !== regular.length || recorded.length !== regular.length || recorded.some(g => !keys.has(g.scheduleKey))) throw new Error('集計と試合記録が揃っていません。時間をおいて読み直してください。');
      return [t.teamId, regular] as const;
    });
    leagueLogs = new Map(loaded);
  }
  // スポーツナビの記録（Shooting・Forced TOV）。B.ONE と2022-23以前には無い。必要な試合のうち、記録がある試合（試合ログに shotTypes がある）だけを読む。
  // 1シーズン・全チームのチーム情報は teams.json の値を使うので読まない
  // 前半・後半を含めるときは、自チームの対象の試合の記録も読む（前半・後半の Shooting・Forced TOV は自チームだけで、全チームの記録は読まない）
  const wantsHalves = (TIME_SLICE_CHOICES.find(c => c.key === choice.timeSlice)?.slices.length ?? 1) > 1;
  let pbps: Map<string, YahooGamePbp> | undefined;
  let pbpsScope: 'league' | 'own' | undefined;
  const yahoo = league === 'premier' && cur.teams.some(t => !!t.shotTypes);
  const leagueNeed = yahoo && choice.kind === 'team' && !(choice.term === 'season' && choice.opp === 'all');
  const needFiles = yahoo && (leagueNeed || choice.kind === 'player' || wantsHalves);
  if (needFiles) {
    pbpsScope = leagueNeed ? 'league' : 'own';
    const need = new Set<string>();
    const collect = (ds: DetailedSeason, tid: string) => {
      // 複数のタームのときだけ「シーズン全体」の列が付く（書き出しの組み立てと同じ）
      const terms = detailedTerms(ds, choice.term, choice.opp, tid, history, league);
      const sets = terms.length > 1 ? [...terms, ...detailedTerms(ds, 'season', choice.opp, tid, history, league)] : terms;
      for (const t of sets) for (const g of t.statLogs) if (g.shotTypes) need.add(g.scheduleKey);
    };
    if (leagueNeed && leagueLogs) for (const t of cur.teams) { const logs = leagueLogs.get(t.teamId); if (logs) collect({ ...cur, team: t, regular: logs }, t.teamId); }
    else collect(cur, teamId);
    const keys = [...need];
    let done = 0;
    hooks.onProgress?.(0, keys.length);
    const loaded = await mapLimited(keys, async key => {
      const p = await source.fetchYahooGamePbp(season, key, league);
      if (!p) throw new Error('スポーツナビの記録を読み込めませんでした。');
      hooks.onProgress?.(++done, keys.length);
      return [key, p] as const;
    }, YAHOO_CONCURRENCY, hooks.signal);
    pbps = new Map(loaded);
  }
  const players: DetailedInput['players'] = [];
  if (choice.kind === 'player') {
    const [list, index] = await Promise.all([source.fetchPlayers(season, league), source.fetchPlayerGameIndex(season, league)]);
    if (!index || !isSupportedGameIndex(index) || index.season !== season) throw new Error('選手の試合索引を確認できません。');
    const view = viewPlayerGameIndex(index);
    const expected = new Map<string, Set<string>>();
    for (let i = 0; i < view.size; i++) {
      const g = playerGameAt(view, i);
      if (g.teamId !== teamId || g.gameType !== 'regular' || g.min <= 0) continue;
      const keys = expected.get(g.playerId) ?? new Set<string>(); keys.add(g.scheduleKey); expected.set(g.playerId, keys);
    }
    const teamHome = new Map(cur.regular.map(g => [g.scheduleKey, g.isHome]));
    const loaded = await mapLimited([...expected.keys()], async id => {
      const player = list.find(p => p.playerId === id);
      if (!player) throw new Error('選手一覧と試合索引が揃っていません。');
      const logs = await source.fetchPlayerGameLogs(season, id, league);
      if (!Array.isArray(logs)) throw new Error('選手の試合記録を確認できません。');
      const mine = logs.filter(g => g.gameType === 'regular' && g.min > 0 && teamHome.get(g.scheduleKey) === g.isHome);
      const want = expected.get(id)!;
      if (mine.length !== want.size || mine.some(g => !want.has(g.scheduleKey))) throw new Error('選手の試合記録と索引が揃っていません。');
      const zeroMinKeys = logs.filter(g => g.gameType === 'regular' && g.min <= 0 && teamHome.get(g.scheduleKey) === g.isHome).map(g => g.scheduleKey);
      return { player, logs: mine, zeroMinKeys };
    });
    players.push(...loaded);
  }
  // 選手情報の登録区分（2026-27以降はシーズン別の記録。読めなければ選手マスタの区分で出し、その旨を書く＝個人詳細と同じ）
  // 選手情報で前半・後半を含めるときの、選手の区間の索引（チーム詳細の選手スタッツタブの期間指定と同じ読み込み）
  let seasonPeriod: DetailedInput['seasonPeriod'] = null;
  if (choice.kind === 'player' && wantsHalves) {
    seasonPeriod = await source.loadSeasonPeriodSource(season, league);
    if (!seasonPeriod) throw new Error('選手の区間の索引を確認できません。');
  }
  const registrations = choice.kind === 'player' && splitClassificationSeason(season) ? await source.loadSeasonRegistrations(season, league).catch(() => null) : null;
  const d = now();
  const exportedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { ...choice, league, season, teamId, history, cur, prev, players, registrations, leagueLogs, periodSource, ttsSource, maxForeignOnCourt, pbps, pbpsScope, seasonPeriod, exportedAt };
}
