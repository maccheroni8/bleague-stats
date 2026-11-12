// 選手詳細の md：リーグ内の順位（ランキング > 個人 > シーズン成績の、条件なし・レギュラーシーズン・全選手・平均の表と同じ決め方）。
// 掲載基準＝出場率（MIN_GAMES_PLAYED_RATIO_FOR_RANKING）と項目ごとの追加基準。順位の付け方は「同じ値は同じ順位・次は飛ばす」（表示の文字で判定）。
// 画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
import type { PlayerGameLog, PlayerSummary, TeamGameLog, TeamSummary } from '../../shared/types';
import { teamTotalsForPlayedGames } from '../../shared/playedTeamTotals';
import { buildGameTeamsByScheduleKey, resolveOwnTeam } from './situational';
import {
  EXTRA_ADVANCED_PLAYER_ITEMS, ON_COURT_SHARE_STAT_KEYS, boxColumnItem, buildProfileItems, doubleItems, extraRuleKey, rawTotalsFromPlayerSummary, seasonBoxColumnsByTab,
  withPppColumn, type PlayerRankItem,
} from './playerSeasonRanking';
import { EXTRA_ELIGIBILITY_RULES, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, filterEligiblePlayers } from './playerRankingEligibility';
import { zeroDenominator } from './aiPlayerCommon';
import { buildSeasonBoxscoreCtx, sumPlayerGameLogs, EMPTY_TEAM_TOTALS, type SeasonBoxscoreCtx, countDoubleTripleDoubles } from './playerSeasonBoxscore';
import { shotTypeEntityColumns, SHOT_TYPE_DISPLAY_ORDER } from './shotTypeBreakdown';
import { foulColumnsSplit } from './ruleChange';
import { rankPositions } from './seasonCompare';
import { CATEGORY_LABELS } from './categoryLabels';
import type { GameSummary } from '../../shared/types';

export interface AiPlayerRankData {
  season: string;
  players: PlayerSummary[];
  teams: TeamSummary[];
  summaries: GameSummary[];
  /** Misc・Scoring の値のため。掲載基準（出場率）を満たす選手の試合ログ（playerId → ログ） */
  logs: ReadonlyMap<string, PlayerGameLog[]>;
  /** 全チームの試合ログ（Misc・Scoring の分母） */
  teamLogs: ReadonlyMap<string, TeamGameLog[]>;
}

export interface RankLine {
  category: string;
  key: string;
  label: string;
  /** その選手の値（平均の表示） */
  value: string;
  /** 順位（掲載基準を満たさない・値が無いときは null） */
  rank: number | null;
  total: number;
  note: string;
  /** 同じ値（表示の文字が同じ）の人数（自分を含む。順位が付いたときだけ） */
  ties: number;
  /** 良い悪いの向き。none は向きが決まっていない項目（順位を付けない） */
  direction: '多い順' | '少ない順' | 'none';
}

/** ランキングのページで良し悪しの向きを決めていない項目（多い順に並べるが良し悪しの意味が無い）。md では順位を付けない */
const NO_DIRECTION = new Set(['flag', 'disr', 'ufoul', 'dqfoul', 'offfoul']);

export const RANK_ELIGIBILITY_TEXT = `出場率${Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100)}%以上（所属チームの試合数に対する出場試合数）。項目によって追加の基準がある（FG%：FGM 1.5本/試合以上、2P%：2PM 1.0本/試合以上、3P%：3PM 1.5本/試合以上、FT%：FTM 1.0本/試合以上）`;

/** Misc・Scoring の順位のために試合ログが要る選手（出場率の掲載基準を満たす選手） */
export function rankLogPlayers(players: PlayerSummary[], teams: TeamSummary[]): PlayerSummary[] {
  return filterEligiblePlayers(players, teams, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, '', 0);
}

type CtxOf = (p: PlayerSummary) => SeasonBoxscoreCtx | null;

export function buildRankLines(data: AiPlayerRankData, target: PlayerSummary): RankLine[] {
  const { season, players, teams } = data;
  const startYear = Number(season.slice(0, 4));
  const foulSplit = foulColumnsSplit([season]);
  const gameTeams = buildGameTeamsByScheduleKey(data.summaries);
  // 条件なしの経路（試合ログを読まない）：集計済みの値
  const summaryCtx = new Map<string, SeasonBoxscoreCtx>();
  const summaryCtxOf: CtxOf = p => {
    let c = summaryCtx.get(p.playerId);
    if (!c) { c = buildSeasonBoxscoreCtx(rawTotalsFromPlayerSummary(p), p.playedTeamTotals ?? EMPTY_TEAM_TOTALS, 'perGame', startYear); summaryCtx.set(p.playerId, c); }
    return c;
  };
  // Misc・Scoring：試合ログから（レギュラーシーズン）
  const logCtx = new Map<string, SeasonBoxscoreCtx | null>();
  const logCtxOf: CtxOf = p => {
    if (logCtx.has(p.playerId)) return logCtx.get(p.playerId)!;
    const all = data.logs.get(p.playerId);
    let c: SeasonBoxscoreCtx | null = null;
    if (all) {
      const regular = all.filter(g => g.gameType === 'regular');
      const team = teamTotalsForPlayedGames(regular, g => resolveOwnTeam(g, gameTeams)?.teamId, data.teamLogs);
      c = buildSeasonBoxscoreCtx(sumPlayerGameLogs(regular), team, 'perGame', startYear);
    }
    logCtx.set(p.playerId, c);
    return c;
  };
  const doubles = (p: PlayerSummary) => ({ dd: p.totals.doubleDoubles, td: p.totals.tripleDoubles, p10: p.totals.points10Games, games: p.gamesPlayed });

  const lines: RankLine[] = [];
  const rankItems = (category: string, items: PlayerRankItem[], ctxFor: (key: string) => CtxOf, pool: PlayerSummary[], keep: (p: PlayerSummary, key: string) => boolean) => {
    for (const item of items) {
      // G・GS・MIN・PTS は Traditional だけ（ほかの表では繰り返さない）
      if (category !== 'traditional' && category !== 'shooting' && ['g', 'gs', 'min', 'pts'].includes(item.key)) continue;
      const ctxOf = ctxFor(item.key);
      const eligible = filterEligiblePlayers(pool, teams, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, extraRuleKey(item.key), EXTRA_ELIGIBILITY_RULES[extraRuleKey(item.key)]?.defaultValue ?? 0);
      const isEligible = eligible.some(p => p.playerId === target.playerId);
      const higher = item.higherIsBetter !== false;
      const direction = NO_DIRECTION.has(item.key) ? 'none' : higher ? '多い順' : '少ない順';
      const text = (p: PlayerSummary) => {
        const c = ctxOf(p);
        if (c && zeroDenominator(item.key, item.label, c.raw)) return '-';
        return item.format(p, c);
      };
      // 値が「-」の選手は順位を付けず、人数にも入れない
      const rows = eligible.filter(p => keep(p, item.key) && text(p) !== '-');
      const num = (p: PlayerSummary) => item.value(p, ctxOf(p));
      const sorted = rows.map(p => ({ p, v: num(p), t: text(p) })).sort((a, b) => (higher ? b.v - a.v : a.v - b.v));
      const ranks = rankPositions(sorted.map(x => x.t));
      const at = sorted.findIndex(x => x.p.playerId === target.playerId);
      const value = text(target);
      const base = { category, key: item.key, label: item.label, value, total: rows.length, direction } as const;
      if (value === '-') lines.push({ ...base, rank: null, note: '値なし（順位なし）', ties: 0 });
      else if (!isEligible) lines.push({ ...base, rank: null, note: '掲載基準未達', ties: 0 });
      else if (direction === 'none') lines.push({ ...base, rank: null, note: '順位なし（ランキングで良し悪しの向きを決めていない項目）', ties: 0 });
      else if (at < 0) lines.push({ ...base, rank: null, note: 'この項目の対象外（値なし）', ties: 0 });
      else lines.push({ ...base, rank: ranks[at]!, note: '', ties: sorted.filter(x => x.t === sorted[at]!.t).length });
    }
  };
  const cols = seasonBoxColumnsByTab(foulSplit);
  const keepAll = (p: PlayerSummary, key: string, ctxOf: CtxOf) => {
    const c = ctxOf(p);
    if (!c || c.raw.gamesPlayed < 1) return false;
    if (key === 'ftr') return c.raw.fga > 0;
    if (ON_COURT_SHARE_STAT_KEYS.has(key)) return c.raw.ocGames > 0;
    return true;
  };
  const dd = doubleItems(p => doubles(p), 'perGame');
  rankItems('traditional', [...cols.traditional.map(c => boxColumnItem(c, 'perGame')), ...dd], () => summaryCtxOf, players, (p, key) => {
    if (key === 'dd2' || key === 'td3' || key === 'pts10') { const c = doubles(p); return ((key === 'dd2' ? c.dd : key === 'td3' ? c.td : c.p10) ?? 0) > 0; }
    return keepAll(p, key, summaryCtxOf);
  });
  rankItems('advanced', [...withPppColumn(cols.advanced).map(c => boxColumnItem(c, 'perGame')), ...EXTRA_ADVANCED_PLAYER_ITEMS], key => (key === 'pace' || key === 'poss' ? logCtxOf : summaryCtxOf), players,
    (p, key) => (key === 'per' ? true : keepAll(p, key, key === 'pace' || key === 'poss' ? logCtxOf : summaryCtxOf)));
  const logPool = players.filter(p => data.logs.has(p.playerId));
  rankItems('misc', cols.misc.map(c => boxColumnItem(c, 'perGame')), () => logCtxOf, logPool, (p, key) => keepAll(p, key, logCtxOf));
  rankItems('scoring', cols.scoring.map(c => boxColumnItem(c, 'perGame')), () => logCtxOf, logPool, (p, key) => keepAll(p, key, logCtxOf));
  if (!target.shotTypes) return lines;
  const shootCols = shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, 'perGame', p => p.gamesPlayed);
  rankItems('shooting', shootCols.map(c => ({
    key: c.key, label: c.label, higherIsBetter: c.higherIsBetter,
    value: (p: PlayerSummary) => Number(c.sortValue(p)), format: (p: PlayerSummary) => (c.format ? c.format(p) : String(c.sortValue(p))),
  })), () => () => null, players.filter(p => !!p.shotTypes), () => true);
  return lines;
}

/** 順位の表の見出し用（カテゴリ名） */
export const RANK_CATEGORY_LABEL: Record<string, string> = {
  traditional: CATEGORY_LABELS.traditional, advanced: CATEGORY_LABELS.advanced, misc: CATEGORY_LABELS.misc, scoring: CATEGORY_LABELS.scoring, shooting: CATEGORY_LABELS.shooting,
};
void countDoubleTripleDoubles;
void buildProfileItems;
