import type { PeriodRangeOption, PeriodRangeValue } from "../lib/periodRange";

interface PeriodRangeToggleProps {
  options: PeriodRangeOption[];
  value: PeriodRangeValue;
  onChange: (value: PeriodRangeValue) => void;
}

/**
 * 試合/1Q/2Q/3Q/4Q/(OT)/前半/後半を切り替える汎用トグル。
 * ショットチャート・ボックススコア等、Period単位のデータを持つ画面で共用する想定。
 */
export function PeriodRangeToggle({ options, value, onChange }: PeriodRangeToggleProps) {
  return (
    <div className="mode-toggle period-range-toggle">
      {options.map((opt) => (
        <button key={opt.value} className={opt.value === value ? "active" : ""} onClick={() => onChange(opt.value)}>
          {opt.label}
        </button>
      ))}
    </div>
  );
}
