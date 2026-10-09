// ランキング > 個人 > 1試合記録の「Q別・前後半・延長」（DESIGN.md 225章）の選択肢・URL・選べない項目の理由。
// シーズン成績のQ別・前後半（SEASON_BOX_PERIOD_OPTIONS）と同じ選択肢に、延長（すべての延長の合計）を足したもの。URLのキーは `q`（On/Off・組み合わせと同じ）。
import type { PeriodRangeOption, PeriodRangeValue } from "./periodRange";
import { buildPeriodRangeOptions } from "./periodRange";
import type { GameRecordPeriod } from "./periodIndex";
import { enumParam } from "./urlState";

/** 試合・1Q〜4Q・前半・後半・延長。延長は、試合のすべての延長の合計（第1延長・第2延長は分けない） */
export const GAME_RECORD_PERIOD_OPTIONS: PeriodRangeOption[] = [
  ...buildPeriodRangeOptions(4),
  { value: "ot", label: "延長", periods: [5] },
];

export const GAME_RECORD_PERIOD_PARAM = enumParam<PeriodRangeValue>(
  "q",
  GAME_RECORD_PERIOD_OPTIONS.map((o) => o.value),
  "all",
);

/** 区間の選択（試合全体は null） */
export function gameRecordPeriodOf(value: PeriodRangeValue): GameRecordPeriod | null {
  return value === "all" ? null : (value as GameRecordPeriod);
}

/** 区間の表示名（タイトルの下の行・画像のファイル名） */
export function gameRecordPeriodLabel(value: PeriodRangeValue): string | null {
  if (value === "all") return null;
  if (value === "h1") return "試合前半";
  if (value === "h2") return "試合後半";
  return GAME_RECORD_PERIOD_OPTIONS.find((o) => o.value === value)?.label ?? null;
}

/** 区間を選んだとき、記録の種類「ワースト」を選べない理由 */
export const PERIOD_WORST_UNSUPPORTED_REASON =
  "Q別・前後半・延長では、ワースト（少ない順）は選べません。少ない方から並べると、0の同率が大量に並ぶためです（試合全体のときだけ選べます）。";

/** 区間を選んだとき、被アシスト率を選べない理由（最低得点20点が、区間では成り立たない） */
export const PERIOD_ASTED_UNSUPPORTED_REASON = "被アシスト率は、得点20点以上の試合が対象のため、Q別・前後半・延長では選べません。";

/** 範囲「シーズン」で、+/- を選べない理由。公式のピリオド別の +/- は2022-23以降だけ */
export const PERIOD_PLUS_MINUS_FIRST_SEASON = "2022-23";
export function periodPlusMinusUnsupported(season: string): boolean {
  return season < PERIOD_PLUS_MINUS_FIRST_SEASON;
}
export const PERIOD_PLUS_MINUS_UNSUPPORTED_REASON = `${PERIOD_PLUS_MINUS_FIRST_SEASON}より前は、公式の記録にQ別・前後半の+/-が無いため選べません。`;
export const PERIOD_PLUS_MINUS_NOTE = `${PERIOD_PLUS_MINUS_FIRST_SEASON}より前は、公式の記録にQ別・前後半の+/-が無いため、含めていません。`;
