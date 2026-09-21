/** 出場率スライダー・追加基準スライダーで共通利用する単一ハンドルの範囲スライダー
 * （ランキングの掲載基準・チーム詳細のチーム内リーダーで共通。PlayersListPage.tsxのGamesPlayedRatioSlider＝2本のtype="range"を重ねる下限/上限指定と
 * 同じ.dual-range系CSSクラスを流用するが、こちらはハンドルが1本の最低ライン指定のみ） */
export function EligibilitySlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="dual-range">
      <div className="dual-range-labels">
        {label}: {format(value)}以上
      </div>
      <div className="dual-range-track-wrap">
        <div className="dual-range-track">
          <div className="dual-range-fill" style={{ left: 0, width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="dual-range-input"
          aria-label={label}
        />
      </div>
    </div>
  );
}
