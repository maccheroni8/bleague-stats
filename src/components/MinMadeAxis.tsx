import type { FilterAxis } from "../lib/filterAxes";
import { effectiveMinMade } from "../lib/minCriterion";
import { EligibilitySlider } from "./EligibilitySlider";
import { NoCriterionCheckbox } from "./NoCriterionCheckbox";

/**
 * 1試合記録の成功率の項目の「掲載基準」（最低成功数。例「FGM 5以上」）を、詳細フィルタで変える・外す軸（個人・チームで共通）。
 * value は URL の値（-1＝最初の基準、0＝基準なし、1以上＝その成功数以上）。最初の基準のままなら、チップは出ない
 */
export function minMadeAxis({ value, base, ruleLabel, max, onChange, disabledReason }: {
  value: number;
  /** 最初の基準（成功率でない項目は null） */
  base: number | null;
  ruleLabel: string | undefined;
  max: number;
  onChange: (value: number) => void;
  disabledReason?: string;
}): FilterAxis {
  const eff = base === null ? 0 : effectiveMinMade(value, base);
  const summary = eff === 0 ? "掲載基準なし" : `${ruleLabel} ${eff}以上`;
  return {
    kind: "popover",
    id: "minMade",
    label: "掲載基準",
    tier: "advanced",
    disabledReason: base === null ? (disabledReason ?? "この項目には、成功数の掲載基準はありません。") : undefined,
    value: String(value),
    defaultValue: "-1",
    onChange: () => onChange(-1),
    summary,
    chipValue: summary,
    content: (
      <>
        <NoCriterionCheckbox checked={eff === 0} onChange={(none) => onChange(none ? 0 : -1)} />
        {base !== null && eff > 0 && (
          <EligibilitySlider
            label={ruleLabel ?? "成功数"}
            value={eff}
            min={1}
            max={Math.max(max, eff)}
            step={1}
            format={(v) => String(v)}
            onChange={(v) => onChange(v === base ? -1 : v)}
          />
        )}
      </>
    ),
  };
}
