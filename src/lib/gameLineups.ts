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
