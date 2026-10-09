// ピリオド別の索引（data/{season}/player-period-index.json.gz。形式は shared/periodIndex.ts、DESIGN.md 225章）を読む。
// 1試合行の索引（gameIndex.ts）の行に結び付けて、Q別・前後半・延長の値を持つ「選手の1試合」にする。集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。
// 前半・後半は 1Q+2Q／3Q+4Q の合計（選手の値は足し算で出せる。シーズン成績のQ別と同じ関数で出した値を、直接出した前半・後半と全行で照合済み。validate:period-index）。
import { PERIOD_INDEX_VERSION, PERIOD_ROW_FLAG_PLUS_MINUS, PLAYER_PERIOD_STAT_COLUMNS, type PlayerPeriodIndexFile, type PlayerPeriodStatColumn } from "../../shared/periodIndex";
import { playerGameAt, type IndexedPlayerGame, type PlayerGameIndexView } from "./gameIndex";

/** 1試合記録で選べる区間（試合全体を除く） */
export type GameRecordPeriod = "q1" | "q2" | "q3" | "q4" | "h1" | "h2" | "ot";

/** 区間に含まれる、持っている区間（PERIOD_ATOMS の番号）。前半は1Q・2Q、後半は3Q・4Q */
export const PERIOD_ATOM_INDEXES: Record<GameRecordPeriod, readonly number[]> = {
  q1: [0],
  q2: [1],
  q3: [2],
  q4: [3],
  h1: [0, 1],
  h2: [2, 3],
  ot: [4],
};

export interface PlayerPeriodView {
  season: string;
  file: PlayerPeriodIndexFile;
  /** 1試合行の索引の行ごとの、区間の行の範囲 [start, end)。区間の行が無い行は start = -1 */
  start: Int32Array;
  end: Int32Array;
}

/** ファイルの版が合い、形が読めるか（版が新しい・壊れたファイルは使わない） */
export function isSupportedPeriodIndex(file: { version?: unknown; rows?: unknown } | null | undefined): boolean {
  return !!file && file.version === PERIOD_INDEX_VERSION && !!file.rows;
}

/** 結び付け先の1試合行の索引の行数が合うときだけ読める。合わないとき（片方だけ古いなど）は null */
export function viewPlayerPeriodIndex(file: PlayerPeriodIndexFile, main: PlayerGameIndexView): PlayerPeriodView | null {
  if (file.indexRows !== main.size) return null;
  const start = new Int32Array(main.size).fill(-1);
  const end = new Int32Array(main.size).fill(-1);
  const { row } = file.rows;
  for (let i = 0; i < row.length; i++) {
    const r = row[i]!;
    if (r < 0 || r >= main.size) return null;
    if (start[r] === -1) start[r] = i;
    end[r] = i + 1;
  }
  return { season: file.season, file, start, end };
}

/** 区間の値を持つ選手の1試合。plusMinusMissing は、公式のピリオド別の +/- が無い（2021-22以前など）ことを表す */
export type IndexedPeriodGame = IndexedPlayerGame & { plusMinusMissing: boolean };

/**
 * 主索引の i 行目の、指定した区間の値を持つ選手の1試合。その区間に出ていない（行が無い）ときは null。
 * 前後半5分の特別な試合は区間の行を持たないので、延長を含めどの区間でも null
 */
export function periodGameAt(main: PlayerGameIndexView, period: PlayerPeriodView, i: number, atoms: readonly number[]): IndexedPeriodGame | null {
  const from = period.start[i]!;
  if (from === -1) return null;
  const { stats, period: periods, flags } = period.file.rows;
  const sum = {} as Record<PlayerPeriodStatColumn, number>;
  for (const c of PLAYER_PERIOD_STAT_COLUMNS) sum[c] = 0;
  let found = false;
  let hasPlusMinus = false;
  for (let k = from; k < period.end[i]!; k++) {
    if (!atoms.includes(periods[k]!)) continue;
    found = true;
    if ((flags[k]! & PERIOD_ROW_FLAG_PLUS_MINUS) !== 0) hasPlusMinus = true;
    for (const c of PLAYER_PERIOD_STAT_COLUMNS) sum[c] += stats[c][k]!;
  }
  if (!found) return null;
  const base = playerGameAt(main, i);
  // 試合全体の値を、区間の値に置き換える（出場時間は分に戻す）。勝負所（第4Q・延長の窓）は区間の値ではないので外す
  const { clutch: _clutch, ...rest } = base;
  void _clutch;
  return { ...rest, ...sum, min: sum.minSec / 60, plusMinusMissing: !hasPlusMinus } as IndexedPeriodGame;
}

