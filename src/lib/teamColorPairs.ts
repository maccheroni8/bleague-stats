// 同じ画面に並ぶ2チーム以上のチームカラーが近いときに、後のチーム（試合のアウェイ、比較の2つ目以降）をサブカラーに替える
// （2026-09-26、DESIGN.md 156章）。「近い」は CIEDE2000 の色差が 15 未満（人の目に近く見える色の差を測る国際規格の式。
// おおむね 10 未満は並べても見分けにくく、20 以上ならはっきり違う色に見える）。サブカラーも前のチームの色に近いときは替えない
import { MONO_FALLBACK_COLOR } from "./color";

export const CLOSE_COLOR_DELTA_E = 15;

/** 色差の計算に使う実際の色（テーマの文字色はライトテーマの値で代表する） */
function resolveHex(color: string | undefined): string | null {
  if (!color) return null;
  if (color === MONO_FALLBACK_COLOR) return "#1a1a1a";
  return /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function hexToLab(hex: string): [number, number, number] {
  const n = hex.slice(1);
  const [r, g, b] = [0, 2, 4].map((i) => {
    const v = parseInt(n.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}

/** CIEDE2000 の色差 */
export function deltaE2000(hex1: string, hex2: string): number {
  const [L1, a1, b1] = hexToLab(hex1);
  const [L2, a2, b2] = hexToLab(hex2);
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (a: number, b: number) => {
    const v = Math.atan2(b, a) / rad;
    return v < 0 ? v + 360 : v;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);
  const dL = L2 - L1;
  const dC = C2p - C1p;
  let dh = h2p - h1p;
  if (C1p * C2p === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2;
  const Cbp = (C1p + C2p) / 2;
  let hb = h1p + h2p;
  if (C1p * C2p !== 0) {
    hb = Math.abs(h1p - h2p) > 180 ? (h1p + h2p + 360) / 2 : (h1p + h2p) / 2;
    if (hb >= 360) hb -= 360;
  }
  const T =
    1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad) + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.2 * Math.cos((4 * hb - 63) * rad);
  const dTheta = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const SC = 1 + 0.045 * Cbp;
  const SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin(2 * dTheta * rad) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

function isClose(a: string | undefined, b: string | undefined): boolean {
  const ha = resolveHex(a);
  const hb = resolveHex(b);
  if (!ha || !hb) return a !== undefined && a === b;
  return deltaE2000(ha, hb) < CLOSE_COLOR_DELTA_E;
}

/**
 * 並んだチームの表示色を決める。先頭はメインのまま、2つ目以降は、それまでに決まった色のどれかに近ければサブカラーに替える。
 * サブカラーも近いときは、近かった前のチームのほうをサブカラーに替える（例: 横浜BCのホームに長崎がアウェイで来たとき、長崎の
 * サブカラー（キャンバスホワイト＝文字色）も横浜BCの紺に近いため、横浜BCを赤にする）。それでも近ければメインのまま
 */
export function distinctTeamColors(entries: { primary?: string; sub?: string }[]): (string | undefined)[] {
  const chosen: (string | undefined)[] = [];
  entries.forEach((e, i) => {
    const conflicts = chosen.map((c, j) => (isClose(c, e.primary) ? j : -1)).filter((j) => j >= 0);
    if (i === 0 || conflicts.length === 0) {
      chosen.push(e.primary);
      return;
    }
    if (e.sub && !chosen.some((c) => isClose(c, e.sub))) {
      chosen.push(e.sub);
      return;
    }
    // 前のチームをサブカラーに替えられるか（替えた色が、今のチームのメインにも、ほかのチームの色にも近くないこと）
    const swappable = conflicts.every((j) => {
      const prevSub = entries[j]!.sub;
      return prevSub !== undefined && !isClose(prevSub, e.primary) && !chosen.some((c, k) => k !== j && isClose(c, prevSub));
    });
    if (swappable) for (const j of conflicts) chosen[j] = entries[j]!.sub;
    chosen.push(e.primary);
  });
  return chosen;
}
