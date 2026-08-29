// ランキングページ・比較ページ・グロッサリーページで共通に使うスタッツ項目の定義。
// ここに1件追加するだけで、計算ロジック(value/format)・ランキング/比較ページの項目選択・
// グロッサリーページの用語集、全部に自動反映される（DESIGN.md 6章の分類方針と整合させること）。

import type { PlayerSummary, TeamSummary } from "../../shared/types";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "./format";
import { safeDiv } from "../../shared/formulas";

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
  /**
   * trueなら用語集には載せるが、ランキング/比較ページの選択肢からは外す
   * （検証中の項目を先に個人詳細ページだけで確認したい場合等に使う）
   */
  hiddenFromPicker?: boolean;
  /**
   * ランキングページでのみ、シーズン合計出場時間（分）がこの値未満の選手を除外する。
   * 個人詳細ページ・比較ページでは適用しない（その選手個人の値をそのまま参照する場面のため）。
   * PERのような「1分あたり」の指標は出場時間が極端に短い選手で値が異常に振れるため、
   * 「多数の中から上位を選ぶ」ランキングという文脈でのみ意味のある足切りとして用意している。
   * 他のレート系スタッツでも同じ問題が起きれば同じ仕組みをそのまま使える汎用フィールドにしてある
   */
  minMinutesForRanking?: number;
}

export interface StatDef<T> extends StatMeta {
  value: (row: T) => number;
  format: (row: T) => string;
}

/**
 * ランキング母集団（パーセンタイル算出等）に含める最低出場率。所属チームの試合数のうち
 * この割合以上に出場した選手のみを対象とする。minMutesForRankingと同じ位置づけ（出場が
 * 少なく数値が振れやすい選手を除いた上で比較する）だが、こちらは「絶対分数」ではなく
 * 「所属チームの試合数に対する出場率」で足切りする点が異なる（シーズン途中加入・移籍選手を
 * 不当に排除しないため。個人詳細ページのレーダーチャートで導入、DESIGN.md参照）
 */
export const MIN_GAMES_PLAYED_RATIO_FOR_RANKING = 0.85;

/**
 * 所属チームの試合数に対する出場率が閾値（デフォルト85%）以上の選手だけを残す。
 * `teams`に所属チームの情報が無い選手（移籍等でteams配列に該当チームが無いケース）は
 * 判定不能として除外する。ランキングページ本体への適用は今回未実施だが、そのまま
 * `filterPlayersByGamesPlayedRatio(players, teams)`で使える汎用シグネチャにしてある
 */
export function filterPlayersByGamesPlayedRatio<T extends { teamId: string; gamesPlayed: number }>(
  players: T[],
  teams: Pick<TeamSummary, "teamId" | "gamesPlayed">[],
  minRatio: number = MIN_GAMES_PLAYED_RATIO_FOR_RANKING,
): T[] {
  const teamGamesById = new Map(teams.map((t) => [t.teamId, t.gamesPlayed]));
  return players.filter((p) => {
    const teamGames = teamGamesById.get(p.teamId);
    return teamGames !== undefined && teamGames > 0 && p.gamesPlayed / teamGames >= minRatio;
  });
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
    key: "oppPts",
    label: "失点",
    value: (t) => t.opponentPerGame.pts,
    format: (t) => formatDecimal(t.opponentPerGame.pts),
    higherIsBetter: false,
    formulaText: "相手チームの得点（ボックススコア）",
    source: "official",
    category: "basic",
  },
  {
    key: "benchPoints",
    label: "ベンチポイント",
    value: (t) => t.advanced.benchPointsPerGame,
    format: (t) => formatDecimal(t.advanced.benchPointsPerGame),
    // GeniusAPIに直接の該当フィールドが無いため、ボックススコア個人行のStartingFlg!==1
    // （先発以外）の選手のPoint合計から導出した独自集計（DESIGN.md 12章、2026-08-17訂正）
    formulaText: "先発以外の選手のPoint合計（1試合あたり平均）",
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
    key: "twoPct",
    label: "2P%",
    value: (t) => safeDiv(t.totals.fgm - t.totals.tpm, t.totals.fga - t.totals.tpa),
    format: (t) => formatPct(safeDiv(t.totals.fgm - t.totals.tpm, t.totals.fga - t.totals.tpa)),
    formulaText: "2PM / 2PA　※2PM=FGM−3PM, 2PA=FGA−3PA",
    source: "official",
    officialAbbr: "2FG%",
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
    key: "efgPct",
    label: "eFG%",
    value: (t) => t.shooting.efgPct,
    format: (t) => formatPct(t.shooting.efgPct),
    formulaText: "(FGM + 0.5×3PM) / FGA",
    source: "official",
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
  {
    key: "ftRate",
    label: "FTR",
    value: (t) => t.shooting.ftRate,
    format: (t) => formatPct(t.shooting.ftRate),
    formulaText: "FTA / FGA",
    source: "nba",
    category: "shooting",
  },
  {
    key: "orbPct",
    label: "ORB%",
    value: (t) => t.advanced.orbPct,
    format: (t) => formatPct100(t.advanced.orbPct),
    formulaText: "100 × 自チームOREB / (自チームOREB + 相手DREB)",
    source: "nba",
    category: "rebounding",
  },
  {
    key: "pace",
    label: "PACE",
    value: (t) => t.advanced.pace,
    format: (t) => formatDecimal(t.advanced.pace),
    formulaText: "40 × POSS / (チーム総プレイタイム / 5)",
    source: "official",
    officialAbbr: "PACE",
    category: "rating",
  },
  {
    key: "offRtg",
    label: "ORtg",
    value: (t) => t.advanced.offRtg,
    format: (t) => formatDecimal(t.advanced.offRtg),
    formulaText: "100 × PTS / POSS",
    source: "official",
    officialAbbr: "OFFRTG",
    category: "rating",
  },
  {
    key: "defRtg",
    label: "DRtg",
    value: (t) => t.advanced.defRtg,
    format: (t) => formatDecimal(t.advanced.defRtg),
    higherIsBetter: false,
    formulaText: "100 × 相手PTS / POSS",
    source: "official",
    officialAbbr: "DEFRTG",
    category: "rating",
  },
  {
    key: "netRtg",
    label: "NetRtg",
    value: (t) => t.advanced.netRtg,
    format: (t) => formatSigned(t.advanced.netRtg),
    formulaText: "OFFRTG − DEFRTG",
    source: "official",
    officialAbbr: "NETRTG",
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
    key: "twoPct",
    label: "2P%",
    value: (p) => safeDiv(p.totals.fgm - p.totals.tpm, p.totals.fga - p.totals.tpa),
    format: (p) => formatPct(safeDiv(p.totals.fgm - p.totals.tpm, p.totals.fga - p.totals.tpa)),
    formulaText: "2PM / 2PA　※2PM=FGM−3PM, 2PA=FGA−3PA",
    source: "official",
    officialAbbr: "2FG%",
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
    key: "efgPct",
    label: "eFG%",
    value: (p) => p.shooting.efgPct,
    format: (p) => formatPct(p.shooting.efgPct),
    formulaText: "(FGM + 0.5×3PM) / FGA",
    source: "official",
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
  {
    key: "ftRate",
    label: "FTR",
    value: (p) => p.shooting.ftRate,
    format: (p) => formatPct(p.shooting.ftRate),
    formulaText: "FTA / FGA",
    source: "nba",
    category: "shooting",
  },
  {
    key: "usagePct",
    label: "Usage%",
    value: (p) => p.advanced.usagePct,
    format: (p) => formatPct100(p.advanced.usagePct),
    formulaText: "100 × ((FGA+0.44×FTA+TOV)×(チームMIN/5)) / (MIN×(チームFGA+0.44×チームFTA+チームTOV))",
    source: "nba",
    category: "rating",
  },
  {
    key: "plusMinus",
    label: "+/-",
    value: (p) => p.perGame.plusMinus,
    format: (p) => formatSigned(p.perGame.plusMinus),
    formulaText: "出場中の自チーム得点 − 相手チーム得点（1試合あたり平均）",
    source: "official",
    officialAbbr: "+/-",
    category: "basic",
  },
  {
    key: "per",
    label: "PER",
    value: (p) => p.advanced.per,
    format: (p) => formatDecimal(p.advanced.per),
    formulaText:
      "uPER × (リーグPACE/チームPACE) × (15/リーグ平均uPER)　※uPERはHollinger方式（NBA/Basketball-Reference流）。" +
      "ランキングページではシーズン合計出場時間200分未満の選手を除外（個人詳細・比較ページでは適用しない）",
    source: "nba",
    category: "rating",
    minMinutesForRanking: 200,
  },
  {
    key: "pps",
    label: "PPS",
    value: (p) => safeDiv(p.totals.pts, p.totals.fga),
    format: (p) => formatDecimal(safeDiv(p.totals.pts, p.totals.fga), 2),
    formulaText: "PTS / FGA",
    source: "nba",
    category: "shooting",
  },
  {
    key: "ppp",
    label: "PPP",
    value: (p) => p.advanced.ppp ?? 0,
    format: (p) => (p.advanced.ppp !== undefined ? formatDecimal(p.advanced.ppp, 2) : "-"),
    formulaText:
      "個人ORtg（Dean Oliver方式。試合詳細ページの個人ORtgと同じ計算式をシーズン合計値に適用） / 100。" +
      "同じ計算式を再利用しているため、シーズン合計出場時間4分未満は算出不能（-表示）",
    source: "nba",
    category: "rating",
  },
  {
    key: "onCourtNet",
    label: "オンコート+/-",
    value: (p) => p.advanced.onCourtNetPerGame,
    format: (p) => formatSigned(p.advanced.onCourtNetPerGame),
    formulaText: "個人+/-（PLUSMINUS）と同義。出場中の自チーム得失点差（1試合あたり平均）",
    source: "custom",
    category: "basic",
    hiddenFromPicker: true,
  },
  {
    key: "offCourtNet",
    label: "オフコート+/-",
    value: (p) => p.advanced.offCourtNetPerGame,
    format: (p) => formatSigned(p.advanced.offCourtNetPerGame),
    formulaText: "出場試合のチーム得失点差 − 個人+/-（ベンチにいる間の自チーム得失点差、1試合あたり平均）",
    source: "custom",
    category: "basic",
    hiddenFromPicker: true,
  },
];
