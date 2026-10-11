interface OpposedBarRowProps {
  label: string;
  homeValue: number;
  awayValue: number;
  homeColor: string;
  awayColor: string;
  /** 表示用フォーマット。デフォルトは整数表示 */
  format?: (value: number) => string;
  /**
   * "fixed100"=0〜100の固定スケール（%系スタッツ用）。
   * "relative"=その行のhome/away最大値を100%とする相対スケール（デフォルト、件数系スタッツ用）
   */
  scale?: "fixed100" | "relative";
  /**
   * 指定すると、バーの長さの基準（これを100%とする）を固定する。左右の最大値を100%にすると、
   * 長い方の数値ボックスがカードの外へはみ出す（テンポと効率のように値が近い行で目立つ）ため、
   * 余白を持たせた基準を呼び出し側で渡す。fixed100・relative より優先する
   */
  maxValue?: number;
}

/**
 * ホーム/アウェイの値を、ラベルを挟んで左右に伸びるバーで対向表示する。
 * バーはラベル側（中央）を起点に外側へ伸び、数値ボックスはバー先端（実際の値の位置）に配置する
 */
export function OpposedBarRow({
  label,
  homeValue,
  awayValue,
  homeColor,
  awayColor,
  format = (v) => String(Math.round(v)),
  scale = "relative",
  maxValue,
}: OpposedBarRowProps) {
  const max = maxValue ?? (scale === "fixed100" ? 100 : Math.max(homeValue, awayValue, 1));
  const homePct = Math.max(0, Math.min(100, (homeValue / max) * 100));
  const awayPct = Math.max(0, Math.min(100, (awayValue / max) * 100));

  return (
    <div className="opposed-bar-row">
      <div className="opposed-bar-track">
        <div className="opposed-bar-fill opposed-bar-fill-home" style={{ width: `${homePct}%`, background: homeColor }} />
        <span className="opposed-bar-value opposed-bar-value-home" style={{ right: `${homePct}%`, borderColor: homeColor }}>
          {format(homeValue)}
        </span>
      </div>
      <span className="opposed-bar-label">{label}</span>
      <div className="opposed-bar-track">
        <div className="opposed-bar-fill opposed-bar-fill-away" style={{ width: `${awayPct}%`, background: awayColor }} />
        <span className="opposed-bar-value opposed-bar-value-away" style={{ left: `${awayPct}%`, borderColor: awayColor }}>
          {format(awayValue)}
        </span>
      </div>
    </div>
  );
}

interface OpposedValueRowProps {
  label: string;
  homeValue: number;
  awayValue: number;
  homeColor: string;
  awayColor: string;
  format?: (value: number) => string;
}

/**
 * ホーム/アウェイの値を、バーを描かずに数値だけで対向表示する（符号を持つ値＝NetRtgなど、
 * バーの長さにできない項目用）。ラベルと左右の位置は OpposedBarRow と同じ
 */
export function OpposedValueRow({
  label,
  homeValue,
  awayValue,
  homeColor,
  awayColor,
  format = (v) => String(Math.round(v)),
}: OpposedValueRowProps) {
  return (
    <div className="opposed-value-row">
      <div className="opposed-value-cell opposed-value-cell-home">
        <span className="opposed-value" style={{ borderColor: homeColor }}>
          {format(homeValue)}
        </span>
      </div>
      <span className="opposed-bar-label">{label}</span>
      <div className="opposed-value-cell opposed-value-cell-away">
        <span className="opposed-value" style={{ borderColor: awayColor }}>
          {format(awayValue)}
        </span>
      </div>
    </div>
  );
}
