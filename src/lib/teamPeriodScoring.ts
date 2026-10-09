// チームの区間別の得点・失点・得失点差（カテゴリタブ「Periods」。全チームスタッツ・チーム詳細のシーズン別成績／シチュエーション別成績・日程結果のラインスコア。DESIGN.md 226章）。
// 値は TeamGameLog の periodPoints／opponentPeriodPoints（1Q〜4Q。shared/teamPeriodRecords.ts の periodScore）から取る。延長は、試合の得点から1Q〜4Qの合計を引いた値
// （延長の合計）。第1延長・第2延長に分けるのは日程結果のラインスコアだけで、試合の生データのクォーター別スコア（gamePeriodScores）から取る。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。ここから import するのは、既存の部品を読むだけ（保存キーの対象のファイルは変えない）。
import { PERIOD_LABELS, periodScore, type PeriodKey } from "../../shared/teamPeriodRecords";
import type { StoredGame, TeamGameLog } from "../../shared/types";
import { gamePeriodScores } from "./gamePeriods";

/** 表の区間の列。前半・後半は 1Q+2Q／3Q+4Q。延長は、延長のあった試合のすべての延長の合計 */
export const PERIOD_SCORING_KEYS = ["q1", "q2", "q3", "q4", "h1", "h2", "ot"] as const;
export type PeriodScoringKey = (typeof PERIOD_SCORING_KEYS)[number];

export const PERIOD_SCORING_LABELS: Record<PeriodScoringKey, string> = { ...PERIOD_LABELS, ot: "OT" };

/** 視点。自チームの得点・相手の得点（失点）・得失点差（既存の「自チーム／opp／+/-」） */
export type PeriodScoringPerspective = "own" | "opp" | "diff";
/** 平均（試合数で割る。延長はあった試合の数で割る）か合計 */
export type PeriodScoringMode = "perGame" | "total";

type LogFields = Pick<TeamGameLog, "teamScore" | "opponentScore" | "periodPoints" | "opponentPeriodPoints" | "overtimes" | "periodPointsFromPbp">;

export interface PeriodPair {
  own: number;
  opp: number;
}

/** 1Q〜4Qの得点（自チーム・相手）が4つともそろっているときだけ、その合計。前後半5分の特別な試合・公式の記録が欠けて補えなかった試合は null */
function regulationTotals(g: LogFields): PeriodPair | null {
  const own = g.periodPoints;
  const opp = g.opponentPeriodPoints;
  if (!own || !opp) return null;
  let o = 0;
  let p = 0;
  for (let q = 0; q < 4; q++) {
    const a = own[q];
    const b = opp[q];
    if (a == null || b == null) return null;
    o += a;
    p += b;
  }
  return { own: o, opp: p };
}

/**
 * 延長の合計（延長の無い試合は null）。試合の得点から1Q〜4Qの合計を引く。延長の本数（overtimes）が無い古いデータでは、差があれば延長とみなす
 */
export function overtimeTotal(g: LogFields): PeriodPair | null {
  const reg = regulationTotals(g);
  if (!reg) return null;
  const own = g.teamScore - reg.own;
  const opp = g.opponentScore - reg.opp;
  const hasOvertime = g.overtimes != null ? g.overtimes > 0 : own + opp > 0;
  if (!hasOvertime || own < 0 || opp < 0) return null;
  return { own, opp };
}

/** その試合のその区間の得点・失点。値が無い（前後半5分の特別な試合・欠けた区間・延長の無い試合の延長）ときは null */
export function gamePeriodPair(g: LogFields, key: PeriodScoringKey): PeriodPair | null {
  if (key === "ot") return overtimeTotal(g);
  const s = periodScore(g as TeamGameLog, key as PeriodKey);
  return s ? { own: s.pts, opp: s.oppPts } : null;
}

/** 合計と、値のあった試合数 */
export interface PeriodScoringCell {
  games: number;
  own: number;
  opp: number;
}

export interface PeriodScoringRow {
  /** 集計した試合数（前後半5分の特別な試合も含む） */
  games: number;
  /** 試合全体（区間の値の有無によらず、すべての試合） */
  full: PeriodScoringCell;
  periods: Record<PeriodScoringKey, PeriodScoringCell>;
  /** 1Q〜4Qの値を持たない試合（前後半5分の特別な試合など）の数。区間の列には含めない */
  withoutPeriods: number;
}

function emptyCell(): PeriodScoringCell {
  return { games: 0, own: 0, opp: 0 };
}

/** 試合ログの一覧を、区間ごとに合計する */
export function aggregatePeriodScoring(logs: readonly LogFields[]): PeriodScoringRow {
  const row: PeriodScoringRow = {
    games: logs.length,
    full: emptyCell(),
    periods: Object.fromEntries(PERIOD_SCORING_KEYS.map((k) => [k, emptyCell()])) as Record<PeriodScoringKey, PeriodScoringCell>,
    withoutPeriods: 0,
  };
  for (const g of logs) {
    row.full.games += 1;
    row.full.own += g.teamScore;
    row.full.opp += g.opponentScore;
    if (!regulationTotals(g)) row.withoutPeriods += 1;
    for (const k of PERIOD_SCORING_KEYS) {
      const pair = gamePeriodPair(g, k);
      if (!pair) continue;
      const cell = row.periods[k];
      cell.games += 1;
      cell.own += pair.own;
      cell.opp += pair.opp;
    }
  }
  return row;
}

/** 視点を選んだ合計（得点／失点／得失点差） */
function perspectiveSum(cell: PeriodScoringCell, perspective: PeriodScoringPerspective): number {
  return perspective === "own" ? cell.own : perspective === "opp" ? cell.opp : cell.own - cell.opp;
}

/** 表に出す数値。値のある試合が無ければ null。平均は値のあった試合数で割る（延長は延長のあった試合の数） */
export function periodScoringValue(cell: PeriodScoringCell, perspective: PeriodScoringPerspective, mode: PeriodScoringMode): number | null {
  if (cell.games === 0) return null;
  const sum = perspectiveSum(cell, perspective);
  return mode === "total" ? sum : sum / cell.games;
}

/** 表の文字列。平均は小数1桁、合計は整数。得失点差は正のとき「+」 */
export function formatPeriodScoringValue(value: number | null, perspective: PeriodScoringPerspective, mode: PeriodScoringMode): string {
  if (value === null) return "-";
  const text = mode === "total" ? String(Math.round(value)) : value.toFixed(1);
  return perspective === "diff" && value > 0 ? `+${text}` : text;
}

// --- 日程結果のラインスコア ---

/** 1試合の区間別の得点。延長ごと（ot）が分かるのは、延長が1本のとき（延長の合計と同じ）か、試合の生データが読めたとき */
export interface Linescore {
  /** 1Q〜4Q。値が欠けた区間は null */
  own: (number | null)[];
  opp: (number | null)[];
  /** 延長の本数。延長の無い試合は 0。1Q〜4Qが読めず延長の合計を出せない試合は、ログの overtimes のまま */
  overtimes: number;
  /** 延長ごとの得点（長さ overtimes）。分けられないときは null */
  ot: PeriodPair[] | null;
  /** 1Q〜4Qの値にプレーバイプレーから補った区間（1始まり）が入っている */
  fromPbp: number[];
}

/**
 * 1試合のラインスコア。前後半5分の特別な試合など、1Q〜4Qの値を持たない試合は null。
 * 延長が2本以上のときは試合の生データ（raw）の公式のクォーター別スコアから延長ごとの得点を取る。raw が無い（読み込み中）・合計が合わないときは ot が null
 */
export function gameLinescore(g: LogFields & Pick<TeamGameLog, "isHome">, raw?: StoredGame | null): Linescore | null {
  if (!g.periodPoints || !g.opponentPeriodPoints) return null;
  const overtimes = g.overtimes ?? (overtimeTotal(g) ? 1 : 0);
  const base = {
    own: g.periodPoints.slice(0, 4),
    opp: g.opponentPeriodPoints.slice(0, 4),
    overtimes,
    fromPbp: g.periodPointsFromPbp ?? [],
  };
  if (overtimes === 0) return { ...base, ot: [] };
  const total = overtimeTotal(g);
  if (overtimes === 1) return { ...base, ot: total ? [total] : null };
  if (!raw || !total) return { ...base, ot: null };
  const scores = gamePeriodScores(raw);
  const own = g.isHome ? scores.home : scores.away;
  const opp = g.isHome ? scores.away : scores.home;
  if (own.length !== 4 + overtimes || opp.length !== 4 + overtimes) return { ...base, ot: null };
  const ot = Array.from({ length: overtimes }, (_, i) => ({ own: own[4 + i]!, opp: opp[4 + i]! }));
  const sumOwn = ot.reduce((a, p) => a + p.own, 0);
  const sumOpp = ot.reduce((a, p) => a + p.opp, 0);
  return sumOwn === total.own && sumOpp === total.opp ? { ...base, ot } : { ...base, ot: null };
}

/**
 * ラインスコアの延長の列の見出し。表示中の試合に2延長以上があれば OT1・OT2…（その本数まで）、延長が1本だけなら「OT」、延長が無ければ列なし
 * （試合詳細の表記とそろえる。試合詳細は、その試合が1延長なら「OT」、2延長以上なら OT1・OT2…）
 */
export function linescoreOvertimeLabels(maxOvertimes: number): string[] {
  if (maxOvertimes <= 0) return [];
  if (maxOvertimes === 1) return ["OT"];
  return Array.from({ length: maxOvertimes }, (_, i) => `OT${i + 1}`);
}

/** 「自-相手」。値が欠けていれば「-」 */
export function formatLinescoreCell(own: number | null | undefined, opp: number | null | undefined): string {
  return own == null || opp == null ? "-" : `${own}-${opp}`;
}
