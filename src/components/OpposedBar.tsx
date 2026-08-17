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
}: OpposedBarRowProps) {
  const max = scale === "fixed100" ? 100 : Math.max(homeValue, awayValue, 1);
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
