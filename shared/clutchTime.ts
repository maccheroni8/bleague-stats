// クラッチの時間帯（設計書 373章）: 第4Qと各延長の残り5:00以下で、点差が5点以内の時間とプレー。
//
// 判定はプレーごと。プレーの直前の点差で決める（5:00ちょうど・5点差ちょうどを含む。6点差以上になれば外れ、5点差以内に戻れば対象に戻る）。
// - 得点・試投は、そのプレーの直前の点差（5点差から8点差へ広げる3Pは含み、8点差から5点差へ詰める3Pは含めない）
// - フリースローは1本ごと（5点差から6点差にする1本目は含み、6点差で打つ2本目は含めない）
// - アシスト・ブロック・バスケットカウントは、結び付くシュートの判定を引き継ぐ（アシストの結び付け方は shared/assistedScoring.ts と同じ）
// - 時間は、得点のあとの点差が次の得点まで続くとして数え、残り5:00で区切る（秒単位の記録なので小数秒の精度は無い）
// - 同じ秒の得点の並びは shared/gameFlow.ts の scoringSequence と同じ補正（累計得点の昇順）。得点以外のプレーの「直前の点差」は、配列の中でそれより前にある得点の数で決める
// - 残り0:00のプレーも、直前が対象なら数える
// クラッチになった試合＝対象の時間（1秒以上）か、対象のプレー（記録の付くプレー）が実際にあった試合。勝敗は試合の最終結果。
// 判定できない試合（プレーバイプレーが無い 2017-18 の1810、前後半5分の特別な試合、得点の累計が最終スコアと合わない試合）は、有・無のどちらにも数えない。
//
// 値の出し方: クラッチのプレーだけを抜き出して、ピリオド番号を CLUTCH_PERIOD にした「仮のピリオド」のプレーバイプレーと、
// そのプレーから数えたボックススコアの行（PeriodCategory = CLUTCH_PERIOD）を作り、Q別と同じ関数（buildPlayerBoxscores など）に渡す。
// 4Q・延長の公式のQ別の値と、プレーバイプレーから数えた値は、全シーズンで得点・シュート・リバウンド・アシスト・スティール・ブロック・ファウルが一致する。
// 合わないのはターンオーバー（まれにプレーバイプレーに記録が無い）と被ファウル（プレーバイプレーの記録が足りない）。品質のビット（CLUTCH_QUALITY_*）で持つ。
import { chronologicalPlayByPlays } from "./pbpOrder.ts";
import type { BoxscoreRow, PlayByPlayEvent } from "./types.ts";

/** クラッチの仮のピリオド番号（実際のピリオド・PeriodCategory〔1〜18〕と重ならない値） */
export const CLUTCH_PERIOD = 99;
/** 対象の残り時間（秒）。5:00ちょうどを含む */
export const CLUTCH_REST_SEC = 300;
/** 対象の点差。5点差ちょうどを含む */
export const CLUTCH_MARGIN = 5;
const CLUTCH_FIRST_PERIOD = 4;

const SCORING_CODES = new Set([1, 3, 4, 7, 44]);
const POINTS_BY_CODE: Record<number, number> = { 1: 3, 3: 2, 4: 2, 44: 2, 7: 1 };
/** 記録の付くプレー（クラッチになった試合の判定に使う。交代・タイムアウト・ピリオドの区切りは含めない） */
const STAT_PLAY_CODES = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 31, 44, 91, 92, 93, 94]);
/** アシストの結び付け（shared/assistedScoring.ts と同じ値） */
const ASSIST_TARGET_CODES = new Set([1, 3, 4, 7]);
const ASSIST_SKIP_CODES = new Set([16, 22, 84, 85, 86, 87, 88]);
const ASSIST_MAX_BACKWARD = 8;
/** ブロックは直前の相手の失敗したFG、バスケットカウントは直前の同じチームの成功したFGに結び付ける */
const MISSED_FG_CODES = new Set([2, 5, 6]);
const MADE_FG_CODES = new Set([1, 3, 4, 44]);
const PAIR_SKIP_CODES = new Set([15, 16, 22, 84, 85, 86, 87, 88, 89]);
const PAIR_MAX_BACKWARD = 4;

/** 品質のビット（チーム×試合）。立っている項目は、プレーバイプレーから数えた値が公式の4Q・延長の値と合わない */
export const CLUTCH_QUALITY_TOV = 1;
export const CLUTCH_QUALITY_SHOTS = 2;
export const CLUTCH_QUALITY_OTHER = 4;
/** 出場区間の復元で、クラッチ中の選手の秒数の合計がチームの秒数×5と合わない（出場時間・+/-・出場中の値は使えない） */
export const CLUTCH_QUALITY_ONCOURT = 8;

function restSecondsOf(ev: PlayByPlayEvent): number {
  const m = /^(\d+):(\d{2})$/.exec(ev.RestTime ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}
function periodSeconds(period: number): number {
  return period <= 4 ? 600 : 300;
}
function periodEndSec(period: number): number {
  return period <= 4 ? period * 600 : 2400 + (period - 4) * 300;
}
function elapsedOf(ev: PlayByPlayEvent): number {
  return periodEndSec(ev.Period) - restSecondsOf(ev);
}

export interface ClutchJudgement {
  /** 時系列のプレーバイプレー（chronologicalPlayByPlays の出力） */
  playByPlays: PlayByPlayEvent[];
  /** playByPlays と同じ並びの、クラッチのプレーか */
  flags: boolean[];
  /** クラッチの時間帯（試合開始からの経過秒 [始め, 終わり)） */
  windows: [number, number][];
  /** クラッチの時間帯の長さ（秒） */
  seconds: number;
  /** クラッチになった試合（時間が1秒以上か、記録の付く対象のプレーがある） */
  isClutchGame: boolean;
}

export type ClutchJudgeResult = { ok: true; judgement: ClutchJudgement } | { ok: false; reason: "no-pbp" | "short-game" | "score-sequence" | "final-score" };

/**
 * 試合のクラッチの判定。playByPlays は生データの並び（中で chronologicalPlayByPlays を通す）。
 * 判定できない試合は ok: false（有・無のどちらにも数えない）
 */
export function judgeClutch(playByPlays: PlayByPlayEvent[], homeTeamId: string, finalHome: number, finalAway: number): ClutchJudgeResult {
  void homeTeamId;
  const pbp = chronologicalPlayByPlays(playByPlays);
  if (pbp.length === 0) return { ok: false, reason: "no-pbp" };
  const maxPeriod = Math.max(...pbp.map((e) => e.Period));
  if (maxPeriod < CLUTCH_FIRST_PERIOD) return { ok: false, reason: "short-game" };

  // 得点の並び（gameFlow.ts の scoringSequence と同じ補正）
  type Cand = { index: number; home: number; away: number; elapsed: number; period: number };
  const cands: Cand[] = [];
  for (let i = 0; i < pbp.length; i++) {
    const ev = pbp[i]!;
    if (!SCORING_CODES.has(ev.ActionCD1)) continue;
    const m = /^(\d+)-(\d+)$/.exec(ev.Score ?? "");
    if (!m) return { ok: false, reason: "score-sequence" };
    cands.push({ index: i, home: Number(m[1]), away: Number(m[2]), elapsed: elapsedOf(ev), period: ev.Period });
  }
  const sorted = [...cands].sort((a, b) => a.elapsed - b.elapsed || a.period - b.period || a.home + a.away - (b.home + b.away) || a.index - b.index);
  let ph = 0;
  let pa = 0;
  for (const c of sorted) {
    const dh = c.home - ph;
    const da = c.away - pa;
    if (!((dh > 0 && da === 0) || (da > 0 && dh === 0))) return { ok: false, reason: "score-sequence" };
    ph = c.home;
    pa = c.away;
  }
  if (ph !== finalHome || pa !== finalAway) return { ok: false, reason: "final-score" };

  // 各プレーの直前の点差
  const before = new Array<[number, number]>(pbp.length);
  const posOf = new Map<number, number>(sorted.map((c, i) => [c.index, i]));
  let k = 0;
  for (let i = 0; i < pbp.length; i++) {
    const pos = posOf.get(i);
    if (pos !== undefined) {
      const prev = sorted[pos - 1];
      before[i] = prev ? [prev.home, prev.away] : [0, 0];
      k++;
    } else {
      const prev = sorted[k - 1];
      before[i] = prev ? [prev.home, prev.away] : [0, 0];
    }
  }
  const own = (i: number) => {
    const ev = pbp[i]!;
    const [h, a] = before[i]!;
    return ev.Period >= CLUTCH_FIRST_PERIOD && restSecondsOf(ev) <= CLUTCH_REST_SEC && Math.abs(h - a) <= CLUTCH_MARGIN;
  };
  const flags = pbp.map((_, i) => own(i));
  // 引き継ぎ
  for (let i = 0; i < pbp.length; i++) {
    const ev = pbp[i]!;
    let j = -1;
    if (ev.ActionCD1 === 12) j = assistTarget(pbp, i);
    else if (ev.ActionCD1 === 11) j = pairBackward(pbp, i, (c) => MISSED_FG_CODES.has(c.ActionCD1) && !!c.TeamID && c.TeamID !== ev.TeamID);
    else if (ev.ActionCD1 === 16) j = pairBackward(pbp, i, (c) => MADE_FG_CODES.has(c.ActionCD1) && c.TeamID === ev.TeamID);
    if (j >= 0) flags[i] = flags[j]!;
  }

  // 時間帯: 得点のあとの点差が次の得点まで続く
  const windows: [number, number][] = [];
  let h = 0;
  let a = 0;
  let si = 0;
  for (let p = 1; p <= maxPeriod; p++) {
    const end = periodEndSec(p);
    const lo = end - Math.min(CLUTCH_REST_SEC, periodSeconds(p));
    let cursor = end - periodSeconds(p);
    while (si < sorted.length && sorted[si]!.period === p) {
      const c = sorted[si]!;
      const from = Math.max(cursor, lo);
      if (p >= CLUTCH_FIRST_PERIOD && Math.abs(h - a) <= CLUTCH_MARGIN && c.elapsed > from) windows.push([from, c.elapsed]);
      cursor = Math.max(cursor, c.elapsed);
      h = c.home;
      a = c.away;
      si++;
    }
    const from = Math.max(cursor, lo);
    if (p >= CLUTCH_FIRST_PERIOD && Math.abs(h - a) <= CLUTCH_MARGIN && end > from) windows.push([from, end]);
  }
  // 続いた区間はまとめる
  const merged: [number, number][] = [];
  for (const w of windows) {
    const last = merged[merged.length - 1];
    if (last && last[1] === w[0]) last[1] = w[1];
    else merged.push([w[0], w[1]]);
  }
  const seconds = merged.reduce((n, [s, e]) => n + e - s, 0);
  const isClutchGame = seconds > 0 || pbp.some((e, i) => flags[i] && STAT_PLAY_CODES.has(e.ActionCD1));
  return { ok: true, judgement: { playByPlays: pbp, flags, windows: merged, seconds, isClutchGame } };
}

/** アシストの結び付く得点の位置（shared/assistedScoring.ts の後方の探し方と同じ）。見つからなければ -1 */
function assistTarget(pbp: PlayByPlayEvent[], i: number): number {
  const ev = pbp[i]!;
  for (let j = i - 1, steps = 0; j >= 0 && steps < ASSIST_MAX_BACKWARD; j--, steps++) {
    const c = pbp[j]!;
    if (ASSIST_TARGET_CODES.has(c.ActionCD1)) return c.TeamID === ev.TeamID && c.Period === ev.Period && c.PlayerID1 ? j : -1;
    if (!ASSIST_SKIP_CODES.has(c.ActionCD1)) return -1;
  }
  return -1;
}

function pairBackward(pbp: PlayByPlayEvent[], i: number, match: (c: PlayByPlayEvent) => boolean): number {
  const ev = pbp[i]!;
  for (let j = i - 1, steps = 0; j >= 0 && steps < PAIR_MAX_BACKWARD; j--) {
    const c = pbp[j]!;
    if (c.Period !== ev.Period) return -1;
    if (match(c)) return j;
    if (!PAIR_SKIP_CODES.has(c.ActionCD1)) return -1;
    if (c.ActionCD1 < 80) steps++;
  }
  return -1;
}

/** 経過秒の区間 [s, e) と、クラッチの時間帯の重なり（秒） */
export function clutchOverlapSeconds(windows: readonly [number, number][], s: number, e: number): number {
  let n = 0;
  for (const [ws, we] of windows) n += Math.max(0, Math.min(we, e) - Math.max(ws, s));
  return n;
}

/** クラッチのプレーだけの、仮のピリオド（CLUTCH_PERIOD）のプレーバイプレー。並びは時系列のまま */
export function clutchPlayByPlays(j: ClutchJudgement): PlayByPlayEvent[] {
  return j.playByPlays.filter((_, i) => j.flags[i]).map((e) => ({ ...e, Period: CLUTCH_PERIOD }));
}

function formatPlayTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** プレーバイプレーの記録を、選手の行の項目に数える（個人の番号は新形式・旧形式で同じ） */
function bumpPlayerRow(row: Record<string, number>, code: number): void {
  const add = (k: string, n = 1) => (row[k] = (row[k] ?? 0) + n);
  switch (code) {
    case 1: add("Point", 3); add("PT3M"); add("PT3A"); break;
    case 2: add("PT3A"); break;
    case 3: case 4: case 44: add("Point", 2); add("PT2M"); add("PT2A"); break;
    case 5: case 6: add("PT2A"); break;
    case 7: add("Point", 1); add("FTM"); add("FTA"); break;
    case 8: add("FTA"); break;
    case 9: add("RB_DEF"); add("RB_TOT"); break;
    case 10: add("RB_OFF"); add("RB_TOT"); break;
    case 11: add("BS"); break;
    case 12: add("AS"); break;
    case 13: add("TO"); break;
    case 14: add("ST"); break;
    case 15: add("FOULON"); break;
    case 22: case 23: case 24: case 25: case 26: case 31: case 91: case 92: case 93: case 94: add("FOUL"); break;
  }
}

const ROW_NUMBER_FIELDS = ["Point", "PT3M", "PT3A", "PT2M", "PT2A", "FTM", "FTA", "FOUL", "FOULON", "RB_OFF", "RB_DEF", "RB_TOT", "TO", "AS", "ST", "BS", "BSON", "PTFB", "PT2IN", "PT2ND", "EFF"] as const;

/**
 * クラッチのボックススコアの行（PeriodCategory = CLUTCH_PERIOD）。選手の行（Category 1）・チーム発生の行（2）・チーム合計の行（3）。
 * 選手の行は、試合全体の行（PeriodCategory 18）がある選手すべてに作る（クラッチに出ていなければ値は0。出場時間は "00:00"）。
 * pbp は clutchPlayByPlays の出力。onCourtSec・plusMinus は選手ごとのクラッチ中の値（無い選手は0。plusMinus 自体が null なら +/- を持たせない）。
 * legacy は旧形式（2019-20以前。チームリバウンドの番号が 18＝OR・19＝DR で新形式と逆）
 */
export function clutchBoxscoreRows(
  rows: readonly BoxscoreRow[],
  teamId: string,
  pbp: readonly PlayByPlayEvent[],
  onCourtSec: ReadonlyMap<string, number>,
  plusMinus: ReadonlyMap<string, number> | null,
  legacy: boolean,
): BoxscoreRow[] {
  const gameRows = rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
  const template = rows.find((r) => r.PeriodCategory === 18) ?? gameRows[0];
  const blank = (category: 1 | 2 | 3, base: BoxscoreRow | undefined): BoxscoreRow => {
    const r = { ...(base ?? template), Category: category, PeriodCategory: CLUTCH_PERIOD } as BoxscoreRow & Record<string, unknown>;
    for (const f of ROW_NUMBER_FIELDS) r[f] = 0;
    delete r.PLUSMINUS;
    for (const f of ["AST_TO", "EFG", "TS", "USG"] as const) r[f] = 0;
    delete r.OFFRTG;
    delete r.DEFRTG;
    delete r.NETRTG;
    delete r.POSS;
    return r;
  };
  const byPlayer = new Map<string, BoxscoreRow>();
  const out: BoxscoreRow[] = [];
  for (const g of gameRows) {
    const r = blank(1, g);
    r.PlayTime = g.PlayTime === "DNP" ? "DNP" : formatPlayTime(onCourtSec.get(g.PlayerID) ?? 0);
    if (plusMinus) r.PLUSMINUS = plusMinus.get(g.PlayerID) ?? 0;
    byPlayer.set(g.PlayerID, r);
    out.push(r);
  }
  const team = blank(2, rows.find((r) => r.Category === 2 && r.PeriodCategory === 18));
  team.PlayerID = "";
  team.PlayTime = "";
  const teamOr = legacy ? 18 : 19;
  const teamDr = legacy ? 19 : 18;
  // ブロックされた側（BSON）: ブロックの直前の相手の失敗したFGの選手
  for (let i = 0; i < pbp.length; i++) {
    const ev = pbp[i]!;
    if (ev.TeamID !== teamId) {
      if (ev.ActionCD1 === 11) {
        const j = pairBackward(pbp as PlayByPlayEvent[], i, (c) => MISSED_FG_CODES.has(c.ActionCD1) && c.TeamID === teamId);
        const shooter = j >= 0 ? pbp[j]!.PlayerID1 : null;
        const row = shooter ? byPlayer.get(shooter) : undefined;
        if (row) row.BSON += 1;
      }
      continue;
    }
    const code = ev.ActionCD1;
    if (code === teamOr) { team.RB_OFF += 1; team.RB_TOT += 1; continue; }
    if (code === teamDr) { team.RB_DEF += 1; team.RB_TOT += 1; continue; }
    if (code === 17 || (code === 13 && !ev.PlayerID1)) { team.TO += 1; continue; }
    if (code === 20 || code === 21) { team.FOUL += 1; continue; }
    const row = ev.PlayerID1 ? byPlayer.get(ev.PlayerID1) : undefined;
    if (row) bumpPlayerRow(row as unknown as Record<string, number>, code);
  }
  const total = blank(3, rows.find((r) => r.Category === 3 && r.PeriodCategory === 18));
  total.PlayerID = "";
  let minSec = 0;
  for (const r of [...byPlayer.values(), team]) {
    const into = total as unknown as Record<string, number>;
    for (const f of ROW_NUMBER_FIELDS) into[f] = (into[f] ?? 0) + ((r as unknown as Record<string, number>)[f] ?? 0);
    if (r.Category === 1 && r.PlayTime !== "DNP") minSec += onCourtSec.get(r.PlayerID) ?? 0;
  }
  total.PlayTime = formatPlayTime(minSec);
  if (plusMinus) total.PLUSMINUS = [...byPlayer.values()].reduce((n, r) => n + (r.PLUSMINUS ?? 0), 0);
  // EFF は持たない（2020-21以降の式は被ファウルを含み、プレーバイプレーの被ファウルは足りないため。画面はクラッチの EFF を「-」にする）。
  // 被ファウル（FOULON）は「値なし」（NaN。プレーバイプレーの被ファウルの記録は公式の値より少ないことが多い）。索引に書くときは 0 にし、読む側が「値なし」に戻す
  for (const r of [...byPlayer.values(), team, total]) {
    r.FOULON = Number.NaN;
    r.EFF = Number.NaN;
  }
  out.push(team, total);
  return out;
}

/**
 * 品質のビット（CLUTCH_QUALITY_*。出場区間のビットは呼び出し側が足す）。第4Q・延長のプレーバイプレーから数えた選手・チームの行と、
 * 公式のピリオド別の行（PeriodCategory 4〜14）の合計を比べる。合わない項目のビットを立てる（クラッチは第4Q・延長の中にあるので、ここが合えばクラッチの値も公式と同じ数え方）
 */
export function clutchQuality(rows: readonly BoxscoreRow[], teamId: string, playByPlays: readonly PlayByPlayEvent[], legacy: boolean): number {
  const late = playByPlays.filter((e) => e.Period >= CLUTCH_FIRST_PERIOD).map((e) => ({ ...e, Period: CLUTCH_PERIOD }));
  const syn = clutchBoxscoreRows(rows, teamId, late, new Map(), null, legacy);
  const official = (category: number, playerId: string | null, field: string) =>
    rows
      .filter((r) => r.Category === category && r.PeriodCategory >= 4 && r.PeriodCategory <= 14 && (playerId === null || r.PlayerID === playerId))
      .reduce((n, r) => n + Number((r as unknown as Record<string, unknown>)[field] ?? 0), 0);
  const groups: [number, readonly string[]][] = [
    [CLUTCH_QUALITY_SHOTS, ["Point", "PT3M", "PT3A", "PT2M", "PT2A", "FTM", "FTA"]],
    [CLUTCH_QUALITY_TOV, ["TO"]],
    [CLUTCH_QUALITY_OTHER, ["RB_OFF", "RB_DEF", "RB_TOT", "AS", "ST", "BS", "FOUL"]],
  ];
  let bits = 0;
  for (const r of syn) {
    if (r.Category === 3) continue;
    for (const [bit, fields] of groups) {
      for (const f of fields) {
        if (official(r.Category, r.Category === 1 ? r.PlayerID : null, f) !== Number((r as unknown as Record<string, unknown>)[f] ?? 0)) bits |= bit;
      }
    }
  }
  return bits;
}

/** 試合の得点（プレーバイプレーの得点の記録から。検証用） */
export function pointsOfPlay(code: number): number {
  return POINTS_BY_CODE[code] ?? 0;
}
