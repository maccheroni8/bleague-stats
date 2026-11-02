// AI向けMarkdown（詳しい版）の読み込み。必要なものだけを読み、失敗・食い違いを空の値に置き換えず作成を止める。
import { fetchTeams, fetchTeamGameLogs, fetchSchedule, fetchGameSummaries, fetchPlayers, fetchPlayerGameLogs, fetchTeamHistory, fetchPlayerGameIndex, fetchSeasons, fetchDivisionHistory, fetchSeasonRules } from './data';
import { loadSeasonRegistrations } from './registrationScope';
import { splitClassificationSeason } from './classificationFilter';
import { loadTeamPeriodSource } from './teamPeriodTotals';
import { loadTtsSource } from './teamTts';
import { seasonRuleFor } from '../../shared/seasonRules';
import { isSupportedGameIndex, playerGameAt, viewPlayerGameIndex } from './gameIndex';
import { previousSeason } from './seasonCompare';
import type { TeamGameLog } from '../../shared/types';
import type { DetailedInput, DetailedKind, DetailedSeason } from './aiDetailedExport';
import type { OpponentKind, TermKind } from './aiExportScope';

export const aiDetailedSource = { fetchTeams, fetchTeamGameLogs, fetchSchedule, fetchGameSummaries, fetchPlayers, fetchPlayerGameLogs, fetchTeamHistory, fetchPlayerGameIndex, fetchSeasons, fetchDivisionHistory, fetchSeasonRules, loadTeamPeriodSource, loadTtsSource, loadSeasonRegistrations };
export type AiDetailedSource = typeof aiDetailedSource;
export interface DetailedChoice { kind: DetailedKind; term: TermKind; opp: OpponentKind; timeSlice: string; compare: boolean }

async function mapLimited<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i]!); }
  }));
  return results;
}

async function loadSeason(source: AiDetailedSource, season: string, teamId: string, division: unknown): Promise<DetailedSeason | null> {
  const [teams, schedule, summaries, logs] = await Promise.all([
    source.fetchTeams(season, 'premier'), source.fetchSchedule(season, 'premier'), source.fetchGameSummaries(season, 'premier'), source.fetchTeamGameLogs(season, teamId, 'premier').catch(() => null),
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

export async function loadDetailedExport(season: string, teamId: string, choice: DetailedChoice, source: AiDetailedSource = aiDetailedSource, now: () => Date = () => new Date()): Promise<DetailedInput> {
  const seasons = await source.fetchSeasons();
  if (!seasons.some(s => s.season === season)) throw new Error('対象シーズンが見つかりません。');
  const prevName = choice.kind === 'team' && choice.compare ? previousSeason(season) : null;
  const prevSeason = prevName && seasons.some(s => s.season === prevName) ? prevName : null;
  const [history, division] = await Promise.all([source.fetchTeamHistory(), source.fetchDivisionHistory()]);
  const [cur, prev] = await Promise.all([loadSeason(source, season, teamId, division), prevSeason ? loadSeason(source, prevSeason, teamId, division) : Promise.resolve(null)]);
  if (!cur) throw new Error('対象チームの記録がありません。');
  // オンザコート別・Time to Shot の索引（チーム情報だけ）。読めないときは空の表にせず止める（Time to Shot は2020-21より前は無い）
  let periodSource: DetailedInput['periodSource'] = null, ttsSource: DetailedInput['ttsSource'] = null, maxForeignOnCourt: number | undefined;
  if (choice.kind === 'team') {
    const [tp, tts, rules] = await Promise.all([source.loadTeamPeriodSource(season, 'premier'), source.loadTtsSource(season, 'premier'), source.fetchSeasonRules()]);
    if (!tp) throw new Error('チームの区間の索引を確認できません。');
    if (season >= '2020-21' && !tts) throw new Error('Time to Shot の記録を確認できません。');
    periodSource = tp; ttsSource = tts;
    maxForeignOnCourt = seasonRuleFor(rules, season, 'premier')?.maxForeignOnCourt ?? 4;
  }
  // リーグ順位・リーグ平均のため、全チームの試合記録を読む（チーム情報だけ。1チームでも読めなければ止める）
  let leagueLogs: Map<string, TeamGameLog[]> | undefined;
  if (choice.kind === 'team') {
    const loaded = await mapLimited(cur.teams, async t => {
      if (t.teamId === teamId) return [t.teamId, cur.regular] as const;
      const logs = await source.fetchTeamGameLogs(season, t.teamId, 'premier');
      if (!Array.isArray(logs)) throw new Error('チームの試合記録を確認できません。');
      const regular = logs.filter(g => g.gameType === 'regular').sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
      const keys = new Set(regular.map(g => g.scheduleKey));
      const recorded = cur.summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg && (g.homeTeamId === t.teamId || g.awayTeamId === t.teamId));
      if (regular.length !== t.gamesPlayed || keys.size !== regular.length || recorded.length !== regular.length || recorded.some(g => !keys.has(g.scheduleKey))) throw new Error('集計と試合記録が揃っていません。時間をおいて読み直してください。');
      return [t.teamId, regular] as const;
    });
    leagueLogs = new Map(loaded);
  }
  const players: DetailedInput['players'] = [];
  if (choice.kind === 'player') {
    const [list, index] = await Promise.all([source.fetchPlayers(season, 'premier'), source.fetchPlayerGameIndex(season, 'premier')]);
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
      const logs = await source.fetchPlayerGameLogs(season, id, 'premier');
      if (!Array.isArray(logs)) throw new Error('選手の試合記録を確認できません。');
      const mine = logs.filter(g => g.gameType === 'regular' && g.min > 0 && teamHome.get(g.scheduleKey) === g.isHome);
      const want = expected.get(id)!;
      if (mine.length !== want.size || mine.some(g => !want.has(g.scheduleKey))) throw new Error('選手の試合記録と索引が揃っていません。');
      return { player, logs: mine };
    });
    players.push(...loaded);
  }
  // 選手情報の登録区分（2026-27以降はシーズン別の記録。読めなければ選手マスタの区分で出し、その旨を書く＝個人詳細と同じ）
  const registrations = choice.kind === 'player' && splitClassificationSeason(season) ? await source.loadSeasonRegistrations(season, 'premier').catch(() => null) : null;
  const d = now();
  const exportedAt = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { ...choice, season, teamId, history, cur, prev, players, registrations, leagueLogs, periodSource, ttsSource, maxForeignOnCourt, exportedAt };
}
