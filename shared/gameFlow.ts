// 試合の得点の流れ（プレーバイプレーの得点イベントから）の集計: チームの最大のラン、選手の勝ち越し弾・同点弾・決勝点（DESIGN.md 221章）。
//
// 元は PlayByPlays の得点イベント（ActionCD1 = 1, 3, 4, 7, 44。shared/gameMargins.ts と同じ集合）の Score（その時点の両チームの累計「ホーム-アウェイ」）。
// 得点したチームと点数は、前の得点イベントからの Score の差で決める（ActionCD1 のコードでは決めない）。フリースローは ActionCD1 = 7（FGと区別する）。
//
// **並び**: 入力は必ず shared/pbpOrder.ts の出力（時系列）にする。この関数の中でも chronologicalPlayByPlays を通す（すでに時系列なら何もしない）。
// そのうえで、**得点イベントだけ**、同じ経過秒（同じピリオド）の中を累計得点（ホーム+アウェイ）の昇順に直す。
// 2020-21以降の16試合で、同じ秒に記録されたフリースローなどの Score が配列の中で逆転している（例: 80-85, 80-83, 80-84。試合7652の最後の2行もこの例）。
// 累計得点は得点のたびに必ず増えるので、同じ秒の中の正しい並びは累計得点の昇順で一意に決まる。pbpOrder.ts 自体は変えない（既存の集計の入力が変わるため）。
//
// ラン（相手が無得点の間の、自チームの連続得点の合計）: ピリオドをまたいで続く。同じ値のランが1試合に複数あるときは、最初のものを採る。
// 勝ち越し弾・同点弾・決勝点: 第4Qと各延長の、残り時間が window 秒以内（2:00ちょうどを含む）の得点。窓は 5分・2分・1分。
//   - 勝ち越し: 得点前に同点か負けていて、得点後にリードしたもの
//   - 同点: 得点前に負けていて、得点後に同点になったもの
//   - 決勝点: 勝ったチームの最後の勝ち越し（その後、一度もリードを失わない）が、窓の中にあるもの
// 得点者は PlayerID1。FG（ActionCD1 = 1, 3, 4）とフリースロー（7）を分けて数える。
import { chronologicalPlayByPlays } from "./pbpOrder.ts";
import type { PlayByPlayEvent } from "./types.ts";

const SCORING_ACTION_CODES = new Set([1, 3, 4, 7, 44]);
const FREE_THROW_CODE = 7;

/** ピリオド4（第4Q）以降だけが窓の対象 */
const CLUTCH_FIRST_PERIOD = 4;
/** 窓の長さ（秒）。0: 残り5分、1: 残り2分（初期値）、2: 残り1分 */
export const CLUTCH_WINDOWS_SEC = [300, 120, 60] as const;
/** 勝ち越し・同点・決勝点 */
export const CLUTCH_KINDS = ["goAhead", "tie", "winner"] as const;
export type ClutchKind = (typeof CLUTCH_KINDS)[number];
/** 1人×1試合の勝負所の配列の長さ: 窓3 × 種類3 × {FG, FT} */
export const CLUTCH_LENGTH = CLUTCH_WINDOWS_SEC.length * CLUTCH_KINDS.length * 2;

/** 勝負所の配列の位置。window は CLUTCH_WINDOWS_SEC の番号、kind は CLUTCH_KINDS の番号 */
export function clutchIndex(window: number, kind: number, freeThrow: boolean): number {
  return window * CLUTCH_KINDS.length * 2 + kind * 2 + (freeThrow ? 1 : 0);
}

const PERIOD_REGULAR_SECONDS = 600;
const PERIOD_OVERTIME_SECONDS = 300;

function periodSeconds(period: number): number {
  return period <= 4 ? PERIOD_REGULAR_SECONDS : PERIOD_OVERTIME_SECONDS;
}

function periodStartSec(period: number): number {
  let total = 0;
  for (let p = 1; p < period; p += 1) total += periodSeconds(p);
  return total;
}

/** 残り時間（秒）。読めなければ 0（shared/pbpOrder.ts と同じ） */
function restSecondsOf(ev: PlayByPlayEvent): number {
  const m = /^(\d+):(\d{2})$/.exec(ev.RestTime ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

/** 試合開始からの経過秒 → ピリオドと残り時間（秒）。ピリオドの境目は前のピリオドの終わり（残り0）として扱う */
export function periodAndRestAt(elapsedSec: number): { period: number; restSec: number } {
  let period = 1;
  while (elapsedSec > periodStartSec(period) + periodSeconds(period)) period += 1;
  return { period, restSec: periodStartSec(period) + periodSeconds(period) - elapsedSec };
}

/** 得点イベント1件（得点したチームと点数は Score の差から決める） */
export interface ScoringEvent {
  /** 得点したのはホームか（true）アウェイか（false） */
  home: boolean;
  points: number;
  /** フリースロー（ActionCD1 = 7） */
  freeThrow: boolean;
  /** この得点の後のホーム・アウェイの累計 */
  homeScore: number;
  awayScore: number;
  period: number;
  restSec: number;
  /** 試合開始からの経過秒 */
  elapsedSec: number;
  playerId: string | null;
}

export interface ScoringSequence {
  events: ScoringEvent[];
  /** 同じ秒の中で並びを直した得点イベントの数 */
  reordered: number;
  /** 前の得点との差が「片方のチームの増加」にならず、使わなかった得点イベントの数（正常なデータでは 0） */
  skipped: number;
}

export function scoringSequence(playByPlays: PlayByPlayEvent[]): ScoringSequence {
  const candidates: { ev: PlayByPlayEvent; home: number; away: number; elapsed: number; index: number }[] = [];
  chronologicalPlayByPlays(playByPlays).forEach((ev, index) => {
    if (!SCORING_ACTION_CODES.has(ev.ActionCD1)) return;
    const m = /^(\d+)-(\d+)$/.exec(ev.Score ?? "");
    if (!m) return;
    candidates.push({ ev, home: Number(m[1]), away: Number(m[2]), elapsed: periodStartSec(ev.Period) + periodSeconds(ev.Period) - restSecondsOf(ev), index });
  });
  const sorted = [...candidates].sort((a, b) => a.elapsed - b.elapsed || a.ev.Period - b.ev.Period || a.home + a.away - (b.home + b.away) || a.index - b.index);
  let reordered = 0;
  sorted.forEach((c, i) => {
    if (c !== candidates[i]) reordered += 1;
  });

  const events: ScoringEvent[] = [];
  let skipped = 0;
  let prevHome = 0;
  let prevAway = 0;
  for (const c of sorted) {
    const dh = c.home - prevHome;
    const da = c.away - prevAway;
    const oneSided = (dh > 0 && da === 0) || (da > 0 && dh === 0);
    if (!oneSided) {
      skipped += 1;
      continue;
    }
    events.push({
      home: dh > 0,
      points: dh > 0 ? dh : da,
      freeThrow: c.ev.ActionCD1 === FREE_THROW_CODE,
      homeScore: c.home,
      awayScore: c.away,
      period: c.ev.Period,
      restSec: restSecondsOf(c.ev),
      elapsedSec: c.elapsed,
      playerId: c.ev.PlayerID1 ?? null,
    });
    prevHome = c.home;
    prevAway = c.away;
  }
  return { events, reordered, skipped };
}

/** チームの最大のラン */
export interface TeamRun {
  points: number;
  /** ランの最初・最後の得点の経過秒 */
  fromSec: number;
  toSec: number;
  /** ランが始まる直前の両チームの得点 */
  ownBefore: number;
  oppBefore: number;
}

/** [ホームの最大のラン, アウェイの最大のラン]。得点イベントが無ければ両方 null */
export function maxRuns(events: ScoringEvent[]): [TeamRun | null, TeamRun | null] {
  type OpenRun = { points: number; fromSec: number; ownBefore: number; oppBefore: number };
  const best: [TeamRun | null, TeamRun | null] = [null, null];
  const current: [OpenRun | null, OpenRun | null] = [null, null];
  let prevHome = 0;
  let prevAway = 0;
  for (const e of events) {
    const side = e.home ? 0 : 1;
    const other = e.home ? 1 : 0;
    current[other] = null;
    let run = current[side];
    if (!run) {
      run = { points: 0, fromSec: e.elapsedSec, ownBefore: e.home ? prevHome : prevAway, oppBefore: e.home ? prevAway : prevHome };
      current[side] = run;
    }
    run.points += e.points;
    const b = best[side];
    if (!b || run.points > b.points) {
      best[side] = { points: run.points, fromSec: run.fromSec, toSec: e.elapsedSec, ownBefore: run.ownBefore, oppBefore: run.oppBefore };
    }
    prevHome = e.homeScore;
    prevAway = e.awayScore;
  }
  return best;
}

/**
 * 選手ごとの勝ち越し弾・同点弾・決勝点（CLUTCH_LENGTH 個の配列。位置は clutchIndex）。1つも無い選手は含めない。
 * homeScore・awayScore は公式の最終スコア（引き分けの試合には決勝点が無い）
 */
export function clutchByPlayer(events: ScoringEvent[], homeScore: number, awayScore: number): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (events.length === 0) return out;
  const winnerIsHome = homeScore > awayScore ? true : homeScore < awayScore ? false : null;

  // 得点する側から見た得点前後の点差
  const margins = events.map((e, i) => {
    const prevHome = i === 0 ? 0 : events[i - 1]!.homeScore;
    const prevAway = i === 0 ? 0 : events[i - 1]!.awayScore;
    return {
      before: e.home ? prevHome - prevAway : prevAway - prevHome,
      after: e.home ? e.homeScore - e.awayScore : e.awayScore - e.homeScore,
    };
  });
  let lastGoAheadOfWinner = -1;
  if (winnerIsHome !== null) {
    events.forEach((e, i) => {
      if (e.home === winnerIsHome && margins[i]!.before <= 0 && margins[i]!.after > 0) lastGoAheadOfWinner = i;
    });
  }

  events.forEach((e, i) => {
    if (e.period < CLUTCH_FIRST_PERIOD || !e.playerId) return;
    const { before, after } = margins[i]!;
    const kinds = [before <= 0 && after > 0, before < 0 && after === 0, i === lastGoAheadOfWinner];
    if (!kinds.some(Boolean)) return;
    CLUTCH_WINDOWS_SEC.forEach((limit, w) => {
      if (e.restSec > limit) return;
      kinds.forEach((hit, k) => {
        if (!hit) return;
        let arr = out.get(e.playerId!);
        if (!arr) {
          arr = new Array<number>(CLUTCH_LENGTH).fill(0);
          out.set(e.playerId!, arr);
        }
        arr[clutchIndex(w, k, e.freeThrow)]! += 1;
      });
    });
  });
  return out;
}
