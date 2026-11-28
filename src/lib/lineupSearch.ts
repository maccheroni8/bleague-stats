// ラインナップ検索（チーム詳細）の計算。チームの出場区間ごとの数え上げ（data/{season}/team-stints/{teamId}.json。DESIGN.md 204章）から、
// 選んだ選手が全員コートにいた時間帯（Players On）と、全員ベンチにいた時間帯（Players Off）の成績を求める。DESIGN.md 207章
//
// - Players On: 選んだ選手が全員コートにいる区間
// - Players Off: 選んだ選手が全員コートにいない区間。どちらか一部だけがコートにいる区間は、On にも Off にも入れない
//   Off は、選んだ選手のうち誰かが出場した試合だけが対象（出場しなかった試合の「ベンチ」は意味が無いため。個人詳細のオンコート/オフコートと同じ）
// - 試合数は、その状態が実際に起きた試合の数（時間があった、または得点・攻撃の記録があった試合）。平均はその試合数で割る

import type { TeamStintsFile } from "../../shared/types";
import { ratingsFromPossessions } from "./lineupRatings";

export type LineupSearchMode = "on" | "off";

export interface LineupSearchOptions {
  /** 対象にする試合（ScheduleKey）か。試合区分・ホーム/アウェイの絞り込みはここで渡す */
  includeGame: (scheduleKey: string) => boolean;
  /** 対象にするピリオド。null は全ピリオド */
  periods: number[] | null;
}

export interface LineupSearchResult {
  games: number;
  seconds: number;
  ownPoints: number;
  oppPoints: number;
  ownPoss: number;
  oppPoss: number;
}

const FIXED_COLUMNS = 9; // 試合番号・ピリオド・開始秒・終了秒・選手×5

/** 数え上げの列の位置（countKeys に無ければ -1） */
function countIndex(file: TeamStintsFile, key: string): number {
  return file.countKeys.indexOf(key);
}

/** 選んだ選手のうち、そのチームのファイルに居る選手の番号 */
function selectedNumbers(file: TeamStintsFile, selectedPlayerIds: readonly string[]): number[] {
  const numbers: number[] = [];
  for (const id of selectedPlayerIds) {
    const n = file.players.indexOf(id);
    if (n >= 0) numbers.push(n);
  }
  return numbers;
}

export function searchLineup(
  file: TeamStintsFile,
  selectedPlayerIds: readonly string[],
  mode: LineupSearchMode,
  options: LineupSearchOptions,
): LineupSearchResult {
  const result: LineupSearchResult = { games: 0, seconds: 0, ownPoints: 0, oppPoints: 0, ownPoss: 0, oppPoss: 0 };
  // 選んだ選手がこのチームのファイルに居ない（このシーズンに出場していない）ときは、On は成り立たず、Off は対象の試合が無い
  const selected = selectedNumbers(file, selectedPlayerIds);
  if (selectedPlayerIds.length === 0 || selected.length !== selectedPlayerIds.length) return result;
  const selectedSet = new Set(selected);
  const nKeys = file.countKeys.length;
  const ptsIdx = countIndex(file, "pts");
  const possIdx = countIndex(file, "poss");
  if (ptsIdx < 0 || possIdx < 0) return result;

  // 試合ごとに、選んだ選手のうち誰かが出場したか（ピリオドの絞り込みに関係なく、試合全体で見る）
  const appeared = new Set<number>();
  if (mode === "off") {
    for (const row of file.rows) {
      const game = row[0]!;
      if (appeared.has(game) || row[3]! <= row[2]!) continue;
      for (let i = 4; i < FIXED_COLUMNS; i += 1) {
        if (selectedSet.has(row[i]!)) {
          appeared.add(game);
          break;
        }
      }
    }
  }

  const gameIncluded = new Map<number, boolean>();
  const active = new Set<number>();
  for (const row of file.rows) {
    const game = row[0]!;
    let ok = gameIncluded.get(game);
    if (ok === undefined) {
      ok = options.includeGame(file.games[game]!);
      gameIncluded.set(game, ok);
    }
    if (!ok) continue;
    if (options.periods !== null && !options.periods.includes(row[1]!)) continue;

    let onCourt = 0;
    for (let i = 4; i < FIXED_COLUMNS; i += 1) if (selectedSet.has(row[i]!)) onCourt += 1;
    if (mode === "on" ? onCourt !== selected.length : onCourt !== 0 || !appeared.has(game)) continue;

    const seconds = row[3]! - row[2]!;
    const ownPts = row[FIXED_COLUMNS + ptsIdx]!;
    const oppPts = row[FIXED_COLUMNS + nKeys + ptsIdx]!;
    const ownPoss = row[FIXED_COLUMNS + possIdx]!;
    const oppPoss = row[FIXED_COLUMNS + nKeys + possIdx]!;
    result.seconds += seconds;
    result.ownPoints += ownPts;
    result.oppPoints += oppPts;
    result.ownPoss += ownPoss;
    result.oppPoss += oppPoss;
    if (seconds > 0 || ownPts !== 0 || oppPts !== 0 || ownPoss !== 0 || oppPoss !== 0) active.add(game);
  }
  result.games = active.size;
  return result;
}

export interface LineupSearchRow {
  games: number;
  totalMinutes: number;
  ownPoints: number;
  oppPoints: number;
  netPoints: number;
  avgMinutes: number | null;
  avgOwnPoints: number | null;
  avgOppPoints: number | null;
  avgNetPoints: number | null;
  off: number | null;
  def: number | null;
  net: number | null;
}

/** 画面に出す12項目。平均は、その状態が実際に起きた試合の数で割る */
export function lineupSearchRow(r: LineupSearchResult): LineupSearchRow {
  const avg = (v: number) => (r.games > 0 ? v / r.games : null);
  const ratings = ratingsFromPossessions(r.ownPoints, r.oppPoints, r.ownPoss, r.oppPoss);
  return {
    games: r.games,
    totalMinutes: r.seconds / 60,
    ownPoints: r.ownPoints,
    oppPoints: r.oppPoints,
    netPoints: r.ownPoints - r.oppPoints,
    avgMinutes: avg(r.seconds / 60),
    avgOwnPoints: avg(r.ownPoints),
    avgOppPoints: avg(r.oppPoints),
    avgNetPoints: avg(r.ownPoints - r.oppPoints),
    off: ratings.off,
    def: ratings.def,
    net: ratings.net,
  };
}

/** ファイルに出てくるピリオドの最大（延長を含む試合のピリオド数。4未満にはしない） */
export function maxPeriodOf(file: TeamStintsFile): number {
  let max = 4;
  for (const row of file.rows) if (row[1]! > max) max = row[1]!;
  return max;
}

/** 選手ごとの出場時間（秒、全試合）。選択肢を出場時間の多い順に並べるのに使う */
export function playerSecondsOf(file: TeamStintsFile): Map<string, number> {
  const seconds = new Map<string, number>();
  for (const row of file.rows) {
    const d = row[3]! - row[2]!;
    if (d <= 0) continue;
    for (let i = 4; i < FIXED_COLUMNS; i += 1) {
      const id = file.players[row[i]!]!;
      seconds.set(id, (seconds.get(id) ?? 0) + d);
    }
  }
  return seconds;
}

// ---- 人数ごと・組み合わせごと（DESIGN.md 482章） ----
//
// 選んだ選手（N人）のうち「何人がコートにいるか」で区間を分ける。組み合わせは、コートにいた選手の集合（選んだ順の番号のビット）。
// 対象の試合は、選んだ選手のうち誰かが出場した試合（Players Off と同じ）。全員出場（N人）の行は、選んだ選手が全員出た区間なので Players On と同じ値になる。
// 対象の試合の区間はどれか1つの行に入るので、行の出場時間を足すと対象の試合の時間の合計になる

/** 数え上げの合計（own・opp は file.countKeys と同じ並び） */
export interface LineupSplitTotals {
  games: number;
  seconds: number;
  own: number[];
  opp: number[];
  countKeys: string[];
}

export interface LineupSplitResult {
  /** 選んだ人数（ファイルに居る選手の数。選んだ全員が居ないときは0で、行は無い） */
  size: number;
  /** 組み合わせ（ビット＝選んだ順の番号）ごとの合計。起きなかった組み合わせは入らない */
  byMask: Map<number, LineupSplitTotals>;
  /** 人数ごとの合計（添字＝コートにいた人数 0〜size） */
  byCount: LineupSplitTotals[];
  /** 対象の試合（選んだ選手の誰かが出場した試合。区分・場所の絞り込みのあと）の時間の合計（秒。ピリオドの絞り込みのあと） */
  totalSeconds: number;
}

function emptyTotals(nKeys: number, countKeys: string[]): LineupSplitTotals {
  return { games: 0, seconds: 0, own: new Array<number>(nKeys).fill(0), opp: new Array<number>(nKeys).fill(0), countKeys };
}

export function searchLineupSplit(file: TeamStintsFile, selectedPlayerIds: readonly string[], options: LineupSearchOptions): LineupSplitResult {
  const nKeys = file.countKeys.length;
  const selected = selectedNumbers(file, selectedPlayerIds);
  const size = selected.length;
  const empty: LineupSplitResult = { size: 0, byMask: new Map(), byCount: [], totalSeconds: 0 };
  if (selectedPlayerIds.length === 0 || size !== selectedPlayerIds.length) return empty;
  const bitOf = new Map<number, number>(selected.map((n, i) => [n, 1 << i]));
  const ptsIdx = countIndex(file, "pts");
  const possIdx = countIndex(file, "poss");
  if (ptsIdx < 0 || possIdx < 0) return empty;

  const appeared = new Set<number>();
  for (const row of file.rows) {
    const game = row[0]!;
    if (appeared.has(game) || row[3]! <= row[2]!) continue;
    for (let i = 4; i < FIXED_COLUMNS; i += 1) {
      if (bitOf.has(row[i]!)) {
        appeared.add(game);
        break;
      }
    }
  }

  const byMask = new Map<number, LineupSplitTotals>();
  const activeByMask = new Map<number, Set<number>>();
  const gameIncluded = new Map<number, boolean>();
  let totalSeconds = 0;
  for (const row of file.rows) {
    const game = row[0]!;
    if (!appeared.has(game)) continue;
    let ok = gameIncluded.get(game);
    if (ok === undefined) {
      ok = options.includeGame(file.games[game]!);
      gameIncluded.set(game, ok);
    }
    if (!ok) continue;
    if (options.periods !== null && !options.periods.includes(row[1]!)) continue;

    let mask = 0;
    for (let i = 4; i < FIXED_COLUMNS; i += 1) mask |= bitOf.get(row[i]!) ?? 0;
    let t = byMask.get(mask);
    if (!t) {
      t = emptyTotals(nKeys, file.countKeys);
      byMask.set(mask, t);
      activeByMask.set(mask, new Set());
    }
    const seconds = row[3]! - row[2]!;
    t.seconds += seconds;
    totalSeconds += seconds;
    let any = seconds > 0;
    for (let k = 0; k < nKeys; k += 1) {
      const o = row[FIXED_COLUMNS + k]!;
      const p = row[FIXED_COLUMNS + nKeys + k]!;
      t.own[k]! += o;
      t.opp[k]! += p;
      if ((k === ptsIdx || k === possIdx) && (o !== 0 || p !== 0)) any = true;
    }
    if (any) activeByMask.get(mask)!.add(game);
  }

  const byCount: LineupSplitTotals[] = [];
  const activeByCount: Set<number>[] = [];
  for (let c = 0; c <= size; c += 1) {
    byCount.push(emptyTotals(nKeys, file.countKeys));
    activeByCount.push(new Set());
  }
  for (const [mask, t] of byMask) {
    const active = activeByMask.get(mask)!;
    t.games = active.size;
    const c = popCount(mask);
    const sum = byCount[c]!;
    sum.seconds += t.seconds;
    for (let k = 0; k < nKeys; k += 1) {
      sum.own[k]! += t.own[k]!;
      sum.opp[k]! += t.opp[k]!;
    }
    for (const g of active) activeByCount[c]!.add(g);
  }
  byCount.forEach((t, c) => {
    t.games = activeByCount[c]!.size;
  });
  return { size, byMask, byCount, totalSeconds };
}

export function popCount(mask: number): number {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n += 1;
  return n;
}

/** 数え上げの合計を、今までの12項目の行の材料（得点・失点・攻撃回数）にする */
export function splitTotalsToResult(t: LineupSplitTotals): LineupSearchResult {
  const at = (arr: number[], key: string) => {
    const i = t.countKeys.indexOf(key);
    return i >= 0 ? arr[i]! : 0;
  };
  return {
    games: t.games,
    seconds: t.seconds,
    ownPoints: at(t.own, "pts"),
    oppPoints: at(t.opp, "pts"),
    ownPoss: at(t.own, "poss"),
    oppPoss: at(t.opp, "poss"),
  };
}

/** 組み合わせの並び: 選んだ順の番号の小さい選手を含むものから（3人なら AB・AC・BC） */
export function masksOfCount(size: number, count: number): number[] {
  const out: number[] = [];
  for (let m = 0; m < 1 << size; m += 1) if (popCount(m) === count) out.push(m);
  // ビットの低い順＝選んだ順の早い選手を含むものが先になるよう、選手の番号の並びで辞書順に
  const key = (m: number) => {
    const idx: number[] = [];
    for (let i = 0; i < size; i += 1) if (m & (1 << i)) idx.push(i);
    return idx;
  };
  return out.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < Math.min(ka.length, kb.length); i += 1) if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
    return ka.length - kb.length;
  });
}
