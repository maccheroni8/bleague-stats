// ランキングページ・比較ページ・グロッサリーページで共通に使うスタッツ項目の定義。
// ここに1件追加するだけで、計算ロジック(value/format)・ランキング/比較ページの項目選択・
// グロッサリーページの用語集、全部に自動反映される（DESIGN.md 6章の分類方針と整合させること）。

import type { PlayerSummary, TeamSummary } from "./types";
import { formatDecimal, formatPct, formatSigned } from "./format";

export type StatSource = "official" | "nba" | "custom";

export type StatCategory = "basic" | "shooting" | "rebounding" | "turnover" | "rating";

export const STAT_CATEGORY_LABELS: Record<StatCategory, string> = {
  basic: "基本",
  shooting: "シュート",
  rebounding: "リバウンド",
  turnover: "ターンオーバー",
  rating: "レーティング",
};

export const STAT_CATEGORY_ORDER: StatCategory[] = ["basic", "shooting", "rebounding", "turnover", "rating"];

/** value/formatを含まない、グロッサリーページ表示に必要なメタ情報だけの型 */
export interface StatMeta {
  key: string;
  label: string;
  /** falseならTOVのように値が小さいほど良い項目。比較ページのハイライト判定に使う（未指定はtrue扱い） */
  higherIsBetter?: boolean;
  /** 人間が読める形の計算式（グロッサリーページ表示用） */
  formulaText: string;
  /** 'official'=Bリーグ公式定義、'nba'=NBA/Basketball-Reference流の補足、'custom'=独自集計 */
  source: StatSource;
  /** Bリーグ公式の略称が確認できている項目のみ設定（DESIGN.md 6章で確認済みのもの） */
  officialAbbr?: string;
  category: StatCategory;
}

export interface StatDef<T> extends StatMeta {
  value: (row: T) => number;
  format: (row: T) => string;
}

export const TEAM_STAT_DEFS: StatDef<TeamSummary>[] = [
  {
    key: "pts",
    label: "得点",
    value: (t) => t.perGame.pts,
    format: (t) => formatDecimal(t.perGame.pts),
    formulaText: "得点（ボックススコア）",
    source: "official",
    officialAbbr: "PTS",
    category: "basic",
  },
  {
    key: "net",
    label: "Net",
    value: (t) => t.netPerGame.pts,
    format: (t) => formatSigned(t.netPerGame.pts),
    // Bリーグ公式の「+/-」は個人単位の指標（出場時間帯のチーム得失点差、オンコート追跡が必要）で
    // これとは別物。混同防止のためofficialAbbrは付けずsourceもcustomのままにする
    formulaText: "自チーム得点 − 相手チーム得点",
    source: "custom",
    category: "basic",
  },
  {
    key: "reb",
    label: "REB",
    value: (t) => t.perGame.reb,
    format: (t) => formatDecimal(t.perGame.reb),
    formulaText: "OREB + DREB",
    source: "official",
    officialAbbr: "TR",
    category: "rebounding",
  },
  {
    key: "ast",
    label: "AST",
    value: (t) => t.perGame.ast,
    format: (t) => formatDecimal(t.perGame.ast),
    formulaText: "アシスト（ボックススコア）",
    source: "official",
    officialAbbr: "AS",
    category: "basic",
  },
  {
    key: "stl",
    label: "STL",
    value: (t) => t.perGame.stl,
    format: (t) => formatDecimal(t.perGame.stl),
    formulaText: "スティール（ボックススコア）",
    source: "official",
    officialAbbr: "ST",
    category: "basic",
  },
  {
    key: "blk",
    label: "BLK",
    value: (t) => t.perGame.blk,
    format: (t) => formatDecimal(t.perGame.blk),
    formulaText: "ブロック（ボックススコア）",
    source: "official",
    officialAbbr: "BS",
    category: "basic",
  },
  {
    key: "tov",
    label: "TOV",
    value: (t) => t.perGame.tov,
    format: (t) => formatDecimal(t.perGame.tov),
    higherIsBetter: false,
    formulaText: "ターンオーバー（ボックススコア）",
    source: "official",
    officialAbbr: "TO",
    category: "turnover",
  },
  {
    key: "fgPct",
    label: "FG%",
    value: (t) => t.shooting.fgPct,
    format: (t) => formatPct(t.shooting.fgPct),
    formulaText: "FGM / FGA",
    source: "official",
    officialAbbr: "FG%",
    category: "shooting",
  },
  {
    key: "tpPct",
    label: "3P%",
    value: (t) => t.shooting.tpPct,
    format: (t) => formatPct(t.shooting.tpPct),
    formulaText: "3PM / 3PA",
    source: "official",
    officialAbbr: "3FG%",
    category: "shooting",
  },
  {
    key: "ftPct",
    label: "FT%",
    value: (t) => t.shooting.ftPct,
    format: (t) => formatPct(t.shooting.ftPct),
    formulaText: "FTM / FTA",
    source: "official",
    officialAbbr: "FT%",
    category: "shooting",
  },
  {
    key: "eff",
    label: "EFF",
    value: (t) => t.advanced.eff,
    format: (t) => formatDecimal(t.advanced.eff),
    formulaText: "(PTS+AST+BLK+STL+FD+REB) − (TOV+BSR+PF) − (FGA−FGM) − (FTA−FTM)　※2020-21シーズン以降の式",
    source: "official",
    officialAbbr: "EFF",
    category: "rating",
  },
];

export const PLAYER_STAT_DEFS: StatDef<PlayerSummary>[] = [
  {
    key: "pts",
    label: "得点",
    value: (p) => p.perGame.pts,
    format: (p) => formatDecimal(p.perGame.pts),
    formulaText: "得点（ボックススコア）",
    source: "official",
    officialAbbr: "PTS",
    category: "basic",
  },
  {
    key: "reb",
    label: "REB",
    value: (p) => p.perGame.reb,
    format: (p) => formatDecimal(p.perGame.reb),
    formulaText: "OREB + DREB",
    source: "official",
    officialAbbr: "TR",
    category: "rebounding",
  },
  {
    key: "ast",
    label: "AST",
    value: (p) => p.perGame.ast,
    format: (p) => formatDecimal(p.perGame.ast),
    formulaText: "アシスト（ボックススコア）",
    source: "official",
    officialAbbr: "AS",
    category: "basic",
  },
  {
    key: "stl",
    label: "STL",
    value: (p) => p.perGame.stl,
    format: (p) => formatDecimal(p.perGame.stl),
    formulaText: "スティール（ボックススコア）",
    source: "official",
    officialAbbr: "ST",
    category: "basic",
  },
  {
    key: "blk",
    label: "BLK",
    value: (p) => p.perGame.blk,
    format: (p) => formatDecimal(p.perGame.blk),
    formulaText: "ブロック（ボックススコア）",
    source: "official",
    officialAbbr: "BS",
    category: "basic",
  },
  {
    key: "tov",
    label: "TOV",
    value: (p) => p.perGame.tov,
    format: (p) => formatDecimal(p.perGame.tov),
    higherIsBetter: false,
    formulaText: "ターンオーバー（ボックススコア）",
    source: "official",
    officialAbbr: "TO",
    category: "turnover",
  },
  {
    key: "min",
    label: "MIN",
    value: (p) => p.perGame.min,
    format: (p) => formatDecimal(p.perGame.min),
    formulaText: "出場時間（ボックススコア）",
    source: "official",
    officialAbbr: "MIN",
    category: "basic",
  },
  {
    key: "fgPct",
    label: "FG%",
    value: (p) => p.shooting.fgPct,
    format: (p) => formatPct(p.shooting.fgPct),
    formulaText: "FGM / FGA",
    source: "official",
    officialAbbr: "FG%",
    category: "shooting",
  },
  {
    key: "tpPct",
    label: "3P%",
    value: (p) => p.shooting.tpPct,
    format: (p) => formatPct(p.shooting.tpPct),
    formulaText: "3PM / 3PA",
    source: "official",
    officialAbbr: "3FG%",
    category: "shooting",
  },
  {
    key: "ftPct",
    label: "FT%",
    value: (p) => p.shooting.ftPct,
    format: (p) => formatPct(p.shooting.ftPct),
    formulaText: "FTM / FTA",
    source: "official",
    officialAbbr: "FT%",
    category: "shooting",
  },
  {
    key: "eff",
    label: "EFF",
    value: (p) => p.advanced.eff,
    format: (p) => formatDecimal(p.advanced.eff),
    formulaText: "(PTS+AST+BLK+STL+FD+REB) − (TOV+BSR+PF) − (FGA−FGM) − (FTA−FTM)　※2020-21シーズン以降の式",
    source: "official",
    officialAbbr: "EFF",
    category: "rating",
  },
];
