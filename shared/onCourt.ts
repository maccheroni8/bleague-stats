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
// イベント種別コード（DESIGN.md 2-4章・2-7章で確定済み）:
// - 1, 3, 4, 7, 44=得点イベント（点数は公式サイトのpointsHashTableと同じ対応）
// - 86=選手交代イン（両モデル共通。試合開始時のスタメン挿入にも使われる）
// - モデルによって選手交代の記録方式が異なる（2020-21シーズンでgenius_contexts APIの
//   スキーマが変わったタイミングで交代イベントの記録方式自体も変わったとみられる。
//   DESIGN.md 2-7章参照。試合ごとの自動判定ではなく、シーズンによる明示的な分岐にする
//   ことをユーザーと合意済み。substitutionModelForSeason()で判定する）:
//   - "modern"（2020-21シーズン以降）: 86=IN・87=OUT、それぞれ単独イベントとして
//     全ての交代を記録
//   - "legacy"（2016-17〜2019-20シーズン。game_detailページ埋め込みJSON経由でのみ取得可能。
//     genius_contexts API本体は403）: 86は試合開始時のスタメン挿入のみに使われ、
//     87は一度も出現しない。試合中の交代は全てActionCD1=89で、1イベントに
//     PlayerID1（退場選手）・PlayerID2（入場選手）のペアとして記録される

import type { BoxscoreRow, PlayByPlayEvent } from "./types.ts";
import { safeDiv } from "./formulas.ts";

const REGULAR_PERIOD_SECONDS = 10 * 60;
const OT_PERIOD_SECONDS = 5 * 60;

const SUB_IN_CODE = 86;
const SUB_OUT_CODE = 87;
const LEGACY_SUB_SWAP_CODE = 89;
const POINTS_BY_ACTION_CD1: Record<number, number> = { 1: 3, 3: 2, 4: 2, 7: 1, 44: 2 };

// ポゼッション区切り検出用のActionCD1コード（DESIGN.md 14-3章で確定済み。B.PREMIER/B.ONE共通）。
// 2P/3Pの成功（1,3,4）、FT成功/失敗（7,8）、DREB（個人9・チーム18）、TOV（個人13・チーム17）
const FG_MAKE_CODES = new Set([1, 3, 4]);
const FT_MAKE_CODE = 7;
const FT_MISS_CODE = 8;
const DREB_CODES = new Set([9, 18]);
const TOV_CODES = new Set([13, 17]);

export type SubstitutionModel = "modern" | "legacy";

/**
 * シーズン文字列から選手交代の記録モデルを判定する。境界は実データ4シーズン分
 * （2016-17・2017-18・2018-19・2019-20）で確定済み（DESIGN.md 2-7章）。
 */
export function substitutionModelForSeason(season: string): SubstitutionModel {
  const startYear = Number(season.split("-")[0]);
  return startYear < 2020 ? "legacy" : "modern";
}

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
  /**
   * この区間中の自チーム・相手チームの新ポゼッション開始回数（buildPossessionStartEvents参照）。
   * 個人PACE算出用（個人ORtg/DRtgはDean Oliver方式のボックススコアのみの式に置き換え済みで
   * これらは使わない。shared/formulas.tsのindividualOffRtg/individualDefRtg参照）
   */
  ownPoss: number;
  oppPoss: number;
  /**
   * この区間中の自チーム/相手チームの得点（出場交代バーのツールチップ「10-8」形式表示用。
   * 個人+/-（plusMinus）は試合全体の累計だが、こちらは1区間分に限定した内訳）
   */
  ownPts: number;
  oppPts: number;
}

export interface OnCourtWarning {
  type: "starter-mismatch" | "player-count" | "duplicate-in" | "unmatched-out" | "missing-team-or-player" | "unknown-sub-code";
  message: string;
  elapsedSec?: number;
  period?: number;
  restTime?: string;
  teamId?: string;
}

/** 同じ5人が同時にコートにいた区間（ラインナップスティント） */
export interface LineupStint {
  teamId: string;
  /** playerIdをソートして","結合した正規化キー（5人の組み合わせを順不同で同一視する） */
  lineupKey: string;
  playerIds: string[];
  startSec: number;
  endSec: number;
  /** このスティント中のチーム純得失点（自チーム得点 − 相手チーム得点） */
  netPoints: number;
}

export interface OnCourtReconstruction {
  intervals: OnCourtInterval[];
  /** 復元ロジックが算出した個人+/-。復元結果からの再計算値であり、公式PLUSMINUSとは別物 */
  plusMinus: Record<string, number>;
  /** 5人組の在コートスティント（ラインナップスタッツの基盤データ） */
  lineupStints: LineupStint[];
  warnings: OnCourtWarning[];
}

function lineupKeyOf(set: Set<string>): string {
  return [...set].sort().join(",");
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

function buildRelevantEvents(
  playByPlays: PlayByPlayEvent[],
  warnings: OnCourtWarning[],
  model: SubstitutionModel,
): RelevantEvent[] {
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
    // 86（IN）は両モデル共通（試合開始時のスタメン挿入・legacyモデルでもここだけは共通）
    if (ev.ActionCD1 === SUB_IN_CODE) {
      if (!ev.TeamID || !ev.PlayerID1) {
        warnings.push({
          type: "missing-team-or-player",
          message: `交代INイベントにTeamID/PlayerID1が無い（No=${ev.No}）`,
          period: ev.Period,
          restTime: ev.RestTime,
        });
        continue;
      }
      events.push({
        elapsedSec: elapsedSeconds(ev.Period, ev.RestTime),
        period: ev.Period,
        restTime: ev.RestTime,
        kind: "sub-in",
        teamId: ev.TeamID,
        playerId: ev.PlayerID1,
        points: 0,
      });
      continue;
    }
    if (model === "modern") {
      if (ev.ActionCD1 === SUB_OUT_CODE) {
        if (!ev.TeamID || !ev.PlayerID1) {
          warnings.push({
            type: "missing-team-or-player",
            message: `交代OUTイベントにTeamID/PlayerID1が無い（No=${ev.No}）`,
            period: ev.Period,
            restTime: ev.RestTime,
          });
          continue;
        }
        events.push({
          elapsedSec: elapsedSeconds(ev.Period, ev.RestTime),
          period: ev.Period,
          restTime: ev.RestTime,
          kind: "sub-out",
          teamId: ev.TeamID,
          playerId: ev.PlayerID1,
          points: 0,
        });
        continue;
      }
      if (ev.ActionCD1 === LEGACY_SUB_SWAP_CODE) {
        warnings.push({
          type: "unknown-sub-code",
          message: `ActionCD1=89が出現（modernモデルでは未確認のため在コート復元では無視。No=${ev.No}）`,
          period: ev.Period,
          restTime: ev.RestTime,
          teamId: ev.TeamID ?? undefined,
        });
      }
      continue;
    }

    // legacyモデル: 交代はActionCD1=89の1イベントにOUT→INのペアとして記録される
    // （PlayerID1=退場選手・PlayerID2=入場選手。DESIGN.md 2-7章）。87は実データ上出現しない
    if (ev.ActionCD1 === LEGACY_SUB_SWAP_CODE) {
      if (!ev.TeamID || !ev.PlayerID1 || !ev.PlayerID2) {
        warnings.push({
          type: "missing-team-or-player",
          message: `legacy交代イベントにTeamID/PlayerID1/PlayerID2が無い（No=${ev.No}）`,
          period: ev.Period,
          restTime: ev.RestTime,
        });
        continue;
      }
      const elapsedSec = elapsedSeconds(ev.Period, ev.RestTime);
      events.push({
        elapsedSec,
        period: ev.Period,
        restTime: ev.RestTime,
        kind: "sub-out",
        teamId: ev.TeamID,
        playerId: ev.PlayerID1,
        points: 0,
      });
      events.push({
        elapsedSec,
        period: ev.Period,
        restTime: ev.RestTime,
        kind: "sub-in",
        teamId: ev.TeamID,
        playerId: ev.PlayerID2,
        points: 0,
      });
      continue;
    }
    if (ev.ActionCD1 === SUB_OUT_CODE) {
      warnings.push({
        type: "unknown-sub-code",
        message: `ActionCD1=87が出現（legacyモデルでは想定外のため在コート復元では無視。No=${ev.No}）`,
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

export interface PossessionStartEvent {
  /** このポゼッションを開始した（＝ボールを得た）チーム */
  teamId: string;
  elapsedSec: number;
}

/**
 * PlayByPlaysから「ポゼッションが切り替わった瞬間」を検出する（個人OFFRTG/DEFRTG/PACEの
 * 算出基盤。DESIGN.md参照）。
 *
 * 得点イベントの発生だけをポゼッションの区切りとして使うと、得点に至らなかった攻撃回
 * （ミス＋守備リバウンド、ターンオーバー）を一切数えないため、既存のPOSS推定式（Oliver方式、
 * `estimatedPossessions()`）が返す値（1試合あたり両チーム計150前後）の半分以下しか
 * カウントできず、明らかに矛盾する。そのため以下の複数シグナルを組み合わせて「ボール保持
 * チームの切り替わり」を検出する（DREB/TOVは単独イベントで確定、FG/FTは「同一トリップの
 * 途中か最後か」を次イベントで確認する必要がある）:
 *
 * - ディフェンスリバウンド（DREB、個人9・チーム18）: リバウンドしたチームの新ポゼッション開始
 *   （オフェンスリバウンド＝個人10・チーム19は同一ポゼッションの継続なのでトリガーにしない）
 * - ターンオーバー（TOV、個人13・チーム17）: 相手チームの新ポゼッション開始
 * - FGシュート成功（1,3,4）・FT成功（7）: 直後に同一選手・同一チームのFT試投イベントが
 *   続く場合（アンドワン継続中・複数本FTの1本目等）は同一トリップの途中とみなし区切らない。
 *   続かない場合はそのトリップの最後の得点とみなし、相手チームの新ポゼッション開始
 * - FT失敗（8）単体ではトリガーにしない。トリップ最後のライブなミスなら直後に続くリバウンド
 *   イベント（DREB/OREBいずれか）が上のDREB分岐で処理され、トリップ途中のミス（例:
 *   2本のうち1本目）はリバウンドイベント自体が発生しないため何もしないままで正しい
 *   （ポゼッションは継続中のため）
 *
 * 既知の限界（低頻度のため許容し、報告のみに留める）:
 * - テクニカルファウルのFT（コーチ/ベンチ/選手のテクニカル。ActionCD1=20/21/24）は、
 *   FIBAルール上ボールを保持していたチームがそのまま継続するが、本ロジックは他のFTトリップと
 *   同じ扱い（成功なら相手ボールに切り替え）をしてしまう。低頻度のため個別対応はしていない
 * - 試合開始（Q1オープニングの最初のポゼッション）・各ピリオド開始時の最初のポゼッションは、
 *   その開始を示す明示的なトリガーイベントが無いため区切りとしてカウントされない
 *   （1ピリオドあたり最大1回、両チーム合わせて1試合あたり4〜5回程度の過少カウント）
 */
function buildPossessionStartEvents(
  playByPlays: PlayByPlayEvent[],
  homeTeamId: string,
  awayTeamId: string,
): PossessionStartEvent[] {
  const opponentOf = (teamId: string): string => (teamId === homeTeamId ? awayTeamId : homeTeamId);

  const relevant = playByPlays
    .filter(
      (ev) =>
        ev.TeamID != null &&
        (FG_MAKE_CODES.has(ev.ActionCD1) ||
          ev.ActionCD1 === FT_MAKE_CODE ||
          ev.ActionCD1 === FT_MISS_CODE ||
          DREB_CODES.has(ev.ActionCD1) ||
          TOV_CODES.has(ev.ActionCD1)),
    )
    .map((ev) => ({ ev, elapsedSec: elapsedSeconds(ev.Period, ev.RestTime) }))
    // buildRelevantEvents()と同じ理由でstable sortを使い、同一秒内は元の配列の並び順を信頼する
    .sort((a, b) => a.elapsedSec - b.elapsedSec);

  const starts: PossessionStartEvent[] = [];
  for (let i = 0; i < relevant.length; i += 1) {
    const { ev, elapsedSec } = relevant[i]!;
    const teamId = ev.TeamID!;

    if (DREB_CODES.has(ev.ActionCD1)) {
      starts.push({ teamId, elapsedSec });
      continue;
    }
    if (TOV_CODES.has(ev.ActionCD1)) {
      starts.push({ teamId: opponentOf(teamId), elapsedSec });
      continue;
    }
    if (ev.ActionCD1 === FT_MISS_CODE) {
      continue;
    }
    // ここに来るのはFG成功またはFT成功。同一選手・同一チームの次のFT試投が続く場合は
    // 同一トリップの途中とみなし、このイベントでは区切らない（次のFTイベントの判定に委ねる）
    const next = relevant[i + 1];
    const sameTripContinues =
      next !== undefined &&
      (next.ev.ActionCD1 === FT_MAKE_CODE || next.ev.ActionCD1 === FT_MISS_CODE) &&
      next.ev.TeamID === teamId &&
      next.ev.PlayerID1 === ev.PlayerID1;
    if (sameTripContinues) continue;

    starts.push({ teamId: opponentOf(teamId), elapsedSec });
  }
  return starts;
}

export function reconstructOnCourt(
  playByPlays: PlayByPlayEvent[],
  homeBoxscores: BoxscoreRow[],
  awayBoxscores: BoxscoreRow[],
  homeTeamId: string,
  awayTeamId: string,
  totalPeriods: number,
  substitutionModel: SubstitutionModel,
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
  // 現在の在コート区間だけに限定した得点内訳（sub-out・試合終了時にintervalへ書き出し、
  // その選手が次にIN'した時点でまた0から積み上げ直す。plusMinusは試合全体の累計なので別物）
  const currentIntervalScore: Record<string, { ownPts: number; oppPts: number }> = {};
  const addIntervalScore = (playerId: string, key: "ownPts" | "oppPts", delta: number) => {
    const acc = currentIntervalScore[playerId] ?? { ownPts: 0, oppPts: 0 };
    acc[key] += delta;
    currentIntervalScore[playerId] = acc;
  };
  const flushIntervalScore = (playerId: string): { ownPts: number; oppPts: number } => {
    const acc = currentIntervalScore[playerId] ?? { ownPts: 0, oppPts: 0 };
    delete currentIntervalScore[playerId];
    return acc;
  };

  // ラインナップスティント（同じ5人の在コート区間）は個人+/-と全く同じイベント順で
  // 同時に積算する。tie-break不要（配列の元の並び順を信頼する）という結論は個人+/-の
  // 検証で確立済みなので、そのロジックをそのまま流用する（ズレる余地がない）
  const lineupStints: LineupStint[] = [];
  const currentStint: Record<string, { start: number; net: number }> = {
    [homeTeamId]: { start: 0, net: 0 },
    [awayTeamId]: { start: 0, net: 0 },
  };

  const events = buildRelevantEvents(playByPlays, warnings, substitutionModel);

  let i = 0;
  while (i < events.length) {
    const event = events[i]!;
    if (event.kind === "score") {
      const opponentTeamId = event.teamId === homeTeamId ? awayTeamId : homeTeamId;
      for (const pid of onCourt[event.teamId]!) {
        addPlusMinus(pid, event.points);
        addIntervalScore(pid, "ownPts", event.points);
      }
      for (const pid of onCourt[opponentTeamId]!) {
        addPlusMinus(pid, -event.points);
        addIntervalScore(pid, "oppPts", event.points);
      }
      currentStint[event.teamId]!.net += event.points;
      currentStint[opponentTeamId]!.net -= event.points;
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
    const lineupBeforeBatch = lineupKeyOf(onCourt[teamId]!);
    const playersBeforeBatch = [...onCourt[teamId]!].sort();

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
        const { ownPts, oppPts } = flushIntervalScore(s.playerId);
        intervals.push({ playerId: s.playerId, teamId, startSec: start, endSec: t, ownPoss: 0, oppPoss: 0, ownPts, oppPts });
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

    // このバッチで実際にラインナップ（5人の組み合わせ）が変わった場合のみスティントを区切る。
    // バッチ処理前が有効な5人組（playersBeforeBatch.length===5）の場合のみ記録する
    // （試合開始直後の最初のバッチは在コートが空集合からのスタートなので対象外）
    const lineupAfterBatch = lineupKeyOf(onCourt[teamId]!);
    if (lineupAfterBatch !== lineupBeforeBatch && playersBeforeBatch.length === 5) {
      const stint = currentStint[teamId]!;
      lineupStints.push({
        teamId,
        lineupKey: lineupBeforeBatch,
        playerIds: playersBeforeBatch,
        startSec: stint.start,
        endSec: t,
        netPoints: stint.net,
      });
    }
    if (lineupAfterBatch !== lineupBeforeBatch) {
      currentStint[teamId] = { start: t, net: 0 };
    }
    i = j;
  }

  const gameEnd = totalGameSeconds(totalPeriods);
  for (const teamId of [homeTeamId, awayTeamId]) {
    const finalLineup = lineupKeyOf(onCourt[teamId]!);
    if (finalLineup.length > 0 && onCourt[teamId]!.size === 5) {
      const stint = currentStint[teamId]!;
      lineupStints.push({
        teamId,
        lineupKey: finalLineup,
        playerIds: [...onCourt[teamId]!].sort(),
        startSec: stint.start,
        endSec: gameEnd,
        netPoints: stint.net,
      });
    }
    for (const [playerId, start] of openStart[teamId]!.entries()) {
      const { ownPts, oppPts } = flushIntervalScore(playerId);
      intervals.push({ playerId, teamId, startSec: start, endSec: gameEnd, ownPoss: 0, oppPoss: 0, ownPts, oppPts });
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

  // 個人PACE算出用に、各在コート区間へ自チーム/相手チームの新ポゼッション開始回数を集計する
  // （buildPossessionStartEvents()参照）。在コート人数の判定・個人+/-・ラインナップスティントの
  // 既存ロジックには一切影響しない、末尾の追加パスとして実装する
  const possessionStarts = buildPossessionStartEvents(playByPlays, homeTeamId, awayTeamId);
  for (const iv of intervals) {
    for (const ps of possessionStarts) {
      if (ps.elapsedSec < iv.startSec || ps.elapsedSec >= iv.endSec) continue;
      if (ps.teamId === iv.teamId) iv.ownPoss += 1;
      else iv.oppPoss += 1;
    }
  }

  return { intervals, plusMinus, lineupStints, warnings };
}

/** 選手ごとの在コート合計秒数（intervalsの合算） */
export function totalOnCourtSeconds(intervals: OnCourtInterval[]): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const iv of intervals) {
    totals[iv.playerId] = (totals[iv.playerId] ?? 0) + (iv.endSec - iv.startSec);
  }
  return totals;
}

export interface PlayerOnCourtRatings {
  pace: number;
  onCourtSec: number;
}

/**
 * 選手ごとの在コート区間（reconstructOnCourt()が返すOnCourtInterval[]。ownPoss/oppPossを
 * 保持済み）を合算し、個人単位のPACEを算出する（NBA.comの「この選手が出場中のチームの
 * ペース」と同じ考え方）。個人ORtg/DRtg/NETRTGはDean Oliver方式のボックススコアのみの式
 * （shared/formulas.tsのindividualOffRtg/individualDefRtg）に置き換え済みのため、
 * ここでは扱わない。
 *
 * PACEはteam-levelの`pace()`（shared/formulas.ts）をそのまま流用しない: `pace()`の第2引数は
 * 「5人分の合計プレイタイム」（内部で/5して実経過時間に戻す）という前提だが、ここでの
 * `onCourtSec`は選手1人分の実際の在コート秒数そのもの（既に実経過時間）なので、/5の前提に
 * 合わせるための変換は不要。誤って`pace()`をそのまま呼ぶと実経過時間が1/5に縮んでPACEが
 * 5倍に水増しされるため、ここでは同じ40分換算の考え方を直接計算する
 */
export function computeOnCourtRatings(intervals: OnCourtInterval[]): Record<string, PlayerOnCourtRatings> {
  const totals: Record<string, { ownPoss: number; oppPoss: number; onCourtSec: number }> = {};
  for (const iv of intervals) {
    const acc = totals[iv.playerId] ?? { ownPoss: 0, oppPoss: 0, onCourtSec: 0 };
    acc.ownPoss += iv.ownPoss;
    acc.oppPoss += iv.oppPoss;
    acc.onCourtSec += iv.endSec - iv.startSec;
    totals[iv.playerId] = acc;
  }

  const result: Record<string, PlayerOnCourtRatings> = {};
  for (const [playerId, acc] of Object.entries(totals)) {
    const onCourtMinutes = acc.onCourtSec / 60;
    result[playerId] = {
      pace: safeDiv(40 * ((acc.ownPoss + acc.oppPoss) / 2), onCourtMinutes),
      onCourtSec: acc.onCourtSec,
    };
  }
  return result;
}
