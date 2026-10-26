// 書き出し専用の読み込み。失敗・版違いを空配列へ置き換えず、完成版の作成を止める。
import { fetchTeams, fetchTeamGameLogs, fetchSchedule, fetchGameSummaries, fetchPlayers, fetchPlayerGameLogs, fetchTeamHistory, fetchPlayerGameIndex, fetchSeasons } from './data';
import type { League } from './league';
import { isSupportedGameIndex, playerGameAt, viewPlayerGameIndex } from './gameIndex';
import { previousSeason } from './seasonCompare';
import type { AiExportInput, AiExportSeason } from './aiExport';

export const aiExportSource = { fetchTeams, fetchTeamGameLogs, fetchSchedule, fetchGameSummaries, fetchPlayers, fetchPlayerGameLogs, fetchTeamHistory, fetchPlayerGameIndex, fetchSeasons };
export type AiExportSource = typeof aiExportSource;
async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]!); }
  }));
  return results;
}
/** league は読み込む場所（データの置き場所）。書き出す文面は B.PREMIER の前提なので、画面は B.PREMIER のときだけ呼ぶ */
export async function loadAiExport(season: string, teamId: string, source: AiExportSource = aiExportSource, league: League = 'premier'): Promise<AiExportInput> {
  const seasons = await source.fetchSeasons();
  if (!seasons.some(s => s.season === season)) throw new Error('対象シーズンが見つかりません。');
  const prev = previousSeason(season);
  // 日程・全チーム・試合一覧は必須。前季がないことと、前季の取得失敗を区別する。
  async function loadSeason(s: string, all: boolean): Promise<AiExportSeason> {
    const [teams, schedule, summaries] = await Promise.all([source.fetchTeams(s, league), source.fetchSchedule(s, league), source.fetchGameSummaries(s, league)]);
    if (!Array.isArray(teams) || !Array.isArray(summaries) || !schedule || schedule.season !== s || !Array.isArray(schedule.scheduleKeys) || (schedule.upcomingGames !== undefined && !Array.isArray(schedule.upcomingGames))) throw new Error('データの形式を確認できません。');
    const targets = all ? teams : teams.filter(t => t.teamId === teamId);
    const entries = await mapLimited(targets, async t => {
      const logs = await source.fetchTeamGameLogs(s, t.teamId, league);
      if (!Array.isArray(logs)) throw new Error('チームの試合記録を確認できません。');
      const regular = logs.filter(g => g.gameType === 'regular');
      const keys = new Set(regular.map(g => g.scheduleKey));
      const recorded = summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg && (g.homeTeamId === t.teamId || g.awayTeamId === t.teamId));
      if (regular.length !== t.gamesPlayed || keys.size !== regular.length || recorded.length !== regular.length || recorded.some(g => !keys.has(g.scheduleKey))) {
        throw new Error('集計と試合記録が揃っていません。時間をおいて読み直してください。');
      }
      return [t.teamId, logs] as const;
    });
    return { season: s, teams, logs: new Map(entries), schedule, summaries };
  }
  const [current, previous, history, players, index] = await Promise.all([
    loadSeason(season, true), league === 'premier' && prev && seasons.some(s => s.season === prev) ? loadSeason(prev, false) : Promise.resolve(null),
    source.fetchTeamHistory(), source.fetchPlayers(season, league), source.fetchPlayerGameIndex(season, league),
  ]);
  if (!index || !isSupportedGameIndex(index) || index.season !== season) throw new Error('選手の試合索引を確認できません。');
  const view = viewPlayerGameIndex(index);
  const ids = new Set<string>();
  const expected = new Map<string, Set<string>>();
  for (let i = 0; i < view.size; i++) {
    const g = playerGameAt(view, i);
    if (g.teamId !== teamId || g.gameType !== 'regular' || g.min <= 0) continue;
    ids.add(g.playerId);
    const keys = expected.get(g.playerId) ?? new Set<string>(); keys.add(g.scheduleKey); expected.set(g.playerId, keys);
  }
  const ownLogs = current.logs.get(teamId);
  if (!ownLogs) throw new Error('対象チームの試合記録がありません。');
  const teamKeys = new Map(ownLogs.filter(g => g.gameType === 'regular').map(g => [g.scheduleKey, g.isHome]));
  if (teamKeys.size && ids.size === 0) throw new Error('チーム内リーダーの記録が揃っていません。');
  const playerData = await mapLimited([...ids], async id => {
    const player = players.find(p => p.playerId === id);
    if (!player) throw new Error('選手一覧と試合索引が揃っていません。');
    const logs = await source.fetchPlayerGameLogs(season, id, league);
    if (!Array.isArray(logs)) throw new Error('選手の試合記録を確認できません。');
    const mine = logs.filter(g => g.gameType === 'regular' && g.min > 0 && teamKeys.get(g.scheduleKey) === g.isHome);
    // 必須項目の欠けを順位表からの黙った除外にしない（旧キャッシュ・更新途中も停止）。
    const required: (keyof typeof mine[number])[] = ['min', 'pts', 'reb', 'ast', 'stl', 'blk', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'tov'];
    if (season >= '2020-21') required.push('pf', 'foulsDrawn', 'blockedAgainst', 'technicalFouls');
    if (mine.some(g => required.some(k => typeof g[k] !== 'number' || !Number.isFinite(g[k])))) throw new Error('選手の成績に必要な項目が揃っていません。');
    const expectedKeys = expected.get(id)!;
    if (mine.length !== expectedKeys.size || mine.some(g => !expectedKeys.has(g.scheduleKey))) throw new Error('選手の試合記録と索引が揃っていません。');
    return { player, logs };
  });
  return { current, previous, teamId, history, players: playerData };
}
