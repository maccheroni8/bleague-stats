// 選手詳細の md（AI向け書き出し）：入力の型と、対象期間（ターム・対戦相手）の試合の選び方。
// ターム・対戦相手の決め方はチーム詳細の「詳しい版」と同じ関数（detailedTerms）を呼ぶ。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
import type { GameSummary, PlayerCareersFile, PlayerGameLog, PlayerSummary, TeamGameLog, TeamHistoryEntry, TeamSummary, YahooGamePbp } from '../../shared/types';
import type { ScheduleFileExtended } from '../../shared/resultOnlyGames';
import type { SeasonRegistrationFile } from '../../shared/registration';
import type { StoredGame } from '../../shared/types';
import type { League } from './league';
import type { OpponentKind, TermKind } from './aiExportScope';
import { buildTermsWithOpponent } from './aiExportScope';
import { isRegularSeasonComplete } from '../../shared/regularSeasonComplete';
import { teamNameInSeason } from './teamLabel';
import type { TeamSummary as TeamSummaryT } from '../../shared/types';
import { buildGameTeamsByScheduleKey, resolveOwnTeam, type GameTeamInfo } from './situational';
import type { SeasonPeriodSource } from './seasonPeriod';
import type { AiPlayerRankData } from './aiPlayerRank';
import type { AiPlayerExtra } from './aiPlayerExtra';

/** 1シーズン分の、この選手と、リーグ全体の材料 */
export interface PlayerMdSeason {
  season: string;
  players: PlayerSummary[];
  teams: TeamSummary[];
  summaries: GameSummary[];
  schedule: ScheduleFileExtended;
  /** 対象の選手（そのシーズン・リーグの players.json の行） */
  player: PlayerSummary;
  /** 対象の選手の試合ログ（レギュラー・ポストシーズン。出場0分の行を含む） */
  logs: PlayerGameLog[];
  /** 対象の選手が所属したチームの試合ログ（チームID → レギュラーシーズン・ポストシーズン） */
  teamLogs: Map<string, TeamGameLog[]>;
}

/** 通算（他のシーズン）の1シーズン分。試合ログとそのシーズンの所属チーム */
export interface PlayerMdCareerSeason {
  season: string;
  league: League;
  logs: PlayerGameLog[];
  summaries: GameSummary[];
  teamLogs: Map<string, TeamGameLog[]>;
  /** そのシーズンの players.json の行（無いときは null） */
  player: PlayerSummary | null;
}

export interface PlayerMdInput {
  league: League;
  season: string;
  playerId: string;
  term: TermKind;
  opp: OpponentKind;
  history: TeamHistoryEntry[];
  division: unknown;
  cur: PlayerMdSeason;
  prev: PlayerMdSeason | null;
  /** 「前季全体と比べる」を入れたか。入れないときは前季の値を一切出さない */
  compare: boolean;
  /** 比べる前季の名前（最初のシーズンは null） */
  prevName: string | null;
  /** 前季を出せない理由（出せるときは null） */
  prevReason: string | null;
  prevRank: AiPlayerRankData | null;
  prevPeriodSource: SeasonPeriodSource | null;
  prevPbps: ReadonlyMap<string, YahooGamePbp>;
  prevRawGames: ReadonlyMap<string, StoredGame>;
  registrations: SeasonRegistrationFile | null;
  careers: PlayerCareersFile | null;
  awards: { season: string; name: string; category?: string }[];
  nameHistory: { name: string; fromSeason?: string; toSeason?: string }[];
  /** 区間（Q別・前後半・延長・クラッチ）の索引 */
  periodSource: SeasonPeriodSource | null;
  /** リーグ内の順位の材料（ランキングの掲載基準を満たす選手の値） */
  rank: AiPlayerRankData | null;
  /** スポーツナビの記録（scheduleKey → 記録。対象の試合のうち記録があるもの） */
  pbps: ReadonlyMap<string, YahooGamePbp>;
  /** 試合の生データ（scheduleKey → 記録。エリア別シュートのため。対象の試合） */
  rawGames: ReadonlyMap<string, StoredGame>;
  /** 通算（出場したシーズン） */
  career: PlayerMdCareerSeason[];
  /** その他（On/Off の組み合わせ・アシストペア・記録のランキングなど） */
  extra: AiPlayerExtra | null;
  exportedAt: string;
}

export interface PlayerScopeTerm {
  key: string;
  label: string;
  rule: string;
  /** チームの対象の試合（結果だけの試合を含む）の勝敗の数え用 */
  teamGames: { scheduleKey: string; date: string; win: boolean; resultOnly: boolean }[];
  /** 対象の試合の、この選手の試合ログ（レギュラーシーズン。出場0分を含む） */
  logs: PlayerGameLog[];
  excluded: number;
}

export interface PlayerScope {
  /** 対象のチーム（ターム・対戦相手の基準。移籍した選手は最後に出たチーム） */
  teamId: string;
  teamName: string;
  terms: PlayerScopeTerm[];
  /** シーズン全体（ターム分けの参考列。1シーズンのときは terms[0] と同じ） */
  seasonTerm: PlayerScopeTerm;
  /** 全タームの試合の合計 */
  union: PlayerGameLog[];
  /** 出場した試合（出場時間が0より長い）の合計 */
  playedUnion: PlayerGameLog[];
  /** 1シーズン・全チームのとき（移籍した選手の全チームの試合を含む） */
  allTeams: boolean;
  ownBy: Map<string, GameTeamInfo>;
}

interface DetailedSeason { season: string; teams: TeamSummaryT[]; team: TeamSummaryT; regular: TeamGameLog[]; summaries: GameSummary[]; schedule: ScheduleFileExtended; division: unknown }
/** チーム詳細の md（詳しい版）の detailedTerms と同じ決め方（画面側の重い部品を読み込まないよう、ここに置く） */
function detailedTerms(d: DetailedSeason, kind: TermKind, opp: OpponentKind, teamId: string, history: TeamHistoryEntry[], league: League) {
  const complete = isRegularSeasonComplete({ schedule: d.schedule, summaries: d.summaries });
  const names = [d.team.teamName, teamNameInSeason(history, teamId, d.season, d.team.teamName)];
  const r = buildTermsWithOpponent(kind, opp, { season: d.season, league, teamId, teamNames: names, regularLogs: d.regular, summaries: d.summaries, schedule: d.schedule, complete });
  if ('unavailable' in r) throw new Error(`このタームは選べません: ${r.unavailable}`);
  return r.terms;
}

const byDate = <T extends { date: string; scheduleKey: string }>(a: T, b: T) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey);

/** 試合ごとの自チーム（出場した試合の分。scheduleKey → チーム） */
export function ownTeamMap(season: PlayerMdSeason | { summaries: GameSummary[]; logs: PlayerGameLog[] }): Map<string, GameTeamInfo> {
  const gameTeams = buildGameTeamsByScheduleKey(season.summaries);
  const map = new Map<string, GameTeamInfo>();
  for (const g of season.logs) {
    const own = resolveOwnTeam(g, gameTeams);
    if (own) map.set(g.scheduleKey, own);
  }
  return map;
}

/** この選手の最後の試合の自チーム（レギュラーシーズン優先） */
function lastTeamOf(s: PlayerMdSeason, ownBy: Map<string, GameTeamInfo>): GameTeamInfo | null {
  const regular = s.logs.filter(g => g.gameType === 'regular' && ownBy.has(g.scheduleKey)).sort(byDate);
  const last = regular.at(-1) ?? s.logs.filter(g => ownBy.has(g.scheduleKey)).sort(byDate).at(-1);
  return last ? ownBy.get(last.scheduleKey)! : null;
}

/** 対象期間の試合を決める。1シーズン・全チームのときは、移籍した選手の全チームの試合を含む */
export function playerScope(i: Pick<PlayerMdInput, 'season' | 'league' | 'term' | 'opp' | 'history' | 'division' | 'cur'>): PlayerScope {
  const cur = i.cur;
  const ownBy = ownTeamMap(cur);
  const regularLogs = cur.logs.filter(g => g.gameType === 'regular').sort(byDate);
  const team = lastTeamOf(cur, ownBy) ?? { teamId: cur.player.teamId, teamName: cur.player.teamName };
  const teamId = team.teamId;
  const teamName = cur.teams.find(t => t.teamId === teamId)?.teamName ?? team.teamName;
  const done = (terms: PlayerScopeTerm[], seasonTerm: PlayerScopeTerm, allTeams: boolean): PlayerScope => {
    const seen = new Set<string>();
    const union: PlayerGameLog[] = [];
    for (const t of terms) for (const g of t.logs) if (!seen.has(g.scheduleKey)) { seen.add(g.scheduleKey); union.push(g); }
    union.sort(byDate);
    return { teamId, teamName, terms, seasonTerm, union, playedUnion: union.filter(g => g.min > 0), allTeams, ownBy };
  };
  if (i.term === 'season' && i.opp === 'all') {
    const games = [...new Set(regularLogs.map(g => g.scheduleKey))].map(k => {
      const g = regularLogs.find(x => x.scheduleKey === k)!;
      return { scheduleKey: k, date: g.date, win: g.win, resultOnly: false };
    });
    const t: PlayerScopeTerm = {
      key: 'season', label: '1シーズン',
      rule: 'このシーズンのレギュラーシーズンの全試合。シーズンの途中で移籍した選手は、所属したすべてのチームでの試合を含む',
      teamGames: games, logs: regularLogs, excluded: 0,
    };
    return done([t], t, true);
  }
  const teamRegular = (cur.teamLogs.get(teamId) ?? []).filter(g => g.gameType === 'regular').sort(byDate);
  const teamSummary = cur.teams.find(t => t.teamId === teamId);
  if (!teamSummary) throw new Error('対象チームの記録がありません。');
  const ds: DetailedSeason = { season: i.season, teams: cur.teams, team: teamSummary, regular: teamRegular, summaries: cur.summaries, schedule: cur.schedule, division: i.division };
  const own = (g: PlayerGameLog) => ownBy.get(g.scheduleKey)?.teamId === teamId;
  const conv = (t: ReturnType<typeof detailedTerms>[number]): PlayerScopeTerm => {
    const keys = new Set(t.statLogs.map(g => g.scheduleKey));
    return {
      key: t.key, label: t.label, rule: t.rule,
      teamGames: t.games.map(g => ({ scheduleKey: g.scheduleKey, date: g.date, win: g.win, resultOnly: g.resultOnly })),
      logs: regularLogs.filter(g => keys.has(g.scheduleKey) && own(g)),
      excluded: t.excluded,
    };
  };
  const terms = detailedTerms(ds, i.term, i.opp, teamId, i.history, i.league).map(conv);
  const seasonTerm = terms.length > 1 ? conv(detailedTerms(ds, 'season', i.opp, teamId, i.history, i.league)[0]!) : terms[0]!;
  return done(terms, seasonTerm, false);
}
