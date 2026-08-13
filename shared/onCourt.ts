// 在コート状態の復元（Phase 4: ラインナップスタッツ・オンコート/オフコートスタッツの基盤）。
//
// games/{scheduleKey}.jsonのPlayByPlaysから、各時点でコートに立っている5人を時系列で復元する。
// 復元結果は個人+/-の再計算にも使い、公式PLUSMINUSフィールドと突合することで復元ロジック自体の
// 信頼性を検証する（scripts/validate-oncourt.ts）。
//
// 時間軸の考え方はsrc/lib/leadTracker.tsと同じ（各Q10分・OT5分固定、RestTimeを累計経過秒に変換）。
// Lead Trackerはフロントエンド専用機能のため独立させてあり、ここでは同じ定数・変換式を
// このモジュール内に閉じて持つ（意図的な重複。DESIGN.md参照）。
//
// イベント種別コード（DESIGN.md 2-4章で確定済み）:
// - 86=選手交代イン、87=選手交代アウト（1イベント=1選手。IN/OUTは別々の行）
// - 1, 3, 4, 7, 44=得点イベント（点数は公式サイトのpointsHashTableと同じ対応）
// - 89=86/87と同じアイコンが割り当てられているが意味未確認・実データ未出現（出現したら警告に出す）

import type { BoxscoreRow, PlayByPlayEvent } from "./types.ts";

const REGULAR_PERIOD_SECONDS = 10 * 60;
const OT_PERIOD_SECONDS = 5 * 60;

const SUB_IN_CODE = 86;
const SUB_OUT_CODE = 87;
const SUB_UNKNOWN_CODE = 89;
const POINTS_BY_ACTION_CD1: Record<number, number> = { 1: 3, 3: 2, 4: 2, 7: 1, 44: 2 };

function periodDurationSeconds(period: number): number {
  return period <= 4 ? REGULAR_PERIOD_SECONDS : OT_PERIOD_SECONDS;
}

function periodStartSeconds(period: number): number {
  let total = 0;
  for (let p = 1; p < period; p += 1) total += periodDurationSeconds(p);
  return total;
}

function parseRestTimeSeconds(restTime: string): number {
  const match = /^(\d+):(\d{2})$/.exec(restTime);
  if (!match) return 0;
  return Number(match[1]) * 60 + Number(match[2]);
}

function elapsedSeconds(period: number, restTime: string): number {
  const remaining = parseRestTimeSeconds(restTime);
  return periodStartSeconds(period) + periodDurationSeconds(period) - remaining;
}

export function totalGameSeconds(totalPeriods: number): number {
  return periodStartSeconds(totalPeriods + 1);
}

export interface OnCourtInterval {
  playerId: string;
  teamId: string;
  startSec: number;
  endSec: number;
}

export interface OnCourtWarning {
  type: "starter-mismatch" | "player-count" | "duplicate-in" | "unmatched-out" | "missing-team-or-player" | "unknown-sub-code";
  message: string;
  elapsedSec?: number;
  period?: number;
  restTime?: string;
  teamId?: string;
}

export interface OnCourtReconstruction {
  intervals: OnCourtInterval[];
  /** 復元ロジックが算出した個人+/-。復元結果からの再計算値であり、公式PLUSMINUSとは別物 */
  plusMinus: Record<string, number>;
  warnings: OnCourtWarning[];
}

/** BoxscoreRow（個人・試合全体行）からスタメン5人のplayerIdを抽出する */
export function extractStarters(rows: BoxscoreRow[], teamId: string): string[] {
  return rows
    .filter((r) => r.Category === 1 && r.PeriodCategory === 18 && r.TeamID === teamId && r.StartingFlg === 1)
    .map((r) => r.PlayerID);
}

interface RelevantEvent {
  elapsedSec: number;
  period: number;
  restTime: string;
  kind: "score" | "sub-in" | "sub-out";
  teamId: string;
  playerId: string;
  points: number;
}

function buildRelevantEvents(playByPlays: PlayByPlayEvent[], warnings: OnCourtWarning[]): RelevantEvent[] {
  const events: RelevantEvent[] = [];
  for (const ev of playByPlays) {
    const points = POINTS_BY_ACTION_CD1[ev.ActionCD1];
    if (points !== undefined) {
      if (!ev.TeamID) continue;
      events.push({
        elapsedSec: elapsedSeconds(ev.Period, ev.RestTime),
        period: ev.Period,
        restTime: ev.RestTime,
        kind: "score",
        teamId: ev.TeamID,
        playerId: ev.PlayerID1 ?? "",
        points,
      });
      continue;
    }
    if (ev.ActionCD1 === SUB_IN_CODE || ev.ActionCD1 === SUB_OUT_CODE) {
      if (!ev.TeamID || !ev.PlayerID1) {
        warnings.push({
          type: "missing-team-or-player",
          message: `交代イベントにTeamID/PlayerID1が無い（No=${ev.No}）`,
          period: ev.Period,
          restTime: ev.RestTime,
        });
        continue;
      }
      events.push({
        elapsedSec: elapsedSeconds(ev.Period, ev.RestTime),
        period: ev.Period,
        restTime: ev.RestTime,
        kind: ev.ActionCD1 === SUB_IN_CODE ? "sub-in" : "sub-out",
        teamId: ev.TeamID,
        playerId: ev.PlayerID1,
        points: 0,
      });
      continue;
    }
    if (ev.ActionCD1 === SUB_UNKNOWN_CODE) {
      warnings.push({
        type: "unknown-sub-code",
        message: `ActionCD1=89が出現（IN/OUTどちらか未確認のため在コート復元では無視）`,
        period: ev.Period,
        restTime: ev.RestTime,
        teamId: ev.TeamID ?? undefined,
      });
    }
  }
  // elapsedSecの単純昇順でソートする（JSのArray.sortは安定ソートなので、同一elapsedSec内の
  // 順序は元のPlayByPlays配列内での相対順序がそのまま保たれる）。
  //
  // 実データ検証で判明した2つの事実から、この「同一秒内は配列の元の並び順を信頼する」方式が
  // 正しいことを確認済み（DESIGN.md参照）:
  // 1. PlayByPlays全体は必ずしも試合内の時系列順ではない（後日の記録修正等が原因とみられる、
  //    別ピリオドの区間がまるごと配列の途中に挿入されているケースを確認）。これはelapsedSecでの
  //    グローバルな並べ替えで正しく解消される
  // 2. 一方、同一秒（同一RestTime）内で起きた「交代→得点→交代」のような細かい順序は、
  //    配列内の元の並び順が実際の発生順と一致している（フリースロー前後の緊急交代等で実証済み）。
  //    RestTimeの解像度が1秒しかないため、この元の並び順を崩す独自の優先順位付け
  //    （例:「得点を交代より先に処理する」という決め打ち）をすると、同一秒内で交代が絡む
  //    得点イベントの在コート判定を誤り、個人+/-がずれる（実際にこのバグで公式PLUSMINUSと
  //    ズレるケースを検出し、原因を特定した上で修正した経緯がある）
  events.sort((a, b) => a.elapsedSec - b.elapsedSec);
  return events;
}

export function reconstructOnCourt(
  playByPlays: PlayByPlayEvent[],
  homeBoxscores: BoxscoreRow[],
  awayBoxscores: BoxscoreRow[],
  homeTeamId: string,
  awayTeamId: string,
  totalPeriods: number,
): OnCourtReconstruction {
  const warnings: OnCourtWarning[] = [];

  // 在コート状態はPBP自体から復元する（BoxscoreRowのStartingFlgでは事前初期化しない）。
  // 実データを見ると、試合開始時点（Period1・RestTime10:00）に、スタメン5人×2チーム分の
  // ActionCD1=86（IN）イベントが明示的に記録されていることを確認済み。事前初期化すると
  // このオープニングのINイベントと二重にカウントしてしまう（duplicate-in警告が必ず
  // スタメン人数分＝10件発生する）ため、BoxscoreRowのStartingFlgは復元後の突合検証にのみ使う
  const onCourt: Record<string, Set<string>> = { [homeTeamId]: new Set(), [awayTeamId]: new Set() };
  const openStart: Record<string, Map<string, number>> = { [homeTeamId]: new Map(), [awayTeamId]: new Map() };
  const intervals: OnCourtInterval[] = [];
  const plusMinus: Record<string, number> = {};
  const addPlusMinus = (playerId: string, delta: number) => {
    plusMinus[playerId] = (plusMinus[playerId] ?? 0) + delta;
  };

  const events = buildRelevantEvents(playByPlays, warnings);

  let i = 0;
  while (i < events.length) {
    const event = events[i]!;
    if (event.kind === "score") {
      const opponentTeamId = event.teamId === homeTeamId ? awayTeamId : homeTeamId;
      for (const pid of onCourt[event.teamId]!) addPlusMinus(pid, event.points);
      for (const pid of onCourt[opponentTeamId]!) addPlusMinus(pid, -event.points);
      i += 1;
      continue;
    }

    // 同時刻・同チームの交代イベントをまとめて1バッチとして処理する
    // （OUTとペアのINが同一秒内で処理される前提。片方だけ処理すると在コート人数が一時的に
    // 崩れて見えてしまうため、バッチ単位でしか人数チェックをしない）
    let j = i;
    while (
      j < events.length &&
      events[j]!.kind !== "score" &&
      events[j]!.elapsedSec === event.elapsedSec &&
      events[j]!.teamId === event.teamId
    ) {
      j += 1;
    }
    const batch = events.slice(i, j);
    const teamId = event.teamId;
    const t = event.elapsedSec;

    for (const s of batch) {
      if (s.kind !== "sub-out") continue;
      if (!onCourt[teamId]!.has(s.playerId)) {
        warnings.push({
          type: "unmatched-out",
          message: `OUTだが在コートでない選手（playerId=${s.playerId}）`,
          elapsedSec: t,
          period: s.period,
          restTime: s.restTime,
          teamId,
        });
        continue;
      }
      onCourt[teamId]!.delete(s.playerId);
      const start = openStart[teamId]!.get(s.playerId);
      if (start !== undefined) {
        intervals.push({ playerId: s.playerId, teamId, startSec: start, endSec: t });
        openStart[teamId]!.delete(s.playerId);
      }
    }
    for (const s of batch) {
      if (s.kind !== "sub-in") continue;
      if (onCourt[teamId]!.has(s.playerId)) {
        warnings.push({
          type: "duplicate-in",
          message: `INだが既に在コートの選手（playerId=${s.playerId}）`,
          elapsedSec: t,
          period: s.period,
          restTime: s.restTime,
          teamId,
        });
        continue;
      }
      onCourt[teamId]!.add(s.playerId);
      openStart[teamId]!.set(s.playerId, t);
    }
    if (onCourt[teamId]!.size !== 5) {
      warnings.push({
        type: "player-count",
        message: `在コート人数が${onCourt[teamId]!.size}人`,
        elapsedSec: t,
        period: batch[0]!.period,
        restTime: batch[0]!.restTime,
        teamId,
      });
    }
    i = j;
  }

  const gameEnd = totalGameSeconds(totalPeriods);
  for (const teamId of [homeTeamId, awayTeamId]) {
    for (const [playerId, start] of openStart[teamId]!.entries()) {
      intervals.push({ playerId, teamId, startSec: start, endSec: gameEnd });
    }
  }

  // 突合検証: PBP側から復元した「試合開始時点(startSec=0)で在コートだった選手」の集合が、
  // BoxscoreRowのStartingFlgと一致するか確認する（データソースが2つとも独立に「スタメン」を
  // 記録しているので、両者が一致すること自体が復元ロジックの妥当性の傍証になる）
  const pbpOpeningFive: Record<string, Set<string>> = { [homeTeamId]: new Set(), [awayTeamId]: new Set() };
  for (const iv of intervals) {
    if (iv.startSec === 0) pbpOpeningFive[iv.teamId]!.add(iv.playerId);
  }
  for (const teamId of [homeTeamId, awayTeamId]) {
    const boxSet = new Set(extractStarters(teamId === homeTeamId ? homeBoxscores : awayBoxscores, teamId));
    const pbpSet = pbpOpeningFive[teamId]!;
    const onlyInBox = [...boxSet].filter((id) => !pbpSet.has(id));
    const onlyInPbp = [...pbpSet].filter((id) => !boxSet.has(id));
    if (onlyInBox.length > 0 || onlyInPbp.length > 0) {
      warnings.push({
        type: "starter-mismatch",
        message: `スタメン不一致（BoxscoreRowのみ:[${onlyInBox.join(",")}] / PBPのみ:[${onlyInPbp.join(",")}]）`,
        teamId,
      });
    }
  }

  return { intervals, plusMinus, warnings };
}

/** 選手ごとの在コート合計秒数（intervalsの合算） */
export function totalOnCourtSeconds(intervals: OnCourtInterval[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const iv of intervals) {
    totals[iv.playerId] = (totals[iv.playerId] ?? 0) + (iv.endSec - iv.startSec);
  }
  return totals;
}
