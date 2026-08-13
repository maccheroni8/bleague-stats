// Lead Tracker（試合中の得失点差の推移）用のデータ整形。
// games/{scheduleKey}.jsonのPlayByPlays（GeniusAPI生データ）から、フロントエンドでその場構築する
// （バックエンド集計ファイルは増やさない方針。DESIGN.md参照）。
//
// ActionCD1の意味はDESIGN.md 2-2・2-4章で確定済み:
// - 得点イベント（1, 3, 4, 7, 44）: 公式サイトのスコアチャート実装（PBPGraphBuilder.pointsHashTable）
//   と同じコード集合を採用。Scoreフィールドに「そのイベント時点の両チーム累計スコア」がそのまま
//   入っているため、得点計算をこちら側で再現する必要はない
// - タイムアウト（88）
//
// クォーターの秒数はB.LEAGUE公式ルール通り: 各Q10分、延長(OT)は5分固定。実データ（PBPのPeriodEndRowFlg
// 行のRestTime）でも延長開始時点が"5:00"であることを確認済み。

import type { PlayByPlayEvent } from "../../shared/types";

const REGULAR_PERIOD_SECONDS = 10 * 60;
const OT_PERIOD_SECONDS = 5 * 60;

/** 公式サイトのスコアチャート実装と同じ、得点が入るActionCD1コードの集合 */
const SCORING_ACTION_CODES = new Set([1, 3, 4, 7, 44]);
const TIMEOUT_ACTION_CODE = 88;

export function periodDurationSeconds(period: number): number {
  return period <= 4 ? REGULAR_PERIOD_SECONDS : OT_PERIOD_SECONDS;
}

/** そのピリオドが開始する時点の、試合開始からの累計経過秒 */
export function periodStartSeconds(period: number): number {
  let total = 0;
  for (let p = 1; p < period; p += 1) total += periodDurationSeconds(p);
  return total;
}

function parseRestTimeSeconds(restTime: string): number {
  const match = /^(\d+):(\d{2})$/.exec(restTime);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** ピリオド内の残り時間(RestTime)を、試合開始からの累計経過秒に変換する */
export function elapsedSeconds(period: number, restTime: string): number {
  const remaining = parseRestTimeSeconds(restTime);
  return periodStartSeconds(period) + periodDurationSeconds(period) - remaining;
}

export function totalGameSeconds(totalPeriods: number): number {
  return periodStartSeconds(totalPeriods + 1);
}

function periodLabel(period: number): string {
  if (period <= 4) return `${period}Q`;
  const otIndex = period - 4;
  return otIndex > 1 ? `OT${otIndex}` : "OT";
}

export interface PeriodBoundary {
  period: number;
  label: string;
  startSec: number;
}

export function buildPeriodBoundaries(totalPeriods: number): PeriodBoundary[] {
  const boundaries: PeriodBoundary[] = [];
  for (let p = 1; p <= totalPeriods; p += 1) {
    boundaries.push({ period: p, label: periodLabel(p), startSec: periodStartSeconds(p) });
  }
  return boundaries;
}

export interface ScorePoint {
  elapsedSec: number;
  period: number;
  restTime: string;
  homeScore: number;
  awayScore: number;
  diff: number;
  playText: string;
}

function parseScore(score: string | undefined): { home: number; away: number } | null {
  if (!score) return null;
  const match = /^(\d+)-(\d+)$/.exec(score);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

/**
 * 得点イベントから、試合開始(0-0)〜試合終了時点までのスコア推移を時系列で構築する
 * （階段状に変化する値なのでrecharts側は`type="stepAfter"`で描画する前提）。
 */
export function buildScoreTimeline(
  events: PlayByPlayEvent[],
  finalScore: { home: number; away: number },
  totalPeriods: number,
): ScorePoint[] {
  const points: ScorePoint[] = [
    { elapsedSec: 0, period: 1, restTime: `${REGULAR_PERIOD_SECONDS / 60}:00`, homeScore: 0, awayScore: 0, diff: 0, playText: "試合開始" },
  ];

  for (const ev of events) {
    if (!SCORING_ACTION_CODES.has(ev.ActionCD1)) continue;
    const score = parseScore(ev.Score);
    if (!score) continue;
    points.push({
      elapsedSec: elapsedSeconds(ev.Period, ev.RestTime),
      period: ev.Period,
      restTime: ev.RestTime,
      homeScore: score.home,
      awayScore: score.away,
      diff: score.home - score.away,
      playText: ev.PlayText.trim(),
    });
  }

  points.sort((a, b) => a.elapsedSec - b.elapsedSec);

  points.push({
    elapsedSec: totalGameSeconds(totalPeriods),
    period: totalPeriods,
    restTime: "0:00",
    homeScore: finalScore.home,
    awayScore: finalScore.away,
    diff: finalScore.home - finalScore.away,
    playText: "試合終了",
  });

  return points;
}

export interface TimeoutMark {
  elapsedSec: number;
  period: number;
  restTime: string;
  /** 1=ホームのタイムアウト, 2=アウェイのタイムアウト, null=オフィシャルタイムアウト */
  homeAway: 1 | 2 | null;
}

export function buildTimeoutMarks(events: PlayByPlayEvent[]): TimeoutMark[] {
  return events
    .filter((ev) => ev.ActionCD1 === TIMEOUT_ACTION_CODE)
    .map((ev) => ({
      elapsedSec: elapsedSeconds(ev.Period, ev.RestTime),
      period: ev.Period,
      restTime: ev.RestTime,
      homeAway: (ev.HomeAway === 1 || ev.HomeAway === 2 ? ev.HomeAway : null) as 1 | 2 | null,
    }))
    .sort((a, b) => a.elapsedSec - b.elapsedSec);
}
