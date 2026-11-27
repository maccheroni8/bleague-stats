import { ACHIEVABLE_BASE_PERCENT } from "../lib/gamesPlayedRatio";

/** 掲載基準の「85%以上達成可能」のチェック（基準は85%で固定。スライダーの値では動かない。DESIGN.md 249章・365章・476章） */
export function AchievableCheckbox({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="filter-multi-item">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {ACHIEVABLE_BASE_PERCENT}%以上達成可能
    </label>
  );
}
