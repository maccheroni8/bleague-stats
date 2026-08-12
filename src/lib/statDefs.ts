// ランキングページ・比較ページで共通に使う基本スタッツ項目の定義。
// アドバンスドスタッツ（ORtg/Pace等）はPhase2で追加する想定のため、ここではティアAの基本項目のみ。

import type { PlayerSummary, TeamSummary } from "./types";
import { formatDecimal, formatPct, formatSigned } from "./format";

export interface StatDef<T> {
  key: string;
  label: string;
  value: (row: T) => number;
  format: (row: T) => string;
  /** falseならTOVのように値が小さいほど良い項目。比較ページのハイライト判定に使う（未指定はtrue扱い） */
  higherIsBetter?: boolean;
}

export const TEAM_STAT_DEFS: StatDef<TeamSummary>[] = [
  { key: "pts", label: "得点", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts) },
  { key: "net", label: "Net", value: (t) => t.netPerGame.pts, format: (t) => formatSigned(t.netPerGame.pts) },
  { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb) },
  { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast) },
  { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl) },
  { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk) },
  {
    key: "tov",
    label: "TOV",
    value: (t) => t.perGame.tov,
    format: (t) => formatDecimal(t.perGame.tov),
    higherIsBetter: false,
  },
  { key: "fgPct", label: "FG%", value: (t) => t.shooting.fgPct, format: (t) => formatPct(t.shooting.fgPct) },
  { key: "tpPct", label: "3P%", value: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct) },
  { key: "ftPct", label: "FT%", value: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct) },
];

export const PLAYER_STAT_DEFS: StatDef<PlayerSummary>[] = [
  { key: "pts", label: "得点", value: (p) => p.perGame.pts, format: (p) => formatDecimal(p.perGame.pts) },
  { key: "reb", label: "REB", value: (p) => p.perGame.reb, format: (p) => formatDecimal(p.perGame.reb) },
  { key: "ast", label: "AST", value: (p) => p.perGame.ast, format: (p) => formatDecimal(p.perGame.ast) },
  { key: "stl", label: "STL", value: (p) => p.perGame.stl, format: (p) => formatDecimal(p.perGame.stl) },
  { key: "blk", label: "BLK", value: (p) => p.perGame.blk, format: (p) => formatDecimal(p.perGame.blk) },
  {
    key: "tov",
    label: "TOV",
    value: (p) => p.perGame.tov,
    format: (p) => formatDecimal(p.perGame.tov),
    higherIsBetter: false,
  },
  { key: "min", label: "MIN", value: (p) => p.perGame.min, format: (p) => formatDecimal(p.perGame.min) },
  { key: "fgPct", label: "FG%", value: (p) => p.shooting.fgPct, format: (p) => formatPct(p.shooting.fgPct) },
  { key: "tpPct", label: "3P%", value: (p) => p.shooting.tpPct, format: (p) => formatPct(p.shooting.tpPct) },
  { key: "ftPct", label: "FT%", value: (p) => p.shooting.ftPct, format: (p) => formatPct(p.shooting.ftPct) },
];
