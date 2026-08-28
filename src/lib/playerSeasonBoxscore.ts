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
  offensiveRating,
  pace,
  safeDiv,
  tovPct,
  tsPct,
  usagePct,
  eff as effFormula,
  type EffTotals,
  type OliverBoxStats,
} from "../../shared/formulas";
import {
  astToTovRatio,
  buildPlayTypeCounts,
  buildPlayerBoxscores,
  buildTeamTotalCounts,
  computeTeamRatings,
  countTeamGeneratedTechnicalFouls,
  formatAstToRatio,
  formatMinutesFromSeconds,
  scaleCounts,
  sharePct,
  sumCountsList,
  type BoxscoreCounts,
  type PlayTypeCounts,
} from "./boxscoreAggregate";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "./format";
import { buildPeriodRangeOptions, type PeriodRangeOption } from "./periodRange";
import type { GameType, PlayerGameLog, StoredGame, TeamGameLog, YahooTurnoverEvent } from "../../shared/types";
import { computeTeamSituationalStats, type GameTeamInfo, type TeamSituationalStats } from "./situational";
import { teamShortName } from "../../shared/teamNames";
import type { ColumnCtx } from "../components/BoxscoreTable";

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

export const EMPTY_TEAM_TOTALS: TeamSeasonRawTotals = {
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

export function sumTeamSeasonTotals(a: TeamSeasonRawTotals, b: TeamSeasonRawTotals): TeamSeasonRawTotals {
  return {
    pts: a.pts + b.pts,
    fgm: a.fgm + b.fgm,
    fga: a.fga + b.fga,
    tpm: a.tpm + b.tpm,
    tpa: a.tpa + b.tpa,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
    tov: a.tov + b.tov,
    min: a.min + b.min,
    ast: a.ast + b.ast,
    oreb: a.oreb + b.oreb,
    dreb: a.dreb + b.dreb,
    stl: a.stl + b.stl,
    blk: a.blk + b.blk,
    pf: a.pf + b.pf,
    poss: a.poss + b.poss,
    opponentMin: a.opponentMin + b.opponentMin,
    opponentPts: a.opponentPts + b.opponentPts,
    opponentFgm: a.opponentFgm + b.opponentFgm,
    opponentFga: a.opponentFga + b.opponentFga,
    opponentFtm: a.opponentFtm + b.opponentFtm,
    opponentFta: a.opponentFta + b.opponentFta,
    opponentOreb: a.opponentOreb + b.opponentOreb,
    opponentDreb: a.opponentDreb + b.opponentDreb,
    opponentTov: a.opponentTov + b.opponentTov,
  };
}

export interface TeamSplitRow {
  key: string;
  teamId: string | null;
  /** チーム略称（teamShortName）。所属チームが解決できなかった場合は"-"、複数チームにまたがる
   * 合計行は「複数チーム」 */
  teamLabel: string;
  ctx: SeasonBoxscoreCtx;
  /** その行の元になった試合ログ（DD/TD等、ctxに含まれない値の算出に呼び出し側が使う） */
  logs: PlayerGameLog[];
  /** 複数チームにまたがる合計行かどうか。通算集計（総計行）はisCombinedがtrueの行、または
   * 単一チームの行のみを対象にする（チーム別の内訳行を二重に足し込まないため） */
  isCombined: boolean;
}

/**
 * 試合ログを、試合ログから動的に導出した所属チーム（resolveOwnTeam）ごとに分割する
 * （シーズン内移籍対応。個人詳細ページ「シーズン別成績」「シチュエーション別成績」・
 * チーム詳細ページ「選手スタッツ」共通のロジック。DESIGN.md参照）。
 * 1チームのみでプレーした場合は1行のみ、複数チームにまたがる場合はチーム別の行に加えて
 * 「複数チーム」の合計行を返す。DNP（出場0分）の試合は所属チームの判定対象から除く
 */
export function buildTeamSplitRows(
  keyPrefix: string,
  logs: PlayerGameLog[],
  ownTeamByScheduleKey: Map<string, GameTeamInfo>,
  teamTotalsByTeamId: Map<string, TeamSeasonRawTotals>,
  displayMode: SeasonDisplayMode,
  seasonStartYear: number,
): TeamSplitRow[] {
  const played = logs.filter((g) => g.min > 0);
  if (played.length === 0) return [];

  const byTeam = new Map<string, { teamName: string; logs: PlayerGameLog[] }>();
  for (const log of played) {
    const own = ownTeamByScheduleKey.get(log.scheduleKey);
    const id = own?.teamId ?? "unknown";
    let entry = byTeam.get(id);
    if (!entry) {
      entry = { teamName: own?.teamName ?? "", logs: [] };
      byTeam.set(id, entry);
    }
    entry.logs.push(log);
  }
  const teamIds = [...byTeam.keys()];
  const buildCtx = (teamLogs: PlayerGameLog[], team: TeamSeasonRawTotals) =>
    buildSeasonBoxscoreCtx(sumPlayerGameLogs(teamLogs), team, displayMode, seasonStartYear);
  const labelFor = (id: string, teamName: string) => (id === "unknown" ? "-" : teamShortName(id, teamName));

  if (teamIds.length === 1) {
    const id = teamIds[0]!;
    const entry = byTeam.get(id)!;
    const team = teamTotalsByTeamId.get(id) ?? EMPTY_TEAM_TOTALS;
    return [
      {
        key: `${keyPrefix}|${id}`,
        teamId: id === "unknown" ? null : id,
        teamLabel: labelFor(id, entry.teamName),
        ctx: buildCtx(entry.logs, team),
        logs: entry.logs,
        isCombined: false,
      },
    ];
  }

  const rows: TeamSplitRow[] = teamIds.map((id) => {
    const entry = byTeam.get(id)!;
    const team = teamTotalsByTeamId.get(id) ?? EMPTY_TEAM_TOTALS;
    return {
      key: `${keyPrefix}|${id}`,
      teamId: id === "unknown" ? null : id,
      teamLabel: labelFor(id, entry.teamName),
      ctx: buildCtx(entry.logs, team),
      logs: entry.logs,
      isCombined: false,
    };
  });
  const combinedTeam = teamIds.reduce(
    (acc, id) => sumTeamSeasonTotals(acc, teamTotalsByTeamId.get(id) ?? EMPTY_TEAM_TOTALS),
    EMPTY_TEAM_TOTALS,
  );
  rows.push({
    key: `${keyPrefix}|combined`,
    teamId: null,
    teamLabel: "複数チーム",
    ctx: buildCtx(played, combinedTeam),
    logs: played,
    isCombined: true,
  });
  return rows;
}

/**
 * ダブルダブル/トリプルダブル判定（scripts/aggregate.tsのprocessPlayers()・
 * src/lib/boxscoreAggregate.tsのcomputeStatBadge()と同じ閾値: PTS/REB/AST/STL/BLKのうち
 * 2桁到達部門数が2以上でDD、3以上でTD）。トリプルダブルはダブルダブルの条件も満たすため、
 * aggregate.tsの季集計と同じくDD側にも計上する（バッジ表示のような排他処理はしない）
 */
export function countDoubleTripleDoubles(logs: PlayerGameLog[]): { dd: number; td: number } {
  let dd = 0;
  let td = 0;
  for (const g of logs) {
    const doubleDigitCount = [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;
    if (doubleDigitCount >= 2) dd += 1;
    if (doubleDigitCount >= 3) td += 1;
  }
  return { dd, td };
}

export type SeasonBoxTabKey = "traditional" | "advanced" | "misc" | "scoring";

export const SEASON_BOX_TABS: { key: SeasonBoxTabKey; label: string }[] = [
  { key: "traditional", label: "トラディショナル" },
  { key: "advanced", label: "アドバンスド" },
  { key: "misc", label: "Misc" },
  { key: "scoring", label: "スコアリング" },
];

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

function usgPctOf(c: SeasonBoxscoreCtx): number {
  return usagePct(
    { fga: c.raw.fga, fta: c.raw.fta, tov: c.raw.tov, min: c.raw.min },
    { fga: c.team.fga, fta: c.team.fta, tov: c.team.tov, min: c.team.min },
  );
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
  /** ソート専用の数値アクセサ。formatが返す文字列表現（MM:SS・%・"-"等）とは別に、
   * 列ヘッダークリックソート用の生の数値を返す（PlayerDetailPage.tsxのSortableTable参照）。
   * 算出不能（"-"表示）な場合は0を返す（PPP等、既存の未定義値の扱いと同じ方針） */
  value: (ctx: SeasonBoxscoreCtx, mode: SeasonDisplayMode) => number;
  higherIsBetter?: boolean;
  description: string;
}

export const SEASON_TRADITIONAL_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), value: (c) => c.raw.gamesPlayed, description: "試合数" },
  {
    key: "min",
    label: "MIN",
    format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)),
    value: (c) => c.scaled.min,
    description: "出場時間",
  },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), value: (c) => c.scaled.pts, description: "得点" },
  {
    key: "fgm",
    label: "FGM",
    format: (c, mode) => formatDecimal(c.scaled.fgm, countDigits(mode)),
    value: (c) => c.scaled.fgm,
    description: "フィールドゴール成功数",
  },
  {
    key: "fga",
    label: "FGA",
    format: (c, mode) => formatDecimal(c.scaled.fga, countDigits(mode)),
    value: (c) => c.scaled.fga,
    description: "フィールドゴール試投数",
  },
  {
    key: "fgpct",
    label: "FG%",
    format: (c) => formatPct(safeDiv(c.raw.fgm, c.raw.fga)),
    value: (c) => safeDiv(c.raw.fgm, c.raw.fga),
    description: "FGM / FGA",
  },
  {
    key: "2pm",
    label: "2PM",
    format: (c, mode) => formatDecimal(c.scaled.fgm - c.scaled.tpm, countDigits(mode)),
    value: (c) => c.scaled.fgm - c.scaled.tpm,
    description: "2P成功数",
  },
  {
    key: "2pa",
    label: "2PA",
    format: (c, mode) => formatDecimal(c.scaled.fga - c.scaled.tpa, countDigits(mode)),
    value: (c) => c.scaled.fga - c.scaled.tpa,
    description: "2P試投数",
  },
  {
    key: "2ppct",
    label: "2P%",
    format: (c) => formatPct(safeDiv(c.raw.fgm - c.raw.tpm, c.raw.fga - c.raw.tpa)),
    value: (c) => safeDiv(c.raw.fgm - c.raw.tpm, c.raw.fga - c.raw.tpa),
    description: "2PM / 2PA",
  },
  {
    key: "3pm",
    label: "3PM",
    format: (c, mode) => formatDecimal(c.scaled.tpm, countDigits(mode)),
    value: (c) => c.scaled.tpm,
    description: "3P成功数",
  },
  {
    key: "3pa",
    label: "3PA",
    format: (c, mode) => formatDecimal(c.scaled.tpa, countDigits(mode)),
    value: (c) => c.scaled.tpa,
    description: "3P試投数",
  },
  {
    key: "3ppct",
    label: "3P%",
    format: (c) => formatPct(safeDiv(c.raw.tpm, c.raw.tpa)),
    value: (c) => safeDiv(c.raw.tpm, c.raw.tpa),
    description: "3PM / 3PA",
  },
  {
    key: "ftm",
    label: "FTM",
    format: (c, mode) => formatDecimal(c.scaled.ftm, countDigits(mode)),
    value: (c) => c.scaled.ftm,
    description: "フリースロー成功数",
  },
  {
    key: "fta",
    label: "FTA",
    format: (c, mode) => formatDecimal(c.scaled.fta, countDigits(mode)),
    value: (c) => c.scaled.fta,
    description: "フリースロー試投数",
  },
  {
    key: "ftpct",
    label: "FT%",
    format: (c) => formatPct(safeDiv(c.raw.ftm, c.raw.fta)),
    value: (c) => safeDiv(c.raw.ftm, c.raw.fta),
    description: "FTM / FTA",
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.raw.fgm, c.raw.tpm, c.raw.fga)),
    value: (c) => efgPct(c.raw.fgm, c.raw.tpm, c.raw.fga),
    description: "(FGM + 0.5×3PM) / FGA",
  },
  {
    key: "ts",
    label: "TS%",
    format: (c) => formatPct(tsPct(c.raw.pts, c.raw.fga, c.raw.fta)),
    value: (c) => tsPct(c.raw.pts, c.raw.fga, c.raw.fta),
    description: "PTS / (2 × (FGA + 0.44×FTA))",
  },
  {
    key: "or",
    label: "OR",
    format: (c, mode) => formatDecimal(c.scaled.oreb, countDigits(mode)),
    value: (c) => c.scaled.oreb,
    description: "オフェンスリバウンド",
  },
  {
    key: "dr",
    label: "DR",
    format: (c, mode) => formatDecimal(c.scaled.dreb, countDigits(mode)),
    value: (c) => c.scaled.dreb,
    description: "ディフェンスリバウンド",
  },
  {
    key: "tr",
    label: "TR",
    format: (c, mode) => formatDecimal(c.scaled.reb, countDigits(mode)),
    value: (c) => c.scaled.reb,
    description: "OREB + DREB",
  },
  {
    key: "ast",
    label: "AST",
    format: (c, mode) => formatDecimal(c.scaled.ast, countDigits(mode)),
    value: (c) => c.scaled.ast,
    description: "アシスト",
  },
  {
    key: "tov",
    label: "TOV",
    format: (c, mode) => formatDecimal(c.scaled.tov, countDigits(mode)),
    value: (c) => c.scaled.tov,
    higherIsBetter: false,
    description: "ターンオーバー",
  },
  {
    key: "asttov",
    label: "AST/TOV",
    format: (c) => formatAstToRatio(c.raw.ast, c.raw.tov),
    value: (c) => astToTovRatio(c.raw.ast, c.raw.tov),
    description: "AST / TOV（TOV=0の場合はAST数をそのまま比率として使う）",
  },
  {
    key: "stl",
    label: "STL",
    format: (c, mode) => formatDecimal(c.scaled.stl, countDigits(mode)),
    value: (c) => c.scaled.stl,
    description: "スティール",
  },
  {
    key: "blk",
    label: "BLK",
    format: (c, mode) => formatDecimal(c.scaled.blk, countDigits(mode)),
    value: (c) => c.scaled.blk,
    description: "ブロック",
  },
  {
    key: "bsr",
    label: "BSR",
    format: (c, mode) => formatDecimal(c.scaled.blockedAgainst, countDigits(mode)),
    value: (c) => c.scaled.blockedAgainst,
    higherIsBetter: false,
    description: "被ブロック数",
  },
  {
    key: "f",
    label: "F",
    format: (c, mode) => formatDecimal(c.scaled.pf, countDigits(mode)),
    value: (c) => c.scaled.pf,
    higherIsBetter: false,
    description: "ファウル数",
  },
  {
    key: "fd",
    label: "FD",
    format: (c, mode) => formatDecimal(c.scaled.foulsDrawn, countDigits(mode)),
    value: (c) => c.scaled.foulsDrawn,
    description: "被ファウル数（ファウルを誘発した回数）",
  },
  {
    key: "eff",
    label: "EFF",
    format: (c, mode) => formatDecimal(scaledEff(c, mode), countDigits(mode)),
    value: (c, mode) => scaledEff(c, mode),
    description: "Bリーグ公式の総合貢献度指標",
  },
  {
    key: "plusminus",
    label: "+/-",
    format: (c, mode) => formatSigned(c.scaled.plusMinus, countDigits(mode)),
    value: (c) => c.scaled.plusMinus,
    description: "プラスマイナス",
  },
];

export const SEASON_ADVANCED_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), value: (c) => c.raw.gamesPlayed, description: "試合数" },
  {
    key: "min",
    label: "MIN",
    format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)),
    value: (c) => c.scaled.min,
    description: "出場時間",
  },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), value: (c) => c.scaled.pts, description: "得点" },
  {
    key: "usg",
    label: "USG%",
    format: (c) => formatPct100(usgPctOf(c)),
    value: (c) => usgPctOf(c),
    description: "自分が関与したプレー（FGA・FTA・TOV）の、出場中のチーム全体に占める割合",
  },
  {
    key: "tovpct",
    label: "TOV%",
    format: (c) => formatPct100(tovPct(c.raw.tov, c.raw.fga, c.raw.fta)),
    value: (c) => tovPct(c.raw.tov, c.raw.fga, c.raw.fta),
    higherIsBetter: false,
    description: "100 × TOV / (FGA + 0.44×FTA + TOV)",
  },
  {
    key: "efg",
    label: "eFG%",
    format: (c) => formatPct(efgPct(c.raw.fgm, c.raw.tpm, c.raw.fga)),
    value: (c) => efgPct(c.raw.fgm, c.raw.tpm, c.raw.fga),
    description: "(FGM + 0.5×3PM) / FGA",
  },
  {
    key: "ts",
    label: "TS%",
    format: (c) => formatPct(tsPct(c.raw.pts, c.raw.fga, c.raw.fta)),
    value: (c) => tsPct(c.raw.pts, c.raw.fga, c.raw.fta),
    description: "PTS / (2 × (FGA + 0.44×FTA))",
  },
  {
    key: "pps",
    label: "PPS",
    format: (c) => formatDecimal(safeDiv(c.raw.pts, c.raw.fga), 2),
    value: (c) => safeDiv(c.raw.pts, c.raw.fga),
    description: "PTS / FGA",
  },
  {
    key: "poss",
    label: "POSS",
    format: () => NA,
    value: () => 0,
    description: "個人POSSという概念は無いため非対応（チーム合計行専用の概念。DESIGN.md参照）",
  },
  {
    key: "pace",
    label: "PACE",
    format: (c) => {
      const v = seasonPace(c.raw);
      return v !== undefined ? formatDecimal(v, 1) : NA;
    },
    value: (c) => seasonPace(c.raw) ?? 0,
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
    value: (c) => seasonOffRtg(c) ?? 0,
    description: "個人ORtg（Dean Oliver方式）。シーズン合計値に式を1回だけ適用する（Basketball-Reference準拠）",
  },
  {
    key: "drtg",
    label: "DRtg",
    format: (c) => {
      const v = seasonDefRtg(c);
      return v !== undefined ? formatDecimal(v, 1) : NA;
    },
    value: (c) => seasonDefRtg(c) ?? 0,
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
    value: (c) => {
      const off = seasonOffRtg(c);
      const def = seasonDefRtg(c);
      return off !== undefined && def !== undefined ? off - def : 0;
    },
    description: "ORtg − DRtg",
  },
  {
    key: "plusminus",
    label: "+/-",
    format: (c, mode) => formatSigned(c.scaled.plusMinus, countDigits(mode)),
    value: (c) => c.scaled.plusMinus,
    description: "プラスマイナス",
  },
];

export const SEASON_MISC_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), value: (c) => c.raw.gamesPlayed, description: "試合数" },
  {
    key: "min",
    label: "MIN",
    format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)),
    value: (c) => c.scaled.min,
    description: "出場時間",
  },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), value: (c) => c.scaled.pts, description: "得点" },
  {
    key: "pitp",
    label: "PITP",
    format: (c, mode) => formatDecimal(c.scaled.pt2in, countDigits(mode)),
    value: (c) => c.scaled.pt2in,
    description: "ペイント内での得点（Points in the Paint）",
  },
  {
    key: "fbps",
    label: "FBPS",
    format: (c, mode) => formatDecimal(c.scaled.ptfb, countDigits(mode)),
    value: (c) => c.scaled.ptfb,
    description: "ファストブレイクによる得点（Fastbreak Points）",
  },
  {
    key: "2ndpts",
    label: "2ND PTS",
    format: (c, mode) => formatDecimal(c.scaled.pt2nd, countDigits(mode)),
    value: (c) => c.scaled.pt2nd,
    description: "セカンドチャンスによる得点",
  },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (c, mode) => formatDecimal(c.scaled.ptsOffTov, countDigits(mode)),
    value: (c) => c.scaled.ptsOffTov,
    description: "ターンオーバーからの得点（PlayTextの公式判定タグ集計。2016-17シーズンはタグ自体が存在せず常に0）",
  },
  {
    key: "dunk",
    label: "DUNK",
    format: (c, mode) => formatDecimal(c.scaled.dunks, countDigits(mode)),
    value: (c) => c.scaled.dunks,
    description: "ダンク成功数",
  },
  {
    key: "and1",
    label: "AND1",
    format: (c, mode) => formatDecimal(c.scaled.basketCounts, countDigits(mode)),
    value: (c) => c.scaled.basketCounts,
    description: "バスケットカウント（アンドワン）数",
  },
  {
    key: "ufoul",
    label: "UFOUL",
    format: (c, mode) => formatDecimal(c.scaled.unsportsmanlikeFouls, countDigits(mode)),
    value: (c) => c.scaled.unsportsmanlikeFouls,
    description: "アンスポーツマンファウル数",
  },
  {
    key: "dqfoul",
    label: "DQFOUL",
    format: (c, mode) => formatDecimal(c.scaled.disqualifyingFouls, countDigits(mode)),
    value: (c) => c.scaled.disqualifyingFouls,
    description: "ディスクォリファイングファウル数",
  },
  {
    key: "tf",
    label: "TF",
    format: (c, mode) => formatDecimal(c.scaled.technicalFouls, countDigits(mode)),
    value: (c) => c.scaled.technicalFouls,
    higherIsBetter: false,
    description: "テクニカルファウル数（選手個人のもの。ActionCD1=24）",
  },
  {
    key: "ast2m",
    label: "AST2M",
    format: (c, mode) => formatDecimal(c.scaled.assisted2m, countDigits(mode)),
    value: (c) => c.scaled.assisted2m,
    description: "アシストされた2P成功数",
  },
  {
    key: "ast3m",
    label: "AST3M",
    format: (c, mode) => formatDecimal(c.scaled.assisted3m, countDigits(mode)),
    value: (c) => c.scaled.assisted3m,
    description: "アシストされた3P成功数",
  },
  {
    key: "astftm",
    label: "ASTFTM",
    format: (c, mode) => formatDecimal(c.scaled.assistedFtm, countDigits(mode)),
    value: (c) => c.scaled.assistedFtm,
    description: "アシストされたFT成功数",
  },
  {
    key: "astpct",
    label: "AST%",
    format: (c) =>
      formatPct100(safeDiv(c.raw.assisted2m * 2 + c.raw.assisted3m * 3 + c.raw.assistedFtm, c.raw.pts)),
    value: (c) => safeDiv(c.raw.assisted2m * 2 + c.raw.assisted3m * 3 + c.raw.assistedFtm, c.raw.pts),
    description: "(アシストされた2Mx2 + 3Mx3 + FTMx1) / PTS。得点のうちアシストが付いた割合",
  },
];

/** ショットチャート非対応シーズン（"-"表示列）のvalueは一律0にする（PPP等と同じ既存方針） */
function shotChartValue(c: SeasonBoxscoreCtx, raw: number): number {
  return c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? raw : 0;
}

export const SEASON_SCORING_COLUMNS: SeasonBoxscoreColumn[] = [
  { key: "g", label: "G", format: (c) => String(c.raw.gamesPlayed), value: (c) => c.raw.gamesPlayed, description: "試合数" },
  {
    key: "min",
    label: "MIN",
    format: (c) => formatMinutesFromSeconds(Math.round(c.scaled.min * 60)),
    value: (c) => c.scaled.min,
    description: "出場時間",
  },
  { key: "pts", label: "PTS", format: (c, mode) => formatDecimal(c.scaled.pts, countDigits(mode)), value: (c) => c.scaled.pts, description: "得点" },
  {
    key: "pctpts",
    label: "%PTS",
    format: (c) => formatPct100(sharePct(c.raw.pts, c.team.pts)),
    value: (c) => sharePct(c.raw.pts, c.team.pts),
    description: "チーム総得点に占める割合",
  },
  {
    key: "pctfgm",
    label: "%FGM",
    format: (c) => formatPct100(sharePct(c.raw.fgm, c.team.fgm)),
    value: (c) => sharePct(c.raw.fgm, c.team.fgm),
    description: "チーム総FGMに占める割合",
  },
  {
    key: "pctfga",
    label: "%FGA",
    format: (c) => formatPct100(sharePct(c.raw.fga, c.team.fga)),
    value: (c) => sharePct(c.raw.fga, c.team.fga),
    description: "チーム総FGAに占める割合",
  },
  {
    key: "pct3pm",
    label: "%3PM",
    format: (c) => formatPct100(sharePct(c.raw.tpm, c.team.tpm)),
    value: (c) => sharePct(c.raw.tpm, c.team.tpm),
    description: "チーム総3PMに占める割合",
  },
  {
    key: "pct3pa",
    label: "%3PA",
    format: (c) => formatPct100(sharePct(c.raw.tpa, c.team.tpa)),
    value: (c) => sharePct(c.raw.tpa, c.team.tpa),
    description: "チーム総3PAに占める割合",
  },
  {
    key: "pctftm",
    label: "%FTM",
    format: (c) => formatPct100(sharePct(c.raw.ftm, c.team.ftm)),
    value: (c) => sharePct(c.raw.ftm, c.team.ftm),
    description: "チーム総FTMに占める割合",
  },
  {
    key: "pctfta",
    label: "%FTA",
    format: (c) => formatPct100(sharePct(c.raw.fta, c.team.fta)),
    value: (c) => sharePct(c.raw.fta, c.team.fta),
    description: "チーム総FTAに占める割合",
  },
  {
    key: "paint2m",
    label: "PAINT2M",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.paint2m, countDigits(mode)) : NA,
    value: (c) => shotChartValue(c, c.scaled.paint2m),
    description: "ペイント内2P成功数（ショットチャート座標由来。2022-23シーズン以降のみ対応）",
  },
  {
    key: "paint2a",
    label: "PAINT2A",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.paint2a, countDigits(mode)) : NA,
    value: (c) => shotChartValue(c, c.scaled.paint2a),
    description: "ペイント内2P試投数（同上、2022-23シーズン以降のみ対応）",
  },
  {
    key: "paint2pct",
    label: "PAINT2%",
    format: (c) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatPct(safeDiv(c.raw.paint2m, c.raw.paint2a)) : NA,
    value: (c) => shotChartValue(c, safeDiv(c.raw.paint2m, c.raw.paint2a)),
    description: "PAINT2M / PAINT2A（2022-23シーズン以降のみ対応）",
  },
  {
    key: "mid2m",
    label: "MID2M",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.mid2m, countDigits(mode)) : NA,
    value: (c) => shotChartValue(c, c.scaled.mid2m),
    description: "ミッドレンジ（ペイント外）2P成功数（ショットチャート座標由来。2022-23シーズン以降のみ対応）",
  },
  {
    key: "mid2a",
    label: "MID2A",
    format: (c, mode) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatDecimal(c.scaled.mid2a, countDigits(mode)) : NA,
    value: (c) => shotChartValue(c, c.scaled.mid2a),
    description: "ミッドレンジ（ペイント外）2P試投数（同上、2022-23シーズン以降のみ対応）",
  },
  {
    key: "mid2pct",
    label: "MID2%",
    format: (c) =>
      c.seasonStartYear >= MIN_SHOT_CHART_SEASON_START_YEAR ? formatPct(safeDiv(c.raw.mid2m, c.raw.mid2a)) : NA,
    value: (c) => shotChartValue(c, safeDiv(c.raw.mid2m, c.raw.mid2a)),
    description: "MID2M / MID2A（2022-23シーズン以降のみ対応）",
  },
];

export const SEASON_BOX_COLUMNS: Record<SeasonBoxTabKey, SeasonBoxscoreColumn[]> = {
  traditional: SEASON_TRADITIONAL_COLUMNS,
  advanced: SEASON_ADVANCED_COLUMNS,
  misc: SEASON_MISC_COLUMNS,
  scoring: SEASON_SCORING_COLUMNS,
};

// ここから「シーズン別成績」「シチュエーション別成績」「チーム詳細ページの選手スタッツ」の
// Q別/前半/後半トグル用ロジック（DESIGN.md参照）。試合ごとにOTの有無が異なりうるため、
// 試合詳細ページのbuildPeriodRangeOptions()と同じ考え方だがOTは対象外にした固定4ピリオド
// （試合/1Q/2Q/3Q/4Q/前半/後半）に絞る。SEASON_SHOT_CHART_PERIOD_OPTIONS（PlayerDetailPage.tsx）
// とは異なりOT分の吸収は行わない（ユーザー要求が「試合全体/各Q/前半/後半」のみのため）
export const SEASON_BOX_PERIOD_OPTIONS: PeriodRangeOption[] = buildPeriodRangeOptions(4);

export interface GameTeamPeriodTotals {
  own: BoxscoreCounts;
  opp: BoxscoreCounts;
  poss: number;
}

/**
 * 指定期間範囲（試合/Q別/前後半）で、1試合分の生データから自チーム/相手チームの
 * BoxscoreCountsを組み立てる（試合詳細ページのボックススコアと同じbuildTeamTotalCounts・
 * computeTeamRatingsを呼ぶだけ）。computeGamePeriodTotals（選手個人版）と
 * buildTeamPeriodStats（チーム詳細ページ「スタッツ」タブのopp/+/-トグル・シチュエーション別
 * 成績（チーム版）用）の共通部分をここに切り出した
 */
export function computeGameTeamPeriodTotals(
  game: StoredGame,
  isHome: boolean,
  option: PeriodRangeOption | undefined,
): GameTeamPeriodTotals {
  const ownRows = isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const oppRows = isHome ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
  const own = buildTeamTotalCounts(ownRows, option);
  const opp = buildTeamTotalCounts(oppRows, option);
  const { poss } = computeTeamRatings(own, opp);
  return { own, opp, poss };
}

export interface TeamGameBoxTotals {
  own: BoxscoreCounts;
  opp: BoxscoreCounts;
  ownCtx: ColumnCtx;
  oppCtx: ColumnCtx;
}

/**
 * チーム詳細ページ「日程結果」タブのトラディショナル/アドバンスド/Misc/スコアリング
 * カテゴリタブ用。試合詳細ページのBoxscoreTeamPanel（src/components/BoxscoreTable.tsx）が
 * 1試合内で「チーム合計」行を組み立てている処理（buildTeamTotalCounts＋F4・被アシスト・
 * ライブ/デッドTOV・テクニカルファウルを選手ごとの値から合算する処理）を、自チーム・
 * 相手チーム双方について行い、そのままCOLUMNS_BY_TAB（同ファイルからexport済み）に渡せる
 * ColumnCtxまで組み立てる。Misc/Scoringタブの被タグ集計・座標ベースのゾーン分割を含む
 * BoxscoreCounts全項目が必要なため、computeGameTeamPeriodTotalsと異なりQ別/前後半の
 * 選択に関わらず常に生データ（StoredGame・Yahoo PBP）が必要（DESIGN.md参照）
 */
export function buildTeamGameBoxTotals(
  game: StoredGame,
  isHome: boolean,
  option: PeriodRangeOption | undefined,
  yahooTurnovers: YahooTurnoverEvent[],
  shotChartSupported: boolean,
  yahooPbpSupported: boolean,
): TeamGameBoxTotals {
  const ownRows = isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const oppRows = isHome ? game.raw.AwayBoxscores : game.raw.HomeBoxscores;
  const ownSide = isHome ? "home" : "away";
  const oppSide = isHome ? "away" : "home";

  const ownMisc = sumCountsList(buildPlayerBoxscores(ownRows, option, game.raw.PlayByPlays, yahooTurnovers).map((p) => p.counts));
  const oppMisc = sumCountsList(buildPlayerBoxscores(oppRows, option, game.raw.PlayByPlays, yahooTurnovers).map((p) => p.counts));
  const ownTeamId = ownRows.find((r) => r.TeamID)?.TeamID ?? null;
  const oppTeamId = oppRows.find((r) => r.TeamID)?.TeamID ?? null;

  const own: BoxscoreCounts = {
    ...buildTeamTotalCounts(ownRows, option),
    dunks: ownMisc.dunks,
    basketCounts: ownMisc.basketCounts,
    unsportsmanlikeFouls: ownMisc.unsportsmanlikeFouls,
    disqualifyingFouls: ownMisc.disqualifyingFouls,
    assisted2m: ownMisc.assisted2m,
    assisted3m: ownMisc.assisted3m,
    assistedFtm: ownMisc.assistedFtm,
    liveTov: ownMisc.liveTov,
    deadTov: ownMisc.deadTov,
    paint2m: ownMisc.paint2m,
    paint2a: ownMisc.paint2a,
    nonPaint2m: ownMisc.nonPaint2m,
    nonPaint2a: ownMisc.nonPaint2a,
    technicalFouls: ownMisc.technicalFouls + countTeamGeneratedTechnicalFouls(game.raw.PlayByPlays, ownTeamId, option),
  };
  const opp: BoxscoreCounts = {
    ...buildTeamTotalCounts(oppRows, option),
    dunks: oppMisc.dunks,
    basketCounts: oppMisc.basketCounts,
    unsportsmanlikeFouls: oppMisc.unsportsmanlikeFouls,
    disqualifyingFouls: oppMisc.disqualifyingFouls,
    assisted2m: oppMisc.assisted2m,
    assisted3m: oppMisc.assisted3m,
    assistedFtm: oppMisc.assistedFtm,
    liveTov: oppMisc.liveTov,
    deadTov: oppMisc.deadTov,
    paint2m: oppMisc.paint2m,
    paint2a: oppMisc.paint2a,
    nonPaint2m: oppMisc.nonPaint2m,
    nonPaint2a: oppMisc.nonPaint2a,
    technicalFouls: oppMisc.technicalFouls + countTeamGeneratedTechnicalFouls(game.raw.PlayByPlays, oppTeamId, option),
  };

  const ownPlayType = buildPlayTypeCounts(game.raw.Summaries, ownSide, option);
  const oppPlayType = buildPlayTypeCounts(game.raw.Summaries, oppSide, option);
  const ownRatings = computeTeamRatings(own, opp);
  const oppRatings = computeTeamRatings(opp, own);

  return {
    own,
    opp,
    ownCtx: {
      own,
      ownPlayType,
      ratings: ownRatings,
      isPlayerRow: false,
      isTeamTotalRow: true,
      shotChartSupported,
      yahooPbpSupported,
    },
    oppCtx: {
      own: opp,
      ownPlayType: oppPlayType,
      ratings: oppRatings,
      isPlayerRow: false,
      isTeamTotalRow: true,
      shotChartSupported,
      yahooPbpSupported,
    },
  };
}

function sumPlayType(list: PlayTypeCounts[]): PlayTypeCounts {
  return list.reduce(
    (acc, p) => ({ pft: acc.pft + p.pft, fb: acc.fb + p.fb, pt2nd: acc.pt2nd + p.pt2nd, pt2in: acc.pt2in + p.pt2in }),
    { pft: 0, fb: 0, pt2nd: 0, pt2in: 0 },
  );
}

function scalePlayType(p: PlayTypeCounts, factor: number): PlayTypeCounts {
  return { pft: p.pft * factor, fb: p.fb * factor, pt2nd: p.pt2nd * factor, pt2in: p.pt2in * factor };
}

/**
 * チーム詳細ページ「比較」タブ用。buildTeamGameBoxTotals（1試合分）を複数試合分呼び、
 * own/opp双方のBoxscoreCounts・プレータイプ内訳を合算した上で「1試合あたり平均」に変換して
 * COLUMNS_BY_TABにそのまま渡せるColumnCtxを組み立てる。合計値のまま比較するとスロットごとの
 * 試合数の違いで比較しづらくなるため、個人詳細ページの比較タブ（seasonBoxCompareDefs、常に
 * 「平均」固定）と同じ方針にした。POSSは6章・11章・53章・buildTeamPeriodStatsと同じ
 * 「試合単位で確定させてから合算する」方針（非線形性回避）を踏襲し、PACE/ORtg/DRtg/NetRtgは
 * 合算後のPOSS・PTSから再計算する（比率のため合算値・平均値のどちらから計算しても同じ結果になる。
 * computeTeamRatingsを平均化後のBoxscoreCountsに再適用すると比率項の非線形性で誤差が出るため
 * 使わない）
 */
export function buildTeamMultiGameBoxTotals(
  entries: { game: StoredGame; isHome: boolean }[],
  yahooTurnoversByScheduleKey: Map<string, YahooTurnoverEvent[]>,
  shotChartSupported: boolean,
  yahooPbpSupported: boolean,
): TeamGameBoxTotals | null {
  if (entries.length === 0) return null;
  const perGame = entries.map(({ game, isHome }) =>
    buildTeamGameBoxTotals(
      game,
      isHome,
      undefined,
      yahooTurnoversByScheduleKey.get(game.scheduleKey) ?? [],
      shotChartSupported,
      yahooPbpSupported,
    ),
  );
  const gamesPlayed = perGame.length;
  const ownSum = sumCountsList(perGame.map((g) => g.own));
  const oppSum = sumCountsList(perGame.map((g) => g.opp));
  const possSum = perGame.reduce((sum, g) => sum + (g.ownCtx.ratings?.poss ?? 0), 0);
  const ownPlayTypeSum = sumPlayType(perGame.map((g) => g.ownCtx.ownPlayType));
  const oppPlayTypeSum = sumPlayType(perGame.map((g) => g.oppCtx.ownPlayType));

  const ownOffRtg = offensiveRating(ownSum.pts, possSum);
  const ownDefRtg = offensiveRating(oppSum.pts, possSum);
  const ownPace = pace(possSum, ownSum.minSec / 60);

  const factor = 1 / gamesPlayed;
  const own = scaleCounts(ownSum, factor);
  const opp = scaleCounts(oppSum, factor);
  const ownPlayType = scalePlayType(ownPlayTypeSum, factor);
  const oppPlayType = scalePlayType(oppPlayTypeSum, factor);
  const possPerGame = possSum * factor;

  return {
    own,
    opp,
    ownCtx: {
      own,
      ownPlayType,
      ratings: { poss: possPerGame, pace: ownPace, offRtg: ownOffRtg, defRtg: ownDefRtg, netRtg: ownOffRtg - ownDefRtg },
      isPlayerRow: false,
      isTeamTotalRow: true,
      shotChartSupported,
      yahooPbpSupported,
    },
    oppCtx: {
      own: opp,
      ownPlayType: oppPlayType,
      ratings: { poss: possPerGame, pace: ownPace, offRtg: ownDefRtg, defRtg: ownOffRtg, netRtg: ownDefRtg - ownOffRtg },
      isPlayerRow: false,
      isTeamTotalRow: true,
      shotChartSupported,
      yahooPbpSupported,
    },
  };
}

export interface GamePeriodTotals {
  player: BoxscoreCounts;
  own: BoxscoreCounts;
  opp: BoxscoreCounts;
  poss: number;
}

/**
 * 指定選手・指定期間範囲（試合/Q別/前後半）で、1試合分の生データから自身/自チーム/相手チームの
 * BoxscoreCountsを組み立てる。試合詳細ページのボックススコア（buildPlayerBoxscores・
 * buildTeamTotalCounts・computeTeamRatings）と全く同じロジックを1試合単位で呼ぶだけ。
 * 選手がその試合のボックススコアに存在しない場合はnullを返す
 */
export function computeGamePeriodTotals(
  game: StoredGame,
  isHome: boolean,
  playerId: string,
  option: PeriodRangeOption | undefined,
): GamePeriodTotals | null {
  const ownRows = isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
  const { own, opp, poss } = computeGameTeamPeriodTotals(game, isHome, option);
  const players = buildPlayerBoxscores(ownRows, option, game.raw.PlayByPlays, []);
  const player = players.find((p) => p.playerId === playerId);
  if (!player) return null;
  return { player: player.counts, own, opp, poss };
}

/**
 * チーム詳細ページ「スタッツ」タブの自チーム/opp/+/-トグル・シチュエーション別成績（チーム版）用。
 * 「試合」選択時（option未指定またはperiods===null）は追加の生データ取得が不要な
 * computeTeamSituationalStats（永続化済みTeamGameLogベース、DESIGN.md 53章でopp内訳を拡張済み）に
 * そのまま委譲する。Q別/前後半選択時のみ、呼び出し側が事前フェッチしたgamesByScheduleKeyから
 * 試合単位でcomputeGameTeamPeriodTotalsを呼び、POSSは試合単位で確定させてから合算する方針
 * （DESIGN.md 6章・11章・53章と同じ非線形性回避）を踏襲する。生データ未取得の試合は除外される
 */
export function buildTeamPeriodStats(
  logs: TeamGameLog[],
  option: PeriodRangeOption | undefined,
  gamesByScheduleKey: Map<string, StoredGame>,
): TeamSituationalStats | null {
  const played = logs.filter((g) => g.min > 0);
  if (played.length === 0) return null;
  if (!option || option.periods === null) {
    return computeTeamSituationalStats(played);
  }

  const contributions = played
    .map((log) => {
      const game = gamesByScheduleKey.get(log.scheduleKey);
      return game ? computeGameTeamPeriodTotals(game, log.isHome, option) : null;
    })
    .filter((c): c is GameTeamPeriodTotals => c !== null);
  if (contributions.length === 0) return null;

  const gamesPlayed = contributions.length;
  const own = sumCountsList(contributions.map((c) => c.own));
  const opp = sumCountsList(contributions.map((c) => c.opp));
  const possSum = contributions.reduce((sum, c) => sum + c.poss, 0);

  const offRtg = offensiveRating(own.pts, possSum);
  const defRtg = offensiveRating(opp.pts, possSum);

  return {
    gamesPlayed,
    perGame: {
      pts: own.pts / gamesPlayed,
      oppPts: opp.pts / gamesPlayed,
      net: (own.pts - opp.pts) / gamesPlayed,
      reb: own.treb / gamesPlayed,
      oppReb: opp.treb / gamesPlayed,
      ast: own.ast / gamesPlayed,
      oppAst: opp.ast / gamesPlayed,
      stl: own.stl / gamesPlayed,
      oppStl: opp.stl / gamesPlayed,
      blk: own.blk / gamesPlayed,
      oppBlk: opp.blk / gamesPlayed,
      tov: own.tov / gamesPlayed,
      oppTov: opp.tov / gamesPlayed,
    },
    shooting: {
      fgPct: safeDiv(own.pt2m + own.pt3m, own.pt2a + own.pt3a),
      oppFgPct: safeDiv(opp.pt2m + opp.pt3m, opp.pt2a + opp.pt3a),
      tpPct: safeDiv(own.pt3m, own.pt3a),
      oppTpPct: safeDiv(opp.pt3m, opp.pt3a),
      ftPct: safeDiv(own.ftm, own.fta),
      oppFtPct: safeDiv(opp.ftm, opp.fta),
      efgPct: efgPct(own.pt2m + own.pt3m, own.pt3m, own.pt2a + own.pt3a),
      oppEfgPct: efgPct(opp.pt2m + opp.pt3m, opp.pt3m, opp.pt2a + opp.pt3a),
      tsPct: tsPct(own.pts, own.pt2a + own.pt3a, own.fta),
      oppTsPct: tsPct(opp.pts, opp.pt2a + opp.pt3a, opp.fta),
    },
    advanced: {
      pace: pace(possSum, own.minSec / 60),
      offRtg,
      defRtg,
      netRtg: offRtg - defRtg,
    },
  };
}

/**
 * GamePeriodTotals（試合単位で確定させた値）の配列を合算し、PlayerSeasonRawTotals・
 * TeamSeasonRawTotalsと同じ形の集計を作る（buildSeasonBoxscoreCtxにそのまま渡せる）。
 * POSSはチームPOSSと同じく「試合単位で確定させてから合算する」方針（DESIGN.md 6章・11章参照）。
 * 個人PACE用の在コート区間3項目（onCourtOwnPoss等）はQ別の在コート復元に明確な定義が無いため
 * 対象外とし常に0にする（＝PACE列は「-」表示のまま）
 */
export function buildPeriodFilteredRawTotals(contributions: GamePeriodTotals[]): {
  raw: PlayerSeasonRawTotals;
  team: TeamSeasonRawTotals;
} {
  const gamesPlayed = contributions.length;
  const playerSum = sumCountsList(contributions.map((c) => c.player));
  const ownSum = sumCountsList(contributions.map((c) => c.own));
  const oppSum = sumCountsList(contributions.map((c) => c.opp));
  const possSum = contributions.reduce((sum, c) => sum + c.poss, 0);

  const raw: PlayerSeasonRawTotals = {
    ...EMPTY_RAW_TOTALS,
    gamesPlayed,
    min: playerSum.minSec / 60,
    pts: playerSum.pts,
    fgm: playerSum.pt2m + playerSum.pt3m,
    fga: playerSum.pt2a + playerSum.pt3a,
    tpm: playerSum.pt3m,
    tpa: playerSum.pt3a,
    ftm: playerSum.ftm,
    fta: playerSum.fta,
    oreb: playerSum.oreb,
    dreb: playerSum.dreb,
    reb: playerSum.treb,
    ast: playerSum.ast,
    tov: playerSum.tov,
    stl: playerSum.stl,
    blk: playerSum.blk,
    pf: playerSum.foul,
    foulsDrawn: playerSum.foulon,
    blockedAgainst: playerSum.bson,
    technicalFouls: playerSum.technicalFouls,
    pt2in: playerSum.pt2in,
    ptfb: playerSum.ptfb,
    pt2nd: playerSum.pt2nd,
    plusMinus: playerSum.plusMinus,
    ptsOffTov: playerSum.ptsOffTov,
    dunks: playerSum.dunks,
    basketCounts: playerSum.basketCounts,
    unsportsmanlikeFouls: playerSum.unsportsmanlikeFouls,
    disqualifyingFouls: playerSum.disqualifyingFouls,
    assisted2m: playerSum.assisted2m,
    assisted3m: playerSum.assisted3m,
    assistedFtm: playerSum.assistedFtm,
    paint2m: playerSum.paint2m,
    paint2a: playerSum.paint2a,
    mid2m: playerSum.nonPaint2m,
    mid2a: playerSum.nonPaint2a,
  };

  const team: TeamSeasonRawTotals = {
    pts: ownSum.pts,
    fgm: ownSum.pt2m + ownSum.pt3m,
    fga: ownSum.pt2a + ownSum.pt3a,
    tpm: ownSum.pt3m,
    tpa: ownSum.pt3a,
    ftm: ownSum.ftm,
    fta: ownSum.fta,
    tov: ownSum.tov,
    min: ownSum.minSec / 60,
    ast: ownSum.ast,
    oreb: ownSum.oreb,
    dreb: ownSum.dreb,
    stl: ownSum.stl,
    blk: ownSum.blk,
    pf: ownSum.foul,
    poss: possSum,
    opponentMin: oppSum.minSec / 60,
    opponentPts: oppSum.pts,
    opponentFgm: oppSum.pt2m + oppSum.pt3m,
    opponentFga: oppSum.pt2a + oppSum.pt3a,
    opponentFtm: oppSum.ftm,
    opponentFta: oppSum.fta,
    opponentOreb: oppSum.oreb,
    opponentDreb: oppSum.dreb,
    opponentTov: oppSum.tov,
  };

  return { raw, team };
}

/**
 * buildTeamSplitRowsのQ別/前後半対応版。「試合」（periods===null、またはoption未指定）選択時は
 * 追加の生データ取得が不要な既存のbuildTeamSplitRows（PlayerGameLog永続集計ベース）にそのまま
 * 委譲する。Q別/前後半選択時は、呼び出し側がPeriodRangeToggle操作時に事前フェッチした
 * gamesByScheduleKey（scheduleKey→試合の生データ）を使い、試合単位でcomputeGamePeriodTotalsを
 * 呼んでからbuildPeriodFilteredRawTotalsで合算する。gamesByScheduleKeyに未取得のscheduleKeyが
 * あればその試合は除いて集計する（フェッチ完了を待つ間は部分的な値になるが、フェッチが進むたびに
 * 呼び出し側の再レンダリングで値が更新される。ローディング表示は呼び出し側の責務）
 */
export function buildTeamSplitRowsForPeriod(
  keyPrefix: string,
  logs: PlayerGameLog[],
  ownTeamByScheduleKey: Map<string, GameTeamInfo>,
  teamTotalsByTeamId: Map<string, TeamSeasonRawTotals>,
  displayMode: SeasonDisplayMode,
  seasonStartYear: number,
  playerId: string,
  option: PeriodRangeOption | undefined,
  gamesByScheduleKey: Map<string, StoredGame>,
): TeamSplitRow[] {
  if (!option || option.periods === null) {
    return buildTeamSplitRows(keyPrefix, logs, ownTeamByScheduleKey, teamTotalsByTeamId, displayMode, seasonStartYear);
  }

  const played = logs.filter((g) => g.min > 0);
  if (played.length === 0) return [];

  const byTeam = new Map<string, { teamName: string; logs: PlayerGameLog[] }>();
  for (const log of played) {
    const own = ownTeamByScheduleKey.get(log.scheduleKey);
    const id = own?.teamId ?? "unknown";
    let entry = byTeam.get(id);
    if (!entry) {
      entry = { teamName: own?.teamName ?? "", logs: [] };
      byTeam.set(id, entry);
    }
    entry.logs.push(log);
  }
  const teamIds = [...byTeam.keys()];
  const labelFor = (id: string, teamName: string) => (id === "unknown" ? "-" : teamShortName(id, teamName));

  const buildCtx = (teamLogs: PlayerGameLog[]): SeasonBoxscoreCtx => {
    const contributions = teamLogs
      .map((log) => {
        const game = gamesByScheduleKey.get(log.scheduleKey);
        return game ? computeGamePeriodTotals(game, log.isHome, playerId, option) : null;
      })
      .filter((c): c is GamePeriodTotals => c !== null);
    const { raw, team } = buildPeriodFilteredRawTotals(contributions);
    return buildSeasonBoxscoreCtx(raw, team, displayMode, seasonStartYear);
  };

  if (teamIds.length === 1) {
    const id = teamIds[0]!;
    const entry = byTeam.get(id)!;
    return [
      {
        key: `${keyPrefix}|${id}`,
        teamId: id === "unknown" ? null : id,
        teamLabel: labelFor(id, entry.teamName),
        ctx: buildCtx(entry.logs),
        logs: entry.logs,
        isCombined: false,
      },
    ];
  }

  const rows: TeamSplitRow[] = teamIds.map((id) => {
    const entry = byTeam.get(id)!;
    return {
      key: `${keyPrefix}|${id}`,
      teamId: id === "unknown" ? null : id,
      teamLabel: labelFor(id, entry.teamName),
      ctx: buildCtx(entry.logs),
      logs: entry.logs,
      isCombined: false,
    };
  });
  rows.push({
    key: `${keyPrefix}|combined`,
    teamId: null,
    teamLabel: "複数チーム",
    ctx: buildCtx(played),
    logs: played,
    isCombined: true,
  });
  return rows;
}
