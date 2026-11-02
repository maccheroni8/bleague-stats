// AI向けMarkdown（詳しい版）：タームの試合の選び方・対戦相手の絞り込み・時間帯の型。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
import type { GameSummary, TeamGameLog } from '../../shared/types';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames';
import { resultOnlyLogsForTeam } from './resultOnlyGames';
import { MIN_GAMES_FOR_OPPONENT_WIN_RATE } from './situational';

export type TermKind = 'season' | 'threeTerms' | 'halves' | 'recent5';
export const TERM_KIND_LABELS: Record<TermKind, string> = { season: '1シーズン', threeTerms: '3ターム', halves: '前半戦・後半戦', recent5: '直近5試合' };

/** 中断とみなす「試合のない日」の日数（既存の BIWEEK_GAP_DAYS=10〔開催日の差〕と同じ境界） */
export const BREAK_MIN_OFF_DAYS = 9;
export const RECENT_GAMES = 5;
/** 進行中のシーズンの前半戦の試合数（60試合の半分） */
export const HALF_GAMES = 30;

export interface Gap { before: string; after: string; offDays: number }

const dayNo = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const isoOf = (n: number) => new Date(n * 86_400_000).toISOString().slice(0, 10);

/**
 * リーグのレギュラーシーズンの開催日（重複なし・昇順）。終わった試合＋結果だけの試合＋今後の予定。中止は入れない。
 * 今後の予定（upcomingGames）には試合区分が無いので、レギュラーシーズン中はすべてレギュラーとして扱う（製品では大会区分を確かめる）
 */
export function leagueRegularDates(summaries: readonly GameSummary[], schedule: ScheduleFileExtended): { dates: string[]; scheduledDates: Set<string> } {
  const cancelled = new Set((schedule.cancelledGames ?? []).map(g => g.scheduleKey));
  const played = summaries.filter(g => g.gameType === 'regular' && g.gameEndedFlg && !cancelled.has(g.scheduleKey)).map(g => g.date);
  const resultOnly = (schedule.resultOnlyGames ?? []).filter(g => g.gameType === 'regular').map(g => g.date);
  const playedSet = new Set([...played, ...resultOnly]);
  const upcoming = (schedule.upcomingGames ?? []).filter(g => !cancelled.has(g.scheduleKey)).map(g => g.date);
  const scheduledDates = new Set(upcoming.filter(d => !playedSet.has(d)));
  return { dates: [...new Set([...playedSet, ...upcoming])].sort(), scheduledDates };
}

export function findGaps(dates: readonly string[]): Gap[] {
  const out: Gap[] = [];
  for (let i = 1; i < dates.length; i++) {
    const offDays = dayNo(dates[i]!) - dayNo(dates[i - 1]!) - 1;
    if (offDays >= BREAK_MIN_OFF_DAYS) out.push({ before: dates[i - 1]!, after: dates[i]!, offDays });
  }
  return out;
}

/** 中断（試合のない日 before+1〜after-1）が、その年・月に1日でもかかるか */
export function gapOverlapsMonth(gap: Gap, year: number, month: number): boolean {
  const first = dayNo(`${year}-${String(month).padStart(2, '0')}-01`);
  const last = dayNo(isoOf(dayNo(`${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`) - 1));
  return dayNo(gap.before) + 1 <= last && dayNo(gap.after) - 1 >= first;
}

export type BreakPick = { gap: Gap; candidates: Gap[] } | { gap: null; candidates: Gap[]; reason: 'none' | 'tie' };
export function pickBreak(gaps: readonly Gap[], year: number, month: number): BreakPick {
  const candidates = gaps.filter(g => gapOverlapsMonth(g, year, month));
  if (candidates.length === 0) return { gap: null, candidates, reason: 'none' };
  const max = Math.max(...candidates.map(g => g.offDays));
  const longest = candidates.filter(g => g.offDays === max);
  return longest.length === 1 ? { gap: longest[0]!, candidates } : { gap: null, candidates, reason: 'tie' };
}

export type ThreeTermBreaks = { ok: true; nov: Gap; feb: Gap; novCandidates: Gap[]; febCandidates: Gap[] } | { ok: false; reason: string; nov: BreakPick; feb: BreakPick };
export function threeTermBreaks(season: string, league: 'premier' | 'one', summaries: readonly GameSummary[], schedule: ScheduleFileExtended): ThreeTermBreaks {
  const y = Number(season.slice(0, 4));
  const gaps = findGaps(leagueRegularDates(summaries, schedule).dates);
  const nov = pickBreak(gaps, y, 11);
  const feb = pickBreak(gaps, y + 1, 2);
  if (league === 'one') return { ok: false, reason: 'B.ONE は3タームを選べません', nov, feb };
  if (!nov.gap || !feb.gap) {
    const why = (p: BreakPick, m: string) => (p.gap ? '' : p.reason === 'tie' ? `${m}の中断の候補が同じ長さで複数` : `${m}にかかる中断が見つからない`);
    return { ok: false, reason: [why(nov, '11月'), why(feb, '2月')].filter(Boolean).join('・'), nov, feb };
  }
  return { ok: true, nov: nov.gap, feb: feb.gap, novCandidates: nov.candidates, febCandidates: feb.candidates };
}

/** チームの「結果が確定した試合」（スタッツのある試合＋結果だけの試合）。日付→ScheduleKey の順 */
export interface TeamGame { scheduleKey: string; date: string; win: boolean; isHome: boolean; resultOnly: boolean; log: TeamGameLog }
export function teamConfirmedGames(teamId: string, regularLogs: readonly TeamGameLog[], schedule: ScheduleFileExtended): TeamGame[] {
  const logs = regularLogs.filter(g => g.gameType === 'regular');
  const extra = resultOnlyLogsForTeam(schedule.resultOnlyGames ?? [], teamId, new Set(logs.map(g => g.scheduleKey))).filter(g => g.gameType === 'regular');
  return [...logs.map(log => ({ log, resultOnly: false })), ...extra.map(log => ({ log, resultOnly: true }))]
    .map(({ log, resultOnly }) => ({ scheduleKey: log.scheduleKey, date: log.date, win: log.win, isHome: log.isHome, resultOnly, log }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
}

export interface Term {
  key: string;
  label: string;
  /** 結果が確定した試合（タームの試合数・勝敗） */
  games: TeamGame[];
  /** スタッツのある試合（スタッツの分母） */
  statLogs: TeamGameLog[];
  /** このタームに入る今後の予定の試合数（進行中のシーズンだけ） */
  upcoming: number;
  /** 境界の説明（日付・何試合目） */
  rule: string;
}

function makeTerm(key: string, label: string, games: TeamGame[], upcoming: number, rule: string): Term {
  return { key, label, games, statLogs: games.filter(g => !g.resultOnly).map(g => g.log), upcoming, rule };
}

export interface ScopeInput {
  season: string;
  league: 'premier' | 'one';
  teamId: string;
  teamNames: readonly string[];
  regularLogs: readonly TeamGameLog[];
  summaries: readonly GameSummary[];
  schedule: ScheduleFileExtended;
  /** レギュラーシーズンが終わっているか（isRegularSeasonComplete） */
  complete: boolean;
}

export function upcomingTeamDates(input: ScopeInput): string[] {
  const cancelled = new Set((input.schedule.cancelledGames ?? []).map(g => g.scheduleKey));
  const names = new Set(input.teamNames);
  return (input.schedule.upcomingGames ?? []).filter(g => !cancelled.has(g.scheduleKey) && (names.has(g.homeTeamName) || names.has(g.awayTeamName))).map(g => g.date).sort();
}

/** タームの区分。選べないときは理由 */
export function buildTerms(kind: TermKind, input: ScopeInput): { terms: Term[] } | { unavailable: string } {
  const games = teamConfirmedGames(input.teamId, input.regularLogs, input.schedule);
  const upcoming = input.complete ? [] : upcomingTeamDates(input);
  if (kind === 'season') return { terms: [makeTerm('season', 'シーズン全体', games, upcoming.length, 'レギュラーシーズンのすべての試合')] };
  if (kind === 'recent5') {
    const last = games.slice(-RECENT_GAMES);
    return { terms: [makeTerm('recent5', `直近${RECENT_GAMES}試合`, last, 0, `結果が確定した試合の最後の${RECENT_GAMES}試合${last.length < RECENT_GAMES ? `（${last.length}試合しかない）` : ''}`)] };
  }
  if (kind === 'halves') {
    // 終わったシーズン: そのチームの結果確定試合数の半分（奇数は前半戦に1多く）。進行中のシーズン: 30試合目まで＝前半戦で固定
    // （60試合の半分を定数で持つ。予定の試合数から数えない：B.ONE などは公式の日程にまだ載っていない試合があり、数えると境目がずれる）
    const split = input.complete ? Math.ceil(games.length / 2) : HALF_GAMES;
    const rule = input.complete ? `行った${games.length}試合を半分に分ける（前半戦${split}試合。奇数は前半戦が1試合多い）` : `${HALF_GAMES}試合目までを前半戦（進行中でも境界は動かさない。60試合の半分）`;
    const h1Upcoming = Math.max(0, split - games.length);
    return {
      terms: [
        makeTerm('h1', '前半戦', games.slice(0, split), h1Upcoming, `1〜${split}試合目。${rule}`),
        makeTerm('h2', '後半戦', games.slice(split), Math.max(0, upcoming.length - h1Upcoming), `${split + 1}試合目以降。${rule}`),
      ],
    };
  }
  const br = threeTermBreaks(input.season, input.league, input.summaries, input.schedule);
  if (!br.ok) return { unavailable: br.reason };
  const t1 = games.filter(g => g.date <= br.nov.before);
  const t2 = games.filter(g => g.date >= br.nov.after && g.date <= br.feb.before);
  const t3 = games.filter(g => g.date >= br.feb.after);
  const up = (from: string | null, to: string | null) => upcoming.filter(d => (!from || d >= from) && (!to || d <= to)).length;
  return {
    terms: [
      makeTerm('t1', '第1ターム', t1, up(null, br.nov.before), `開幕〜${br.nov.before}（11月の中断の前）`),
      makeTerm('t2', '第2ターム', t2, up(br.nov.after, br.feb.before), `${br.nov.after}〜${br.feb.before}（11月の中断明け〜2月の中断の前）`),
      makeTerm('t3', '第3ターム', t3, up(br.feb.after, null), `${br.feb.after}〜（2月の中断明け〜）`),
    ],
  };
}

// ---- 対戦相手の絞り込み（段階0の追加） ----
export type OpponentKind = 'all' | 'atLeast60';
export const OPPONENT_KIND_LABELS: Record<OpponentKind, string> = { all: '全チーム', atLeast60: '勝率6割以上' };

/**
 * 相手のその試合に入る時点の勝敗（チームスタッツ・シチュエーション別成績・ランキング等の「対6割以上」の絞り込みと同じ数え方）。
 * 数えるのはリーグのレギュラーシーズンの終わった試合（games-summary）だけ。結果だけの試合は相手の勝敗に数えない（サイトの絞り込みと同じ）。
 * スタッツのある試合は buildRecordsBeforeGame（ScheduleKey で引く）と同じ値。結果だけの試合はその日より前の試合だけで数える。
 */
export function opponentRecordBefore(summaries: readonly GameSummary[], opponentTeamId: string, date: string, scheduleKey: string): { wins: number; losses: number } {
  let wins = 0, losses = 0;
  for (const g of summaries) {
    if (g.gameType !== 'regular' || !g.gameEndedFlg) continue;
    if (g.homeTeamId !== opponentTeamId && g.awayTeamId !== opponentTeamId) continue;
    // buildRecordsBeforeGame と同じ並び（日付→ScheduleKey）で、その試合より前
    if (!(g.date < date || (g.date === date && g.scheduleKey < scheduleKey))) continue;
    const homeWin = g.homeScore > g.awayScore;
    if ((g.homeTeamId === opponentTeamId) === homeWin) wins++; else losses++;
  }
  return { wins, losses };
}

/** 相手の消化試合数がこれ未満なら判定しない（チームスタッツ等の絞り込み「対6割以上」と同じ値） */
export const MIN_OPP_GAMES = MIN_GAMES_FOR_OPPONENT_WIN_RATE;

export type OpponentJudge = 'in' | 'out' | 'tooFew';
export function judgeOpponent(kind: OpponentKind, summaries: readonly GameSummary[], g: TeamGame): OpponentJudge {
  if (kind === 'all') return 'in';
  const r = opponentRecordBefore(summaries, g.log.opponentTeamId, g.date, g.scheduleKey);
  const n = r.wins + r.losses;
  if (n < MIN_OPP_GAMES) return 'tooFew';
  return r.wins / n >= 0.6 ? 'in' : 'out';
}

/** タームを先に決め、そのあとで相手で絞る（タームの境界は絞り込みで動かない） */
export function filterTermByOpponent(t: Term, kind: OpponentKind, summaries: readonly GameSummary[]): Term & { tooFew: number; excluded: number } {
  if (kind === 'all') return { ...t, tooFew: 0, excluded: 0 };
  const judged = t.games.map(g => [g, judgeOpponent(kind, summaries, g)] as const);
  const games = judged.filter(([, j]) => j === 'in').map(([g]) => g);
  return { ...makeTerm(t.key, t.label, games, 0, t.rule), tooFew: judged.filter(([, j]) => j === 'tooFew').length, excluded: judged.filter(([, j]) => j !== 'in').length };
}

/**
 * ターム＋対戦相手。3ターム・前半戦後半戦・1シーズンは「期間を決めてから絞る」。
 * 直近5試合だけは「相手の条件に当てはまる試合の中の直近5試合」（決定 2026-11-03。5試合に満たなければある分だけ）
 */
export function buildTermsWithOpponent(kind: TermKind, opp: OpponentKind, input: ScopeInput): { terms: (Term & { tooFew: number; excluded: number })[] } | { unavailable: string } {
  if (kind === 'recent5' && opp !== 'all') {
    const all = teamConfirmedGames(input.teamId, input.regularLogs, input.schedule);
    const judged = all.map(g => [g, judgeOpponent(opp, input.summaries, g)] as const);
    const hits = judged.filter(([, j]) => j === 'in').map(([g]) => g);
    const last = hits.slice(-RECENT_GAMES);
    const rule = `${OPPONENT_KIND_LABELS[opp]}の相手との試合のうち、最後の${RECENT_GAMES}試合${last.length < RECENT_GAMES ? `（${last.length}試合しかない）` : ''}。直近5試合だけは、相手で絞ってから5試合を選ぶ`;
    return { terms: [{ ...makeTerm('recent5', `直近${RECENT_GAMES}試合`, last, 0, rule), tooFew: judged.filter(([, j]) => j === 'tooFew').length, excluded: judged.filter(([, j]) => j !== 'in').length }] };
  }
  const r = buildTerms(kind, input);
  if ('unavailable' in r) return r;
  return { terms: r.terms.map(t => filterTermByOpponent(t, opp, input.summaries)) };
}

// ---- 選ぶ画面の選択肢（段階1。準備中の選択肢は選べない形で見せる） ----
/** 時間帯。あとから 'clutch'（クラッチタイム）を足せる形にする */
export type TimeSlice = 'game' | 'h1' | 'h2';
export interface TimeSliceChoice { key: string; label: string; slices: readonly TimeSlice[]; available: (season: string) => boolean }
export const TIME_SLICE_CHOICES: readonly TimeSliceChoice[] = [
  { key: 'game', label: '試合全体だけ', slices: ['game'], available: () => true },
  { key: 'halves', label: '前半・後半も含める', slices: ['game', 'h1', 'h2'], available: () => false },
];
export interface TermChoice { kind: TermKind; label: string; available: boolean }
export const TERM_CHOICES: readonly TermChoice[] = [
  { kind: 'season', label: '1シーズン', available: true },
  { kind: 'recent5', label: '直近5試合', available: true },
  { kind: 'threeTerms', label: '3ターム', available: true },
  { kind: 'halves', label: '前半戦・後半戦', available: true },
];
