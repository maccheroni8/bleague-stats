import type { FilterAxis } from '../lib/filterAxes';

/** 「軸の反転」のチェック（散布図）。ボタンに今の状態（なし／反転）が出て、押すとチェックの小窓が開く */
export function invertAxis({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (checked: boolean) => void }): FilterAxis {
  return {
    kind: 'popover', id, label, tier: 'primary', value: checked ? 'inv' : '', defaultValue: '', onChange: () => onChange(false),
    summary: checked ? '反転' : 'なし', chipValue: '反転',
    content: <label className="filter-multi-item"><input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />反転する（良いほうが{label.startsWith('縦') ? '上' : '右'}）</label>,
  };
}
