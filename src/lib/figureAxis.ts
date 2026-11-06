// 画面専用（図解の散布図）。軸の範囲は「固定の基本範囲」を基本にして、点がはみ出すときだけ広げる。
export interface AxisBase { lo: number; hi: number; step: number }
export interface AxisDomain { min: number; max: number; step: number; ticks: number[] }

/** きりのよい目盛り幅（1・2・5 × 10のべき乗）。約 target 本の目盛りになる幅 */
export function niceStep(span: number, target = 6): number {
  if (!(span > 0)) return 1;
  const raw = span / target;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const unit = raw / pow;
  return (unit < 1.5 ? 1 : unit < 3.5 ? 2 : unit < 7.5 ? 5 : 10) * pow;
}

const round6 = (v: number) => Number(v.toFixed(6));

export function axisDomain(values: readonly (number | null | undefined)[], base: AxisBase): AxisDomain {
  const valid = values.filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
  const { lo, hi, step } = base;
  const min = Math.min(lo, ...valid.map(v => Math.floor((v + 1e-9) / step) * step));
  const max = Math.max(hi, ...valid.map(v => Math.ceil((v - 1e-9) / step) * step));
  return { min: round6(min), max: round6(max), step, ticks: Array.from({ length: Math.round((max - min) / step) + 1 }, (_, i) => round6(min + i * step)) };
}

/** 合計に切り替えたときの基本範囲。1試合平均の基本範囲を、対象の試合数（games）倍にして目盛り幅をきりのよい値にする。 */
export function totalBase(perGame: AxisBase, games: number): AxisBase {
  const g = Math.max(1, games);
  const step = niceStep((perGame.hi - perGame.lo) * g);
  return { lo: Math.floor(perGame.lo * g / step) * step, hi: Math.ceil(perGame.hi * g / step) * step, step };
}
