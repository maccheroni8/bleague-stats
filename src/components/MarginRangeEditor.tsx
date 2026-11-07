import { useId } from "react";
import { NumberTextInput } from "./NumberTextInput";

const toCount = (text: string): number | undefined => (text === "" ? undefined : Number(text));

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
        <NumberTextInput
          id={`${id}-min`}
          kind="count"
          aria-label="最終点差の下限（点）"
          value={min === undefined ? "" : String(min)}
          onCommit={(text) => onChange({ min: toCount(text), max })}
        />
        <label htmlFor={`${id}-min`}>点以上</label>
      </div>
      <div className="margin-range-row">
        <NumberTextInput
          id={`${id}-max`}
          kind="count"
          aria-label="最終点差の上限（点）"
          value={max === undefined ? "" : String(max)}
          onCommit={(text) => onChange({ min, max: toCount(text) })}
        />
        <label htmlFor={`${id}-max`}>点以下</label>
      </div>
      {reversed && <p className="filter-bar-note">下限が上限より大きいため、該当する試合はありません。</p>}
      <p className="margin-range-hint">点差の大きさで指定します（勝った試合・負けた試合は「勝敗」で選びます）</p>
    </div>
  );
}
