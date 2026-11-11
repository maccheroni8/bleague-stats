import { AchievableCheckbox } from "../components/AchievableCheckbox";
import { EligibilitySlider } from "../components/EligibilitySlider";
import type { FilterAxis } from "../lib/filterAxes";
import { eligibilityLabels } from "../lib/conditionLabels";

/**
 * 図解の「掲載基準」（出場率◯%以上）。ランキングの掲載基準と同じ形：ボタンに今の値（「出場率85%以上」）が出て、
 * 押すとスライダーの小窓が開く。achievable を渡すと、ランキングと同じ「◯%以上達成可能」のチェックを出す
 * （supported が false のとき〔B.ONE で日程が足りない間〕はチェックを出さない）。年齢分布・トップスコアラー・散布図・ベン図・シュート成功率で共通
 */
export function ratioEligibilityAxis({ id, value, defaultValue, onChange, achievable }: {
  id: string; value: number; defaultValue: number; onChange: (value: number) => void;
  achievable?: { checked: boolean; onChange: (checked: boolean) => void; supported: boolean };
}): FilterAxis {
  const checked = !!achievable?.supported && achievable.checked;
  const summary = eligibilityLabels({ gamesRatio: value / 100, achievable: checked }).join("");
  return {
    kind: "popover", id, label: "掲載基準", tier: "primary",
    value: `${value}|${checked ? "ach" : ""}`, defaultValue: `${defaultValue}|`,
    onChange: () => { onChange(defaultValue); achievable?.onChange(false); },
    summary, chipValue: summary,
    content: <>
      <EligibilitySlider label="出場率" value={value} min={0} max={100} step={1} format={v => `${v}%`} onChange={onChange} />
      {achievable?.supported && <AchievableCheckbox ratioPercent={value} checked={achievable.checked} onChange={achievable.onChange} />}
    </>,
  };
}
