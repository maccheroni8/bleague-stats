// クォーター別・前後半別の記録と1試合平均（チーム詳細「クラブレコード」「通算成績」、チーム全体「歴代記録」、
// 日次集計のシーズン別リーグ順位で共通。DESIGN.md 143章）。区間は1Q〜4Q・前半（1Q＋2Q）・後半（3Q＋4Q）で、延長戦は含めない。
// 値は TeamGameLog.periodPoints / opponentPeriodPoints（shared/periodPoints.ts）から取る。その区間に欠けているクォーターがある試合と、
// クォーター別の値を持たない試合（CSの前後半5分の特別な試合）は、その区間の対象外
import type { TeamGameLog } from "./types.ts";

export type PeriodKey = "q1" | "q2" | "q3" | "q4" | "h1" | "h2";

export const PERIOD_KEYS: PeriodKey[] = ["q1", "q2", "q3", "q4", "h1", "h2"];

export const PERIOD_LABELS: Record<PeriodKey, string> = { q1: "1Q", q2: "2Q", q3: "3Q", q4: "4Q", h1: "前半", h2: "後半" };

/** 区間に含まれるクォーター（0始まり） */
const PERIOD_QUARTERS: Record<PeriodKey, number[]> = { q1: [0], q2: [1], q3: [2], q4: [3], h1: [0, 1], h2: [2, 3] };

export interface PeriodScore {
  pts: number;
  oppPts: number;
  /** この区間の値にプレーバイプレーから補ったクォーターを含むか（公式のクォーター別スコアが欠けていた試合） */
  fromPbp: boolean;
}

/** その試合のその区間の得点・失点。区間のクォーターが1つでも欠けていれば null */
export function periodScore(g: TeamGameLog, key: PeriodKey): PeriodScore | null {
  const own = g.periodPoints;
  const opp = g.opponentPeriodPoints;
  if (!own || !opp) return null;
  let pts = 0;
  let oppPts = 0;
  for (const q of PERIOD_QUARTERS[key]) {
    const a = own[q];
    const b = opp[q];
    if (a == null || b == null) return null;
    pts += a;
    oppPts += b;
  }
  const fromPbp = PERIOD_QUARTERS[key].some((q) => g.periodPointsFromPbp?.includes(q + 1) ?? false);
  return { pts, oppPts, fromPbp };
}

// --- 1試合の記録（最多得点等） ---

export type PeriodRecordKind = "mostPts" | "fewestOppPts" | "bestDiff" | "fewestPts" | "mostOppPts" | "worstDiff";

export interface PeriodRecordKindDef {
  key: PeriodRecordKind;
  label: string;
  /** 記録（チームにとって良い方）かワースト（悪い方）か */
  mode: "record" | "worst";
  value: (s: PeriodScore) => number;
  /** 値が小さいほど上位か */
  lowerFirst: boolean;
}

export const PERIOD_RECORD_KINDS: PeriodRecordKindDef[] = [
  { key: "mostPts", label: "最多得点", mode: "record", value: (s) => s.pts, lowerFirst: false },
  { key: "fewestOppPts", label: "最少失点", mode: "record", value: (s) => s.oppPts, lowerFirst: true },
  { key: "bestDiff", label: "最大得失点差", mode: "record", value: (s) => s.pts - s.oppPts, lowerFirst: false },
  { key: "fewestPts", label: "最少得点", mode: "worst", value: (s) => s.pts, lowerFirst: true },
  { key: "mostOppPts", label: "最多失点", mode: "worst", value: (s) => s.oppPts, lowerFirst: false },
  { key: "worstDiff", label: "最大の点差負け", mode: "worst", value: (s) => s.pts - s.oppPts, lowerFirst: true },
];

export function periodRecordKindDef(key: PeriodRecordKind): PeriodRecordKindDef {
  return PERIOD_RECORD_KINDS.find((d) => d.key === key)!;
}

/** 歴代記録の項目キー（「q1:mostPts」等） */
export function periodRecordStatKey(period: PeriodKey, kind: PeriodRecordKind): string {
  return `${period}:${kind}`;
}

export interface RankedPeriodGame<G extends TeamGameLog> {
  game: G;
  score: PeriodScore;
  value: number;
  /** 同じ値は同じ順位（次の順位はその分飛ばす） */
  rank: number;
}

/** 試合をその区間・その記録の順に並べ、順位を付ける。同じ値は日付の古い順 */
export function rankPeriodGames<G extends TeamGameLog>(games: G[], period: PeriodKey, kind: PeriodRecordKind): RankedPeriodGame<G>[] {
  const def = periodRecordKindDef(kind);
  const scored: Omit<RankedPeriodGame<G>, "rank">[] = [];
  for (const game of games) {
    const score = periodScore(game, period);
    if (score) scored.push({ game, score, value: def.value(score) });
  }
  scored.sort((a, b) => (def.lowerFirst ? a.value - b.value : b.value - a.value) || a.game.date.localeCompare(b.game.date));
  const ranked: RankedPeriodGame<G>[] = [];
  let rank = 0;
  scored.forEach((s, i) => {
    if (i === 0 || s.value !== scored[i - 1]!.value) rank = i + 1;
    ranked.push({ ...s, rank });
  });
  return ranked;
}

// --- 1試合平均 ---

export interface PeriodAverage {
  /** その区間の値がある試合数 */
  games: number;
  pts: number;
  oppPts: number;
  diff: number;
}

export function periodAverage(games: TeamGameLog[], period: PeriodKey): PeriodAverage | null {
  let n = 0;
  let pts = 0;
  let oppPts = 0;
  for (const g of games) {
    const s = periodScore(g, period);
    if (!s) continue;
    n += 1;
    pts += s.pts;
    oppPts += s.oppPts;
  }
  if (n === 0) return null;
  return { games: n, pts: pts / n, oppPts: oppPts / n, diff: (pts - oppPts) / n };
}

export type PeriodAverageStat = "pts" | "oppPts" | "diff";

export const PERIOD_AVERAGE_STATS: { key: PeriodAverageStat; lowerFirst: boolean }[] = [
  { key: "pts", lowerFirst: false },
  { key: "oppPts", lowerFirst: true },
  { key: "diff", lowerFirst: false },
];

/** 歴代記録（通算の1試合平均）の項目キー（「q1:pts」等） */
export function periodAverageStatKey(period: PeriodKey, stat: PeriodAverageStat): string {
  return `${period}:${stat}`;
}
