import { useEffect, useRef, useState } from "react";

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
  /** 棒の内側（端の近く）に出す補足（「21/40」など）。棒が短いときは棒のすぐ外に出す */
  homeDetail?: string;
  awayDetail?: string;
}

/** 数値ボックスの半分＋余白（棒の端から補足の文字までの距離） */
const DETAIL_OFFSET = 34;
/** 補足を棒の内側に収めるのに必要な棒の長さ（px） */
const DETAIL_INSIDE_MIN = 74;

/** 背景色の上で読める文字色（白か黒）。色名・var() などは判定できないので白 */
function inkOn(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return "#fff";
  const n = parseInt(m[1]!, 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.62 ? "#111" : "#fff";
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
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
  homeDetail,
  awayDetail,
}: OpposedBarRowProps) {
  const [homeRef, homeW] = useWidth<HTMLDivElement>();
  const [awayRef, awayW] = useWidth<HTMLDivElement>();
  const max = maxValue ?? (scale === "fixed100" ? 100 : Math.max(homeValue, awayValue, 1));
  const homePct = Math.max(0, Math.min(100, (homeValue / max) * 100));
  const awayPct = Math.max(0, Math.min(100, (awayValue / max) * 100));

  return (
    <div className="opposed-bar-row">
      <div className="opposed-bar-track" ref={homeRef}>
        <div className="opposed-bar-fill opposed-bar-fill-home" style={{ width: `${homePct}%`, background: homeColor }} />
        <span className="opposed-bar-value opposed-bar-value-home" style={{ right: `${homePct}%`, borderColor: homeColor }}>
          {format(homeValue)}
        </span>
        {homeDetail && (
          <span
            className="opposed-bar-detail"
            style={
              (homePct / 100) * homeW >= DETAIL_INSIDE_MIN
                ? { left: `calc(${100 - homePct}% + ${DETAIL_OFFSET}px)`, color: inkOn(homeColor) }
                : { right: `calc(${homePct}% + ${DETAIL_OFFSET}px)`, color: "var(--muted)" }
            }
          >
            {homeDetail}
          </span>
        )}
      </div>
      <span className="opposed-bar-label">{label}</span>
      <div className="opposed-bar-track" ref={awayRef}>
        <div className="opposed-bar-fill opposed-bar-fill-away" style={{ width: `${awayPct}%`, background: awayColor }} />
        <span className="opposed-bar-value opposed-bar-value-away" style={{ left: `${awayPct}%`, borderColor: awayColor }}>
          {format(awayValue)}
        </span>
        {awayDetail && (
          <span
            className="opposed-bar-detail"
            style={
              (awayPct / 100) * awayW >= DETAIL_INSIDE_MIN
                ? { right: `calc(${100 - awayPct}% + ${DETAIL_OFFSET}px)`, color: inkOn(awayColor) }
                : { left: `calc(${awayPct}% + ${DETAIL_OFFSET}px)`, color: "var(--muted)" }
            }
          >
            {awayDetail}
          </span>
        )}
      </div>
    </div>
  );
}
