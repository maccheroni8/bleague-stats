/** 掲載基準の「基準なし」のチェック（入れると、項目ごとに前もって決めてある基準を外す。外すと、その項目の最初の基準に戻る） */
export function NoCriterionCheckbox({ checked, onChange, label = "基準なし" }: { checked: boolean; onChange: (checked: boolean) => void; label?: string }) {
  return (
    <label className="filter-multi-item">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
