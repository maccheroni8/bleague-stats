import { useState } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { ExternalLinkIcon } from "./ExternalLinkIcon";
import { bleaguePlayerUrl } from "../lib/externalLinks";
import { PeriodRangeToggle } from "./PeriodRangeToggle";
import { buildPeriodRangeOptions, type PeriodRangeOption, type PeriodRangeValue } from "../lib/periodRange";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "../lib/format";
import { efgPct, safeDiv, tovPct, tsPct, usagePct } from "../../shared/formulas";
import type { PlayerOnCourtRatings } from "../../shared/onCourt";
import type { BoxscoreRow, PlayByPlayEvent, PlayerSummary, SummaryRow, YahooTurnoverEvent } from "../../shared/types";
import {
  astToTovRatio,
  buildPlayTypeCounts,
  buildPlayerBoxscores,
  buildTeamCoachesCounts,
  buildTeamTotalCounts,
  computeIndividualRatings,
  computeTeamRatings,
  countTeamGeneratedTechnicalFouls,
  formatAstToRatio,
  formatMinutesFromSeconds,
  sharePct,
  sumCountsList,
  type BoxscoreCounts,
  type PlayTypeCounts,
  type PlayerBoxscore,
  type TeamRatings,
} from "../lib/boxscoreAggregate";
import { PLAYER_STAT_DEFS, TEAM_STAT_DEFS } from "../lib/statDefs";

// グロッサリーページ・ランキング/比較ページと同じ情報源（statDefs.ts）のformulaTextを
// 列見出しのツールチップに再利用する。ボックススコア固有の列（PTSOFFTO/DUNK等、シーズン
// 集計のPlayerSummary/TeamSummaryには存在しない）はstatDefs.tsに対応が無いため、
// この下の各列定義でその場合のみ独自の説明文を用意する
const STAT_FORMULA_BY_KEY = new Map<string, string>();
for (const def of [...TEAM_STAT_DEFS, ...PLAYER_STAT_DEFS]) {
  if (!STAT_FORMULA_BY_KEY.has(def.key)) STAT_FORMULA_BY_KEY.set(def.key, def.formulaText);
}

export type BoxscoreTabKey = "traditional" | "advanced" | "misc" | "scoring";

export const BOXSCORE_TABS: { key: BoxscoreTabKey; label: string }[] = [
  { key: "traditional", label: "トラディショナル" },
  { key: "advanced", label: "アドバンスド" },
  { key: "misc", label: "Misc" },
  { key: "scoring", label: "スコアリング" },
];

export interface ColumnCtx {
  /** %-share・USG%の分母に使うチーム合計（選択中の期間範囲） */
  own: BoxscoreCounts;
  ownPlayType: PlayTypeCounts;
  /** チーム合計行のみ定義される（POSS/PACE/ORtg/DRtg/NetRtg用） */
  ratings?: TeamRatings;
  isPlayerRow: boolean;
  isTeamTotalRow: boolean;
  /** ペイント内外2P内訳の元になるX/Y/AreaCDが収録されているか（2022-23シーズン以降のみ。DESIGN.md参照） */
  shotChartSupported: boolean;
  /** Yahoo!スポーツplay-by-play由来の列（LIVETOV/DEADTOV等）が算出可能か。DESIGN.md参照 */
  yahooPbpSupported: boolean;
}

export interface BoxscoreColumn {
  key: string;
  label: string;
  format: (c: BoxscoreCounts, ctx: ColumnCtx) => string;
  /**
   * トップ値ハイライト用の生数値。undefinedを返す（またはフィールド自体を省略する）列は
   * ハイライト対象外にする（FG/2P/3P/FT等の複合表示列、チーム単位でしか値を持たない列など）
   */
  value?: (c: BoxscoreCounts, ctx: ColumnCtx) => number | undefined;
  /** falseならTOV/BSR/Fのように値が小さいほど良い列。比較ページの仕組みと同じ規約（未指定はtrue扱い） */
  higherIsBetter?: boolean;
  /** 列見出しホバー時のツールチップ文言。statDefs.tsのformulaTextを再利用するかボックススコア固有の説明を書く */
  description: string;
}

/** statDefs.tsに対応する項目があればそのformulaTextを、無ければ渡したfallbackを使う */
function desc(key: string, fallback: string): string {
  return STAT_FORMULA_BY_KEY.get(key) ?? fallback;
}

const plusMinusCol: BoxscoreColumn = {
  key: "plusminus",
  label: "+/-",
  format: (c) => (c.hasPlusMinus ? formatSigned(c.plusMinus, 0) : "-"),
  value: (c) => (c.hasPlusMinus ? c.plusMinus : undefined),
  description: "出場中の自チーム得点 − 相手チーム得点",
};

const TRADITIONAL_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec, description: desc("min", "出場時間") },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts, description: desc("pts", "得点") },
  { key: "fgm", label: "FGM", format: (c) => String(c.pt2m + c.pt3m), value: (c) => c.pt2m + c.pt3m, description: "FG成功数（2P成功+3P成功）" },
  { key: "fga", label: "FGA", format: (c) => String(c.pt2a + c.pt3a), value: (c) => c.pt2a + c.pt3a, description: "FG試投数（2P試投+3P試投）" },
  {
    key: "fgpct",
    label: "FG%",
    format: (c) => formatPct(safeDiv(c.pt2m + c.pt3m, c.pt2a + c.pt3a)),
    value: (c) => safeDiv(c.pt2m + c.pt3m, c.pt2a + c.pt3a),
    description: desc("fgPct", "FGM / FGA"),
  },
  { key: "2pm", label: "2PM", format: (c) => String(c.pt2m), value: (c) => c.pt2m, description: "2P成功数" },
  { key: "2pa", label: "2PA", format: (c) => String(c.pt2a), value: (c) => c.pt2a, description: "2P試投数" },
  {
    key: "2ppct",
    label: "2P%",
    format: (c) => formatPct(safeDiv(c.pt2m, c.pt2a)),
    value: (c) => safeDiv(c.pt2m, c.pt2a),
    description: desc("twoPct", "2PM / 2PA"),
  },
  { key: "3pm", label: "3PM", format: (c) => String(c.pt3m), value: (c) => c.pt3m, description: "3P成功数" },
  { key: "3pa", label: "3PA", format: (c) => String(c.pt3a), value: (c) => c.pt3a, description: "3P試投数" },
  {
    key: "3ppct",
    label: "3P%",
    format: (c) => formatPct(safeDiv(c.pt3m, c.pt3a)),
    value: (c) => safeDiv(c.pt3m, c.pt3a),
    description: desc("tpPct", "3PM / 3PA"),
  },
  { key: "ftm", label: "FTM", format: (c) => String(c.ftm), value: (c) => c.ftm, description: "FT成功数" },
  { key: "fta", label: "FTA", format: (c) => String(c.fta), value: (c) => c.fta, description: "FT試投数" },
  {
    key: "ftpct",
    label: "FT%",
    format: (c) => formatPct(safeDiv(c.ftm, c.fta)),
    value: (c) => safeDiv(c.ftm, c.fta),
    description: desc("ftPct", "FTM / FTA"),
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a)),
    value: (c) => efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a),
    description: desc("efgPct", "(FGM + 0.5×3PM) / FGA"),
  },
  {
    key: "ts",
    label: "TS%",
    format: (c) => formatPct(tsPct(c.pts, c.pt2a + c.pt3a, c.fta)),
    value: (c) => tsPct(c.pts, c.pt2a + c.pt3a, c.fta),
    description: "PTS / (2 × (FGA + 0.44×FTA))",
  },
  { key: "or", label: "OR", format: (c) => String(c.oreb), value: (c) => c.oreb, description: "オフェンスリバウンド" },
  { key: "dr", label: "DR", format: (c) => String(c.dreb), value: (c) => c.dreb, description: "ディフェンスリバウンド" },
  { key: "tr", label: "TR", format: (c) => String(c.treb), value: (c) => c.treb, description: desc("reb", "OREB + DREB") },
  { key: "ast", label: "AST", format: (c) => String(c.ast), value: (c) => c.ast, description: desc("ast", "アシスト") },
  { key: "tov", label: "TOV", format: (c) => String(c.tov), value: (c) => c.tov, higherIsBetter: false, description: desc("tov", "ターンオーバー") },
  {
    key: "asttov",
    label: "AST/TOV",
    format: (c) => formatAstToRatio(c.ast, c.tov),
    value: (c) => astToTovRatio(c.ast, c.tov),
    description: "AST / TOV（TOV=0の場合はAST数をそのまま比率として使う）",
  },
  { key: "stl", label: "STL", format: (c) => String(c.stl), value: (c) => c.stl, description: desc("stl", "スティール") },
  { key: "blk", label: "BLK", format: (c) => String(c.blk), value: (c) => c.blk, description: desc("blk", "ブロック") },
  { key: "bsr", label: "BSR", format: (c) => String(c.bson), value: (c) => c.bson, higherIsBetter: false, description: "被ブロック数" },
  { key: "f", label: "F", format: (c) => String(c.foul), value: (c) => c.foul, higherIsBetter: false, description: "パーソナル/オフェンス等のファウル数" },
  { key: "fd", label: "FD", format: (c) => String(c.foulon), value: (c) => c.foulon, description: "被ファウル数（ファウルを誘発した回数）" },
  { key: "eff", label: "EFF", format: (c) => String(c.eff), value: (c) => c.eff, description: desc("eff", "Bリーグ公式の総合貢献度指標") },
  plusMinusCol,
];

const ADVANCED_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec, description: desc("min", "出場時間") },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts, description: desc("pts", "得点") },
  { key: "eff", label: "EFF", format: (c) => String(c.eff), value: (c) => c.eff, description: desc("eff", "Bリーグ公式の総合貢献度指標") },
  {
    key: "usg",
    label: "USG%",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(usagePctOf(c, ctx)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? usagePctOf(c, ctx) : undefined),
    description: desc("usagePct", "自分が関与したプレー（FGA・FTA・TOV）の、出場中のチーム全体に占める割合"),
  },
  {
    key: "tovpct",
    label: "TOV%",
    format: (c) => formatPct100(tovPct(c.tov, c.pt2a + c.pt3a, c.fta)),
    value: (c) => tovPct(c.tov, c.pt2a + c.pt3a, c.fta),
    higherIsBetter: false,
    description: "100 × TOV / (FGA + 0.44×FTA + TOV)。Four Factorsの標準定義（AST/TOVとは別の指標）",
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a)),
    value: (c) => efgPct(c.pt2m + c.pt3m, c.pt3m, c.pt2a + c.pt3a),
    description: desc("efgPct", "(FGM + 0.5×3PM) / FGA"),
  },
  {
    key: "ts",
    label: "TS%",
    format: (c) => formatPct(tsPct(c.pts, c.pt2a + c.pt3a, c.fta)),
    value: (c) => tsPct(c.pts, c.pt2a + c.pt3a, c.fta),
    description: "PTS / (2 × (FGA + 0.44×FTA))",
  },
  {
    key: "pps",
    label: "PPS",
    format: (c) => formatDecimal(safeDiv(c.pts, c.pt2a + c.pt3a), 2),
    value: (c) => safeDiv(c.pts, c.pt2a + c.pt3a),
    description: desc("pps", "PTS / FGA"),
  },
  {
    key: "poss",
    label: "POSS",
    format: (_c, ctx) => (ctx.ratings ? formatDecimal(ctx.ratings.poss, 1) : "-"),
    description:
      "推定ポゼッション数（Bリーグ公式定義）。自チーム・相手チーム双方の視点から推定した値の平均。" +
      "チーム合計行のみ算出（選手個人のPOSSという概念は無い）",
  },
  {
    key: "pace",
    label: "PACE",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatDecimal(ctx.ratings.pace, 1)
          : "-"
        : ctx.isPlayerRow && c.onCourtPace !== undefined
          ? formatDecimal(c.onCourtPace, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.pace : ctx.isPlayerRow ? c.onCourtPace : undefined),
    description: desc("pace", "40 × POSS / (チーム総プレイタイム / 5)") + "。選手行はその選手が出場中の在コート区間ベースの値（試合全体選択時のみ）",
  },
  {
    key: "ortg",
    label: "ORtg",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatDecimal(ctx.ratings.offRtg, 1)
          : "-"
        : ctx.isPlayerRow && c.offRtg !== undefined
          ? formatDecimal(c.offRtg, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.offRtg : ctx.isPlayerRow ? c.offRtg : undefined),
    description: "チーム合計行: 100 × PTS / POSS。選手行: 個人ORtg（Dean Oliver方式）。出場時間4分未満は算出不能",
  },
  {
    key: "drtg",
    label: "DRtg",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatDecimal(ctx.ratings.defRtg, 1)
          : "-"
        : ctx.isPlayerRow && c.defRtg !== undefined
          ? formatDecimal(c.defRtg, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.defRtg : ctx.isPlayerRow ? c.defRtg : undefined),
    higherIsBetter: false,
    description: "チーム合計行: 100 × 相手PTS / POSS。選手行: 個人DRtg（Dean Oliver方式）。出場時間4分未満は算出不能",
  },
  {
    key: "netrtg",
    label: "NetRtg",
    format: (c, ctx) =>
      ctx.isTeamTotalRow
        ? ctx.ratings
          ? formatSigned(ctx.ratings.netRtg, 1)
          : "-"
        : ctx.isPlayerRow && c.netRtg !== undefined
          ? formatSigned(c.netRtg, 1)
          : "-",
    value: (c, ctx) => (ctx.isTeamTotalRow ? ctx.ratings?.netRtg : ctx.isPlayerRow ? c.netRtg : undefined),
    description: desc("netRtg", "ORtg − DRtg"),
  },
  plusMinusCol,
];

function usagePctOf(c: BoxscoreCounts, ctx: ColumnCtx): number {
  return usagePct(
    { fga: c.pt2a + c.pt3a, fta: c.fta, tov: c.tov, min: c.minSec / 60 },
    { fga: ctx.own.pt2a + ctx.own.pt3a, fta: ctx.own.fta, tov: ctx.own.tov, min: ctx.own.minSec / 60 },
  );
}

const MISC_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec, description: desc("min", "出場時間") },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts, description: desc("pts", "得点") },
  { key: "pitp", label: "PITP", format: (c) => String(c.pt2in), value: (c) => c.pt2in, description: "ペイント内での得点（Points in the Paint）" },
  { key: "fbps", label: "FBPS", format: (c) => String(c.ptfb), value: (c) => c.ptfb, description: "ファストブレイクによる得点（Fastbreak Points）" },
  { key: "2ndpts", label: "2ND PTS", format: (c) => String(c.pt2nd), value: (c) => c.pt2nd, description: "セカンドチャンス（オフェンスリバウンド後）による得点" },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (c, ctx) => (ctx.isTeamTotalRow ? String(ctx.ownPlayType.pft) : String(c.ptsOffTov)),
    value: (c) => c.ptsOffTov,
    description: "ターンオーバーからの得点（Points From Turnover）",
  },
  { key: "dunk", label: "DUNK", format: (c) => String(c.dunks), value: (c) => c.dunks, description: "ダンク成功数" },
  { key: "and1", label: "AND1", format: (c) => String(c.basketCounts), value: (c) => c.basketCounts, description: "バスケットカウント（アンドワン）成功数" },
  // 低頻度なファウル2種は通常のFカラムとは別にMiscタブでのみ表示する（DUNK/AND1と異なり
  // ほぼ全選手が0になるため、ハイライト対象からは外す＝valueを持たせない）
  { key: "ufoul", label: "UFOUL", format: (c) => String(c.unsportsmanlikeFouls), description: "アンスポーツマンファウル数" },
  { key: "dqfoul", label: "DQFOUL", format: (c) => String(c.disqualifyingFouls), description: "ディスクォリファイングファウル数" },
  {
    key: "tf",
    label: "TF",
    format: (c) => String(c.technicalFouls),
    higherIsBetter: false,
    description: "テクニカルファウル数（選手行は個人のテクニカルのみ。チーム合計行・TEAM/COACHES行はHC/ベンチテクニカルも含む）",
  },
  // アシストからの得点（得点者視点。shared/assistedScoring.ts参照）。FTAST含め
  // PlayByPlays配列内の構造的な隣接パターンから求めた「被アシスト」内訳
  { key: "ast2m", label: "AST2M", format: (c) => String(c.assisted2m), value: (c) => c.assisted2m, description: "アシストされた2P成功数" },
  { key: "ast3m", label: "AST3M", format: (c) => String(c.assisted3m), value: (c) => c.assisted3m, description: "アシストされた3P成功数" },
  { key: "astftm", label: "ASTFTM", format: (c) => String(c.assistedFtm), value: (c) => c.assistedFtm, description: "アシストされたフリースロー成功数（シュートファウルでフリースローに切り替わったケース）" },
  {
    key: "astpct",
    label: "AST%",
    format: (c) =>
      formatPct100(sharePct(c.assisted2m * 2 + c.assisted3m * 3 + c.assistedFtm, c.pts)),
    value: (c) => sharePct(c.assisted2m * 2 + c.assisted3m * 3 + c.assistedFtm, c.pts),
    description: "(被アシスト2PM×2 + 被アシスト3PM×3 + 被アシストFTM) / PTS × 100",
  },
  // ターンオーバーのライブ/デッドボール内訳（Yahoo!スポーツplay-by-play由来、2023-24シーズン
  // 以降のみ。DESIGN.md参照）。未対応シーズン・未取得試合は「-」表示にする
  {
    key: "livetov",
    label: "LIVETOV",
    format: (c, ctx) => (ctx.yahooPbpSupported ? String(c.liveTov) : "-"),
    value: (c, ctx) => (ctx.yahooPbpSupported ? c.liveTov : undefined),
    higherIsBetter: false,
    description: "ライブボールターンオーバー数（バッドパス・ボールハンドリングロスト等、相手の速攻に直結しうるもの）",
  },
  {
    key: "deadtov",
    label: "DEADTOV",
    format: (c, ctx) => (ctx.yahooPbpSupported ? String(c.deadTov) : "-"),
    value: (c, ctx) => (ctx.yahooPbpSupported ? c.deadTov : undefined),
    higherIsBetter: false,
    description: "デッドボールターンオーバー数（トラベリング・オフェンスファウル・各種バイオレーション等、笛で試合が止まるもの）",
  },
  {
    key: "livetovpct",
    label: "LIVE%",
    format: (c, ctx) =>
      ctx.yahooPbpSupported ? formatPct100(sharePct(c.liveTov, c.liveTov + c.deadTov)) : "-",
    value: (c, ctx) => (ctx.yahooPbpSupported ? sharePct(c.liveTov, c.liveTov + c.deadTov) : undefined),
    description: "LIVETOV / (LIVETOV + DEADTOV) × 100",
  },
  {
    key: "deadtovpct",
    label: "DEAD%",
    format: (c, ctx) =>
      ctx.yahooPbpSupported ? formatPct100(sharePct(c.deadTov, c.liveTov + c.deadTov)) : "-",
    value: (c, ctx) => (ctx.yahooPbpSupported ? sharePct(c.deadTov, c.liveTov + c.deadTov) : undefined),
    description: "DEADTOV / (LIVETOV + DEADTOV) × 100",
  },
];

const SCORING_COLUMNS: BoxscoreColumn[] = [
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(c.minSec), value: (c) => c.minSec, description: desc("min", "出場時間") },
  { key: "pts", label: "PTS", format: (c) => String(c.pts), value: (c) => c.pts, description: desc("pts", "得点") },
  {
    key: "pctpts",
    label: "%PTS",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pts, ctx.own.pts)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pts, ctx.own.pts) : undefined),
    description: "個人PTS / チーム合計PTS × 100",
  },
  {
    key: "pctfgm",
    label: "%FGM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt2m + c.pt3m, ctx.own.pt2m + ctx.own.pt3m)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt2m + c.pt3m, ctx.own.pt2m + ctx.own.pt3m) : undefined),
    description: "個人FGM / チーム合計FGM × 100",
  },
  {
    key: "pctfga",
    label: "%FGA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt2a + c.pt3a, ctx.own.pt2a + ctx.own.pt3a)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt2a + c.pt3a, ctx.own.pt2a + ctx.own.pt3a) : undefined),
    description: "個人FGA / チーム合計FGA × 100",
  },
  {
    key: "pct3pm",
    label: "%3PM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt3m, ctx.own.pt3m)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt3m, ctx.own.pt3m) : undefined),
    description: "個人3PM / チーム合計3PM × 100",
  },
  {
    key: "pct3pa",
    label: "%3PA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.pt3a, ctx.own.pt3a)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.pt3a, ctx.own.pt3a) : undefined),
    description: "個人3PA / チーム合計3PA × 100",
  },
  {
    key: "pctftm",
    label: "%FTM",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.ftm, ctx.own.ftm)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.ftm, ctx.own.ftm) : undefined),
    description: "個人FTM / チーム合計FTM × 100",
  },
  {
    key: "pctfta",
    label: "%FTA",
    format: (c, ctx) => (ctx.isPlayerRow ? formatPct100(sharePct(c.fta, ctx.own.fta)) : "-"),
    value: (c, ctx) => (ctx.isPlayerRow ? sharePct(c.fta, ctx.own.fta) : undefined),
    description: "個人FTA / チーム合計FTA × 100",
  },
  {
    key: "paint2m",
    label: "PAINT2M",
    format: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? String(c.paint2m) : "-"),
    value: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? c.paint2m : undefined),
    description: "ペイント内2Pシュートの成功数（ショットチャート座標から判定。2022-23シーズン以降のみ）",
  },
  {
    key: "paint2a",
    label: "PAINT2A",
    format: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? String(c.paint2a) : "-"),
    value: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? c.paint2a : undefined),
    description: "ペイント内2Pシュートの試投数（ショットチャート座標から判定。2022-23シーズン以降のみ）",
  },
  {
    key: "paint2pct",
    label: "PAINT2%",
    format: (c, ctx) =>
      (ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? formatPct(safeDiv(c.paint2m, c.paint2a)) : "-",
    value: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? safeDiv(c.paint2m, c.paint2a) : undefined),
    description: "PAINT2M / PAINT2A",
  },
  {
    key: "mid2m",
    label: "MID2M",
    format: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? String(c.nonPaint2m) : "-"),
    value: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? c.nonPaint2m : undefined),
    description: "ペイント外2Pシュート（ミッドレンジ）の成功数（ショットチャート座標から判定。2022-23シーズン以降のみ）",
  },
  {
    key: "mid2a",
    label: "MID2A",
    format: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? String(c.nonPaint2a) : "-"),
    value: (c, ctx) => ((ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? c.nonPaint2a : undefined),
    description: "ペイント外2Pシュート（ミッドレンジ）の試投数（ショットチャート座標から判定。2022-23シーズン以降のみ）",
  },
  {
    key: "mid2pct",
    label: "MID2%",
    format: (c, ctx) =>
      (ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? formatPct(safeDiv(c.nonPaint2m, c.nonPaint2a)) : "-",
    value: (c, ctx) =>
      (ctx.isPlayerRow || ctx.isTeamTotalRow) && ctx.shotChartSupported ? safeDiv(c.nonPaint2m, c.nonPaint2a) : undefined,
    description: "MID2M / MID2A",
  },
];

export const COLUMNS_BY_TAB: Record<BoxscoreTabKey, BoxscoreColumn[]> = {
  traditional: TRADITIONAL_COLUMNS,
  advanced: ADVANCED_COLUMNS,
  misc: MISC_COLUMNS,
  scoring: SCORING_COLUMNS,
};

interface BoxscoreTableProps {
  homeTeamName: string;
  awayTeamName: string;
  homeRows: BoxscoreRow[];
  awayRows: BoxscoreRow[];
  summaries: SummaryRow[];
  playByPlays: PlayByPlayEvent[];
  /** Yahoo!スポーツplay-by-play由来のターンオーバーイベント（両チーム分。未対応/未取得なら空配列） */
  yahooTurnovers: YahooTurnoverEvent[];
  yahooPbpSupported: boolean;
  periods: number;
  classificationById: Map<string, PlayerSummary["classification"]>;
  /** ペイント内外2P内訳（スコアリングタブ）の元になるX/Y/AreaCDが収録されているか。2022-23シーズン以降のみ */
  shotChartSupported: boolean;
  /** 個人単位の在コート中OFFRTG/DEFRTG/NETRTG/PACE（shared/onCourt.ts）。shotChartSupportedがfalseなら空 */
  onCourtRatings: Record<string, PlayerOnCourtRatings>;
  homeColor?: string;
  awayColor?: string;
}

export function BoxscoreTable({
  homeTeamName,
  awayTeamName,
  homeRows,
  awayRows,
  summaries,
  playByPlays,
  yahooTurnovers,
  yahooPbpSupported,
  periods,
  classificationById,
  shotChartSupported,
  onCourtRatings,
  homeColor,
  awayColor,
}: BoxscoreTableProps) {
  const [activeTab, setActiveTab] = useState<BoxscoreTabKey>("traditional");
  const [periodRange, setPeriodRange] = useState<PeriodRangeValue>("all");

  const periodOptions = buildPeriodRangeOptions(periods);
  const selectedOption = periodOptions.find((o) => o.value === periodRange);
  const columns = COLUMNS_BY_TAB[activeTab];

  return (
    <>
      <div className="boxscore-controls">
        <div className="mode-toggle boxscore-category-tabs">
          {BOXSCORE_TABS.map((tab) => (
            <button key={tab.key} className={tab.key === activeTab ? "active" : ""} onClick={() => setActiveTab(tab.key)}>
              {tab.label}
            </button>
          ))}
        </div>
        <PeriodRangeToggle options={periodOptions} value={periodRange} onChange={setPeriodRange} />
      </div>
      <BoxscoreTeamPanel
        teamName={homeTeamName}
        ownRows={homeRows}
        oppRows={awayRows}
        side="home"
        summaries={summaries}
        playByPlays={playByPlays}
        yahooTurnovers={yahooTurnovers}
        yahooPbpSupported={yahooPbpSupported}
        periodOption={selectedOption}
        columns={columns}
        classificationById={classificationById}
        shotChartSupported={shotChartSupported}
        onCourtRatings={onCourtRatings}
        accentColor={homeColor}
        showStatBadges={activeTab === "traditional"}
      />
      <BoxscoreTeamPanel
        teamName={awayTeamName}
        ownRows={awayRows}
        oppRows={homeRows}
        side="away"
        summaries={summaries}
        playByPlays={playByPlays}
        yahooTurnovers={yahooTurnovers}
        yahooPbpSupported={yahooPbpSupported}
        periodOption={selectedOption}
        columns={columns}
        classificationById={classificationById}
        shotChartSupported={shotChartSupported}
        onCourtRatings={onCourtRatings}
        accentColor={awayColor}
        showStatBadges={activeTab === "traditional"}
      />
    </>
  );
}

/** トップ値ハイライト対象の各列について、DNPを除く選手の中でのベスト値を求める（比較ページのcompare-bestと同じ規約） */
function computeBestByColumn(
  players: PlayerBoxscore[],
  columns: BoxscoreColumn[],
  ctx: ColumnCtx,
): Map<string, number> {
  const candidates = players.filter((p) => !p.dnp);
  const best = new Map<string, number>();
  for (const col of columns) {
    if (!col.value) continue;
    const values = candidates
      .map((p) => col.value!(p.counts, ctx))
      .filter((v): v is number => v !== undefined);
    if (values.length < 2) continue;
    best.set(col.key, col.higherIsBetter === false ? Math.min(...values) : Math.max(...values));
  }
  return best;
}

/** この集計セクションでは+/-が意味を持たないため、常に「-」表示になるよう強制する */
function withoutPlusMinus(counts: BoxscoreCounts): BoxscoreCounts {
  return { ...counts, hasPlusMinus: false };
}

function BoxscoreTeamPanel({
  teamName,
  ownRows,
  oppRows,
  side,
  summaries,
  playByPlays,
  yahooTurnovers,
  yahooPbpSupported,
  periodOption,
  columns,
  classificationById,
  shotChartSupported,
  onCourtRatings,
  accentColor,
  showStatBadges,
}: {
  teamName: string;
  ownRows: BoxscoreRow[];
  oppRows: BoxscoreRow[];
  side: "home" | "away";
  summaries: SummaryRow[];
  playByPlays: PlayByPlayEvent[];
  yahooTurnovers: YahooTurnoverEvent[];
  yahooPbpSupported: boolean;
  periodOption: PeriodRangeOption | undefined;
  columns: BoxscoreColumn[];
  classificationById: Map<string, PlayerSummary["classification"]>;
  shotChartSupported: boolean;
  onCourtRatings: Record<string, PlayerOnCourtRatings>;
  accentColor?: string;
  /** ダブルダブル/トリプルダブルバッジをトラディショナルタブでのみ表示する */
  showStatBadges: boolean;
}) {
  let teamTotal = buildTeamTotalCounts(ownRows, periodOption);
  const oppTeamTotal = buildTeamTotalCounts(oppRows, periodOption);
  const coaches = buildTeamCoachesCounts(ownRows, periodOption, playByPlays);
  const playType = buildPlayTypeCounts(summaries, side, periodOption);
  const ratings = computeTeamRatings(teamTotal, oppTeamTotal);

  // 個人PACEは試合全体（periods===null）選択時のみマージする。PlayByPlaysのポゼッション区切り
  // 検出（shared/onCourt.ts）に依存するため、Q別・前後半選択時に「試合全体固定」の値が出ると
  // 誤解を招く（他のペイント内外2P等と同じくundefinedのままにし「-」表示にする）。
  // 一方、個人ORtg/DRtg/NetRtg（Dean Oliver方式）は選択中の期間範囲のBoxscoreCountsのみで
  // 計算できるため、期間範囲を問わず常にマージする
  const showOnCourtPace = periodOption === undefined || periodOption.periods === null;
  const players = buildPlayerBoxscores(ownRows, periodOption, playByPlays, yahooTurnovers).map((p) => {
    const { offRtg, defRtg, netRtg } = computeIndividualRatings(p.counts, teamTotal, oppTeamTotal, ratings.poss);
    const onCourtPace = showOnCourtPace ? onCourtRatings[p.playerId]?.pace : undefined;
    return { ...p, counts: { ...p.counts, offRtg, defRtg, netRtg, onCourtPace } };
  });

  // F4（ダンク数・バスケットカウント・アンスポーツマンファウル・ディスクォリファイングファウル）は
  // BoxscoreRowに個人単位のフィールドが無く、buildTeamTotalCounts()（Category=3行ベース）では
  // 常に0のままなので、選手ごとの集計値を合算してチーム合計行に反映する
  const miscTeamTotals = sumCountsList(players.map((p) => p.counts));
  teamTotal = {
    ...teamTotal,
    dunks: miscTeamTotals.dunks,
    basketCounts: miscTeamTotals.basketCounts,
    unsportsmanlikeFouls: miscTeamTotals.unsportsmanlikeFouls,
    disqualifyingFouls: miscTeamTotals.disqualifyingFouls,
    assisted2m: miscTeamTotals.assisted2m,
    assisted3m: miscTeamTotals.assisted3m,
    assistedFtm: miscTeamTotals.assistedFtm,
    // LIVETOV/DEADTOVも同様（isTeamTurnover=trueの個人に紐付かないターンオーバーは含まれない。
    // DESIGN.md参照）
    liveTov: miscTeamTotals.liveTov,
    deadTov: miscTeamTotals.deadTov,
    // ペイント内外2P分割（PAINT2M等）も同様、選手ごとの値を合算してチーム合計行に反映する
    paint2m: miscTeamTotals.paint2m,
    paint2a: miscTeamTotals.paint2a,
    nonPaint2m: miscTeamTotals.nonPaint2m,
    nonPaint2a: miscTeamTotals.nonPaint2a,
    // テクニカルファウル数は選手個人分（miscTeamTotals、ActionCD1=24の合算）＋HC/ベンチ分
    // （ActionCD1=20/21、選手に紐付かないためplayers側の合算には含まれない）の合計がチーム全体の
    // 正しい値になる（DESIGN.md 2-2章参照）
    technicalFouls:
      miscTeamTotals.technicalFouls + countTeamGeneratedTechnicalFouls(playByPlays, ownRows[0]?.TeamID ?? null, periodOption),
  };

  const starters = players.filter((p) => p.startingFlg === 1);
  const bench = players.filter((p) => p.startingFlg !== 1);
  const japanese = players.filter((p) => classificationById.get(p.playerId) === "日本人");
  const international = players.filter((p) => {
    const c = classificationById.get(p.playerId);
    return c === "外国籍" || c === "帰化選手" || c === "アジア特別枠";
  });
  const unclassifiedPlayedCount = players.filter((p) => !p.dnp && classificationById.get(p.playerId) === undefined).length;
  const classificationNote =
    "※現在の登録情報に基づく参考値" + (unclassifiedPlayedCount > 0 ? `／${unclassifiedPlayedCount}名分のデータ欠落あり` : "");

  const playerCtx: ColumnCtx = {
    own: teamTotal,
    ownPlayType: playType,
    isPlayerRow: true,
    isTeamTotalRow: false,
    shotChartSupported,
    yahooPbpSupported,
  };
  const nonPlayerCtx: ColumnCtx = {
    own: teamTotal,
    ownPlayType: playType,
    isPlayerRow: false,
    isTeamTotalRow: false,
    shotChartSupported,
    yahooPbpSupported,
  };
  const teamTotalCtx: ColumnCtx = {
    own: teamTotal,
    ownPlayType: playType,
    ratings,
    isPlayerRow: false,
    isTeamTotalRow: true,
    shotChartSupported,
    yahooPbpSupported,
  };
  // 内訳集計セクションの「チーム合計」行は+/-を除きteamTotalCtxと同じ扱い（POSS/PACE等は引き続き表示する）
  const summaryTotalCtx: ColumnCtx = teamTotalCtx;

  // ハイライトはスタメン・ベンチを跨いだチーム全体で見た「トップ値」（Bリーグ公式ボックススコアの
  // チームリーダー表示と同じ考え方）。DNPは0値で不当に最良値を取ってしまうため候補から除外する
  const bestByColumn = computeBestByColumn(players, columns, playerCtx);

  return (
    <>
      <div className="boxscore-section" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
        <h3>{teamName}</h3>
        <div className="table-scroll">
          <table className="boxscore-table">
            <thead>
              <tr>
                <th className="align-left">選手</th>
                {columns.map((col) => (
                  <th key={col.key} title={col.description}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <BoxscoreGroup
                title="スタメン"
                players={starters}
                columns={columns}
                ctx={playerCtx}
                bestByColumn={bestByColumn}
                showStatBadges={showStatBadges}
              />
              <BoxscoreGroup
                title="ベンチ"
                players={bench}
                columns={columns}
                ctx={playerCtx}
                bestByColumn={bestByColumn}
                showStatBadges={showStatBadges}
              />
              <BoxscoreDataRow
                label="TEAM / COACHES"
                counts={coaches}
                columns={columns}
                ctx={nonPlayerCtx}
                className="team-coaches-row"
              />
              <BoxscoreDataRow
                label="チーム合計"
                counts={teamTotal}
                columns={columns}
                ctx={teamTotalCtx}
                className="boxscore-summary-row"
              />
            </tbody>
          </table>
        </div>
      </div>

      <div className="boxscore-summary-section">
        <h4>内訳集計</h4>
        <div className="table-scroll">
          <table className="boxscore-table">
            <thead>
              <tr>
                <th className="align-left"> </th>
                {columns.map((col) => (
                  <th key={col.key} title={col.description}>{col.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <BoxscoreDataRow
                label="スタメン合計"
                counts={withoutPlusMinus(sumCountsList(starters.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
              />
              <BoxscoreDataRow
                label="ベンチ合計"
                counts={withoutPlusMinus(sumCountsList(bench.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
              />
              <BoxscoreDataRow
                label="チーム合計"
                counts={withoutPlusMinus(teamTotal)}
                columns={columns}
                ctx={summaryTotalCtx}
                className="boxscore-summary-row boxscore-summary-grand-total"
              />
              <tr className="boxscore-summary-spacer" aria-hidden="true">
                <td colSpan={columns.length + 1} />
              </tr>
              <BoxscoreDataRow
                label="日本人選手合計"
                counts={withoutPlusMinus(sumCountsList(japanese.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
                note={classificationNote}
              />
              <BoxscoreDataRow
                label="外国籍+帰化+アジア特別枠合計"
                counts={withoutPlusMinus(sumCountsList(international.map((p) => p.counts)))}
                columns={columns}
                ctx={nonPlayerCtx}
                className="boxscore-summary-row"
                note={classificationNote}
              />
              <BoxscoreDataRow
                label="チーム合計"
                counts={withoutPlusMinus(teamTotal)}
                columns={columns}
                ctx={summaryTotalCtx}
                className="boxscore-summary-row boxscore-summary-grand-total"
              />
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function BoxscoreGroup({
  title,
  players,
  columns,
  ctx,
  bestByColumn,
  showStatBadges,
}: {
  title: string;
  players: PlayerBoxscore[];
  columns: BoxscoreColumn[];
  ctx: ColumnCtx;
  bestByColumn: Map<string, number>;
  showStatBadges: boolean;
}) {
  if (players.length === 0) return null;
  // DNPは各グループの下部にまとめる（出場した選手を先に見せる）。それ以外は元の並び順を保持する
  const ordered = [...players].sort((a, b) => Number(a.dnp) - Number(b.dnp));
  return (
    <>
      <tr className="boxscore-group-row">
        <td colSpan={columns.length + 1}>{title}</td>
      </tr>
      {ordered.map((p) => (
        <tr key={p.playerId} className={p.dnp ? "dnp-row" : undefined}>
          <td className={`align-left${p.playerId ? " has-external-link" : ""}`}>
            {p.playerId ? (
              <Link to={`/players/${p.playerId}`} className="cell-link">
                {p.nameJ}
              </Link>
            ) : (
              p.nameJ
            )}
            {p.playerId && (
              <ExternalLinkIcon href={bleaguePlayerUrl(p.playerId)} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
            )}
            {showStatBadges && p.statBadge && (
              <span className={`stat-badge stat-badge-${p.statBadge.toLowerCase()}`}>{p.statBadge}</span>
            )}
          </td>
          {p.dnp ? (
            <td colSpan={columns.length}>DNP</td>
          ) : (
            columns.map((col) => {
              const val = col.value?.(p.counts, ctx);
              const isBest = val !== undefined && bestByColumn.get(col.key) === val;
              return (
                <td key={col.key} className={isBest ? "boxscore-best" : undefined}>
                  {col.format(p.counts, ctx)}
                </td>
              );
            })
          )}
        </tr>
      ))}
    </>
  );
}

function BoxscoreDataRow({
  label,
  counts,
  columns,
  ctx,
  className,
  note,
}: {
  label: string;
  counts: BoxscoreCounts;
  columns: BoxscoreColumn[];
  ctx: ColumnCtx;
  className?: string;
  note?: string;
}) {
  return (
    <tr className={className}>
      <td className="align-left">
        {label}
        {note && (
          <span className="row-note" title={note}>
            ※
          </span>
        )}
      </td>
      {columns.map((col) => (
        <td key={col.key}>{col.format(counts, ctx)}</td>
      ))}
    </tr>
  );
}
