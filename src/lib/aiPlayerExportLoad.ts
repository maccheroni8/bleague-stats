// 選手詳細の md の読み込み。ボタンを押したときだけ読む。必要なものが読めないときは空の値に置き換えず作成を止める。
import { fetchSeasons, fetchPlayers, fetchTeams, fetchGameSummaries, fetchSchedule, fetchPlayerGameLogs, fetchTeamGameLogs, fetchTeamHistory, fetchDivisionHistory, fetchPlayerCareers, fetchPlayerHistory, fetchPlayerAwards } from './data';
import { loadSeasonRegistrations } from './registrationScope';
import { splitClassificationSeason } from './classificationFilter';
import { loadSeasonPeriodSource } from './seasonPeriod';
import { ONE_SEASONS, type League } from './league';
import { previousSeason } from './seasonCompare';
import type { OpponentKind, TermKind } from './aiExportScope';
import type { PlayerGameLog, TeamGameLog } from '../../shared/types';
import { ownTeamMap, type PlayerMdCareerSeason, type PlayerMdInput, type PlayerMdSeason } from './aiPlayerScope';
import { rankLogPlayers, type AiPlayerRankData } from './aiPlayerRank';
import { playerScope } from './aiPlayerScope';
import { fetchYahooGamePbp, fetchGame, fetchTeamStints, fetchAssistPairs, fetchPlayerGameRecords, fetchLeaguePlayerGameRecords, fetchLeaguePlayerCareerTop } from './data';
import { compactStints, type CompactStints } from '../../shared/onCourtTotals';
import type { AiPlayerExtra } from './aiPlayerExtra';
import type { StoredGame, YahooGamePbp } from '../../shared/types';

export const aiPlayerSource = { fetchSeasons, fetchPlayers, fetchTeams, fetchGameSummaries, fetchSchedule, fetchPlayerGameLogs, fetchTeamGameLogs, fetchTeamHistory, fetchDivisionHistory, fetchPlayerCareers, fetchPlayerHistory, fetchPlayerAwards, loadSeasonRegistrations, loadSeasonPeriodSource, fetchYahooGamePbp, fetchGame, fetchTeamStints, fetchAssistPairs, fetchPlayerGameRecords, fetchLeaguePlayerGameRecords, fetchLeaguePlayerCareerTop };
export type AiPlayerSource = typeof aiPlayerSource;
export interface PlayerChoice { league?: League; term: TermKind; opp: OpponentKind; compare?: boolean }
export interface LoadHooks { onProgress?: (text: string) => void; signal?: { aborted: boolean } }
export class LoadAborted extends Error { constructor() { super('中止しました。'); } }

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>, limit = 12, signal?: { aborted: boolean }): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      if (signal?.aborted) throw new LoadAborted();
      const k = next++; results[k] = await fn(items[k]!);
    }
  }));
  return results;
}

const ONE_DATA_SEASONS: readonly string[] = ['2025-26', ...ONE_SEASONS];

/** 1シーズン分。対象の選手がいなければ null */
async function loadPlayerSeason(source: AiPlayerSource, season: string, playerId: string, league: League, signal?: { aborted: boolean }): Promise<PlayerMdSeason | null> {
  const [players, teams, summaries, schedule] = await Promise.all([source.fetchPlayers(season, league), source.fetchTeams(season, league), source.fetchGameSummaries(season, league), source.fetchSchedule(season, league)]);
  if (!Array.isArray(players) || !Array.isArray(teams) || !Array.isArray(summaries) || !schedule) throw new Error('データの形式を確認できません。');
  const player = players.find(p => p.playerId === playerId);
  if (!player) return null;
  const logs = await source.fetchPlayerGameLogs(season, playerId, league);
  if (!Array.isArray(logs)) throw new Error('選手の試合記録を確認できません。');
  const ownBy = ownTeamMap({ summaries, logs });
  const teamIds = new Set([player.teamId, ...[...ownBy.values()].map(t => t.teamId)]);
  const teamLogs = new Map<string, TeamGameLog[]>();
  await mapLimited([...teamIds], async id => { const l = await source.fetchTeamGameLogs(season, id, league); if (!Array.isArray(l)) throw new Error('チームの試合記録を確認できません。'); teamLogs.set(id, l); }, 6, signal);
  return { season, players, teams, summaries, schedule, player, logs, teamLogs };
}

export async function loadPlayerExport(season: string, playerId: string, choice: PlayerChoice, source: AiPlayerSource = aiPlayerSource, now: () => Date = () => new Date(), hooks: LoadHooks = {}): Promise<PlayerMdInput> {
  const league: League = choice.league ?? 'premier';
  const seasons = await source.fetchSeasons();
  const known = league === 'one' ? ONE_DATA_SEASONS.includes(season) : seasons.some(s => s.season === season);
  if (!known) throw new Error('対象シーズンが見つかりません。');
  hooks.onProgress?.('選手・チームの記録を読み込んでいます…');
  const compare = !!choice.compare;
  const prevName = previousSeason(season);
  const prevKnown = compare && prevName && (league === 'one' ? ONE_DATA_SEASONS.includes(prevName) : seasons.some(s => s.season === prevName));
  const [history, division, cur, prev, careers, histories, awardsAll] = await Promise.all([
    source.fetchTeamHistory(), source.fetchDivisionHistory(), loadPlayerSeason(source, season, playerId, league, hooks.signal),
    prevKnown ? loadPlayerSeason(source, prevName!, playerId, league, hooks.signal).catch(() => null) : Promise.resolve(null),
    league === 'premier' ? source.fetchPlayerCareers().catch(() => null) : Promise.resolve(null),
    source.fetchPlayerHistory().catch(() => []), source.fetchPlayerAwards().catch(() => ({})),
  ]);
  if (!cur) throw new Error('この選手のこのシーズンの記録がありません。');
  const awards = [...((awardsAll as Record<string, { season: string; name: string; category?: string }[]>)[playerId] ?? [])].sort((a, b) => a.season.localeCompare(b.season));
  const nameHistory = histories.find(h => h.playerId === playerId)?.names ?? [];
  const registrations = splitClassificationSeason(season) ? await source.loadSeasonRegistrations(season, league).catch(() => null) : null;
  const periodSource = await source.loadSeasonPeriodSource(season, league);
  // 順位の材料：掲載基準（出場率）を満たす選手の試合ログと、全チームの試合ログ（Misc・Scoring の分母）
  hooks.onProgress?.('リーグ全体の記録を読み込んでいます…');
  const rank = await loadRank(source, cur, season, league, playerId, hooks.signal);
  // 通算（在籍が分かっているシーズン）
  hooks.onProgress?.('過去のシーズンの記録を読み込んでいます…');
  const enrolled = league === 'premier' && careers ? seasons.filter(s => careers.seasons[s.season]?.[playerId]).map(s => s.season) : [season];
  const career: PlayerMdCareerSeason[] = (await mapLimited(enrolled, async s => {
    const logsS = s === season ? cur.logs : await source.fetchPlayerGameLogs(s, playerId, league).catch(() => [] as PlayerGameLog[]);
    if (!logsS.length) return null;
    const summaries = s === season ? cur.summaries : await source.fetchGameSummaries(s, league);
    const ownBy = ownTeamMap({ summaries, logs: logsS });
    const tl = new Map<string, TeamGameLog[]>();
    for (const id of new Set([...ownBy.values()].map(t => t.teamId))) tl.set(id, s === season ? (cur.teamLogs.get(id) ?? []) : await source.fetchTeamGameLogs(s, id, league).catch(() => []));
    const players = s === season ? cur.players : await source.fetchPlayers(s, league).catch(() => []);
    return { season: s, league, logs: logsS, summaries, teamLogs: tl, player: players.find(p => p.playerId === playerId) ?? null } satisfies PlayerMdCareerSeason;
  }, 6, hooks.signal)).filter((x): x is PlayerMdCareerSeason => x !== null);
  // 対象期間の試合の記録：スポーツナビ（シュートタイプ。B.PREMIER の2023-24以降）と試合の生データ（エリア別シュート。2022-23以降）
  const base = { season, league, term: choice.term, opp: choice.opp, history, division, cur };
  const scope = playerScope(base);
  const keys = scope.playedUnion.map(g => g.scheduleKey);
  hooks.onProgress?.('対象の試合の記録を読み込んでいます…');
  const pbps = new Map<string, YahooGamePbp>();
  if (league === 'premier' && cur.player.shotTypes) {
    await mapLimited(keys, async k => { const p = await source.fetchYahooGamePbp(season, k, league).catch(() => null); if (p) pbps.set(k, p); }, 16, hooks.signal);
  }
  const rawGames = new Map<string, StoredGame>();
  if (season >= '2022-23') {
    await mapLimited(keys, async k => { rawGames.set(k, await source.fetchGame(season, k, league)); }, 16, hooks.signal);
  }
  // 組み合わせ・アシストペア・記録のランキング
  hooks.onProgress?.('チーム・記録の資料を読み込んでいます…');
  const stints = new Map<string, CompactStints>();
  await mapLimited([...new Set([...scope.ownBy.values()].map(t => t.teamId))], async id => {
    const f = await source.fetchTeamStints(season, id, league).catch(() => null);
    if (f) stints.set(id, compactStints(f));
  }, 6, hooks.signal);
  const [assistPairs, seasonRecords, allTimeRecords, careerTop] = await Promise.all([
    source.fetchAssistPairs(season, league).catch(() => null),
    source.fetchPlayerGameRecords(season, league).catch(() => null),
    league === 'premier' ? source.fetchLeaguePlayerGameRecords().catch(() => null) : Promise.resolve(null),
    league === 'premier' ? source.fetchLeaguePlayerCareerTop().catch(() => null) : Promise.resolve(null),
  ]);
  const extra: AiPlayerExtra = { stints, assistPairs, seasonRecords, allTimeRecords, careerTop };
  // 前季全体との比較（チェックを入れたときだけ）
  let prevReason: string | null = null;
  let prevRank: AiPlayerRankData | null = null, prevPeriodSource: PlayerMdInput['prevPeriodSource'] = null;
  const prevPbps = new Map<string, YahooGamePbp>(), prevRawGames = new Map<string, StoredGame>();
  if (compare) {
    if (!prevName) prevReason = 'このリーグの最初のシーズンのため、前季がありません。';
    else if (!prevKnown) prevReason = `前季（${prevName}）は、このリーグのデータがまだサイトにありません（${league === 'one' ? 'B.ONE の前身（旧B2）の記録はサイトに入っていません' : '記録がありません'}）。`;
    else if (!prev) prevReason = `前季（${prevName}）の${league === 'one' ? (prevName! < '2026-27' ? '旧B2（B.ONE の前身）' : 'B.ONE') : (prevName! < '2026-27' ? 'B1（B.PREMIER の前身）' : 'B.PREMIER')}に、この選手の記録がありません（別のリーグにいた、または登録がありませんでした）。`;
    else if (!prev.logs.some(g => g.gameType === 'regular' && g.min > 0)) prevReason = `前季（${prevName}）は登録されていましたが、レギュラーシーズンの出場がありません。`;
    if (prevReason === null && prev) {
      hooks.onProgress?.('前季の記録を読み込んでいます…');
      prevRank = await loadRank(source, prev, prevName!, league, playerId, hooks.signal);
      prevPeriodSource = await source.loadSeasonPeriodSource(prevName!, league);
      const pkeys = prev.logs.filter(g => g.gameType === 'regular' && g.min > 0).map(g => g.scheduleKey);
      if (league === 'premier' && prev.player.shotTypes) await mapLimited(pkeys, async k => { const p = await source.fetchYahooGamePbp(prevName!, k, league).catch(() => null); if (p) prevPbps.set(k, p); }, 16, hooks.signal);
      if (prevName! >= '2022-23') await mapLimited(pkeys, async k => { prevRawGames.set(k, await source.fetchGame(prevName!, k, league)); }, 16, hooks.signal);
    }
  }
  const d = now();
  const exportedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return {
    league, season, playerId, term: choice.term, opp: choice.opp, history, division, cur, prev: prevReason === null ? prev : null, compare, prevName: compare ? prevName : null, prevReason, prevRank, prevPeriodSource, prevPbps, prevRawGames, registrations, careers, awards, nameHistory, periodSource, rank,
    pbps, rawGames, career, extra, exportedAt,
  };
}

async function loadRank(source: AiPlayerSource, s: PlayerMdSeason, season: string, league: League, playerId: string, signal?: { aborted: boolean }): Promise<AiPlayerRankData> {
  const eligible = rankLogPlayers(s.players, s.teams);
  const logs = new Map<string, PlayerGameLog[]>();
  await mapLimited(eligible, async p => { logs.set(p.playerId, p.playerId === playerId ? s.logs : await source.fetchPlayerGameLogs(season, p.playerId, league)); }, 16, signal);
  logs.set(playerId, s.logs);
  const teamLogs = new Map<string, TeamGameLog[]>();
  await mapLimited(s.teams, async t => { teamLogs.set(t.teamId, s.teamLogs.get(t.teamId) ?? await source.fetchTeamGameLogs(season, t.teamId, league)); }, 8, signal);
  return { season, players: s.players, teams: s.teams, summaries: s.summaries, logs, teamLogs };
}
