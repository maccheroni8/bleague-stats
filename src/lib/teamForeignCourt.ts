// On-Court Foreign（外国籍・帰化・アジアの選手が同時に0〜4人コートにいた時間）と、オンザコート別の得点・失点・攻撃回数を、
// 絞り込んだ試合（試合区分・試合の条件）と区間（試合全体・1Q〜4Q・前半・後半・延長）で足す（DESIGN.md 256章の段階3の画面）。
// - 試合全体の秒数は試合ログ（TeamGameLog.foreignCourtSeconds・opponentForeignCourtSeconds）から、区間はチームのピリオド別の索引（oc0〜oc4）から
// - オンザコート別の得点・失点・攻撃回数は、試合全体も区間も索引（「all.oc{n}Pts」など）から
// - 前後半5分の特別な試合は、1Q〜4Q・前半・後半の値が無いので数えない。延長は延長のあった試合だけを数える（平均の分母も同じ）
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { PERIOD_ATOMS, TEAM_PERIOD_WHOLE_GAME_KEY, type PeriodPossKey, type TeamPeriodIndexFile } from "../../shared/periodIndex";
import type { TeamGameLog } from "../../shared/types";
import { PERIOD_ATOM_INDEXES, type GameRecordPeriod } from "./periodIndex";
import type { TeamPeriodSource } from "./teamPeriodTotals";

/** 区間（試合全体を含む） */
export type ForeignPeriodValue = "all" | GameRecordPeriod;

export const FOREIGN_COUNTS = [0, 1, 2, 3, 4] as const;

/** 索引に人数別の秒数（oc0〜oc4。区間と試合全体）があるか。古い索引には無い */
export function hasForeignColumns(source: TeamPeriodSource | null): boolean {
  return !!source && FOREIGN_COUNTS.every((n) => !!source.file.rows.counts[`q1.oc${n}`] && !!source.file.rows.counts[`${TEAM_PERIOD_WHOLE_GAME_KEY}.oc${n}`]);
}

/** 索引に人数別の得点・失点・攻撃回数（区間と試合全体）があるか。古い索引には無い */
export function hasForeignDetailColumns(source: TeamPeriodSource | null): boolean {
  if (!hasForeignColumns(source)) return false;
  const counts = source!.file.rows.counts;
  return FOREIGN_COUNTS.every((n) =>
    ["Pts", "OppPts", "Poss", "OppPoss"].every((s) => !!counts[`q1.oc${n}${s}`] && !!counts[`${TEAM_PERIOD_WHOLE_GAME_KEY}.oc${n}${s}`]),
  );
}

/** 試合ログに人数別の秒数があるか（古いデータには無い）。1試合でもあれば、そのシーズンのデータは対応している */
export function logsHaveForeignSeconds(logs: Iterable<TeamGameLog>): boolean {
  for (const g of logs) if (g.foreignCourtSeconds) return true;
  return false;
}

function keysOf(period: ForeignPeriodValue): string[] {
  return period === "all" ? [TEAM_PERIOD_WHOLE_GAME_KEY] : PERIOD_ATOM_INDEXES[period].map((a) => PERIOD_ATOMS[a]!);
}

/** 行 r の列 col を、区間のキーで足す（値の無い -1 は飛ばす） */
function sumCol(file: TeamPeriodIndexFile, r: number, keys: readonly string[], col: string): { value: number; has: boolean } {
  let value = 0;
  let has = false;
  for (const k of keys) {
    const v = file.rows.counts[`${k}.${col}`]?.[r] ?? -1;
    if (v >= 0) {
      value += v;
      has = true;
    }
  }
  return { value, has };
}

/** 区間（1Q〜4Q・前半・後半・延長）の値がある試合か（特別な試合の1Q〜後半、延長の無い試合の延長は無い） */
function hasPeriod(file: TeamPeriodIndexFile, r: number, period: GameRecordPeriod): boolean {
  return PERIOD_ATOM_INDEXES[period].some((a) => (file.rows.counts[`${PERIOD_ATOMS[a]}.pts`]?.[r] ?? -1) >= 0);
}

/** 試合ログの試合の、索引の行（自チーム・相手）。索引に無い試合は null */
function rowsOf(source: TeamPeriodSource, g: TeamGameLog): { own: number; opp: number } | null {
  const n = source.gameNo.get(g.scheduleKey);
  if (n === undefined) return null;
  return { own: n * 2 + (g.isHome ? 0 : 1), opp: n * 2 + (g.isHome ? 1 : 0) };
}

/** 人数別の在コート秒数の合計と、数えた試合数（平均の分母） */
export interface ForeignCourtSum {
  games: number;
  /** [0人, 1人, 2人, 3人, 4人] */
  seconds: number[];
}

/**
 * 絞り込み済みの試合ログの、人数別の在コート秒数の合計（side は自チーム／相手のコート上の人数）。
 * 試合全体は試合ログから（人数を数えられる5人組が無い試合も試合数には数える。teams.json の On-Court Foreign と同じ）。
 * 区間は索引から（source が要る。読めなければ null）
 */
export function sumForeignCourt(
  source: TeamPeriodSource | null,
  logs: readonly TeamGameLog[],
  period: ForeignPeriodValue,
  side: "own" | "opp",
): ForeignCourtSum | null {
  const seconds = [0, 0, 0, 0, 0];
  if (period === "all") {
    for (const g of logs) {
      const s = side === "own" ? g.foreignCourtSeconds : g.opponentForeignCourtSeconds;
      if (s) for (const n of FOREIGN_COUNTS) seconds[n]! += s[n] ?? 0;
    }
    return { games: logs.length, seconds };
  }
  if (!source || !hasForeignColumns(source)) return null;
  const keys = keysOf(period);
  let games = 0;
  for (const g of logs) {
    const rows = rowsOf(source, g);
    if (!rows || !hasPeriod(source.file, rows.own, period) || !hasPeriod(source.file, rows.opp, period)) continue;
    games += 1;
    const r = side === "own" ? rows.own : rows.opp;
    for (const n of FOREIGN_COUNTS) seconds[n]! += sumCol(source.file, r, keys, `oc${n}`).value;
  }
  return { games, seconds };
}

/** オンザコート別の合計の材料（人数ごとの時間・得点・失点・攻撃回数と、条件の試合時間・チームの得点・失点・攻撃回数） */
export interface ForeignDetailSum {
  /** 数えた試合数（平均の分母。延長は延長のあった試合） */
  games: number;
  /** 人数ごと（0〜4人） */
  byCount: { seconds: number; ownPoints: number; oppPoints: number; ownPoss: number; oppPoss: number }[];
  /** 攻撃回数が人数ごとにある（2020-21以降）。無いシーズンは推定 */
  realPoss: boolean;
  /** 条件の試合時間（秒）・チームの得点・失点 */
  seconds: number;
  ownPoints: number;
  oppPoints: number;
  /** 条件のチームの攻撃回数（推定に使う） */
  teamPoss: number;
}

/**
 * チーム詳細「オンザコート別の合計」の材料を、試合ログ（試合区分で絞ったもの）と区間から足す。索引に人数別の得点の列が無ければ null。
 * 試合時間は、試合全体は試合ログの出場時間÷5（今のオンザコート別の合計と同じ）、区間は索引の出場時間÷5。攻撃回数は、試合全体は試合ログ、区間は索引
 */
export function sumForeignDetail(source: TeamPeriodSource | null, logs: readonly TeamGameLog[], period: ForeignPeriodValue): ForeignDetailSum | null {
  if (!source || !hasForeignDetailColumns(source)) return null;
  const { file } = source;
  const keys = keysOf(period);
  const byCount = FOREIGN_COUNTS.map(() => ({ seconds: 0, ownPoints: 0, oppPoints: 0, ownPoss: 0, oppPoss: 0 }));
  let games = 0;
  let seconds = 0;
  let ownPoints = 0;
  let oppPoints = 0;
  let teamPoss = 0;
  let realPoss = true;
  let any = false;
  for (const g of logs) {
    const rows = rowsOf(source, g);
    if (!rows) continue;
    if (period !== "all" && (!hasPeriod(file, rows.own, period) || !hasPeriod(file, rows.opp, period))) continue;
    games += 1;
    if (period === "all") {
      seconds += Math.round((g.min * 60) / 5);
      ownPoints += g.teamScore;
      oppPoints += g.opponentScore;
      teamPoss += g.poss > 0 ? g.poss : 0;
    } else {
      seconds += Math.round(sumCol(file, rows.own, keys, "minSec").value / 5);
      ownPoints += sumCol(file, rows.own, keys, "pts").value;
      oppPoints += sumCol(file, rows.opp, keys, "pts").value;
      const p = file.rows.poss[period as PeriodPossKey]?.[rows.own] ?? -1;
      teamPoss += p > 0 ? p : 0;
    }
    for (const n of FOREIGN_COUNTS) {
      const sec = sumCol(file, rows.own, keys, `oc${n}`);
      if (!sec.has) continue; // 人数を数えられる5人組が無い試合（すべて -1）
      any = true;
      const b = byCount[n]!;
      b.seconds += sec.value;
      b.ownPoints += sumCol(file, rows.own, keys, `oc${n}Pts`).value;
      b.oppPoints += sumCol(file, rows.own, keys, `oc${n}OppPts`).value;
      const own = sumCol(file, rows.own, keys, `oc${n}Poss`);
      const opp = sumCol(file, rows.own, keys, `oc${n}OppPoss`);
      if (!own.has || !opp.has) realPoss = false;
      b.ownPoss += own.value;
      b.oppPoss += opp.value;
    }
  }
  return { games, byCount, realPoss: any && realPoss, seconds, ownPoints, oppPoints, teamPoss };
}
