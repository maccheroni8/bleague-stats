import type { Column } from "../components/SortableTable";
import type { BoxscoreTabKey } from "../components/BoxscoreTable";
import type { TeamGameLog } from "../../shared/types";
import type { SeasonDisplayMode } from "./playerSeasonBoxscore";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "./format";
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { efgPct, ftRate, offensiveRating, orbPct, pace, safeDiv, tovPct, tsPct } from "../../shared/formulas";

/**
 * チーム詳細ページ「チームスタッツ」タブ（Phase H4）・「チーム」ページ「全チームスタッツ」タブと
 * 同じ、team-games/{teamId}.json（TeamGameLog）だけで完結するトラディショナル/アドバンスド/
 * Misc/スコアリング項目のカラム定義。全チームスタッツ一覧（TeamsListPage.tsx）とランキング
 * ページ（RankingsPage.tsx）の両方から共通利用する（元はTeamsListPage.tsxに実装されていたものを
 * 2026-09ページで抽出）。
 *
 * ここで返す列は「チーム名/試合数/勝敗/勝率」等の先頭列（LEADING_COLUMNS）を含まない、純粋な
 * スタッツ列のみ。先頭列はJSX（TeamLogo）に依存するため呼び出し側（.tsxファイル）で用意し、
 * 必要に応じて結合する。
 */

export type TeamPerspective = "own" | "opp" | "diff";
export const TEAM_PERSPECTIVE_LABELS: Record<TeamPerspective, string> = {
  own: "自チーム",
  opp: "opp",
  diff: "+/-",
};

export function perspectiveValue(own: number, opp: number, perspective: TeamPerspective): number {
  return perspective === "own" ? own : perspective === "opp" ? opp : own - opp;
}

export interface TeamTotals {
  pts: number;
  oppPts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
  fd: number;
  min: number;
  poss: number;
  oppFgm: number;
  oppFga: number;
  oppTpm: number;
  oppTpa: number;
  oppFtm: number;
  oppFta: number;
  oppOreb: number;
  oppDreb: number;
  oppTov: number;
  oppAst: number;
  oppStl: number;
  oppBlk: number;
  oppPf: number;
  oppFd: number;
  pt2in: number;
  fb: number;
  pt2nd: number;
  pft: number;
  dunks: number;
  oppPt2in: number;
  oppFb: number;
  oppPt2nd: number;
  oppPft: number;
  oppDunks: number;
  // Misc/スコアリングタブ拡張（2026-08-29）
  technicalFouls: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
  oppTechnicalFouls: number;
  oppBasketCounts: number;
  oppUnsportsmanlikeFouls: number;
  oppDisqualifyingFouls: number;
  oppAssisted2m: number;
  oppAssisted3m: number;
  oppAssistedFtm: number;
  oppPaint2m: number;
  oppPaint2a: number;
  oppMid2m: number;
  oppMid2a: number;
}

export const EMPTY_TOTALS: TeamTotals = {
  pts: 0,
  oppPts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  oreb: 0,
  dreb: 0,
  reb: 0,
  ast: 0,
  tov: 0,
  stl: 0,
  blk: 0,
  pf: 0,
  fd: 0,
  min: 0,
  poss: 0,
  oppFgm: 0,
  oppFga: 0,
  oppTpm: 0,
  oppTpa: 0,
  oppFtm: 0,
  oppFta: 0,
  oppOreb: 0,
  oppDreb: 0,
  oppTov: 0,
  oppAst: 0,
  oppStl: 0,
  oppBlk: 0,
  oppPf: 0,
  oppFd: 0,
  pt2in: 0,
  fb: 0,
  pt2nd: 0,
  pft: 0,
  dunks: 0,
  oppPt2in: 0,
  oppFb: 0,
  oppPt2nd: 0,
  oppPft: 0,
  oppDunks: 0,
  technicalFouls: 0,
  basketCounts: 0,
  unsportsmanlikeFouls: 0,
  disqualifyingFouls: 0,
  assisted2m: 0,
  assisted3m: 0,
  assistedFtm: 0,
  paint2m: 0,
  paint2a: 0,
  mid2m: 0,
  mid2a: 0,
  oppTechnicalFouls: 0,
  oppBasketCounts: 0,
  oppUnsportsmanlikeFouls: 0,
  oppDisqualifyingFouls: 0,
  oppAssisted2m: 0,
  oppAssisted3m: 0,
  oppAssistedFtm: 0,
  oppPaint2m: 0,
  oppPaint2a: 0,
  oppMid2m: 0,
  oppMid2a: 0,
};

export function sumTeamGameLogs(logs: TeamGameLog[]): TeamTotals {
  return logs.reduce<TeamTotals>(
    (acc, g) => ({
      pts: acc.pts + g.teamScore,
      oppPts: acc.oppPts + g.opponentScore,
      fgm: acc.fgm + g.fgm,
      fga: acc.fga + g.fga,
      tpm: acc.tpm + g.tpm,
      tpa: acc.tpa + g.tpa,
      ftm: acc.ftm + g.ftm,
      fta: acc.fta + g.fta,
      oreb: acc.oreb + g.oreb,
      dreb: acc.dreb + g.dreb,
      reb: acc.reb + g.reb,
      ast: acc.ast + g.ast,
      tov: acc.tov + g.tov,
      stl: acc.stl + g.stl,
      blk: acc.blk + g.blk,
      pf: acc.pf + g.pf,
      fd: acc.fd + g.foulsDrawn,
      min: acc.min + g.min,
      poss: acc.poss + g.poss,
      oppFgm: acc.oppFgm + g.opponentFgm,
      oppFga: acc.oppFga + g.opponentFga,
      oppTpm: acc.oppTpm + g.opponentTpm,
      oppTpa: acc.oppTpa + g.opponentTpa,
      oppFtm: acc.oppFtm + g.opponentFtm,
      oppFta: acc.oppFta + g.opponentFta,
      oppOreb: acc.oppOreb + g.opponentOreb,
      oppDreb: acc.oppDreb + g.opponentDreb,
      oppTov: acc.oppTov + g.opponentTov,
      oppAst: acc.oppAst + g.opponentAst,
      oppStl: acc.oppStl + g.opponentStl,
      oppBlk: acc.oppBlk + g.opponentBlk,
      oppPf: acc.oppPf + g.opponentPf,
      oppFd: acc.oppFd + g.opponentFoulsDrawn,
      pt2in: acc.pt2in + g.pt2in,
      fb: acc.fb + g.fb,
      pt2nd: acc.pt2nd + g.pt2nd,
      pft: acc.pft + g.pft,
      dunks: acc.dunks + g.dunks,
      oppPt2in: acc.oppPt2in + g.opponentPt2in,
      oppFb: acc.oppFb + g.opponentFb,
      oppPt2nd: acc.oppPt2nd + g.opponentPt2nd,
      oppPft: acc.oppPft + g.opponentPft,
      oppDunks: acc.oppDunks + g.opponentDunks,
      technicalFouls: acc.technicalFouls + g.technicalFouls,
      basketCounts: acc.basketCounts + g.basketCounts,
      unsportsmanlikeFouls: acc.unsportsmanlikeFouls + g.unsportsmanlikeFouls,
      disqualifyingFouls: acc.disqualifyingFouls + g.disqualifyingFouls,
      assisted2m: acc.assisted2m + g.assisted2m,
      assisted3m: acc.assisted3m + g.assisted3m,
      assistedFtm: acc.assistedFtm + g.assistedFtm,
      paint2m: acc.paint2m + g.paint2m,
      paint2a: acc.paint2a + g.paint2a,
      mid2m: acc.mid2m + g.mid2m,
      mid2a: acc.mid2a + g.mid2a,
      oppTechnicalFouls: acc.oppTechnicalFouls + g.opponentTechnicalFouls,
      oppBasketCounts: acc.oppBasketCounts + g.opponentBasketCounts,
      oppUnsportsmanlikeFouls: acc.oppUnsportsmanlikeFouls + g.opponentUnsportsmanlikeFouls,
      oppDisqualifyingFouls: acc.oppDisqualifyingFouls + g.opponentDisqualifyingFouls,
      oppAssisted2m: acc.oppAssisted2m + g.opponentAssisted2m,
      oppAssisted3m: acc.oppAssisted3m + g.opponentAssisted3m,
      oppAssistedFtm: acc.oppAssistedFtm + g.opponentAssistedFtm,
      oppPaint2m: acc.oppPaint2m + g.opponentPaint2m,
      oppPaint2a: acc.oppPaint2a + g.opponentPaint2a,
      oppMid2m: acc.oppMid2m + g.opponentMid2m,
      oppMid2a: acc.oppMid2a + g.opponentMid2a,
    }),
    { ...EMPTY_TOTALS },
  );
}

export interface AllTeamsRow {
  team: { teamId: string; teamName: string };
  gamesPlayed: number;
  wins: number;
  losses: number;
  totals: TeamTotals;
}

export function scaledValue(total: number, gamesPlayed: number, mode: SeasonDisplayMode): number {
  return mode === "total" ? total : safeDiv(total, gamesPlayed);
}

// カウント系（試合数で割る/割らないをmodeが決める）。own/oppそれぞれのpickerを渡し、
// 自チーム/opp/+/-トグルに応じた値を返す。signed=trueの列（+/-等）は自チーム/opp表示も
// 符号付きにする
function countColumn(
  key: string,
  label: string,
  pickOwn: (t: TeamTotals) => number,
  pickOpp: (t: TeamTotals) => number,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  opts: { digits?: number; signed?: boolean } = {},
): Column<AllTeamsRow> {
  const { digits = 1, signed = false } = opts;
  const valueFor = (r: AllTeamsRow) =>
    perspectiveValue(
      scaledValue(pickOwn(r.totals), r.gamesPlayed, mode),
      scaledValue(pickOpp(r.totals), r.gamesPlayed, mode),
      perspective,
    );
  return {
    key,
    label,
    sortValue: valueFor,
    format: (r) => {
      const v = valueFor(r);
      const d = mode === "total" ? 0 : digits;
      return signed || perspective === "diff" ? formatSigned(v, d) : formatDecimal(v, d);
    },
  };
}

// 比率系（mode非依存）。own/oppそれぞれの計算式を渡す
function numberColumn(
  key: string,
  label: string,
  calcOwn: (t: TeamTotals) => number,
  calcOpp: (t: TeamTotals) => number,
  perspective: TeamPerspective,
  format: (v: number) => string,
  diffFormat: (v: number) => string,
): Column<AllTeamsRow> {
  const valueFor = (r: AllTeamsRow) => perspectiveValue(calcOwn(r.totals), calcOpp(r.totals), perspective);
  return {
    key,
    label,
    sortValue: valueFor,
    format: (r) => {
      const v = valueFor(r);
      return perspective === "diff" ? diffFormat(v) : format(v);
    },
  };
}

function pctColumn(
  key: string,
  label: string,
  calcOwn: (t: TeamTotals) => number,
  calcOpp: (t: TeamTotals) => number,
  perspective: TeamPerspective,
): Column<AllTeamsRow> {
  return numberColumn(key, label, calcOwn, calcOpp, perspective, (v) => formatPct(v), (v) => `${formatSigned(v * 100, 1)}%`);
}

function pct100Column(
  key: string,
  label: string,
  calcOwn: (t: TeamTotals) => number,
  calcOpp: (t: TeamTotals) => number,
  perspective: TeamPerspective,
): Column<AllTeamsRow> {
  return numberColumn(key, label, calcOwn, calcOpp, perspective, (v) => formatPct100(v), (v) => `${formatSigned(v, 1)}%`);
}

function decimalColumn(
  key: string,
  label: string,
  calcOwn: (t: TeamTotals) => number,
  calcOpp: (t: TeamTotals) => number,
  perspective: TeamPerspective,
  digits = 1,
): Column<AllTeamsRow> {
  return numberColumn(key, label, calcOwn, calcOpp, perspective, (v) => formatDecimal(v, digits), (v) => formatSigned(v, digits));
}

function signedColumn(
  key: string,
  label: string,
  calcOwn: (t: TeamTotals) => number,
  calcOpp: (t: TeamTotals) => number,
  perspective: TeamPerspective,
  digits = 1,
): Column<AllTeamsRow> {
  return numberColumn(key, label, calcOwn, calcOpp, perspective, (v) => formatSigned(v, digits), (v) => formatSigned(v, digits));
}

/** ショットチャート座標が無いシーズン向けの「-」固定列（%PAINT2M等）。DESIGN.md参照 */
function unavailableColumn(key: string, label: string): Column<AllTeamsRow> {
  return { key, label, sortValue: () => 0, format: () => "-" };
}

export function buildTraditionalColumns(mode: SeasonDisplayMode, perspective: TeamPerspective): Column<AllTeamsRow>[] {
  return [
    {
      key: "min",
      label: "MIN",
      sortValue: (r) => scaledValue(r.totals.min, r.gamesPlayed, mode),
      format: (r) => formatMinutesFromSeconds(Math.round(scaledValue(r.totals.min, r.gamesPlayed, mode) * 60)),
    },
    countColumn("pts", "PTS", (t) => t.pts, (t) => t.oppPts, mode, perspective),
    countColumn("fgm", "FGM", (t) => t.fgm, (t) => t.oppFgm, mode, perspective),
    countColumn("fga", "FGA", (t) => t.fga, (t) => t.oppFga, mode, perspective),
    pctColumn("fgpct", "FG%", (t) => safeDiv(t.fgm, t.fga), (t) => safeDiv(t.oppFgm, t.oppFga), perspective),
    countColumn("2pm", "2PM", (t) => t.fgm - t.tpm, (t) => t.oppFgm - t.oppTpm, mode, perspective),
    countColumn("2pa", "2PA", (t) => t.fga - t.tpa, (t) => t.oppFga - t.oppTpa, mode, perspective),
    pctColumn(
      "2ppct",
      "2P%",
      (t) => safeDiv(t.fgm - t.tpm, t.fga - t.tpa),
      (t) => safeDiv(t.oppFgm - t.oppTpm, t.oppFga - t.oppTpa),
      perspective,
    ),
    countColumn("3pm", "3PM", (t) => t.tpm, (t) => t.oppTpm, mode, perspective),
    countColumn("3pa", "3PA", (t) => t.tpa, (t) => t.oppTpa, mode, perspective),
    pctColumn("3ppct", "3P%", (t) => safeDiv(t.tpm, t.tpa), (t) => safeDiv(t.oppTpm, t.oppTpa), perspective),
    countColumn("ftm", "FTM", (t) => t.ftm, (t) => t.oppFtm, mode, perspective),
    countColumn("fta", "FTA", (t) => t.fta, (t) => t.oppFta, mode, perspective),
    pctColumn("ftpct", "FT%", (t) => safeDiv(t.ftm, t.fta), (t) => safeDiv(t.oppFtm, t.oppFta), perspective),
    pctColumn(
      "efg",
      "eFG%",
      (t) => efgPct(t.fgm, t.tpm, t.fga),
      (t) => efgPct(t.oppFgm, t.oppTpm, t.oppFga),
      perspective,
    ),
    pctColumn(
      "ts",
      "TS%",
      (t) => tsPct(t.pts, t.fga, t.fta),
      (t) => tsPct(t.oppPts, t.oppFga, t.oppFta),
      perspective,
    ),
    countColumn("or", "OR", (t) => t.oreb, (t) => t.oppOreb, mode, perspective),
    countColumn("dr", "DR", (t) => t.dreb, (t) => t.oppDreb, mode, perspective),
    countColumn("tr", "TR", (t) => t.reb, (t) => t.oppOreb + t.oppDreb, mode, perspective),
    countColumn("ast", "AST", (t) => t.ast, (t) => t.oppAst, mode, perspective),
    countColumn("tov", "TOV", (t) => t.tov, (t) => t.oppTov, mode, perspective),
    decimalColumn("asttov", "AST/TOV", (t) => safeDiv(t.ast, t.tov), (t) => safeDiv(t.oppAst, t.oppTov), perspective),
    countColumn("stl", "STL", (t) => t.stl, (t) => t.oppStl, mode, perspective),
    countColumn("blk", "BLK", (t) => t.blk, (t) => t.oppBlk, mode, perspective),
    countColumn("f", "F", (t) => t.pf, (t) => t.oppPf, mode, perspective),
    countColumn("fd", "FD", (t) => t.fd, (t) => t.oppFd, mode, perspective),
    countColumn("plusminus", "+/-", (t) => t.pts - t.oppPts, (t) => t.oppPts - t.pts, mode, perspective, { signed: true }),
  ];
}

export function buildAdvancedColumns(mode: SeasonDisplayMode, perspective: TeamPerspective): Column<AllTeamsRow>[] {
  return [
    pct100Column("tovpct", "TOV%", (t) => tovPct(t.tov, t.fga, t.fta), (t) => tovPct(t.oppTov, t.oppFga, t.oppFta), perspective),
    pctColumn("ftr", "FTR", (t) => ftRate(t.fta, t.fga), (t) => ftRate(t.oppFta, t.oppFga), perspective),
    pct100Column("orbpct", "OR%", (t) => orbPct(t.oreb, t.oppDreb), (t) => orbPct(t.oppOreb, t.dreb), perspective),
    pctColumn(
      "efg",
      "eFG%",
      (t) => efgPct(t.fgm, t.tpm, t.fga),
      (t) => efgPct(t.oppFgm, t.oppTpm, t.oppFga),
      perspective,
    ),
    pctColumn(
      "ts",
      "TS%",
      (t) => tsPct(t.pts, t.fga, t.fta),
      (t) => tsPct(t.oppPts, t.oppFga, t.oppFta),
      perspective,
    ),
    decimalColumn("pps", "PPS", (t) => safeDiv(t.pts, t.fga), (t) => safeDiv(t.oppPts, t.oppFga), perspective, 2),
    {
      key: "poss",
      label: "POSS",
      sortValue: (r) => scaledValue(r.totals.poss, r.gamesPlayed, mode),
      format: (r) => formatDecimal(scaledValue(r.totals.poss, r.gamesPlayed, mode), mode === "total" ? 0 : 1),
    },
    {
      key: "pace",
      label: "PACE",
      sortValue: (r) => pace(r.totals.poss, r.totals.min),
      format: (r) => formatDecimal(pace(r.totals.poss, r.totals.min)),
    },
    decimalColumn("ortg", "ORtg", (t) => offensiveRating(t.pts, t.poss), (t) => offensiveRating(t.oppPts, t.poss), perspective),
    decimalColumn("drtg", "DRtg", (t) => offensiveRating(t.oppPts, t.poss), (t) => offensiveRating(t.pts, t.poss), perspective),
    signedColumn(
      "netrtg",
      "NetRtg",
      (t) => offensiveRating(t.pts, t.poss) - offensiveRating(t.oppPts, t.poss),
      (t) => offensiveRating(t.oppPts, t.poss) - offensiveRating(t.pts, t.poss),
      perspective,
    ),
  ];
}

export function buildMiscColumns(mode: SeasonDisplayMode, perspective: TeamPerspective): Column<AllTeamsRow>[] {
  return [
    countColumn("pitp", "PITP", (t) => t.pt2in, (t) => t.oppPt2in, mode, perspective),
    countColumn("fbps", "FBPS", (t) => t.fb, (t) => t.oppFb, mode, perspective),
    countColumn("2ndpts", "2ND PTS", (t) => t.pt2nd, (t) => t.oppPt2nd, mode, perspective),
    countColumn("ptsofftov", "PTSOFFTO", (t) => t.pft, (t) => t.oppPft, mode, perspective),
    countColumn("dunk", "DUNK", (t) => t.dunks, (t) => t.oppDunks, mode, perspective),
    countColumn("tf", "TF", (t) => t.technicalFouls, (t) => t.oppTechnicalFouls, mode, perspective),
    countColumn("ufoul", "UFOUL", (t) => t.unsportsmanlikeFouls, (t) => t.oppUnsportsmanlikeFouls, mode, perspective),
    countColumn("dqfoul", "DQFOUL", (t) => t.disqualifyingFouls, (t) => t.oppDisqualifyingFouls, mode, perspective),
    countColumn("and1", "AND1", (t) => t.basketCounts, (t) => t.oppBasketCounts, mode, perspective),
    countColumn("ast2m", "AST2M", (t) => t.assisted2m, (t) => t.oppAssisted2m, mode, perspective),
    countColumn("ast3m", "AST3M", (t) => t.assisted3m, (t) => t.oppAssisted3m, mode, perspective),
    countColumn("astftm", "ASTFTM", (t) => t.assistedFtm, (t) => t.oppAssistedFtm, mode, perspective),
    pct100Column(
      "astpct",
      "AST%",
      (t) => safeDiv(100 * (t.assisted2m * 2 + t.assisted3m * 3 + t.assistedFtm), t.pts),
      (t) => safeDiv(100 * (t.oppAssisted2m * 2 + t.oppAssisted3m * 3 + t.oppAssistedFtm), t.oppPts),
      perspective,
    ),
  ];
}

// %PAINT2M/%PAINT2A/%MID2M/%MID2Aはショットチャート座標（X/Y/AreaCD）由来のため
// 2022-23シーズン以降のみ対応（paintSupported、呼び出し元でseasonから判定）
export function buildScoringColumns(perspective: TeamPerspective, paintSupported: boolean): Column<AllTeamsRow>[] {
  return [
    pct100Column("pitppct", "PITP%", (t) => safeDiv(100 * t.pt2in, t.pts), (t) => safeDiv(100 * t.oppPt2in, t.oppPts), perspective),
    pct100Column("fbppct", "FBP%", (t) => safeDiv(100 * t.fb, t.pts), (t) => safeDiv(100 * t.oppFb, t.oppPts), perspective),
    pct100Column(
      "2ndptspct",
      "2ND PTS%",
      (t) => safeDiv(100 * t.pt2nd, t.pts),
      (t) => safeDiv(100 * t.oppPt2nd, t.oppPts),
      perspective,
    ),
    pct100Column(
      "ptsofftovpct",
      "PTSOFFTO%",
      (t) => safeDiv(100 * t.pft, t.pts),
      (t) => safeDiv(100 * t.oppPft, t.oppPts),
      perspective,
    ),
    // ここから下は「自チーム/相手チームの全FGAに対する割合」（シュート選択構成比）。
    // 上記PITP%等（総得点に対する割合）とは分母が異なる別系統の指標
    pct100Column("pct3pm", "%3PM", (t) => safeDiv(100 * t.tpm, t.fga), (t) => safeDiv(100 * t.oppTpm, t.oppFga), perspective),
    pct100Column("pct3pa", "%3PA", (t) => safeDiv(100 * t.tpa, t.fga), (t) => safeDiv(100 * t.oppTpa, t.oppFga), perspective),
    paintSupported
      ? pct100Column(
          "pctpaint2m",
          "%PAINT2M",
          (t) => safeDiv(100 * t.paint2m, t.fga),
          (t) => safeDiv(100 * t.oppPaint2m, t.oppFga),
          perspective,
        )
      : unavailableColumn("pctpaint2m", "%PAINT2M"),
    paintSupported
      ? pct100Column(
          "pctpaint2a",
          "%PAINT2A",
          (t) => safeDiv(100 * t.paint2a, t.fga),
          (t) => safeDiv(100 * t.oppPaint2a, t.oppFga),
          perspective,
        )
      : unavailableColumn("pctpaint2a", "%PAINT2A"),
    paintSupported
      ? pct100Column(
          "pctmid2m",
          "%MID2M",
          (t) => safeDiv(100 * t.mid2m, t.fga),
          (t) => safeDiv(100 * t.oppMid2m, t.oppFga),
          perspective,
        )
      : unavailableColumn("pctmid2m", "%MID2M"),
    paintSupported
      ? pct100Column(
          "pctmid2a",
          "%MID2A",
          (t) => safeDiv(100 * t.mid2a, t.fga),
          (t) => safeDiv(100 * t.oppMid2a, t.oppFga),
          perspective,
        )
      : unavailableColumn("pctmid2a", "%MID2A"),
  ];
}

export const DEFAULT_SORT_KEY: Record<BoxscoreTabKey, string> = {
  traditional: "pts",
  advanced: "netrtg",
  misc: "pitp",
  scoring: "pitppct",
};
