import type { Category, Division, GameSummary } from '../../shared/types.ts';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames.ts';
import type { CalendarGame } from '../../shared/annualSchedule.ts';
import { annualLeagueGames } from './annualSchedule.ts';

/** 「年間1試合の対戦」を確定表示するシーズンとリーグ。ほかは理由つきで対象外にする（調査メモ D の2・4章）。 */
export const ONE_GAME_SEASON = '2026-27';
export const ONE_GAME_LEAGUE: Category = 'premier';

/** 公開後の誤判定を防ぐ条件。満たさないときは断定せず「日程を確認中」にする。 */
export const ONE_GAME_EXPECTED = {
  clubs: 26,
  gamesPerClub: 60,
  totalGames: 780,
  sameDivisionGames: 3,
  otherDivisionGames: [1, 2],
  singleOpponentsPerClub: 2,
} as const;

export type MatchupStatus = 'final' | 'live' | 'cancelled' | 'upcoming' | 'unrecorded';
export const MATCHUP_STATUS_LABELS: Record<MatchupStatus, string> = {
  final: '終了', live: '試合中', cancelled: '中止', upcoming: '予定', unrecorded: '結果未収録',
};

export interface OneGameMatchup {
  id: string;
  date: string;
  tipoff?: string;
  homeId: string;
  awayId: string;
  status: MatchupStatus;
  homeScore?: number;
  awayScore?: number;
  note?: string;
  gameLink?: string;
}
export interface OneGameTeam { teamId: string; teamName: string; division: Division }
/** 1クラブから見た1試合の相手 */
export interface OneGameOpponent { opponentId: string; isHome: boolean; game: OneGameMatchup }

export type OneGameResult =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'checking'; problems: string[] }
  | { kind: 'ready'; teams: OneGameTeam[]; matchups: OneGameMatchup[]; byTeam: Map<string, OneGameOpponent[]> };

export function oneGameUnsupportedReason(season: string, league: Category): string | null {
  if (league === 'one') return 'B.ONEは制度上、他地区と1試合だけ対戦する組み合わせがないため、対象外です。';
  if (season !== ONE_GAME_SEASON) return `${ONE_GAME_SEASON}より前のシーズンは地区の分け方や対戦の回数が異なるため、対象外です。`;
  return null;
}

/** 日付を過ぎても結果がない試合は延期と決めつけず「結果未収録」にする。today は JST の YYYY-MM-DD。 */
export function matchupStatus(game: CalendarGame, today: string): MatchupStatus {
  if (game.status === 'final') return 'final';
  if (game.status === 'live') return 'live';
  if (game.status === 'cancelled') return 'cancelled';
  return game.date < today ? 'unrecorded' : 'upcoming';
}

const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

/**
 * 当初の年間日程で1試合だけ組まれた他地区の組み合わせを求める。年間の判定を先にし、絞り込みは画面側で後から行う。
 * 中止・結果だけ・試合中も1件として数える（実施試合だけで数えない）。
 */
export function buildOneGameMatchups(input: {
  season: string; league: Category;
  summaries: GameSummary[]; schedule: ScheduleFileExtended | null;
  teams: { teamId: string; teamName: string }[];
  divisions: Record<string, Division> | undefined;
  today: string;
}): OneGameResult {
  const reason = oneGameUnsupportedReason(input.season, input.league);
  if (reason) return { kind: 'unsupported', reason };
  const E = ONE_GAME_EXPECTED;
  const problems: string[] = [];
  const regular = input.summaries.filter(g => g.gameType === 'regular');
  const games = annualLeagueGames(regular, input.schedule, input.teams);
  const divisions = input.divisions ?? {};
  const clubIds = new Set<string>();
  const counts = new Map<string, CalendarGame[]>();
  const perClub = new Map<string, number>();
  let unresolved = 0;
  for (const g of games) {
    if (!g.home.id || !g.away.id) { unresolved++; continue; }
    clubIds.add(g.home.id); clubIds.add(g.away.id);
    const key = pairKey(g.home.id, g.away.id);
    counts.set(key, [...(counts.get(key) ?? []), g]);
    for (const id of [g.home.id, g.away.id]) perClub.set(id, (perClub.get(id) ?? 0) + 1);
  }
  if (unresolved) problems.push(`チームを特定できない試合が${unresolved}件`);
  if (games.length !== E.totalGames) problems.push(`全試合が${games.length}件（${E.totalGames}件のはず）`);
  if (clubIds.size !== E.clubs) problems.push(`クラブ数が${clubIds.size}（${E.clubs}のはず）`);
  const noDivision = [...clubIds].filter(id => divisions[id] !== 'east' && divisions[id] !== 'west');
  if (noDivision.length) problems.push(`地区を特定できないクラブが${noDivision.length}件`);
  for (const id of clubIds) if (perClub.get(id) !== E.gamesPerClub) problems.push(`${id}の試合数が${perClub.get(id)}（${E.gamesPerClub}のはず）`);
  const singles = new Map<string, number>();
  const matchups: OneGameMatchup[] = [];
  const ids = [...clubIds];
  for (const [key, list] of counts) {
    const [a, b] = key.split('|') as [string, string];
    if (divisions[a] === undefined || divisions[b] === undefined) continue;
    const same = divisions[a] === divisions[b];
    if (same) {
      if (list.length !== E.sameDivisionGames) problems.push(`同地区${a}-${b}が${list.length}試合`);
    } else if (!(E.otherDivisionGames as readonly number[]).includes(list.length)) {
      problems.push(`他地区${a}-${b}が${list.length}試合`);
    } else if (list.length === 1) {
      const g = list[0]!;
      singles.set(a, (singles.get(a) ?? 0) + 1); singles.set(b, (singles.get(b) ?? 0) + 1);
      matchups.push({
        id: g.id, date: g.date, tipoff: g.tipoff, homeId: g.home.id!, awayId: g.away.id!,
        status: matchupStatus(g, input.today), homeScore: g.homeScore, awayScore: g.awayScore, note: g.note, gameLink: g.gameLink,
      });
    }
  }
  // 地区の違うすべての組み合わせが日程に出ていること（0試合の組み合わせがない）
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i]!, b = ids[j]!;
    if (!counts.has(pairKey(a, b))) problems.push(`${a}-${b}の対戦が日程にない`);
  }
  for (const id of clubIds) if ((singles.get(id) ?? 0) !== E.singleOpponentsPerClub) problems.push(`${id}の1回戦の相手が${singles.get(id) ?? 0}クラブ`);
  if (problems.length) return { kind: 'checking', problems };
  const names = new Map(input.teams.map(t => [t.teamId, t.teamName]));
  for (const g of regular) { names.set(g.homeTeamId, g.homeTeamName); names.set(g.awayTeamId, g.awayTeamName); }
  const teams = ids.map(id => ({ teamId: id, teamName: names.get(id) ?? id, division: divisions[id]! }));
  matchups.sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
  const byTeam = new Map<string, OneGameOpponent[]>(ids.map(id => [id, []]));
  for (const m of matchups) {
    byTeam.get(m.homeId)!.push({ opponentId: m.awayId, isHome: true, game: m });
    byTeam.get(m.awayId)!.push({ opponentId: m.homeId, isHome: false, game: m });
  }
  return { kind: 'ready', teams, matchups, byTeam };
}

/** 日本時間の今日（YYYY-MM-DD） */
export function jstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
