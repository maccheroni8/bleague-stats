// ランキング > 個人 > 達成記録（DESIGN.md 223章）のURL。しきい値は 1試合記録のスタッツの条件と同じ書き方（sc=pts.ge.20,reb.ge.10 と sm=any）で、
// 何も指定しないときは「PTS 以上 20」（DEFAULT_THRESHOLD）。単位 tu、達成試合数の並び by、年齢の向き ao、継続中だけ cur
import type { StatConditionsState } from "./statConditions";
import { DEFAULT_THRESHOLD, type ThresholdAgeWhich, type ThresholdCountSort } from "./thresholdQuery";
import { enumParam, statConditionsParam, type UrlCodec } from "./urlState";

/** 達成記録の中の3つ（達成試合数・連続記録・達成時の年齢） */
export type ThresholdUnit = "count" | "streak" | "age";
export const THRESHOLD_UNITS: ThresholdUnit[] = ["count", "streak", "age"];
export const THRESHOLD_UNIT_LABELS: Record<ThresholdUnit, string> = { count: "達成試合数", streak: "連続記録", age: "達成時の年齢" };

export const THRESHOLD_UNIT_PARAM = enumParam<ThresholdUnit>("tu", ["count", "streak", "age"], "count");
export const THRESHOLD_SORT_PARAM = enumParam<ThresholdCountSort>("by", ["count", "rate"], "count");
export const THRESHOLD_AGE_PARAM = enumParam<ThresholdAgeWhich>("ao", ["young", "old"], "young");
export type OngoingFilter = "all" | "ongoing";
export const THRESHOLD_ONGOING_PARAM = enumParam<OngoingFilter>("cur", ["all", "ongoing"], "all", { ongoing: "1" });

const isDefaultConditions = (v: StatConditionsState): boolean => {
  const d = DEFAULT_THRESHOLD.conditions[0]!;
  const c = v.conditions[0];
  return v.conditions.length === 1 && !!c && c.key === d.key && c.op === d.op && c.value === d.value;
};

/** しきい値。URLに無い（または条件が空の）ときは既定の「PTS 以上 20」。既定の条件のときは sc を載せない（sm=any だけは載せる） */
export const thresholdParam: UrlCodec<StatConditionsState> = {
  keys: statConditionsParam.keys,
  read: (p) => {
    const s = statConditionsParam.read(p);
    if (!s) return undefined;
    return s.conditions.length === 0 ? { match: s.match, conditions: DEFAULT_THRESHOLD.conditions } : s;
  },
  write: (p, v) => {
    if (isDefaultConditions(v)) {
      if (v.match === "any") p.set("sm", "any");
      return;
    }
    statConditionsParam.write(p, v);
  },
};
