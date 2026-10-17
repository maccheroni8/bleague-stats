// チーム詳細「よく使われるラインナップ」を、試合区分・区間（1Q〜4Q・前半・後半・延長）で出す。
// 材料はチームの出場区間ごとの数え上げ（data/{season}/team-stints/{teamId}.json。2020-21以降。DESIGN.md 204章）。
// 5人組ごとに足し直した値は、シーズン全体（合算・試合全体）では lineups/{teamId}.json の値と一致する（validate:lineups-by-condition）。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import type { LineupAggregate, TeamStintsFile } from "../../shared/types";
import type { PeriodRangeValue } from "./periodRange";
import { MIN_LINEUP_AVG_SECONDS, MIN_LINEUP_GAME_SHARE } from "./tableThresholds";

const FIXED_COLUMNS = 9; // 試合番号・ピリオド・開始秒・終了秒・選手×5

export interface LineupsConditionOptions {
  /** 対象にする試合（ScheduleKey）か。試合区分の絞り込みはここで渡す */
  includeGame: (scheduleKey: string) => boolean;
  /** 対象にするピリオド。null は全ピリオド */
  periods: number[] | null;
}

export interface LineupsByCondition {
  /** 出場時間の長い順 */
  lineups: LineupAggregate[];
  /** 条件に合うチームの試合数（「よく使われる」の試合数の基準の分母） */
  teamGames: number;
}

/**
 * 出場区間から、5人組ごとの出場時間・得点・失点・攻撃回数・一緒に出た試合数を足す。
 * 試合数は、その条件の中で時間か得点・攻撃の記録があった試合（ラインナップ検索と同じ数え方）。推定のレーティングは持たない（実際の攻撃回数がある）
 */
export function lineupsByCondition(file: TeamStintsFile, options: LineupsConditionOptions): LineupsByCondition {
  const nKeys = file.countKeys.length;
  const ptsIdx = file.countKeys.indexOf("pts");
  const possIdx = file.countKeys.indexOf("poss");
  if (ptsIdx < 0 || possIdx < 0) return { lineups: [], teamGames: 0 };

  const gameIncluded = new Map<number, boolean>();
  const teamGames = new Set<number>();
  const map = new Map<string, { playerIds: string[]; seconds: number; own: number; opp: number; ownPoss: number; oppPoss: number; games: Set<number> }>();
  for (const row of file.rows) {
    const game = row[0]!;
    let ok = gameIncluded.get(game);
    if (ok === undefined) {
      ok = options.includeGame(file.games[game]!);
      gameIncluded.set(game, ok);
    }
    if (!ok) continue;
    if (options.periods !== null && !options.periods.includes(row[1]!)) continue;

    const seconds = row[3]! - row[2]!;
    const own = row[FIXED_COLUMNS + ptsIdx]!;
    const opp = row[FIXED_COLUMNS + nKeys + ptsIdx]!;
    const ownPoss = row[FIXED_COLUMNS + possIdx]!;
    const oppPoss = row[FIXED_COLUMNS + nKeys + possIdx]!;
    const active = seconds > 0 || own !== 0 || opp !== 0 || ownPoss !== 0 || oppPoss !== 0;
    if (active) teamGames.add(game);

    const playerIds = [row[4]!, row[5]!, row[6]!, row[7]!, row[8]!].map((n) => file.players[n]!).sort();
    const key = playerIds.join(",");
    let acc = map.get(key);
    if (!acc) {
      acc = { playerIds, seconds: 0, own: 0, opp: 0, ownPoss: 0, oppPoss: 0, games: new Set() };
      map.set(key, acc);
    }
    acc.seconds += seconds;
    acc.own += own;
    acc.opp += opp;
    acc.ownPoss += ownPoss;
    acc.oppPoss += oppPoss;
    if (active) acc.games.add(game);
  }

  const lineups: LineupAggregate[] = [...map.entries()]
    .filter(([, a]) => a.games.size > 0)
    .map(([lineupKey, a]) => ({
      lineupKey,
      playerIds: a.playerIds,
      secondsPlayed: a.seconds,
      netPoints: a.own - a.opp,
      ownPoints: a.own,
      oppPoints: a.opp,
      gamesPlayed: a.games.size,
      // 実際の攻撃回数があるので使わない（型の必須項目）
      estimatedNetRtg: 0,
      estimatedOffRtg: 0,
      estimatedDefRtg: 0,
      ownPoss: a.ownPoss,
      oppPoss: a.oppPoss,
    }))
    .sort((a, b) => b.secondsPlayed - a.secondsPlayed);
  return { lineups, teamGames: teamGames.size };
}

/** 区間の長さ（分）。試合全体は40分、1Q〜4Qは10分、前半・後半は20分、延長は5分（延長は1回分。すべての延長の合計を選んでも、延長に出た試合の1回分を基準にする） */
const PERIOD_MINUTES: Record<string, number> = { all: 40, q1: 10, q2: 10, q3: 10, q4: 10, h1: 20, h2: 20, ot: 5 };

/** 「よく使われる」の時間の基準（使われた試合の平均、秒）。試合全体は MIN_LINEUP_AVG_SECONDS で、区間は長さに比例して下げる */
export function lineupMinAvgSeconds(period: PeriodRangeValue): number {
  const minutes = PERIOD_MINUTES[period] ?? 40;
  return (MIN_LINEUP_AVG_SECONDS * minutes) / 40;
}

/** 「よく使われる」の条件を満たすか。時間は使われた試合の平均、試合数は条件に合うチームの試合数の一定割合 */
export function isFrequentLineup(l: LineupAggregate, period: PeriodRangeValue, teamGames: number): boolean {
  return l.gamesPlayed > 0 && l.secondsPlayed / l.gamesPlayed >= lineupMinAvgSeconds(period) && l.gamesPlayed >= MIN_LINEUP_GAME_SHARE * teamGames;
}

/** 秒数の表示（45 → 「45」、22.5 → 「22.5」） */
export function formatBasisSeconds(seconds: number): string {
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}
