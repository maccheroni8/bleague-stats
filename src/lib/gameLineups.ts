// 1試合分のラインナップ（5人組）別の出場時間・得点・失点（試合詳細ページ）。
// チーム詳細ページの「よく使われるラインナップ」（scripts/aggregate.tsのprocessLineups、
// シーズン集計）と同じく、reconstructOnCourtのlineupStintsを5人の組み合わせ（lineupKey）ごとに
// 積算する。こちらは1試合単位で、Q別/前後半の範囲に絞り込める。
import type { LineupStint } from "../../shared/onCourt";
import type { PeriodBoundary } from "./leadTracker";
import { periodDurationSeconds } from "./leadTracker";
import type { PeriodRangeOption } from "./periodRange";

export interface GameLineupRow {
  teamId: string;
  lineupKey: string;
  playerIds: string[];
  seconds: number;
  ownPoints: number;
  oppPoints: number;
  netPoints: number;
}

function overlapSeconds(stint: LineupStint, boundary: PeriodBoundary): number {
  const periodEnd = boundary.startSec + periodDurationSeconds(boundary.period);
  return Math.max(0, Math.min(stint.endSec, periodEnd) - Math.max(stint.startSec, boundary.startSec));
}

/**
 * 指定チームのラインナップ別成績。出場時間はスティントの区間をピリオド境界で切って数え、
 * 得点・失点はスティントのピリオド別内訳（得点イベントのPeriodで振り分け済み）を合計する。
 * 範囲内で出場時間も得点・失点も0のラインナップは含めない
 */
export function buildGameLineups(
  stints: LineupStint[],
  teamId: string,
  option: PeriodRangeOption | undefined,
  periodBoundaries: PeriodBoundary[],
): GameLineupRow[] {
  const targetBoundaries =
    !option || option.periods === null ? null : periodBoundaries.filter((b) => option.periods!.includes(b.period));

  const byKey = new Map<string, GameLineupRow>();
  for (const stint of stints) {
    if (stint.teamId !== teamId) continue;

    let seconds: number;
    let own: number;
    let opp: number;
    if (targetBoundaries === null) {
      seconds = Math.max(0, stint.endSec - stint.startSec);
      own = stint.ownPoints;
      opp = stint.oppPoints;
    } else {
      seconds = 0;
      own = 0;
      opp = 0;
      for (const b of targetBoundaries) {
        seconds += overlapSeconds(stint, b);
        own += stint.pointsByPeriod[b.period]?.own ?? 0;
        opp += stint.pointsByPeriod[b.period]?.opp ?? 0;
      }
    }
    if (seconds === 0 && own === 0 && opp === 0) continue;

    const row = byKey.get(stint.lineupKey) ?? {
      teamId,
      lineupKey: stint.lineupKey,
      playerIds: stint.playerIds,
      seconds: 0,
      ownPoints: 0,
      oppPoints: 0,
      netPoints: 0,
    };
    row.seconds += seconds;
    row.ownPoints += own;
    row.oppPoints += opp;
    row.netPoints = row.ownPoints - row.oppPoints;
    byKey.set(stint.lineupKey, row);
  }
  return [...byKey.values()].sort((a, b) => b.seconds - a.seconds);
}

/** オンザコート別の合計の1行。count が null の行は「集計外」 */
export interface OnCourtSummaryRow {
  count: number | null;
  seconds: number;
  ownPoints: number;
  oppPoints: number;
  netPoints: number;
}

/** 選んだ範囲（全体・Q別・前後半）の試合時間と、そのチームの得点・失点。オンザコート別の合計の検算に使う */
export interface RangeTotals {
  seconds: number;
  ownPoints: number;
  oppPoints: number;
}

export function rangeTotals(
  option: PeriodRangeOption | undefined,
  periodBoundaries: PeriodBoundary[],
  ownByPeriod: number[],
  oppByPeriod: number[],
): RangeTotals {
  const target = !option || option.periods === null ? periodBoundaries : periodBoundaries.filter((b) => option.periods!.includes(b.period));
  let seconds = 0;
  let ownPoints = 0;
  let oppPoints = 0;
  for (const b of target) {
    seconds += periodDurationSeconds(b.period);
    ownPoints += ownByPeriod[b.period - 1] ?? 0;
    oppPoints += oppByPeriod[b.period - 1] ?? 0;
  }
  return { seconds, ownPoints, oppPoints };
}

/**
 * ラインナップ別成績（buildGameLineups の行）を、5人のうち外国籍・帰化・アジア特別枠の選手の人数ごとに足し上げる。
 * 人数は maxOnCourt（そのシーズンの規定の上限）から0まで。区分不明の選手を含む組・上限を超える組（公式記録の取り違え等）と、
 * 在コートの5人が復元できなかった時間は「集計外」の行にまとめる。集計外は範囲の試合時間・得点・失点から人数別の合計を引いて出すので、
 * 全行の合計は常に試合時間・試合の得点と一致する
 */
export function summarizeByForeignCount(
  rows: GameLineupRow[],
  countOf: (row: GameLineupRow) => number | null,
  maxOnCourt: number,
  totals: RangeTotals,
): OnCourtSummaryRow[] {
  const summary: OnCourtSummaryRow[] = [];
  for (let c = maxOnCourt; c >= 0; c -= 1) summary.push({ count: c, seconds: 0, ownPoints: 0, oppPoints: 0, netPoints: 0 });
  for (const row of rows) {
    const c = countOf(row);
    if (c === null || c > maxOnCourt) continue;
    const s = summary[maxOnCourt - c]!;
    s.seconds += row.seconds;
    s.ownPoints += row.ownPoints;
    s.oppPoints += row.oppPoints;
  }
  const counted = summary.reduce(
    (a, s) => ({ seconds: a.seconds + s.seconds, ownPoints: a.ownPoints + s.ownPoints, oppPoints: a.oppPoints + s.oppPoints }),
    { seconds: 0, ownPoints: 0, oppPoints: 0 },
  );
  const excluded: OnCourtSummaryRow = {
    count: null,
    seconds: Math.max(0, totals.seconds - counted.seconds),
    ownPoints: Math.max(0, totals.ownPoints - counted.ownPoints),
    oppPoints: Math.max(0, totals.oppPoints - counted.oppPoints),
    netPoints: 0,
  };
  if (excluded.seconds > 0 || excluded.ownPoints > 0 || excluded.oppPoints > 0) summary.push(excluded);
  for (const s of summary) s.netPoints = s.ownPoints - s.oppPoints;
  return summary;
}

/** ラインナップの行が、オンザコート別の合計のどの行（人数、または集計外=null）に入るか */
export function foreignCountBucket(count: number | null, maxOnCourt: number): number | null {
  return count === null || count > maxOnCourt ? null : count;
}
