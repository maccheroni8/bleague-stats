// ボックススコア（試合詳細ページ）の期間別集計ロジック。
// GeniusAPI生データは選手/チーム行ごとに「1Q/2Q/3Q/4Q/前半/後半/延長合計/試合全体」の
// 集計済み行(PeriodCategory)を個別に持っているため、試合全体(=18)以外の範囲を選んだ場合は
// 該当するPeriodCategory=1..4(・OT分)の行を自前で合算する（15/16/17は「前半/後半/延長合計」
// 専用の集計行で、PeriodRangeOptionのOTを含む「後半」等とは範囲が一致しないケースがあるため使わない）。

import type { BoxscoreRow, PlayByPlayEvent, SummaryRow } from "../../shared/types";
import type { PeriodRangeOption } from "./periodRange";
import { periodInRange } from "./periodRange";
import { estimatedPossessions, offensiveRating, pace, safeDiv } from "../../shared/formulas";
import { computePointsOffTurnovers } from "../../shared/pointsOffTurnovers";
import { buildShotEvents, paintSplitForShot, type ShotEvent } from "./shotChart";

export interface BoxscoreCounts {
  minSec: number;
  pts: number;
  pt2m: number;
  pt2a: number;
  pt3m: number;
  pt3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  treb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  bson: number;
  foul: number;
  foulon: number;
  eff: number;
  plusMinus: number;
  /** 2022-23シーズン以降のみ存在するフィールドのため、値0と未収録を区別するためのフラグ */
  hasPlusMinus: boolean;
  pt2in: number;
  pt2nd: number;
  ptfb: number;
  /**
   * ターンオーバーからの得点（PTSOFFTO）。他のフィールドと異なりBoxscoreRowには個人単位の
   * フィールドが無いため、PlayByPlaysのPlayTextタグから別途算出する
   * （shared/pointsOffTurnovers.ts）。そのためsumCounts()では常に0のままで、
   * buildPlayerBoxscores()が事後的に上書きする。2016-17シーズンのみタグ自体が存在せず
   * 常に0になる（「0点」ではなく「算出不能」。shared/pointsOffTurnovers.ts参照）
   */
  ptsOffTov: number;
  /**
   * ペイント内／ペイント外の2Pシュート内訳（ショットチャートと同じゾーン分類を再利用）。
   * ptsOffTovと同様にBoxscoreRowには個人単位のフィールドが無いため、sumCounts()では常に0のままで、
   * buildPlayerBoxscores()がPlayByPlaysのX/Y/AreaCDから事後的に上書きする。X/Y自体が
   * 2022-23シーズン以降のみ存在するため（shotChart.ts参照）、それより前のシーズンでは
   * 常に0になる（呼び出し側でshotChartSupportedを見て「-」表示にケアする）
   */
  paint2m: number;
  paint2a: number;
  nonPaint2m: number;
  nonPaint2a: number;
}

const ZERO_COUNTS: BoxscoreCounts = {
  minSec: 0,
  pts: 0,
  pt2m: 0,
  pt2a: 0,
  pt3m: 0,
  pt3a: 0,
  ftm: 0,
  fta: 0,
  oreb: 0,
  dreb: 0,
  treb: 0,
  ast: 0,
  tov: 0,
  stl: 0,
  blk: 0,
  bson: 0,
  foul: 0,
  foulon: 0,
  eff: 0,
  plusMinus: 0,
  hasPlusMinus: false,
  pt2in: 0,
  pt2nd: 0,
  ptfb: 0,
  ptsOffTov: 0,
  paint2m: 0,
  paint2a: 0,
  nonPaint2m: 0,
  nonPaint2a: 0,
};

/**
 * "MM:SS" または "DNP" 形式のPlayTimeを秒に変換する。
 * Category=2（TEAM/COACHES）行はPlayTimeフィールド自体を持たないため、未定義/空文字も0扱いにする
 */
export function playTimeToSeconds(playTime: string | undefined): number {
  if (!playTime || playTime === "DNP") return 0;
  const [m, s] = playTime.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

/** 合計秒数を"MM:SS"に戻す（5人×試合時間の合計等、99分を超えうる） */
export function formatMinutesFromSeconds(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * 生データの数値フィールドを安全な数値に変換する。Category=2（TEAM/COACHES）行は
 * Q別・OT別ではFOUL/RB_OFF/RB_DEF/RB_TOT/TO以外のほぼ全フィールドが空文字("")になる
 * （型定義上はnumberだが実データはそうなっていない、既知のAPI仕様）。空文字や未定義は0扱いにする
 */
function num(value: number | string | undefined): number {
  return typeof value === "number" ? value : 0;
}

export function sumCounts(rows: BoxscoreRow[]): BoxscoreCounts {
  return rows.reduce(
    (acc, r) => ({
      minSec: acc.minSec + playTimeToSeconds(r.PlayTime),
      pts: acc.pts + num(r.Point),
      pt2m: acc.pt2m + num(r.PT2M),
      pt2a: acc.pt2a + num(r.PT2A),
      pt3m: acc.pt3m + num(r.PT3M),
      pt3a: acc.pt3a + num(r.PT3A),
      ftm: acc.ftm + num(r.FTM),
      fta: acc.fta + num(r.FTA),
      oreb: acc.oreb + num(r.RB_OFF),
      dreb: acc.dreb + num(r.RB_DEF),
      treb: acc.treb + num(r.RB_TOT),
      ast: acc.ast + num(r.AS),
      tov: acc.tov + num(r.TO),
      stl: acc.stl + num(r.ST),
      blk: acc.blk + num(r.BS),
      bson: acc.bson + num(r.BSON),
      foul: acc.foul + num(r.FOUL),
      foulon: acc.foulon + num(r.FOULON),
      eff: acc.eff + num(r.EFF),
      plusMinus: acc.plusMinus + num(r.PLUSMINUS),
      hasPlusMinus: acc.hasPlusMinus || typeof r.PLUSMINUS === "number",
      pt2in: acc.pt2in + num(r.PT2IN),
      pt2nd: acc.pt2nd + num(r.PT2ND),
      ptfb: acc.ptfb + num(r.PTFB),
      // BoxscoreRowにフィールドが無いため常に0のまま（buildPlayerBoxscores()が事後的に上書きする）
      ptsOffTov: acc.ptsOffTov,
      paint2m: acc.paint2m,
      paint2a: acc.paint2a,
      nonPaint2m: acc.nonPaint2m,
      nonPaint2a: acc.nonPaint2a,
    }),
    ZERO_COUNTS,
  );
}

/** 選択中の期間範囲に該当するPeriodCategoryの行だけを残す。「試合」選択時はPeriodCategory=18の1行に絞る */
export function rowsInPeriodRange<T extends { PeriodCategory: number }>(
  rows: T[],
  option: PeriodRangeOption | undefined,
): T[] {
  if (!option || option.periods === null) return rows.filter((r) => r.PeriodCategory === 18);
  const periods = option.periods;
  return rows.filter((r) => periods.includes(r.PeriodCategory));
}

/** 複数選手の集計済みBoxscoreCountsを合算する（スタメン合計・ベンチ合計等の内訳集計用） */
export function sumCountsList(list: BoxscoreCounts[]): BoxscoreCounts {
  return list.reduce(
    (acc, c) => ({
      minSec: acc.minSec + c.minSec,
      pts: acc.pts + c.pts,
      pt2m: acc.pt2m + c.pt2m,
      pt2a: acc.pt2a + c.pt2a,
      pt3m: acc.pt3m + c.pt3m,
      pt3a: acc.pt3a + c.pt3a,
      ftm: acc.ftm + c.ftm,
      fta: acc.fta + c.fta,
      oreb: acc.oreb + c.oreb,
      dreb: acc.dreb + c.dreb,
      treb: acc.treb + c.treb,
      ast: acc.ast + c.ast,
      tov: acc.tov + c.tov,
      stl: acc.stl + c.stl,
      blk: acc.blk + c.blk,
      bson: acc.bson + c.bson,
      foul: acc.foul + c.foul,
      foulon: acc.foulon + c.foulon,
      eff: acc.eff + c.eff,
      plusMinus: acc.plusMinus + c.plusMinus,
      hasPlusMinus: acc.hasPlusMinus || c.hasPlusMinus,
      pt2in: acc.pt2in + c.pt2in,
      pt2nd: acc.pt2nd + c.pt2nd,
      ptfb: acc.ptfb + c.ptfb,
      ptsOffTov: acc.ptsOffTov + c.ptsOffTov,
      paint2m: acc.paint2m + c.paint2m,
      paint2a: acc.paint2a + c.paint2a,
      nonPaint2m: acc.nonPaint2m + c.nonPaint2m,
      nonPaint2a: acc.nonPaint2a + c.nonPaint2a,
    }),
    ZERO_COUNTS,
  );
}

interface PaintSplitCounts {
  paint2m: number;
  paint2a: number;
  nonPaint2m: number;
  nonPaint2a: number;
}

const ZERO_PAINT_SPLIT: PaintSplitCounts = { paint2m: 0, paint2a: 0, nonPaint2m: 0, nonPaint2a: 0 };

/** ショットチャートと同じX/Y/AreaCDベースのゾーン分類で、選手ごとのペイント内外2P内訳を求める */
function buildPaintSplitByPlayer(shots: ShotEvent[]): Map<string, PaintSplitCounts> {
  const byPlayer = new Map<string, PaintSplitCounts>();
  for (const shot of shots) {
    const split = paintSplitForShot(shot);
    if (!split) continue;
    const entry = byPlayer.get(shot.playerId) ?? { ...ZERO_PAINT_SPLIT };
    if (split === "paint") {
      entry.paint2a += 1;
      if (shot.made) entry.paint2m += 1;
    } else {
      entry.nonPaint2a += 1;
      if (shot.made) entry.nonPaint2m += 1;
    }
    byPlayer.set(shot.playerId, entry);
  }
  return byPlayer;
}

export interface PlayerBoxscore {
  playerId: string;
  playerNo: string;
  nameJ: string;
  startingFlg: 1 | null | "";
  /** 試合を通じて出場が無かったか（選択中の期間に関わらず一定） */
  dnp: boolean;
  counts: BoxscoreCounts;
}

/**
 * 選手ごとの全期間行(Category=1)から、選択中の期間範囲に絞った集計を作る。
 * 名前・背番号・スタメン区分・DNP判定は常に試合全体(PeriodCategory=18)の行を基準にする
 * （出場時間や成績は期間で変わるが、これらの属性は試合を通じて固定のため）
 */
export function buildPlayerBoxscores(
  allRows: BoxscoreRow[],
  option: PeriodRangeOption | undefined,
  playByPlays: PlayByPlayEvent[] = [],
): PlayerBoxscore[] {
  const gameRows = allRows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
  const rowsByPlayer = new Map<string, BoxscoreRow[]>();
  for (const r of allRows) {
    if (r.Category !== 1) continue;
    const list = rowsByPlayer.get(r.PlayerID) ?? [];
    list.push(r);
    rowsByPlayer.set(r.PlayerID, list);
  }
  // PlayByPlaysは選手行のようなPeriodCategory集計行を持たず、イベントごとにPeriodを直接持つため
  // periodInRange()でそのまま絞り込める（rowsInPeriodRangeのPeriodCategoryベースの絞り込みとは別経路）
  const periodFilteredPbp = playByPlays.filter((e) => periodInRange(option, e.Period));
  const { byPlayer: ptsOffTovByPlayer } = computePointsOffTurnovers(periodFilteredPbp);
  // buildShotEvents()はX/Y未収録の行を自然に除外するため、2022-23シーズンより前は
  // 常に空配列になり、以降の集計もpaint2m等が常に0のままになる（呼び出し側でshotChartSupportedを
  // 見て「-」表示にケアする）
  const paintSplitByPlayer = buildPaintSplitByPlayer(buildShotEvents(periodFilteredPbp));
  return gameRows.map((meta) => {
    const periodRows = rowsInPeriodRange(rowsByPlayer.get(meta.PlayerID) ?? [], option);
    const paintSplit = paintSplitByPlayer.get(meta.PlayerID) ?? ZERO_PAINT_SPLIT;
    return {
      playerId: meta.PlayerID,
      playerNo: meta.PlayerNo,
      nameJ: meta.PlayerNameJ,
      startingFlg: meta.StartingFlg,
      dnp: meta.PlayTime === "DNP",
      counts: { ...sumCounts(periodRows), ptsOffTov: ptsOffTovByPlayer.get(meta.PlayerID) ?? 0, ...paintSplit },
    };
  });
}

/** チーム発生イベント行（TEAM/COACHES、Category=2）を選択中の期間範囲で集計する */
export function buildTeamCoachesCounts(allRows: BoxscoreRow[], option: PeriodRangeOption | undefined): BoxscoreCounts {
  return sumCounts(rowsInPeriodRange(allRows.filter((r) => r.Category === 2), option));
}

/** チーム合計行（Category=3）を選択中の期間範囲で集計する */
export function buildTeamTotalCounts(allRows: BoxscoreRow[], option: PeriodRangeOption | undefined): BoxscoreCounts {
  return sumCounts(rowsInPeriodRange(allRows.filter((r) => r.Category === 3), option));
}

export interface PlayTypeCounts {
  /** Points From Turnover（PTSOFFTO）。DESIGN.md 6章参照 */
  pft: number;
  /** Fast Break Points（FBPS） */
  fb: number;
  /** Second Chance Points（2NDPTS） */
  pt2nd: number;
  /** Points in the Paint（PITP）。個人行にもPT2INがあるためチーム単位で使うのはPFTのみだが、
   *  参考としてまとめて保持しておく */
  pt2in: number;
}

/** SummariesはHome/AwayTeamプレフィックス付きなので、側を指定して選択中の期間範囲で合算する */
export function buildPlayTypeCounts(
  summaries: SummaryRow[],
  side: "home" | "away",
  option: PeriodRangeOption | undefined,
): PlayTypeCounts {
  const rows = rowsInPeriodRange(summaries, option);
  const pftKey = side === "home" ? "HomeTeamPTPFT" : "AwayTeamPTPFT";
  const fbKey = side === "home" ? "HomeTeamPTFB" : "AwayTeamPTFB";
  const pt2ndKey = side === "home" ? "HomeTeamPT2ND" : "AwayTeamPT2ND";
  const pt2inKey = side === "home" ? "HomeTeamPT2IN" : "AwayTeamPT2IN";
  return rows.reduce(
    (acc, r) => ({
      pft: acc.pft + (r[pftKey] ?? 0),
      fb: acc.fb + (r[fbKey] ?? 0),
      pt2nd: acc.pt2nd + (r[pt2ndKey] ?? 0),
      pt2in: acc.pt2in + (r[pt2inKey] ?? 0),
    }),
    { pft: 0, fb: 0, pt2nd: 0, pt2in: 0 },
  );
}

export interface TeamRatings {
  poss: number;
  pace: number;
  offRtg: number;
  defRtg: number;
  netRtg: number;
}

/**
 * チームのPOSS/PACE/ORtg/DRtg/NetRtgを選択中の期間範囲の集計値から推定する。
 * 生データのPOSS/OFFRTG/DEFRTGフィールドは試合全体(PeriodCategory=18)にしか存在しないため
 * （Q別・前後半では空欄）、トグルのどの範囲を選んでも一貫した値になるよう常に
 * `estimatedPossessions`の推定式で計算する（KeyStatsSectionが試合全体で生データ優先・
 * フォールバックで推定式を使うのとは異なる方針。範囲間の値の一貫性を優先した）。
 * PACEは`aggregate.ts`のシーズン集計と同じく常に40分換算で正規化する（延長込みの実試合時間
 * ではなく固定値を使う既存の方針に合わせる）
 */
export function computeTeamRatings(own: BoxscoreCounts, opp: BoxscoreCounts): TeamRatings {
  const poss = estimatedPossessions(
    { fga: own.pt2a + own.pt3a, fgm: own.pt2m + own.pt3m, fta: own.fta, oreb: own.oreb, dreb: own.dreb, tov: own.tov },
    { fga: opp.pt2a + opp.pt3a, fgm: opp.pt2m + opp.pt3m, fta: opp.fta, oreb: opp.oreb, dreb: opp.dreb, tov: opp.tov },
  );
  const offRtg = offensiveRating(own.pts, poss);
  const defRtg = offensiveRating(opp.pts, poss);
  return {
    poss,
    offRtg,
    defRtg,
    netRtg: offRtg - defRtg,
    pace: pace(poss, own.minSec / 60),
  };
}

/** AST/TOV。TOV=0の場合はAST数をそのまま比率として使う（一般的な慣例） */
export function astToTovRatio(ast: number, tov: number): number {
  return tov === 0 ? ast : ast / tov;
}

export function formatAstToRatio(ast: number, tov: number): string {
  return astToTovRatio(ast, tov).toFixed(1);
}

/** %-shareスタッツ（個人の数値／チームの数値 × 100）。Bリーグ公式定義（DESIGN.md 6章） */
export function sharePct(playerValue: number, teamValue: number): number {
  return safeDiv(100 * playerValue, teamValue);
}
