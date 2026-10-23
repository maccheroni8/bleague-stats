// チームのペイント内・ペイント外（ミッドレンジ）の2P内訳（6項目: PAINT2M／PAINT2A／PAINT2%・MID2M／MID2A／MID2%）。
// 項目名は個人（statNames.ts）と同じ。表示側だけの計算で、保存済みの値・他のスタッツの分母は変えない。
// 古い試合は2P内訳の記録が欠けていることがあるため、「記録が揃う試合」だけで数え、その試合数（内訳対象）を添える。
import type { TeamGameLog } from "../../shared/types";
import type { Column } from "../components/SortableTable";
import { formatDecimal, formatPct, formatSigned } from "./format";
import type { AllTeamsRow, TeamPerspective, TeamTotals } from "./teamStatsColumns";

export const PAINT2_COVERAGE = "内訳対象";
export const PAINT2_KEYS = ["paint2m", "paint2a", "paint2pct", "mid2m", "mid2a", "mid2pct"] as const;
export type Paint2Key = (typeof PAINT2_KEYS)[number];
const PAINT2_LABELS = ["PAINT2M", "PAINT2A", "PAINT2%", "MID2M", "MID2A", "MID2%"];

/** 1試合・片側の2P内訳（pm/pa=ペイント内の成功/試投、mm/ma=ミッドレンジ、tm/ta=2P全体）。 */
export interface PaintInput {
  pm: number;
  pa: number;
  mm: number;
  ma: number;
  tm: number;
  ta: number;
}

export interface PaintPair {
  own: PaintInput;
  opp: PaintInput;
}

export interface PaintSide {
  games: number;
  pm: number;
  pa: number;
  mm: number;
  ma: number;
}

export interface PaintSummary {
  /** 集計した全試合数 */
  total: number;
  own: PaintSide;
  opp: PaintSide;
  /** 自チームと相手の両方の記録が揃う試合だけの合計（差の視点で使う） */
  bothOwn: PaintSide;
  bothOpp: PaintSide;
  /** 平均する前の合計に含まれるチーム数（リーグ全体の合計を1チームあたりに直すとき） */
  teams: number;
}

const emptySide = (): PaintSide => ({ games: 0, pm: 0, pa: 0, mm: 0, ma: 0 });

/** 記録が揃っている（整数・非負・成功≦試投・内訳の合計＝2P全体）かどうか。 */
export function validPaint(p: PaintInput): boolean {
  return (
    [p.pm, p.pa, p.mm, p.ma, p.tm, p.ta].every((v) => Number.isSafeInteger(v) && v >= 0) &&
    p.pm <= p.pa &&
    p.mm <= p.ma &&
    p.pm + p.mm === p.tm &&
    p.pa + p.ma === p.ta
  );
}

export function paintPair(g: TeamGameLog): PaintPair {
  return {
    own: { pm: g.paint2m, pa: g.paint2a, mm: g.mid2m, ma: g.mid2a, tm: g.fgm - g.tpm, ta: g.fga - g.tpa },
    opp: {
      pm: g.opponentPaint2m,
      pa: g.opponentPaint2a,
      mm: g.opponentMid2m,
      ma: g.opponentMid2a,
      tm: g.opponentFgm - g.opponentTpm,
      ta: g.opponentFga - g.opponentTpa,
    },
  };
}

export function summarizePaint(pairs: readonly PaintPair[]): PaintSummary {
  const summary: PaintSummary = {
    total: pairs.length,
    own: emptySide(),
    opp: emptySide(),
    bothOwn: emptySide(),
    bothOpp: emptySide(),
    teams: 1,
  };
  const add = (to: PaintSide, p: PaintInput) => {
    to.games++;
    to.pm += p.pm;
    to.pa += p.pa;
    to.mm += p.mm;
    to.ma += p.ma;
  };
  for (const pair of pairs) {
    const ownValid = validPaint(pair.own);
    const oppValid = validPaint(pair.opp);
    if (ownValid) add(summary.own, pair.own);
    if (oppValid) add(summary.opp, pair.opp);
    if (ownValid && oppValid) {
      add(summary.bothOwn, pair.own);
      add(summary.bothOpp, pair.opp);
    }
  }
  return summary;
}

export const summarizePaintLogs = (logs: readonly TeamGameLog[]): PaintSummary => summarizePaint(logs.map(paintPair));

// 内訳の対象数は、合計の数値オブジェクトには入れず別に持つ（オブジェクトの列挙・既存の合計・保存形式に影響させない）。
const summaries = new WeakMap<object, PaintSummary>();

export function withPaint<T extends object>(value: T, summary: PaintSummary): T {
  summaries.set(value, summary);
  return value;
}

export const paintOf = (value: object): PaintSummary | undefined => summaries.get(value);

/** 複数チームの内訳を足し合わせる（チーム一覧の「全チーム平均」用）。 */
export function mergePaint(items: readonly object[]): PaintSummary {
  const merged = summarizePaint([]);
  merged.teams = 0;
  for (const item of items) {
    const p = paintOf(item);
    if (!p) continue;
    merged.total += p.total;
    merged.teams += p.teams;
    for (const side of ["own", "opp", "bothOwn", "bothOpp"] as const) {
      for (const k of ["games", "pm", "pa", "mm", "ma"] as const) merged[side][k] += p[side][k];
    }
  }
  return merged;
}

/** 視点ごとの集計対象。自チーム・相手はそれぞれ、差は両方の記録が揃う試合だけ。 */
function sidesFor(s: PaintSummary, perspective: TeamPerspective): [PaintSide, PaintSide?] {
  if (perspective === "own") return [s.own];
  if (perspective === "opp") return [s.opp];
  return [s.bothOwn, s.bothOpp];
}

/** 「記録が揃う試合数／全試合数」 */
export function paintCoverage(s: PaintSummary | undefined, perspective: TeamPerspective): string {
  return s ? `${sidesFor(s, perspective)[0].games}/${s.total}` : "-";
}

function sideValue(v: PaintSide, key: string): number | undefined {
  switch (key) {
    case "paint2m":
      return v.pm;
    case "paint2a":
      return v.pa;
    case "mid2m":
      return v.mm;
    case "mid2a":
      return v.ma;
    case "paint2pct":
      return v.pa ? v.pm / v.pa : undefined;
    case "mid2pct":
      return v.ma ? v.mm / v.ma : undefined;
    default:
      return undefined;
  }
}

/** 成功率は合計の成功÷合計の試投。個数は1試合平均（mode が total のときは1チームあたりの合計）。 */
export function paintValue(s: PaintSummary | undefined, key: string, mode: string, perspective: TeamPerspective): number | undefined {
  if (!s) return undefined;
  const [a, b] = sidesFor(s, perspective);
  if (!a.games) return undefined;
  const x = sideValue(a, key);
  const y = b ? sideValue(b, key) : 0;
  if (x === undefined || y === undefined) return undefined;
  const v = x - y;
  if (key.endsWith("pct")) return v;
  return mode === "total" ? v / Math.max(1, s.teams) : v / a.games;
}

export function paintFormat(s: PaintSummary | undefined, key: string, mode: string, perspective: TeamPerspective): string {
  const v = paintValue(s, key, mode, perspective);
  if (v === undefined) return "-";
  const digits = mode === "total" ? 0 : 1;
  if (key.endsWith("pct")) return perspective === "diff" ? `${formatSigned(v * 100, 1)}%` : formatPct(v);
  return perspective === "diff" ? formatSigned(v, digits) : formatDecimal(v, digits);
}

/** ランキングで順位を付けてよいか（全試合の記録が揃い、成功率は試投が1本以上）。 */
export function paintRankable(s: PaintSummary | undefined, key: string, perspective: TeamPerspective): boolean {
  return !!s && s.total > 0 && sidesFor(s, perspective)[0].games === s.total && paintValue(s, key, "total", perspective) !== undefined;
}

export function paintColumns(mode: string, perspective: TeamPerspective): Column<AllTeamsRow>[] {
  return [
    {
      key: "paint2games",
      label: PAINT2_COVERAGE,
      sortValue: (r) => paintOf(r.totals)?.own.games ?? 0,
      format: (r) => paintCoverage(paintOf(r.totals), perspective),
    },
    ...PAINT2_KEYS.map((key, i) => ({
      key,
      label: PAINT2_LABELS[i]!,
      sortValue: (r: AllTeamsRow) => paintValue(paintOf(r.totals), key, mode, perspective) ?? 0,
      format: (r: AllTeamsRow) => paintFormat(paintOf(r.totals), key, mode, perspective),
      higherIsBetter: perspective !== "opp",
    })),
  ];
}

export const isPaint2Key = (key: string): key is Paint2Key => (PAINT2_KEYS as readonly string[]).includes(key);

/**
 * リーグ平均の内訳が2P全体と一致するか。リーグ平均は既存ファイルが1試合平均なので、
 * 浮動小数点の丸めだけ許容して突き合わせる。
 */
export function leaguePaintComplete(t: {
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
}): boolean {
  const equal = (a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1e-8 * Math.max(1, Math.abs(a), Math.abs(b));
  return (
    [t.paint2m, t.paint2a, t.mid2m, t.mid2a].every((v) => Number.isFinite(v) && v >= 0) &&
    t.paint2m <= t.paint2a &&
    t.mid2m <= t.mid2a &&
    equal(t.paint2m + t.mid2m, t.fgm - t.tpm) &&
    equal(t.paint2a + t.mid2a, t.fga - t.tpa)
  );
}

export const PAINT2_NOTE = "内訳対象は記録の揃う試合数／全試合数です。内訳の平均・成功率は記録の揃う試合だけで計算します。";
export const PAINT2_COMPARE_NOTE =
  "内訳対象は記録の揃う試合数／全試合数です。リーグ平均の内訳6項目が「-」の場合は、記録不足、または対象試合数を確認できないためです。";

/**
 * リーグ平均の内訳が揃っているかの最終確認。比較用の合算では古いチーム・コーチ行が2P全体に入ることがあり、
 * 合計の不一致だけでは欠損と断定できない。不一致のときは各チームの試合ごとの記録で確かめる。
 */
export async function verifyLeaguePaint(t: TeamTotals, loadLogs: () => Promise<TeamGameLog[][]>): Promise<boolean> {
  if (leaguePaintComplete(t)) return true;
  const lists = await loadLogs();
  return (
    lists.some((logs) => logs.length > 0) &&
    lists.every((logs) => {
      const s = summarizePaintLogs(logs);
      return s.own.games === s.total && s.opp.games === s.total;
    })
  );
}
