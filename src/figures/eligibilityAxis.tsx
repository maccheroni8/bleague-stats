import { EligibilitySlider } from "../components/EligibilitySlider";
import type { FilterAxis } from "../lib/filterAxes";

/**
 * 図解の「掲載基準」（出場率◯%以上）。ランキングの掲載基準と同じ形：ボタンに今の値（「出場率85%以上」）が出て、
 * 押すとスライダーの小窓が開く。「達成可能」のチェックは付けない。年齢分布・トップスコアラー・USG% × PPP で共通
 */
export function ratioEligibilityAxis({ id, value, defaultValue, onChange }: {
  id: string; value: number; defaultValue: number; onChange: (value: number) => void;
}): FilterAxis {
  const summary = `出場率${value}%以上`;
  return {
    kind: "popover", id, label: "掲載基準", tier: "primary",
    value: String(value), defaultValue: String(defaultValue),
    onChange: () => onChange(defaultValue),
    summary, chipValue: summary,
    content: <EligibilitySlider label="出場率" value={value} min={0} max={100} step={1} format={v => `${v}%`} onChange={onChange} />,
  };
}
