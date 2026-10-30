// FT・3P の連続成功（シュート単位の連続記録。DESIGN.md 303章）の材料と、試合をまたいだつなぎ方。
//
// 試合ごとの要約（ShotStreakSummary）: その選手のその種類の試投を時系列（withChronologicalPlayByPlays の並び。同じ秒は記録の順）に並べ、
// 失敗で区切った成功の連なりを、先頭の連なり（prefix）・末尾の連なり（suffix）・途中の連なり（先頭・末尾以外）の最長（innerMax）とその件数（innerMaxCount）にまとめる。
// 全部成功（made＝attempts）の試合は、先頭＝末尾＝試投数で、途中の連なりは無い。試投0の試合は、連続をそのまま続ける。
// プレーバイプレーが無い試合・プレーバイプレーの本数が公式のボックススコアと合わない試合（順番が確かめられない）は要約を持たず、
// つなぐときはそこで区切る（続いていたとも途切れたとも決めない）。
import type { BoxscoreRow, PlayByPlayEvent } from "./types.ts";

/** [試投, 成功, 先頭の連なり, 末尾の連なり, 途中の最長, 途中の最長の件数] */
export type ShotStreakSummary = [number, number, number, number, number, number];

export type ShotStreakKind = "ft" | "tp";
const CODES: Record<ShotStreakKind, { made: number; missed: number }> = { ft: { made: 7, missed: 8 }, tp: { made: 1, missed: 2 } };

/** 1試合・1選手・1種類の試投の成否の並び（時系列） */
export function shotSequence(playByPlays: readonly PlayByPlayEvent[], playerId: string, kind: ShotStreakKind): boolean[] {
  const { made, missed } = CODES[kind];
  const out: boolean[] = [];
  for (const e of playByPlays) {
    if (e.PlayerID1 !== playerId) continue;
    if (e.ActionCD1 === made) out.push(true);
    else if (e.ActionCD1 === missed) out.push(false);
  }
  return out;
}

export function summarizeSequence(seq: readonly boolean[]): ShotStreakSummary {
  const attempts = seq.length;
  const madeCount = seq.filter((x) => x).length;
  if (madeCount === attempts) return [attempts, madeCount, attempts, attempts, 0, 0];
  let prefix = 0;
  while (seq[prefix]) prefix++;
  let suffix = 0;
  while (seq[attempts - 1 - suffix]) suffix++;
  let innerMax = 0;
  let innerCount = 0;
  let run = 0;
  // 最初の失敗の次から、最後の失敗まで（先頭・末尾の連なりは含めない）
  for (let i = prefix + 1; i <= attempts - 1 - suffix; i++) {
    if (seq[i]) {
      run++;
      continue;
    }
    if (run > 0) {
      if (run > innerMax) {
        innerMax = run;
        innerCount = 1;
      } else if (run === innerMax) innerCount++;
    }
    run = 0;
  }
  return [attempts, madeCount, prefix, suffix, innerMax, innerCount];
}

/** その選手の公式の試投・成功（試合全体の個人の行） */
function boxCounts(rows: readonly BoxscoreRow[], playerId: string, kind: ShotStreakKind): { attempts: number; made: number } | null {
  const row = rows.find((r) => r.Category === 1 && r.PeriodCategory === 18 && r.PlayerID === playerId);
  if (!row) return null;
  return kind === "ft" ? { attempts: row.FTA, made: row.FTM } : { attempts: row.PT3A, made: row.PT3M };
}

/** 試合の要約。プレーバイプレーが無い・本数が公式と合わないときは null（つなぐときに区切る） */
export function gameShotStreakSummary(
  playByPlays: readonly PlayByPlayEvent[],
  rows: readonly BoxscoreRow[],
  playerId: string,
  kind: ShotStreakKind,
): ShotStreakSummary | null {
  if (playByPlays.length === 0) return null;
  const box = boxCounts(rows, playerId, kind);
  if (!box) return null;
  const seq = shotSequence(playByPlays, playerId, kind);
  const summary = summarizeSequence(seq);
  if (summary[0] !== box.attempts || summary[1] !== box.made) return null;
  return summary;
}

/** つないだ結果の1つの連続 */
export interface ShotStreak {
  length: number;
  /** 連続が始まった試合・終わった試合（要約の key） */
  fromKey: string;
  toKey: string;
}

/** つないだ結果: 最長の連続（代表1件＝最初に達成したもの）と、同じ長さの連続の件数 */
export interface ShotStreakRecord {
  best: ShotStreak | null;
  count: number;
}

/**
 * 時系列に並んだ試合の要約をつなぐ（同じリーグ・同じシーズン・同じ試合区分の中で呼ぶ。移籍しても本人の連続としてつなぐので、チームで分けない）。
 * summary が null の試合（記録が欠けた・順番が確かめられない）では連続を区切る（そこまでの連続は終わったものとして数える）。
 * 連続の長さが0のものは数えない
 */
export function chainShotStreaks(games: readonly { key: string; summary: ShotStreakSummary | null }[]): ShotStreakRecord {
  let best: ShotStreak | null = null;
  let count = 0;
  const consider = (length: number, fromKey: string, toKey: string) => {
    if (length <= 0) return;
    if (!best || length > best.length) {
      best = { length, fromKey, toKey };
      count = 1;
    } else if (length === best.length) count++;
  };
  let open = 0;
  let openFrom = "";
  let openTo = "";
  const close = () => {
    consider(open, openFrom, openTo);
    open = 0;
  };
  for (const g of games) {
    const s = g.summary;
    if (!s) {
      close();
      continue;
    }
    const [attempts, made, prefix, suffix, innerMax, innerCount] = s;
    if (attempts === 0) continue;
    if (made === attempts) {
      if (open === 0) openFrom = g.key;
      open += attempts;
      openTo = g.key;
      continue;
    }
    // 先頭の連なりを、開いている連続につなげて閉じる
    if (prefix > 0) {
      if (open === 0) openFrom = g.key;
      open += prefix;
      openTo = g.key;
    }
    close();
    for (let i = 0; i < innerCount; i++) consider(innerMax, g.key, g.key);
    if (suffix > 0) {
      open = suffix;
      openFrom = g.key;
      openTo = g.key;
    }
  }
  close();
  return { best, count };
}
