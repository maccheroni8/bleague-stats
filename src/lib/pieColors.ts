// 円グラフの区分の色。そのチームのチームカラーの明るさを段階的に変えた色で塗り分ける（DESIGN.md 182章）。
// 色相はチームカラーのまま、明るさ（OKLCH の L）を区分の数だけ等間隔に並べる。段の範囲は絶対値で決める（チームカラー自体が
// 明るい黄色でも暗い紺でも、同じ幅で段ができる）。文字（区分の中の数値）は、塗った色に対して黒か白のどちらかコントラストの高いほう。
import { MONO_FALLBACK_COLOR } from "./color";

export type PieTheme = "light" | "dark";

export interface PieShade {
  fill: string;
  /** 区分の中の文字の色 */
  text: string;
}

/** 段の明るさの範囲（OKLCH の L）。いちばん濃い段〜いちばん薄い段 */
const L_RANGE: Record<PieTheme, [number, number]> = {
  light: [0.42, 0.88],
  dark: [0.5, 0.9],
};

/** 色相が分かる最低限の彩度（暗い紺・無彩色に近い色でも、段が青みを保つ） */
const MIN_CHROMA = 0.045;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function srgbToLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb(v: number): number {
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

/** "#rrggbb" → OKLCH（L: 0〜1、C、H: 度） */
export function hexToOklch(hex: string): { l: number; c: number; h: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return null;
  const n = m[1]!;
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const mm = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * mm - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * mm + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * mm - 0.808675766 * s;
  const C = Math.hypot(a, bb);
  const H = (Math.atan2(bb, a) * 180) / Math.PI;
  return { l: L, c: C, h: H < 0 ? H + 360 : H };
}

function oklchToLinearRgb(L: number, C: number, H: number): [number, number, number] {
  const a = C * Math.cos((H * Math.PI) / 180);
  const b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

const inGamut = (rgb: [number, number, number]) => rgb.every((v) => v >= -0.0005 && v <= 1.0005);

/** OKLCH → "#rrggbb"。表示できない色は、彩度を下げて範囲内に収める */
export function oklchToHex(L: number, C: number, H: number): string {
  let c = C;
  let rgb = oklchToLinearRgb(L, c, H);
  for (let i = 0; i < 30 && !inGamut(rgb); i++) {
    c *= 0.9;
    rgb = oklchToLinearRgb(L, c, H);
  }
  return `#${rgb.map((v) => Math.round(clamp01(linearToSrgb(clamp01(v))) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** WCAG の相対輝度（0〜1） */
function luminance(hex: string): number {
  const n = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => srgbToLinear(parseInt(n.slice(i, i + 2), 16) / 255)) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** 塗った色の上に置く文字の色。黒か白のうち、コントラストの高いほう */
export function readableTextOn(fill: string): string {
  return contrastRatio(fill, "#000000") >= contrastRatio(fill, "#ffffff") ? "#000000" : "#ffffff";
}

/**
 * チームカラー base の明るさ違いを count 段つくる。先頭がいちばん濃く、後ろへいくほど薄い。
 * base が文字色（テーマ追従のモノクロ）のときは無彩色の段にする。色として読めないときも無彩色
 */
export function pieShades(base: string | undefined, count: number, theme: PieTheme): PieShade[] {
  const parsed = base && base !== MONO_FALLBACK_COLOR ? hexToOklch(base) : null;
  const hue = parsed?.h ?? 0;
  const chroma = parsed ? Math.max(parsed.c, MIN_CHROMA) : 0;
  const [lo, hi] = L_RANGE[theme];
  return Array.from({ length: count }, (_, i) => {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const fill = oklchToHex(lo + (hi - lo) * t, chroma, hue);
    return { fill, text: readableTextOn(fill) };
  });
}
