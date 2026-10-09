// ランキング > 個人 > On/Off・組み合わせ（DESIGN.md 224章）のURL。種類 k=lu、単位 lt（onoff／duo／trio）、指標 lm（net／off／def）、範囲 lr（season／career）、
// ポゼッションの下限 lp（チームのポゼッション数に対する割合、%。単位ごとの既定のときは載せない）、ピリオド q（Q別・前後半。試合全体のときは載せない）。
// 試合区分 gt・登録区分 cls・ポジション pos・現役 act・試合の条件（res・ven・opp・ot・fm・mg・dv・div）は、ほかの個人のランキングと同じ
import { LINEUP_METRICS, LINEUP_SHARE_DEFAULT, LINEUP_SHARE_RANGE, LINEUP_UNITS, type LineupMetric, type LineupRange, type LineupUnit } from "./lineupRanking";
import type { PeriodRangeValue } from "./periodRange";
import { enumParam, numberParam, type UrlCodec } from "./urlState";

export const LINEUP_UNIT_PARAM = enumParam<LineupUnit>("lt", LINEUP_UNITS, "onoff");
export const LINEUP_METRIC_PARAM = enumParam<LineupMetric>("lm", LINEUP_METRICS, "net");
export const LINEUP_RANGE_PARAM = enumParam<LineupRange>("lr", ["season", "career"], "season", { career: "all" });

const PERIOD_VALUES: PeriodRangeValue[] = ["all", "q1", "q2", "q3", "q4", "h1", "h2", "ot", ...Array.from({ length: 6 }, (_, i): PeriodRangeValue => `ot${i + 1}`)];
export const LINEUP_PERIOD_PARAM = enumParam<PeriodRangeValue>("q", PERIOD_VALUES, "all");

/** 下限の割合（%）。既定は単位ごとに違う */
export function lineupShareParam(unit: LineupUnit): UrlCodec<number> {
  const { min, max } = LINEUP_SHARE_RANGE[unit];
  return numberParam("lp", LINEUP_SHARE_DEFAULT[unit], { min, max });
}
