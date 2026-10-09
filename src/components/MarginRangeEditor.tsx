import { useId } from "react";

/** 数字だけの入力（空は未指定）。全角数字も受け付ける */
function parseCount(text: string): number | undefined {
  const t = text.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/\D/g, "");
  return t === "" ? undefined : Number(t.slice(0, 3));
}

/**
 * 最終点差の範囲の入力欄（ランキングの1試合記録の詳細フィルタ。DESIGN.md 220章）。「◯点以上」「◯点以下」のどちらか片方だけでもよい。
 * 点差は勝敗によらない大きさ（勝った試合だけ・負けた試合だけにするときは「勝敗」と組み合わせる）
 */
export function MarginRangeEditor({
  min,
  max,
  onChange,
}: {
  min: number | undefined;
  max: number | undefined;
  onChange: (next: { min: number | undefined; max: number | undefined }) => void;
}) {
  const id = useId();
  const reversed = min !== undefined && max !== undefined && min > max;
  return (
    <div className="margin-range-editor">
      <div className="margin-range-row">
        <input
          id={`${id}-min`}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          aria-label="最終点差の下限（点）"
          value={min ?? ""}
          onChange={(e) => onChange({ min: parseCount(e.target.value), max })}
        />
        <label htmlFor={`${id}-min`}>点以上</label>
      </div>
      <div className="margin-range-row">
        <input
          id={`${id}-max`}
          type="text"
          inputMode="numeric"
          enterKeyHint="done"
          aria-label="最終点差の上限（点）"
          value={max ?? ""}
          onChange={(e) => onChange({ min, max: parseCount(e.target.value) })}
        />
        <label htmlFor={`${id}-max`}>点以下</label>
      </div>
      {reversed && <p className="filter-bar-note">下限が上限より大きいため、該当する試合はありません。</p>}
      <p className="margin-range-hint">点差の大きさで指定します（勝った試合・負けた試合は「勝敗」で選びます）</p>
    </div>
  );
}
