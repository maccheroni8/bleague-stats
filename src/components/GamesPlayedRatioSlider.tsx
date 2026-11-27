// 出場試合率（所属チームの試合数に対する出場試合数の割合）を絞り込む、下限・上限を
// それぞれ動かせる範囲スライダー。旅行予約サイトの価格帯フィルタと同じ実装パターン
// （2本のtype="range"を重ね、トラックはpointer-events:noneでつまみだけ操作可能にする）
export function GamesPlayedRatioSlider({
  min,
  max,
  onChange,
  label = "出場試合率",
}: {
  label?: string;
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}) {
  return (
    <div className="dual-range">
      <div className="dual-range-labels">
        {label}: {min}%〜{max}%
      </div>
      <div className="dual-range-track-wrap">
        <div className="dual-range-track">
          <div className="dual-range-fill" style={{ left: `${min}%`, width: `${max - min}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={min}
          onChange={(e) => onChange(Math.min(Number(e.target.value), max), max)}
          className="dual-range-input"
          style={{ zIndex: min >= 50 && min >= max ? 2 : 1 }}
          aria-label={`${label}の下限`}
        />
        <input
          type="range"
          min={0}
          max={100}
          value={max}
          onChange={(e) => onChange(min, Math.max(Number(e.target.value), min))}
          className="dual-range-input"
          aria-label={`${label}の上限`}
        />
      </div>
    </div>
  );
}

