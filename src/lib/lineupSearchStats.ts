// ラインナップ検索（チーム詳細）の Traditional・Advanced タブの列。値は出場区間の数え上げ（team-stints の countKeys）の合計から出す。
// 名前・並び・書き方は全チームスタッツ（teamStatsColumns.ts の buildTraditionalColumns・buildAdvancedColumns）にそろえ、
// 出場区間に数え上げの無い項目（STL・BLK・STOCKS・F・FD）は列ごと出さない。レーティングは自チーム・相手それぞれの実際の攻撃回数で割る
// （ラインナップ検索の得失点タブと同じ値）。DESIGN.md 482章

import { efgPct, ftRate, orbPct, tovPct, tsPct } from "../../shared/formulas";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "./format";
import { formatMinutesColon, formatSignedMinutesColon } from "./minutesFormat";
import type { LineupSplitTotals } from "./lineupSearch";
import type { TeamPerspective } from "./teamStatsColumns";

export type LineupStatsTab = "traditional" | "advanced";
export type LineupStatsMode = "perGame" | "total";

interface Side {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  or: number;
  dr: number;
  ast: number;
  tov: number;
  poss: number;
}

function sideOf(t: LineupSplitTotals, arr: number[]): Side {
  const at = (key: string) => {
    const i = t.countKeys.indexOf(key);
    return i >= 0 ? arr[i]! : 0;
  };
  return {
    pts: at("pts"),
    fgm: at("fgm"),
    fga: at("fga"),
    tpm: at("tpm"),
    tpa: at("tpa"),
    ftm: at("ftm"),
    fta: at("fta"),
    or: at("or"),
    dr: at("dr"),
    ast: at("ast"),
    tov: at("tov"),
    poss: at("poss"),
  };
}

type Kind = "count" | "pct" | "pct100" | "dec" | "signed" | "minutes" | "int";

export interface LineupStatColumn {
  key: string;
  label: string;
  kind: Kind;
  /** 自チーム（own）と相手（opp）の値。計算できない（分母0）ときは null */
  own: (own: Side, opp: Side, t: LineupSplitTotals) => number | null;
  /** 視点を持たない列（G・MIN）は無し */
  opp?: (own: Side, opp: Side, t: LineupSplitTotals) => number | null;
}

const div = (a: number, b: number): number | null => (b === 0 ? null : a / b);
const nz = (b: number, v: () => number): number | null => (b === 0 ? null : v());

function count(key: string, label: string, pick: (s: Side) => number): LineupStatColumn {
  return { key, label, kind: "count", own: (o) => pick(o), opp: (_o, p) => pick(p) };
}
function ratio(key: string, label: string, kind: Kind, calc: (a: Side, b: Side) => number | null): LineupStatColumn {
  return { key, label, kind, own: (o, p) => calc(o, p), opp: (o, p) => calc(p, o) };
}

const LEAD: LineupStatColumn[] = [
  { key: "g", label: "G", kind: "int", own: (_o, _p, t) => t.games },
  { key: "min", label: "MIN", kind: "minutes", own: (_o, _p, t) => t.seconds / 60 },
];

export const LINEUP_TRADITIONAL_COLUMNS: LineupStatColumn[] = [
  ...LEAD,
  count("pts", "PTS", (s) => s.pts),
  count("fgm", "FGM", (s) => s.fgm),
  count("fga", "FGA", (s) => s.fga),
  ratio("fgpct", "FG%", "pct", (s) => div(s.fgm, s.fga)),
  count("2pm", "2PM", (s) => s.fgm - s.tpm),
  count("2pa", "2PA", (s) => s.fga - s.tpa),
  ratio("2ppct", "2P%", "pct", (s) => div(s.fgm - s.tpm, s.fga - s.tpa)),
  count("3pm", "3PM", (s) => s.tpm),
  count("3pa", "3PA", (s) => s.tpa),
  ratio("3ppct", "3P%", "pct", (s) => div(s.tpm, s.tpa)),
  count("ftm", "FTM", (s) => s.ftm),
  count("fta", "FTA", (s) => s.fta),
  ratio("ftpct", "FT%", "pct", (s) => div(s.ftm, s.fta)),
  count("or", "OR", (s) => s.or),
  count("dr", "DR", (s) => s.dr),
  count("tr", "TR", (s) => s.or + s.dr),
  count("ast", "AST", (s) => s.ast),
  count("tov", "TOV", (s) => s.tov),
  ratio("asttov", "AST/TOV", "dec", (s) => div(s.ast, s.tov)),
  { key: "plusminus", label: "+/-", kind: "signed", own: (o, p) => o.pts - p.pts, opp: (o, p) => p.pts - o.pts },
];

export const LINEUP_ADVANCED_COLUMNS: LineupStatColumn[] = [
  ...LEAD,
  ratio("tovpct", "TOV%", "pct100", (s) => nz(s.fga + 0.44 * s.fta + s.tov, () => tovPct(s.tov, s.fga, s.fta))),
  ratio("ftr", "FTR", "pct", (s) => nz(s.fga, () => ftRate(s.fta, s.fga))),
  ratio("orbpct", "OR%", "pct100", (s, o) => nz(s.or + o.dr, () => orbPct(s.or, o.dr))),
  ratio("efg", "eFG%", "pct", (s) => nz(s.fga, () => efgPct(s.fgm, s.tpm, s.fga))),
  ratio("ts", "TS%", "pct", (s) => nz(s.fga + 0.44 * s.fta, () => tsPct(s.pts, s.fga, s.fta))),
  ratio("pps", "PPS", "dec", (s) => div(s.pts, s.fga)),
  count("poss", "POSS", (s) => s.poss),
  {
    key: "pace",
    label: "PACE",
    kind: "dec",
    own: (o, _p, t) => (t.seconds > 0 ? (40 * o.poss) / (t.seconds / 60) : null),
    opp: (_o, p, t) => (t.seconds > 0 ? (40 * p.poss) / (t.seconds / 60) : null),
  },
  ratio("ortg", "ORtg", "dec", (s) => (s.poss > 0 ? (100 * s.pts) / s.poss : null)),
  ratio("drtg", "DRtg", "dec", (_s, o) => (o.poss > 0 ? (100 * o.pts) / o.poss : null)),
  {
    key: "netrtg",
    label: "NetRtg",
    kind: "signed",
    own: (o, p) => (o.poss > 0 && p.poss > 0 ? (100 * o.pts) / o.poss - (100 * p.pts) / p.poss : null),
    opp: (o, p) => (o.poss > 0 && p.poss > 0 ? (100 * p.pts) / p.poss - (100 * o.pts) / o.poss : null),
  },
];

export function lineupStatColumns(tab: LineupStatsTab): LineupStatColumn[] {
  return tab === "traditional" ? LINEUP_TRADITIONAL_COLUMNS : LINEUP_ADVANCED_COLUMNS;
}

/** 列の値（平均は、その状態が起きた試合の数で割る。数の列だけ） */
export function lineupStatValue(col: LineupStatColumn, t: LineupSplitTotals, mode: LineupStatsMode, perspective: TeamPerspective): number | null {
  const own = sideOf(t, t.own);
  const opp = sideOf(t, t.opp);
  // 試合数で割るのは数の列（カウント・時間・+/-）だけ。割合・レーティングは合計から出す
  const scalable = col.kind === "count" || col.kind === "minutes" || col.key === "plusminus";
  const scale = (v: number | null) => (v === null || !scalable || mode === "total" ? v : t.games > 0 ? v / t.games : null);
  if (col.key === "g") return t.games;
  const a = scale(col.own(own, opp, t));
  if (!col.opp) return a;
  const b = scale(col.opp(own, opp, t));
  if (perspective === "own") return a;
  if (perspective === "opp") return b;
  return a === null || b === null ? null : a - b;
}

export function formatLineupStat(col: LineupStatColumn, v: number | null, mode: LineupStatsMode, perspective: TeamPerspective, diffRow = false): string {
  if (v === null || Number.isNaN(v)) return "-";
  const diff = diffRow || (perspective === "diff" && col.opp !== undefined);
  switch (col.kind) {
    case "int":
      return diffRow ? formatSigned(v, 0) : String(v);
    case "minutes":
      return diffRow ? formatSignedMinutesColon(v) : formatMinutesColon(v);
    case "count": {
      const d = mode === "total" ? 0 : 2;
      return diff ? formatSigned(v, d) : formatDecimal(v, d);
    }
    case "pct":
      return diff ? `${formatSigned(v * 100, 2)}%` : formatPct(v);
    case "pct100":
      return diff ? `${formatSigned(v, 2)}%` : formatPct100(v);
    case "dec":
      return diff ? formatSigned(v) : formatDecimal(v);
    case "signed":
      return formatSigned(v, col.key === "plusminus" && mode === "total" ? 0 : 2);
  }
}
