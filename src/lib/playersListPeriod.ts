// 全選手スタッツの Q別・前後半・延長・クラッチ（設計書376章）。
// 値はランキング（個人・シーズン成績）と同じ関数（seasonPeriodTotalsOf → buildPeriodFilteredRawTotals）で、ピリオド別の索引から組み立てる。
// 画面側の部品（保存キーの対象外）。
import type { PlayerGameLog } from "../../shared/types";
import type { SeasonBoxscoreCtx, SeasonDisplayMode } from "./playerSeasonBoxscore";
import type { PeriodRangeValue } from "./periodRange";
import { OVERTIME_MIN_GAMES, buildPeriodCtxForLogs, seasonPeriodOption, type SeasonPeriodSource } from "./seasonPeriod";

/** 区間を選んでいるか（試合全体でない） */
export function isPeriodSelected(period: PeriodRangeValue): boolean {
  return seasonPeriodOption(period).periods !== null;
}

/** 延長・クラッチ（その区間に出た試合が基準以上の選手だけを載せる区間。出場率などの掲載基準は使わない） */
export function isSubsetPeriodValue(period: PeriodRangeValue): boolean {
  return period === "ot" || period === "clutch";
}

/** 表に載せる最低試合数（区間の値がある試合の数）。延長・クラッチは3試合、それ以外の区間は1試合 */
export function periodRowMinGames(period: PeriodRangeValue): number {
  return isSubsetPeriodValue(period) ? OVERTIME_MIN_GAMES : 1;
}

/**
 * 1人の選手の、区間の値から作る表の1行分（ctx）。logs は試合の条件（登録区分・シチュエーション別・試合種別）で絞り終えた試合ログ。
 * 値がある試合が無ければ null
 */
export function playersListPeriodCtx(
  playerId: string,
  logs: readonly PlayerGameLog[],
  period: PeriodRangeValue,
  source: SeasonPeriodSource,
  displayMode: SeasonDisplayMode,
  seasonStartYear: number,
): SeasonBoxscoreCtx | null {
  return buildPeriodCtxForLogs(logs, playerId, period, source, displayMode, seasonStartYear);
}

/** 区間の値がある試合の数が基準に届いている行か */
export function periodRowMeetsMinimum(ctx: SeasonBoxscoreCtx | null, period: PeriodRangeValue): boolean {
  return !!ctx && ctx.raw.gamesPlayed >= periodRowMinGames(period);
}
