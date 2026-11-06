import type { Division, GameSummary } from '../../shared/types.ts';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames.ts';
import type { CalendarGame } from '../../shared/annualSchedule.ts';
import { annualLeagueGames } from './annualSchedule.ts';

export type MatchupStatus = 'final' | 'live' | 'cancelled' | 'upcoming' | 'unrecorded';
export const MATCHUP_STATUS_LABELS: Record<MatchupStatus, string> = {
  final: '終了', live: '試合中', cancelled: '中止', upcoming: '予定', unrecorded: '結果未収録',
};

export interface MatchupGame {
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
export interface MatchupTeam { teamId: string; teamName: string; division: Division }
/** 2クラブの組み合わせ（レギュラーシーズンの当初の年間日程での対戦） */
export interface PairInfo { aId: string; bId: string; sameDivision: boolean; count: number; games: MatchupGame[] }
/** 地区の組み合わせごとの「対戦数 → 組数」。cross は他地区どうし、same は同じ地区の中 */
export interface DivisionPairRow { kind: 'cross' | 'same'; divisions: [Division, Division]; counts: { count: number; pairs: number }[] }
/** 1クラブから見た、ふつうと違う対戦数の相手 */
export interface TeamDeviation { opponentId: string; count: number; direction: 'fewer' | 'more'; games: { game: MatchupGame; isHome: boolean }[] }

export type DivisionMatchupResult =
  | { kind: 'unsupported'; reason: string }
  | {
    kind: 'ready';
    teams: MatchupTeam[];
    /** そのシーズンにある地区（渡された並び順） */
    divisions: Division[];
    pairs: Map<string, PairInfo>;
    /** 他地区との「ふつうの対戦数」＝そのシーズンでいちばん多い対戦数（同数のときは小さいほう） */
    normal: number;
    rows: DivisionPairRow[];
    byTeam: Map<string, TeamDeviation[]>;
    totalGames: number;
  };

/** 日付を過ぎても結果がない試合は延期と決めつけず「結果未収録」にする。today は JST の YYYY-MM-DD。 */
export function matchupStatus(game: CalendarGame, today: string): MatchupStatus {
  if (game.status === 'final') return 'final';
  if (game.status === 'live') return 'live';
  if (game.status === 'cancelled') return 'cancelled';
  return game.date < today ? 'unrecorded' : 'upcoming';
}

export const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

/** いちばん多い対戦数。同数のときは小さいほう。値が無ければ null */
export function mostCommonCount(counts: readonly number[]): number | null {
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  let best: number | null = null;
  for (const [count, n] of tally) {
    if (best === null || n > tally.get(best)! || (n === tally.get(best)! && count < best)) best = count;
  }
  return best;
}

/**
 * 当初の年間日程（実施・中止・結果だけ・試合中・予定をすべて1試合として数える）で、クラブの組み合わせごとの対戦数を求める。
 * 絞り込み（クラブ）は画面側で後から行う。
 */
export function buildDivisionMatchups(input: {
  season: string;
  summaries: GameSummary[]; schedule: ScheduleFileExtended | null;
  teams: { teamId: string; teamName: string }[];
  divisions: Record<string, Division> | undefined;
  /** そのリーグの地区の並び（divisionOrder(league)） */
  divisionOrder: readonly Division[];
  today: string;
}): DivisionMatchupResult {
  if (!input.divisions || Object.keys(input.divisions).length === 0) return { kind: 'unsupported', reason: 'このシーズンは地区の情報がないため、表示できません。' };
  const regular = input.summaries.filter(g => g.gameType === 'regular');
  const games = annualLeagueGames(regular, input.schedule, input.teams);
  const divisions = input.divisions;
  const names = new Map(input.teams.map(t => [t.teamId, t.teamName]));
  for (const g of regular) { names.set(g.homeTeamId, g.homeTeamName); names.set(g.awayTeamId, g.awayTeamName); }
  const grouped = new Map<string, { a: string; b: string; games: CalendarGame[] }>();
  const clubs = new Set<string>();
  for (const g of games) {
    const h = g.home.id, a = g.away.id;
    if (!h || !a || !divisions[h] || !divisions[a]) continue; // チーム・地区を特定できない試合は数えない
    clubs.add(h); clubs.add(a);
    const key = pairKey(h, a);
    const entry = grouped.get(key) ?? { a: key.split('|')[0]!, b: key.split('|')[1]!, games: [] };
    entry.games.push(g);
    grouped.set(key, entry);
  }
  const pairs = new Map<string, PairInfo>();
  for (const [key, e] of grouped) {
    const list: MatchupGame[] = e.games.map(g => ({
      id: g.id, date: g.date, tipoff: g.tipoff, homeId: g.home.id!, awayId: g.away.id!,
      status: matchupStatus(g, input.today), homeScore: g.homeScore, awayScore: g.awayScore, note: g.note, gameLink: g.gameLink,
    }));
    pairs.set(key, { aId: e.a, bId: e.b, sameDivision: divisions[e.a] === divisions[e.b], count: list.length, games: list });
  }
  const present = input.divisionOrder.filter(d => [...clubs].some(id => divisions[id] === d));
  const crossCounts = [...pairs.values()].filter(p => !p.sameDivision).map(p => p.count);
  const normal = mostCommonCount(crossCounts);
  if (normal === null) return { kind: 'unsupported', reason: 'このシーズンには、他の地区との対戦がありません。' };
  const rows: DivisionPairRow[] = [];
  const tally = (pick: (p: PairInfo) => boolean): { count: number; pairs: number }[] => {
    const m = new Map<number, number>();
    for (const p of pairs.values()) if (pick(p)) m.set(p.count, (m.get(p.count) ?? 0) + 1);
    return [...m].map(([count, n]) => ({ count, pairs: n })).sort((x, y) => x.count - y.count);
  };
  for (let i = 0; i < present.length; i++) for (let j = i + 1; j < present.length; j++) {
    const di = present[i]!, dj = present[j]!;
    rows.push({ kind: 'cross', divisions: [di, dj], counts: tally(p => !p.sameDivision && ((divisions[p.aId] === di && divisions[p.bId] === dj) || (divisions[p.aId] === dj && divisions[p.bId] === di))) });
  }
  for (const d of present) rows.push({ kind: 'same', divisions: [d, d], counts: tally(p => p.sameDivision && divisions[p.aId] === d) });
  const teams: MatchupTeam[] = [...clubs].map(id => ({ teamId: id, teamName: names.get(id) ?? id, division: divisions[id]! }));
  const byTeam = new Map<string, TeamDeviation[]>(teams.map(t => [t.teamId, []]));
  for (const p of [...pairs.values()].sort((x, y) => (x.games[0]!.date).localeCompare(y.games[0]!.date) || x.games[0]!.id.localeCompare(y.games[0]!.id))) {
    if (p.sameDivision || p.count === normal) continue;
    const direction = p.count < normal ? 'fewer' : 'more';
    const sorted = [...p.games].sort((x, y) => x.date.localeCompare(y.date) || x.id.localeCompare(y.id));
    byTeam.get(p.aId)!.push({ opponentId: p.bId, count: p.count, direction, games: sorted.map(game => ({ game, isHome: game.homeId === p.aId })) });
    byTeam.get(p.bId)!.push({ opponentId: p.aId, count: p.count, direction, games: sorted.map(game => ({ game, isHome: game.homeId === p.bId })) });
  }
  return { kind: 'ready', teams, divisions: present, pairs, normal, rows, byTeam, totalGames: [...pairs.values()].reduce((n, p) => n + p.count, 0) };
}

/** そのチームから見た勝敗。終了した試合だけで、予定・試合中・中止・結果未収録は null。 */
export function matchupOutcome(game: MatchupGame, isHome: boolean): 'win' | 'loss' | null {
  if (game.status !== 'final' || game.homeScore === undefined || game.awayScore === undefined || game.homeScore === game.awayScore) return null;
  return (game.homeScore > game.awayScore) === isHome ? 'win' : 'loss';
}

/** 日本時間の今日（YYYY-MM-DD） */
export function jstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
