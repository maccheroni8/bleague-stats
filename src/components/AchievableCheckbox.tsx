/** 掲載基準の「◯%以上達成可能」のチェック（ランキングと同じ見た目。DESIGN.md 249章・365章）。ratioPercent は出場率の下限（%） */
export function AchievableCheckbox({ ratioPercent, checked, onChange }: { ratioPercent: number; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="filter-multi-item">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {ratioPercent}%以上達成可能
    </label>
  );
}
