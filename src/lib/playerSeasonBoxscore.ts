// 個人詳細ページ「スタッツ」タブのシーズン集計ボックススコア（GameDetailPageのBoxscoreTableと
// 同じ列構成をシーズン単位に転用したもの）。平均/合計/30分換算の3モードと、レギュラー
// シーズンのみ/プレーオフのみ/合算の3フィルタを掛け合わせて表示する。
//
// 列は原則PlayerGameLog（+ TeamGameLogとの突き合わせ）だけで算出できるものに絞っている。
// PTSOFFTO/DUNK/AND1/UFOUL/DQFOUL/被アシスト内訳/ペイント・ミッドレンジ分割は単純な合算値
// のため、aggregate.ts側でPlayByPlaysから試合単位に集計しPlayerGameLogへ永続化した上で
// ここで合算表示している（DESIGN.md参照）。POSS/PACE/ORtg/DRtg/NetRtgのみ、比率項を含む
// 非線形な計算式のためシーズン合算不可能（試合単位で確定させてから合算しないと誤差が出る）
// と判断し、引き続き「-」表示にしている

import {
  efgPct,
  individualDefRtg,
  individualOffRtg,
  safeDiv,
  tovPct,
  tsPct,
  usagePct,
  eff as effFormula,
  type EffTotals,
  type OliverBoxStats,
} from "../../shared/formulas";
import { astToTovRatio, formatAstToRatio, formatMinutesFromSeconds, sharePct } from "./boxscoreAggregate";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "./format";
import type { GameType, PlayerGameLog, TeamGameLog } from "../../shared/types";

export type SeasonDisplayMode = "total" | "perGame" | "per30";
export type SeasonGameTypeFilter = GameType | "both";

export const SEASON_DISPLAY_MODE_LABELS: Record<SeasonDisplayMode, string> = {
  perGame: "平均",
  total: "合計",
  per30: "30分換算",
};

export const SEASON_GAME_TYPE_LABELS: Record<SeasonGameTypeFilter, string> = {
  regular: "レギュラーシーズンのみ",
  playoff: "プレーオフのみ",
  both: "合算",
};

export function filterByGameType<T extends { gameType: GameType }>(logs: T[], filter: SeasonGameTypeFilter): T[] {
  if (filter === "both") return logs;
  return logs.filter((g) => g.gameType === filter);
}

export interface PlayerSeasonRawTotals {
  gamesPlayed: number;
  min: number;
  pts: number;
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
  foulsDrawn: number;
  blockedAgainst: number;
  technicalFouls: number;
  pt2in: number;
  ptfb: number;
  pt2nd: number;
  plusMinus: number;
  ptsOffTov: number;
  dunks: number;
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
  /** 在コート区間の推定ポゼッション合計（自チーム視点）。個人PACEの季集計にのみ使う。
   * coverage==="full"のシーズン（2022-23以降）以外は常に0（PlayerGameLog参照） */
  onCourtOwnPoss: number;
  onCourtOppPoss: number;
  onCourtSeconds: number;
}

const EMPTY_RAW_TOTALS: PlayerSeasonRawTotals = {
  gamesPlayed: 0,
  min: 0,
  pts: 0,
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
  foulsDrawn: 0,
  blockedAgainst: 0,
  technicalFouls: 0,
  pt2in: 0,
  ptfb: 0,
  pt2nd: 0,
  plusMinus: 0,
  ptsOffTov: 0,
  dunks: 0,
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
  onCourtOwnPoss: 0,
  onCourtOppPoss: 0,
  onCourtSeconds: 0,
};

/** min>0（実際に出場した試合）のみを対象に合算する。DNP行はgamesPlayedにも数えない */
export function sumPlayerGameLogs(logs: PlayerGameLog[]): PlayerSeasonRawTotals {
  const played = logs.filter((g) => g.min > 0);
  return played.reduce<PlayerSeasonRawTotals>(
    (acc, g) => ({
      gamesPlayed: acc.gamesPlayed + 1,
      min: acc.min + g.min,
      pts: acc.pts + g.pts,
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
      foulsDrawn: acc.foulsDrawn + g.foulsDrawn,
      blockedAgainst: acc.blockedAgainst + g.blockedAgainst,
      technicalFouls: acc.technicalFouls + g.technicalFouls,
      pt2in: acc.pt2in + g.pt2in,
      ptfb: acc.ptfb + g.ptfb,
      pt2nd: acc.pt2nd + g.pt2nd,
      plusMinus: acc.plusMinus + g.plusMinus,
      ptsOffTov: acc.ptsOffTov + g.ptsOffTov,
      dunks: acc.dunks + g.dunks,
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
      onCourtOwnPoss: acc.onCourtOwnPoss + g.onCourtOwnPoss,
      onCourtOppPoss: acc.onCourtOppPoss + g.onCourtOppPoss,
      onCourtSeconds: acc.onCourtSeconds + g.onCourtSeconds,
    }),
    { ...EMPTY_RAW_TOTALS },
  );
}

export interface TeamSeasonRawTotals {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  tov: number;
  min: number;
  /** 以下、個人ORtg/DRtg（Dean Oliver方式）の算出にのみ使う追加フィールド。DESIGN.md参照 */
  ast: number;
  oreb: number;
  dreb: number;
  stl: number;
  blk: number;
  pf: number;
  poss: number;
  /** 相手チームのボックススコア（DRtgの「opponent」役に必要な項目のみ） */
  opponentMin: number;
  opponentPts: number;
  opponentFgm: number;
  opponentFga: number;
  opponentFtm: number;
  opponentFta: number;
  opponentOreb: number;
  opponentDreb: number;
  opponentTov: number;
}

const EMPTY_TEAM_TOTALS: TeamSeasonRawTotals = {
  pts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  tov: 0,
  min: 0,
  ast: 0,
  oreb: 0,
  dreb: 0,
  stl: 0,
  blk: 0,
  pf: 0,
  poss: 0,
  opponentMin: 0,
  opponentPts: 0,
  opponentFgm: 0,
  opponentFga: 0,
  opponentFtm: 0,
  opponentFta: 0,
  opponentOreb: 0,
  opponentDreb: 0,
  opponentTov: 0,
};

/** USG%・%-shareスタッツの分母用に、選手が出場した試合と同じScheduleKeyだけを対象にチーム総計を合算する */
export function sumTeamGameLogsFor(logs: TeamGameLog[], scheduleKeys: Set<string>): TeamSeasonRawTotals {
  const matched = logs.filter((g) => scheduleKeys.has(g.scheduleKey));
  return matched.reduce<TeamSeasonRawTotals>(
    (acc, g) => ({
      pts: acc.pts + g.teamScore,
      fgm: acc.fgm + g.fgm,
      fga: acc.fga + g.fga,
      tpm: acc.tpm + g.tpm,
      tpa: acc.tpa + g.tpa,
      ftm: acc.ftm + g.ftm,
      fta: acc.fta + g.fta,
      tov: acc.tov + g.tov,
      min: acc.min + g.min,
      ast: acc.ast + g.ast,
      oreb: acc.oreb + g.oreb,
      dreb: acc.dreb + g.dreb,
      stl: acc.stl + g.stl,
      blk: acc.blk + g.blk,
      pf: acc.pf + g.pf,
      poss: acc.poss + g.poss,
      opponentMin: acc.opponentMin + g.opponentMin,
      opponentPts: acc.opponentPts + g.opponentScore,
      opponentFgm: acc.opponentFgm + g.opponentFgm,
      opponentFga: acc.opponentFga + g.opponentFga,
      opponentFtm: acc.opponentFtm + g.opponentFtm,
      opponentFta: acc.opponentFta + g.opponentFta,
      opponentOreb: acc.opponentOreb + g.opponentOreb,
      opponentDreb: acc.opponentDreb + g.opponentDreb,
      opponentTov: acc.opponentTov + g.opponentTov,
    }),
    { ...EMPTY_TEAM_TOTALS },
  );
}

/**
 * total/perGame/per30の係数。per30は「シーズン合計出場分をちょうど30分に正規化する」係数
 * （＝合計出場時間ベース。1試合あたりの平均を先に出してから再スケールするのではない）。
 * カウント系スタッツにはこの係数をそのまま掛ける。率系スタッツ（FG%等）は分子分母が同じ係数で
 * 相殺されるため常に生の合計値から計算すればよく、この係数は使わない
 */
export function modeFactor(raw: PlayerSeasonRawTotals, mode: SeasonDisplayMode): number {
  if (mode === "total") return 1;
  if (mode === "perGame") return raw.gamesPlayed > 0 ? 1 / raw.gamesPlayed : 0;
  return raw.min > 0 ? 30 / raw.min : 0;
}

function scaleTotals(raw: PlayerSeasonRawTotals, factor: number): PlayerSeasonRawTotals {
  return {
    gamesPlayed: raw.gamesPlayed,
    min: raw.min * factor,
    pts: raw.pts * factor,
    fgm: raw.fgm * factor,
    fga: raw.fga * factor,
    tpm: raw.tpm * factor,
    tpa: raw.tpa * factor,
    ftm: raw.ftm * factor,
    fta: raw.fta * factor,
    oreb: raw.oreb * factor,
    dreb: raw.dreb * factor,
    reb: raw.reb * factor,
    ast: raw.ast * factor,
    tov: raw.tov * factor,
    stl: raw.stl * factor,
    blk: raw.blk * factor,
    pf: raw.pf * factor,
    foulsDrawn: raw.foulsDrawn * factor,
    blockedAgainst: raw.blockedAgainst * factor,
    technicalFouls: raw.technicalFouls * factor,
    pt2in: raw.pt2in * factor,
    ptfb: raw.ptfb * factor,
    pt2nd: raw.pt2nd * factor,
    plusMinus: raw.plusMinus * factor,
    ptsOffTov: raw.ptsOffTov * factor,
    dunks: raw.dunks * factor,
    basketCounts: raw.basketCounts * factor,
    unsportsmanlikeFouls: raw.unsportsmanlikeFouls * factor,
    disqualifyingFouls: raw.disqualifyingFouls * factor,
    assisted2m: raw.assisted2m * factor,
    assisted3m: raw.assisted3m * factor,
    assistedFtm: raw.assistedFtm * factor,
    paint2m: raw.paint2m * factor,
    paint2a: raw.paint2a * factor,
    mid2m: raw.mid2m * factor,
    mid2a: raw.mid2a * factor,
    onCourtOwnPoss: raw.onCourtOwnPoss * factor,
    onCourtOppPoss: raw.onCourtOppPoss * factor,
    onCourtSeconds: raw.onCourtSeconds * factor,
  };
}

export interface SeasonBoxscoreCtx {
  /** 生の合計値（率系スタッツ・EFFの算出元） */
  raw: PlayerSeasonRawTotals;
  /** total/perGame/per30を適用したカウント系スタッツ表示用の値 */
  scaled: PlayerSeasonRawTotals;
  /** USG%・%-shareスタッツの分母（選手が出場した試合のみに絞ったチーム総計。常に生値） */
  team: TeamSeasonRawTotals;
  seasonStartYear: number;
}

export function buildSeasonBoxscoreCtx(
  raw: PlayerSeasonRawTotals,
  team: TeamSeasonRawTotals,
  mode: SeasonDisplayMode,
  seasonStartYear: number,
): SeasonBoxscoreCtx {
  return { raw, scaled: scaleTotals(raw, modeFactor(raw, mode)), team, seasonStartYear };
}

function effTotalsOf(raw: PlayerSeasonRawTotals): EffTotals {
  return {
    pts: raw.pts,
    ast: raw.ast,
    blk: raw.blk,
    stl: raw.stl,
    reb: raw.reb,
    tov: raw.tov,
    pf: raw.pf,
    fgm: raw.fgm,
    fga: raw.fga,
    ftm: raw.ftm,
    fta: raw.fta,
    foulsDrawn: raw.foulsDrawn,
    blockedAgainst: raw.blockedAgainst,
    technicalFouls: raw.technicalFouls,
  };
}

/** rawの合計値を使い、gamesPlayed=1でeff()を呼ぶことで「シーズン合計EFF」を得てから、
 * カウント系スタッツと同じ係数で表示モードに合わせてスケールする */
function scaledEff(ctx: SeasonBoxscoreCtx, mode: SeasonDisplayMode): number {
  const totalEff = effFormula(ctx.seasonStartYear, effTotalsOf(ctx.raw), 1);
  return totalEff * modeFactor(ctx.raw, mode);
}

/**
 * 指定シーズンの生合計値から「シーズン合計EFF」を求める（scaledEffのmode="total"相当）。
 * EFFは年度によって計算式自体が異なる（DESIGN.md参照）ため、複数シーズンを横断する
 * 「通算」行のEFFを求める際は、生カウント値を先に合算してから1回だけeff()を呼ぶのではなく、
 * シーズンごとに正しい式でこの関数を呼んでから結果を合算する必要がある（呼び出し側:
 * PlayerDetailPage.tsxのSeasonBreakdownTable参照）
 */
export function seasonTotalEff(raw: PlayerSeasonRawTotals, seasonStartYear: number): number {
  return effFormula(seasonStartYear, effTotalsOf(raw), 1);
}

/**
 * 個人ORtg/DRtg（Dean Oliver方式、Basketball-Reference準拠）は、試合ごとに計算してから
 * 合算するのではなく、シーズン合計値に対して式を1回だけ適用するのが正しい使い方だと判明した
 * （チームPOSSの式に含まれる比率項の非線形性の問題とは別物。DESIGN.md参照）。試合詳細ページの
 * `src/lib/boxscoreAggregate.ts`の`toOliverBox()`と同じフィールド対応で、シーズン合計の
 * raw値・team値をOliverBoxStatsに変換する
 */
function playerOliverBox(raw: PlayerSeasonRawTotals): OliverBoxStats {
  return {
    min: raw.min,
    fgm: raw.fgm,
    fga: raw.fga,
    fg3m: raw.tpm,
    ftm: raw.ftm,
    fta: raw.fta,
    pts: raw.pts,
    ast: raw.ast,
    oreb: raw.oreb,
    dreb: raw.dreb,
    tov: raw.tov,
    stl: raw.stl,
    blk: raw.blk,
    pf: raw.pf,
  };
}

function teamOliverBox(team: TeamSeasonRawTotals): OliverBoxStats {
  return {
    min: team.min,
    fgm: team.fgm,
    fga: team.fga,
    fg3m: team.tpm,
    ftm: team.ftm,
    fta: team.fta,
    pts: team.pts,
    ast: team.ast,
    oreb: team.oreb,
    dreb: team.dreb,
    tov: team.tov,
    stl: team.stl,
    blk: team.blk,
    pf: team.pf,
  };
}

/** DRtgの「opponent」役はmin/pts/fgm/fga/ftm/fta/oreb/dreb/tovの9項目のみ使う
 * （ast/fg3m/stl/blk/pfは式が参照しないため0で埋めてよい。shared/formulas.ts参照） */
function opponentOliverBox(team: TeamSeasonRawTotals): OliverBoxStats {
  return {
    min: team.opponentMin,
    fgm: team.opponentFgm,
    fga: team.opponentFga,
    fg3m: 0,
    ftm: team.opponentFtm,
    fta: team.opponentFta,
    pts: team.opponentPts,
    ast: 0,
    oreb: team.opponentOreb,
    dreb: team.opponentDreb,
    tov: team.opponentTov,
    stl: 0,
    blk: 0,
    pf: 0,
  };
}

function seasonOffRtg(c: SeasonBoxscoreCtx): number | undefined {
  return individualOffRtg(playerOliverBox(c.raw), teamOliverBox(c.team), opponentOliverBox(c.team));
}

function seasonDefRtg(c: SeasonBoxscoreCtx): number | undefined {
  return individualDefRtg(playerOliverBox(c.raw), teamOliverBox(c.team), opponentOliverBox(c.team), c.team.poss);
}

/**
 * 個人PACE（在コート区間ベース）。試合ごとに`shared/onCourt.ts`の`computeOnCourtRatings`で
 * 求めた区間の推定ポゼッション・在コート秒数を、そのままシーズン合計してから式を1回だけ
 * 適用する（チームPOSSと同じ「正しい値を積算してから式を適用する」パターン。DESIGN.md参照）。
 * onCourtSecondsが0（coverage!=="full"のシーズン、または当該選手の区間データが無い場合）は
 * 算出不能としてundefinedを返す
 */
function seasonPace(raw: PlayerSeasonRawTotals): number | undefined {
  if (raw.onCourtSeconds <= 0) return undefined;
  const onCourtMinutes = raw.onCourtSeconds / 60;
  return safeDiv(40 * ((raw.onCourtOwnPoss + raw.onCourtOppPoss) / 2), onCourtMinutes);
}

/** 合計モードでは小数第一位を四捨五入して整数表示にする（%が付く比率系スタッツはformatPct/
 * formatPct100を使うため対象外。平均モードは従来通り小数第一位のまま） */
export function countDigits(mode: SeasonDisplayMode): number {
  return mode === "total" ? 0 : 1;
}

const NA = "-";
/** ショットチャート座標（X/Y/AreaCD）が存在する最初のシーズン開始年。scripts/lib/seasonCoverage.tsの
 * 判定基準（startYear >= 2022 で"full"）と一致させる */
const MIN_SHOT_CHART_SEASON_START_YEAR = 2022;

export interface SeasonBoxscoreColumn {
  key: string;
  label: string;
  format: (ctx: SeasonBoxscoreCtx, mode: SeasonDisplayMode) => string;
  higherIsBetter?: boolean;
  description: string;
}

export const SEASON_TRADITIONAL_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), description: "試合数" },
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)), description: "出場時間" },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), description: "得点" },
  { key: "fgm", label: "FGM", format: (c, mode) => formatDecimal(c.scaled.fgm, countDigits(mode)), description: "フィールドゴール成功数" },
  { key: "fga", label: "FGA", format: (c, mode) => formatDecimal(c.scaled.fga, countDigits(mode)), description: "フィールドゴール試投数" },
  { key: "fgpct", label: "FG%", format: (c) => formatPct(safeDiv(c.raw.fgm, c.raw.fga)), description: "FGM / FGA" },
  {
    key: "2pm",
    label: "2PM",
    format: (c, mode) => formatDecimal(c.scaled.fgm - c.scaled.tpm, countDigits(mode)),
    description: "2P成功数",
  },
  {
    key: "2pa",
    label: "2PA",
    format: (c, mode) => formatDecimal(c.scaled.fga - c.scaled.tpa, countDigits(mode)),
    description: "2P試投数",
  },
  {
    key: "2ppct",
    label: "2P%",
    format: (c) => formatPct(safeDiv(c.raw.fgm - c.raw.tpm, c.raw.fga - c.raw.tpa)),
    description: "2PM / 2PA",
  },
  { key: "3pm", label: "3PM", format: (c, mode) => formatDecimal(c.scaled.tpm, countDigits(mode)), description: "3P成功数" },
  { key: "3pa", label: "3PA", format: (c, mode) => formatDecimal(c.scaled.tpa, countDigits(mode)), description: "3P試投数" },
  { key: "3ppct", label: "3P%", format: (c) => formatPct(safeDiv(c.raw.tpm, c.raw.tpa)), description: "3PM / 3PA" },
  { key: "ftm", label: "FTM", format: (c, mode) => formatDecimal(c.scaled.ftm, countDigits(mode)), description: "フリースロー成功数" },
  { key: "fta", label: "FTA", format: (c, mode) => formatDecimal(c.scaled.fta, countDigits(mode)), description: "フリースロー試投数" },
  { key: "ftpct", label: "FT%", format: (c) => formatPct(safeDiv(c.raw.ftm, c.raw.fta)), description: "FTM / FTA" },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.raw.fgm, c.raw.tpm, c.raw.fga)),
    description: "(FGM + 0.5×3PM) / FGA",
  },
  { key: "ts", label: "TS%", format: (c) => formatPct(tsPct(c.raw.pts, c.raw.fga, c.raw.fta)), description: "PTS / (2 × (FGA + 0.44×FTA))" },
  { key: "or", label: "OR", format: (c, mode) => formatDecimal(c.scaled.oreb, countDigits(mode)), description: "オフェンスリバウンド" },
  { key: "dr", label: "DR", format: (c, mode) => formatDecimal(c.scaled.dreb, countDigits(mode)), description: "ディフェンスリバウンド" },
  { key: "tr", label: "TR", format: (c, mode) => formatDecimal(c.scaled.reb, countDigits(mode)), description: "OREB + DREB" },
  { key: "ast", label: "AST", format: (c, mode) => formatDecimal(c.scaled.ast, countDigits(mode)), description: "アシスト" },
  {
    key: "tov",
    label: "TOV",
    format: (c, mode) => formatDecimal(c.scaled.tov, countDigits(mode)),
    higherIsBetter: false,
    description: "ターンオーバー",
  },
  {
    key: "asttov",
    label: "AST/TOV",
    format: (c) => formatAstToRatio(c.raw.ast, c.raw.tov),
    description: "AST / TOV（TOV=0の場合はAST数をそのまま比率として使う）",
  },
  { key: "stl", label: "STL", format: (c, mode) => formatDecimal(c.scaled.stl, countDigits(mode)), description: "スティール" },
  { key: "blk", label: "BLK", format: (c, mode) => formatDecimal(c.scaled.blk, countDigits(mode)), description: "ブロック" },
  {
    key: "bsr",
    label: "BSR",
    format: (c, mode) => formatDecimal(c.scaled.blockedAgainst, countDigits(mode)),
    higherIsBetter: false,
    description: "被ブロック数",
  },
  {
    key: "f",
    label: "F",
    format: (c, mode) => formatDecimal(c.scaled.pf, countDigits(mode)),
    higherIsBetter: false,
    description: "ファウル数",
  },
  {
    key: "fd",
    label: "FD",
    format: (c, mode) => formatDecimal(c.scaled.foulsDrawn, countDigits(mode)),
    description: "被ファウル数（ファウルを誘発した回数）",
  },
  { key: "eff", label: "EFF", format: (c, mode) => formatDecimal(scaledEff(c, mode), countDigits(mode)), description: "Bリーグ公式の総合貢献度指標" },
  { key: "plusminus", label: "+/-", format: (c, mode) => formatSigned(c.scaled.plusMinus, countDigits(mode)), description: "プラスマイナス" },
];

export const SEASON_ADVANCED_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), description: "試合数" },
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)), description: "出場時間" },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), description: "得点" },
  { key: "eff", label: "EFF", format: (c, mode) => formatDecimal(scaledEff(c, mode), countDigits(mode)), description: "Bリーグ公式の総合貢献度指標" },
  {
    key: "usg",
    label: "USG%",
    format: (c) =>
      formatPct100(
        usagePct(
          { fga: c.raw.fga, fta: c.raw.fta, tov: c.raw.tov, min: c.raw.min },
          { fga: c.team.fga, fta: c.team.fta, tov: c.team.tov, min: c.team.min },
        ),
      ),
    description: "自分が関与したプレー（FGA・FTA・TOV）の、出場中のチーム全体に占める割合",
  },
  {
    key: "tovpct",
    label: "TOV%",
    format: (c) => formatPct100(tovPct(c.raw.tov, c.raw.fga, c.raw.fta)),
    higherIsBetter: false,
    description: "100 × TOV / (FGA + 0.44×FTA + TOV)",
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.raw.fgm, c.raw.tpm, c.raw.fga)),
    description: "(FGM + 0.5×3PM) / FGA",
  },
  { key: "ts", label: "TS%", format: (c) => formatPct(tsPct(c.raw.pts, c.raw.fga, c.raw.fta)), description: "PTS / (2 × (FGA + 0.44×FTA))" },
  { key: "pps", label: "PPS", format: (c) => formatDecimal(safeDiv(c.raw.pts, c.raw.fga), 2), description: "PTS / FGA" },
  {
    key: "poss",
    label: "POSS",
    format: () => NA,
    description: "個人POSSという概念は無いため非対応（チーム合計行専用の概念。DESIGN.md参照）",
  },
  {
    key: "pace",
    label: "PACE",
    format: (c) => {
      const v = seasonPace(c.raw);
      return v !== undefined ? formatDecimal(v, 1) : NA;
    },
    description:
      "在コート区間ベース（試合ごとの推定ポゼッションをシーズン合計してから算出）。coverage=\"full\"のシーズン（2022-23以降）のみ対応",
  },
  {
    key: "ortg",
    label: "ORtg",
    format: (c) => {
      const v = seasonOffRtg(c);
      return v !== undefined ? formatDecimal(v, 1) : NA;
    },
    description: "個人ORtg（Dean Oliver方式）。シーズン合計値に式を1回だけ適用する（Basketball-Reference準拠）",
  },
  {
    key: "drtg",
    label: "DRtg",
    format: (c) => {
      const v = seasonDefRtg(c);
      return v !== undefined ? formatDecimal(v, 1) : NA;
    },
    higherIsBetter: false,
    description: "個人DRtg（Dean Oliver方式）。シーズン合計値に式を1回だけ適用する（Basketball-Reference準拠）",
  },
  {
    key: "netrtg",
    label: "NetRtg",
    format: (c) => {
      const off = seasonOffRtg(c);
      const def = seasonDefRtg(c);
      return off !== undefined && def !== undefined ? formatSigned(off - def, 1) : NA;
    },
    description: "ORtg − DRtg",
  },
  { key: "plusminus", label: "+/-", format: (c, mode) => formatSigned(c.scaled.plusMinus, countDigits(mode)), description: "プラスマイナス" },
];

export const SEASON_MISC_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), description: "試合数" },
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)), description: "出場時間" },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), description: "得点" },
  {
    key: "pitp",
    label: "PITP",
    format: (c, mode) => formatDecimal(c.scaled.pt2in, countDigits(mode)),
    description: "ペイント内での得点（Points in the Paint）",
  },
  {
    key: "fbps",
    label: "FBPS",
    format: (c, mode) => formatDecimal(c.scaled.ptfb, countDigits(mode)),
    description: "ファストブレイクによる得点（Fastbreak Points）",
  },
  {
    key: "2ndpts",
    label: "2ND PTS",
    format: (c, mode) => formatDecimal(c.scaled.pt2nd, countDigits(mode)),
    description: "セカンドチャンスによる得点",
  },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (c, mode) => formatDecimal(c.scaled.ptsOffTov, countDigits(mode)),
    description: "ターンオーバーからの得点（PlayTextの公式判定タグ集計。2016-17シーズンはタグ自体が存在せず常に0）",
  },
  { key: "dunk", label: "DUNK", format: (c, mode) => formatDecimal(c.scaled.dunks, countDigits(mode)), description: "ダンク成功数" },
  {
    key: "and1",
    label: "AND1",
    format: (c, mode) => formatDecimal(c.scaled.basketCounts, countDigits(mode)),
    description: "バスケットカウント（アンドワン）数",
  },
  {
    key: "ufoul",
    label: "UFOUL",
    format: (c, mode) => formatDecimal(c.scaled.unsportsmanlikeFouls, countDigits(mode)),
    description: "アンスポーツマンファウル数",
  },
  {
    key: "dqfoul",
    label: "DQFOUL",
    format: (c, mode) => formatDecimal(c.scaled.disqualifyingFouls, countDigits(mode)),
    description: "ディスクォリファイングファウル数",
  },
  {
    key: "ast2m",
    label: "AST2M",
    format: (c, mode) => formatDecimal(c.scaled.assisted2m, countDigits(mode)),
    description: "アシストされた2P成功数",
  },
  {
    key: "ast3m",
    label: "AST3M",
    format: (c, mode) => formatDecimal(c.scaled.assisted3m, countDigits(mode)),
    description: "アシストされた3P成功数",
  },
  {
    key: "astftm",
    label: "ASTFTM",
    format: (c, mode) => formatDecimal(c.scaled.assistedFtm, countDigits(mode)),
    description: "アシストされたFT成功数",
  },
  {
    key: "astpct",
    label: "AST%",
    format: (c) =>
      formatPct100(safeDiv(c.raw.assisted2m * 2 + c.raw.assisted3m * 3 + c.raw.assistedFtm, c.raw.pts)),
    description: "(アシストされた2Mx2 + 3Mx3 + FTMx1) / PTS。得点のうちアシストが付いた割合",
  },
];

export const SEASON_SCORING_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), description: "試合数" },
  { key: "min", label: "MIN", format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)), description: "出場時間" },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), description: "得点" },
  { key: "pctpts", label: "%PTS", format: (c) => formatPct100(sharePct(c.raw.pts, c.team.pts)), description: "チーム総得点に占める割合" },
  { key: "pctfgm", label: "%FGM", format: (c) => formatPct100(sharePct(c.raw.fgm, c.team.fgm)), description: "チーム総FGMに占める割合" },
  { key: "pctfga", label: "%FGA", format: (c) => formatPct100(sharePct(c.raw.fga, c.team.fga)), description: "チーム総FGAに占める割合" },
  { key: "pct3pm", label: "%3PM", format: (c) => formatPct100(sharePct(c.raw.tpm, c.team.tpm)), description: "チーム総3PMに占める割合" },
  { key: "pct3pa", label: "%3PA", format: (c) => formatPct100(sharePct(c.raw.tpa, c.team.tpa)), description: "チーム総3PAに占める割合" },
  { key: "pctftm", label: "%FTM", format: (c) => formatPct100(sharePct(c.raw.ftm, c.team.ftm)), description: "チーム総FTMに占める割合" },
  { key: "pctfta", label: "%FTA", format: (c) => formatPct100(sharePct(c.raw.fta, c.team.fta)), description: "チーム総FTAに占める割合" },
  {
    key: "paint2m",
    label: "PAINT2M",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.paint2m, countDigits(mode)) : NA,
    description: "ペイント内2P成功数（ショットチャート座標由来。2022-23シーズン以降のみ対応）",
  },
  {
    key: "paint2a",
    label: "PAINT2A",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.paint2a, countDigits(mode)) : NA,
    description: "ペイント内2P試投数（同上、2022-23シーズン以降のみ対応）",
  },
  {
    key: "paint2pct",
    label: "PAINT2%",
    format: (c) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatPct(safeDiv(c.raw.paint2m, c.raw.paint2a)) : NA,
    description: "PAINT2M / PAINT2A（2022-23シーズン以降のみ対応）",
  },
  {
    key: "mid2m",
    label: "MID2M",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.mid2m, countDigits(mode)) : NA,
    description: "ミッドレンジ（ペイント外）2P成功数（ショットチャート座標由来。2022-23シーズン以降のみ対応）",
  },
  {
    key: "mid2a",
    label: "MID2A",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.mid2a, countDigits(mode)) : NA,
    description: "ミッドレンジ（ペイント外）2P試投数（同上、2022-23シーズン以降のみ対応）",
  },
  {
    key: "mid2pct",
    label: "MID2%",
    format: (c) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatPct(safeDiv(c.raw.mid2m, c.raw.mid2a)) : NA,
    description: "MID2M / MID2A（2022-23シーズン以降のみ対応）",
  },
];
