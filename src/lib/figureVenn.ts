// 画面専用（図解「ベン図」）。上位の選び方と、円の重なりへのロゴの置き方だけを扱う純粋な部品。
// 値の計算は全チームスタッツ・ランキングと同じ列定義（teamStatsColumns）を呼び出し側で渡す。
import { rankPositions } from "./seasonCompare";

export const VENN_TOP_OPTIONS = [5, 8, 10] as const;
export type VennTop = typeof VENN_TOP_OPTIONS[number];
export const DEFAULT_VENN_TOP: VennTop = 10;

export interface VennValue<T> {
  row: T;
  /** 並べ替えに使う元の値 */
  value: number;
  /** 画面に出す値（同じ順位かどうかは、ランキングと同じくこの文字列で決める） */
  text: string;
}
export interface VennRanked<T> extends VennValue<T> {
  /** ランキングと同じ順位（同じ表示値は同順位、次は飛ばす） */
  rank: number;
}

/**
 * 1つの円の元になる並び。値が有限でない行は除く。
 * higherIsBetter が false の項目（DRtg・TOV% など）は、小さいほうが上位。
 * 並べ方・同順位の判定は RankedList（ランキング）と同じ: 値で並べ、隣り合う行の表示値が同じなら同順位。
 */
export function rankVennRows<T>(rows: readonly VennValue<T>[], higherIsBetter: boolean): VennRanked<T>[] {
  const sorted = rows.filter(r => Number.isFinite(r.value)).sort((a, b) => (higherIsBetter ? b.value - a.value : a.value - b.value));
  const ranks = rankPositions(sorted.map(r => r.text));
  return sorted.map((r, i) => ({ ...r, rank: ranks[i]! }));
}

/**
 * 上位 n チーム。境目の順位が同じ値で並んだときは、同じ値のチームを全部入れる（n チームより多くなることがある）。
 * 順位が n 以下 ＝「n 番目と同じ表示値のチームまで」と同じ意味になる（同順位の先頭は、その値の最初の位置）。
 */
export function topVennRows<T>(ranked: readonly VennRanked<T>[], n: number): VennRanked<T>[] {
  return ranked.filter(r => r.rank <= n);
}

// ---- 円と重なりの配置 ----

/** 設計上の幅（この幅を 1 として位置・大きさを決め、画面の幅に合わせて拡縮する） */
export const VENN_DESIGN_WIDTH = 640;
export const VENN_RADIUS = 200;
/** 3つの円の中心。左上・右上・下。中心間の距離は半径と同じ（真ん中も、2つだけの重なりも、ロゴが入る広さになる） */
export const VENN_CENTERS = [
  { x: 220, y: 210 },
  { x: 420, y: 210 },
  { x: 320, y: 383 },
] as const;
export const VENN_DESIGN_HEIGHT = 593;

export type VennMask = number; // 1=左上の円, 2=右上の円, 4=下の円 の組み合わせ（0=どれにも入らない）
export const VENN_MASKS = [7, 3, 5, 6, 1, 2, 4] as const;

export function vennMaskAt(x: number, y: number, scale = 1, margin = 0): VennMask | null {
  let mask = 0;
  for (let i = 0; i < 3; i++) {
    const c = VENN_CENTERS[i]!;
    const d = Math.hypot(x - c.x * scale, y - c.y * scale);
    const r = VENN_RADIUS * scale;
    if (Math.abs(d - r) < margin) return null; // 境目に近い点は、どの重なりにも属さないものとして扱う
    if (d < r) mask |= 1 << i;
  }
  return mask;
}
/** 円ごとの所属（円 i に入っているか） */
export const inCircle = (mask: VennMask, circle: 0 | 1 | 2) => (mask & (1 << circle)) !== 0;

export interface VennItemBox { width: number; height: number }
export interface VennPlacement { x: number; y: number }
export interface VennLayout<K> {
  /** ロゴの1辺（px） */
  logo: number;
  /** 1つの置き場所の幅・高さ（ロゴ＋略称。px） */
  box: VennItemBox;
  /** 略称をロゴの下に出すか（幅が狭くてロゴが小さくなりすぎるときは、ロゴだけにする） */
  labels: boolean;
  placements: Map<K, VennPlacement>;
  /** すべての置き場所が重ならず、領域に収まったか */
  fitted: boolean;
}

export interface VennLayoutOptions {
  size: number; labelFont: number;
  /** 置いてはいけない枠（円の名前など。px。中心の座標と幅・高さ） */
  obstacles?: readonly VennRect[];
  /** 略称つきのロゴの最小の大きさ（これより小さくなるなら、略称を外してロゴを大きくする） */
  minLogoWithLabel?: number;
  /** ロゴだけのときの最小の大きさ */
  minLogo?: number;
  maxLogo?: number;
}

/** 文字列の幅の見積もり（全角は1文字ぶん、半角は0.6文字ぶん） */
export function textWidthEstimate(text: string, font: number): number {
  let w = 0;
  for (const ch of text) w += (ch.codePointAt(0)! > 0xff ? 1 : 0.6) * font;
  return w;
}

interface Candidate { x: number; y: number }
const GAP = 2;
const INSIDE = 0.7;

/** 領域 mask の中で、箱（w×h）が円の境目をまたがずに置ける中心の候補 */
function candidatesFor(mask: VennMask, w: number, h: number, scale: number, step: number): Candidate[] {
  const out: Candidate[] = [];
  // 箱の中心に近い部分（箱の7割）が領域の中にあればよい（ロゴのふちが円の線に少しかかるのは許す。所属はロゴの中心で決まる）
  const xs = [-w * INSIDE / 2, 0, w * INSIDE / 2], ys = [-h * INSIDE / 2, 0, h * INSIDE / 2];
  const m = 3;
  const x0 = Math.min(...VENN_CENTERS.map(c => c.x)) * scale - VENN_RADIUS * scale, x1 = Math.max(...VENN_CENTERS.map(c => c.x)) * scale + VENN_RADIUS * scale;
  const y0 = Math.min(...VENN_CENTERS.map(c => c.y)) * scale - VENN_RADIUS * scale, y1 = Math.max(...VENN_CENTERS.map(c => c.y)) * scale + VENN_RADIUS * scale;
  for (let y = y0; y <= y1; y += step) {
    for (let x = x0; x <= x1; x += step) {
      let ok = true;
      for (const dy of ys) {
        for (const dx of xs) {
          const px = x + dx + Math.sign(dx) * m, py = y + dy + Math.sign(dy) * m;
          if (vennMaskAt(px, py, scale, m) !== mask) { ok = false; break; }
        }
        if (!ok) break;
      }
      if (ok) out.push({ x, y });
    }
  }
  return out;
}

/** 置き場所の候補から、できるだけ互いに離れた k か所を選ぶ。置けないときは null */
function spread(cands: Candidate[], k: number, w: number, h: number): Candidate[] | null {
  if (k === 0) return [];
  if (cands.length < k) return null;
  const dist = (a: Candidate, b: Candidate) => Math.max(Math.abs(a.x - b.x) / (w + GAP), Math.abs(a.y - b.y) / (h + GAP));
  const mx = cands.reduce((s, c) => s + c.x, 0) / cands.length, my = cands.reduce((s, c) => s + c.y, 0) / cands.length;
  let first = cands[0]!;
  for (const c of cands) if (Math.hypot(c.x - mx, c.y - my) < Math.hypot(first.x - mx, first.y - my)) first = c;
  const chosen = [first];
  const minDist = new Map<Candidate, number>(cands.map(c => [c, dist(c, first)]));
  while (chosen.length < k) {
    let best: Candidate | null = null, bestD = -1;
    for (const c of cands) {
      const d = minDist.get(c)!;
      if (d > bestD) { bestD = d; best = c; }
    }
    if (!best || bestD < 1) return null;
    chosen.push(best);
    for (const c of cands) minDist.set(c, Math.min(minDist.get(c)!, dist(c, best)));
  }
  // 中心に寄った並びを、各点が「ほかの点から最も遠い候補」へ動けるときは動かして均す
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < chosen.length; i++) {
      const others = chosen.filter((_, j) => j !== i);
      let best = chosen[i]!, bestD = Math.min(...others.map(o => dist(best, o)), 99);
      for (const c of cands) {
        const d = Math.min(...others.map(o => dist(c, o)), 99);
        if (d > bestD + 1e-9) { bestD = d; best = c; }
      }
      chosen[i] = best;
    }
  }
  chosen.sort((a, b) => a.y - b.y || a.x - b.x);
  return chosen;
}

export interface VennRect { x: number; y: number; width: number; height: number }
const rectsOverlap = (a: VennRect, b: VennRect) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 + GAP && Math.abs(a.y - b.y) < (a.height + b.height) / 2 + GAP;

function tryLayout<K>(groups: ReadonlyMap<VennMask, readonly { key: K; label: string }[]>, scale: number, box: VennItemBox, obstacles: readonly VennRect[]): Map<K, VennPlacement> | null {
  const placements = new Map<K, VennPlacement>();
  // 箱は円の線に少しかかってよいので、ほかの領域の箱・円の名前の枠とも重ならないようにする。候補の少ない（狭い）領域から先に置く
  const placed: VennRect[] = [...obstacles];
  const entries = [...groups].filter(([, items]) => items.length).map(([mask, items]) => ({
    mask, items,
    cands: candidatesFor(mask, box.width, box.height, scale, Math.max(2, Math.round(box.height / 8))).filter(c => !obstacles.some(o => rectsOverlap({ x: c.x, y: c.y, ...box }, o))),
  }));
  entries.sort((a, b) => a.cands.length / a.items.length - b.cands.length / b.items.length);
  for (const { items, cands } of entries) {
    const free = cands.filter(c => placed.every(q => !rectsOverlap({ x: c.x, y: c.y, ...box }, q)));
    const chosen = spread(free, items.length, box.width, box.height);
    if (!chosen) return null;
    items.forEach((item, i) => placements.set(item.key, chosen[i]!));
    placed.push(...chosen.map(c => ({ x: c.x, y: c.y, ...box })));
  }
  return placements;
}

/**
 * 重なりごとのチームを、ロゴの大きさをできるだけ大きくして並べる。
 * 全部の領域に収まる最大のロゴの大きさを、大きいほうから探す（画面の幅 size に合わせて、円の大きさも拡縮する）。
 * 略称つきでロゴが minLogoWithLabel 以上になるならそれを使い、ならないとき（スマホ幅）はロゴだけにして大きくする。
 */
export function layoutVenn<K>(groups: ReadonlyMap<VennMask, readonly { key: K; label: string }[]>, opts: VennLayoutOptions): VennLayout<K> {
  const scale = opts.size / VENN_DESIGN_WIDTH;
  const maxLogo = opts.maxLogo ?? 46 * scale;
  const minWithLabel = opts.minLogoWithLabel ?? 16, minLogo = opts.minLogo ?? 14;
  const labelWidth = Math.max(0, ...[...groups.values()].flat().map(i => textWidthEstimate(i.label, opts.labelFont)));
  for (const withLabel of [true, false]) {
    const floor = withLabel ? minWithLabel : minLogo;
    for (let logo = Math.max(maxLogo, floor); logo >= floor - 1e-9; logo -= 2) {
      const box = withLabel ? { width: Math.max(logo, labelWidth) + 2, height: logo + opts.labelFont + 4 } : { width: logo + 2, height: logo + 2 };
      const placements = tryLayout(groups, scale, box, opts.obstacles ?? []);
      if (placements) return { logo, box, labels: withLabel, placements, fitted: true };
    }
  }
  // どの大きさでも収まらないとき（チームが多すぎる）は、いちばん小さい大きさで領域の中心に集めて返す
  const box = { width: minLogo + 2, height: minLogo + 2 };
  const placements = new Map<K, VennPlacement>();
  for (const [mask, items] of groups) {
    const cands = candidatesFor(mask, 4, 4, scale, 4);
    const cx = cands.length ? cands.reduce((s, c) => s + c.x, 0) / cands.length : opts.size / 2;
    const cy = cands.length ? cands.reduce((s, c) => s + c.y, 0) / cands.length : opts.size / 2;
    items.forEach((item, i) => placements.set(item.key, { x: cx + (i - (items.length - 1) / 2) * 6, y: cy }));
  }
  return { logo: minLogo, box, labels: false, placements, fitted: false };
}

// ---- 3つの円の所属 ----

export interface VennCircleSpec<T> {
  value: (row: T) => number;
  text: (row: T) => string;
  higherIsBetter: boolean;
}
export interface VennModel<T> {
  /** 円ごとの並び（値が有限な行だけ。順位つき） */
  ranked: [VennRanked<T>[], VennRanked<T>[], VennRanked<T>[]];
  /** 円ごとの、その行の順位（並びに入らない行は無い） */
  rankOf: [Map<string, number>, Map<string, number>, Map<string, number>];
  /** 円ごとの上位の行 */
  members: [VennRanked<T>[], VennRanked<T>[], VennRanked<T>[]];
  /** 行ごとの所属（1=左上, 2=右上, 4=下） */
  maskOf: Map<string, VennMask>;
  /** 領域（0 以外）ごとの行。0 はどの円にも入らない行 */
  regions: Map<VennMask, T[]>;
}
export function computeVenn<T>(rows: readonly T[], keyOf: (row: T) => string, specs: readonly [VennCircleSpec<T>, VennCircleSpec<T>, VennCircleSpec<T>], pick: number | ((ranked: VennRanked<T>[], circle: number) => VennRanked<T>[])): VennModel<T> {
  const ranked = specs.map(s => rankVennRows(rows.map(row => ({ row, value: s.value(row), text: s.text(row) })), s.higherIsBetter)) as VennModel<T>['ranked'];
  const members = ranked.map((r, i) => typeof pick === 'number' ? topVennRows(r, pick) : pick(r, i)) as VennModel<T>['members'];
  const rankOf = ranked.map(r => new Map(r.map(x => [keyOf(x.row), x.rank]))) as VennModel<T>['rankOf'];
  const maskOf = new Map<string, VennMask>();
  const regions = new Map<VennMask, T[]>();
  for (const row of rows) {
    const key = keyOf(row);
    let mask = 0;
    for (let i = 0; i < 3; i++) if (members[i]!.some(m => keyOf(m.row) === key)) mask |= 1 << i;
    maskOf.set(key, mask);
    if (!regions.has(mask)) regions.set(mask, []);
    regions.get(mask)!.push(row);
  }
  return { ranked, rankOf, members, maskOf, regions };
}


// ---- 円の名前（円の中の空いている場所） ----

/** 円の名前を書く枠（円ごと）。円の外側の、ほかの円と重ならない場所（左上の円は左上、右上は右上、下は下）に置く。 */
export function vennLabelBoxes(size: number, lines: readonly (readonly string[])[], font: number): VennRect[] {
  const scale = size / VENN_DESIGN_WIDTH;
  const cx = VENN_CENTERS.reduce((s, c) => s + c.x, 0) / 3, cy = VENN_CENTERS.reduce((s, c) => s + c.y, 0) / 3;
  return VENN_CENTERS.map((c, i) => {
    const width = Math.max(...lines[i]!.map(l => textWidthEstimate(l, font))) + 6, height = lines[i]!.length * (font + 3) + 3;
    const dx = c.x - cx, dy = c.y - cy, len = Math.hypot(dx, dy);
    // 円の中心から、ほかの円と反対の向きへ半径の約0.6倍
    const x = (c.x + dx / len * VENN_RADIUS * 0.6) * scale, y = (c.y + dy / len * VENN_RADIUS * 0.6) * scale;
    return { x: Math.max(width / 2 + 2, Math.min(size - width / 2 - 2, x)), y, width, height };
  });
}

// ---- 値で絞る ----

/** 画面に出している値の文字（「115.00」「35.06%」「+3.20」「28:30」「1,234」）を数にする。読めなければ NaN */
export function displayNumber(text: string): number {
  const t = text.trim();
  const clock = /^(-?)(\d+):(\d{2})$/.exec(t);
  if (clock) return (clock[1] ? -1 : 1) * (Number(clock[2]) + Number(clock[3]) / 60);
  return Number(t.replace(/[,%+]/g, ''));
}
/**
 * 基準の値で絞った円の行。値は画面に出している値（丸めた後）で比べる（同じ表示なら同じ扱い。順位で絞るときの同値の扱いと同じ）。
 * 良い向きが「多いほう」なら基準以上、「少ないほう」なら基準以下（基準と同じ値は入る）。
 */
export function thresholdVennRows<T>(ranked: readonly VennRanked<T>[], threshold: number, higherIsBetter: boolean): VennRanked<T>[] {
  return ranked.filter(r => { const v = displayNumber(r.text); return Number.isFinite(v) && (higherIsBetter ? v >= threshold - 1e-9 : v <= threshold + 1e-9); });
}

// ---- 強調するクラブのロゴの倍率 ----

/**
 * 強調するクラブのロゴは、手前に出して最大 max 倍にする。ほかのロゴ・円の名前の枠と重なるときは、重ならない範囲の倍率に下げる（1倍より小さくはしない）。
 * 強調するクラブどうしも、先に決めた倍率の枠と重ならないようにする。
 */
export function vennEmphasisScales<K>(placements: ReadonlyMap<K, VennPlacement>, box: VennItemBox, emphasized: ReadonlySet<K>, obstacles: readonly VennRect[] = [], max = 1.3): Map<K, number> {
  const scales = new Map<K, number>();
  const rectOf = (key: K, f: number): VennRect => { const p = placements.get(key)!; return { x: p.x, y: p.y, width: box.width * f, height: box.height * f }; };
  const overlap = (a: VennRect, b: VennRect) => Math.abs(a.x - b.x) < (a.width + b.width) / 2 && Math.abs(a.y - b.y) < (a.height + b.height) / 2;
  for (const key of placements.keys()) {
    if (!emphasized.has(key)) continue;
    let chosen = 1;
    for (let f = max; f > 1 + 1e-9; f -= 0.05) {
      const mine = rectOf(key, f);
      const others = [...placements.keys()].filter(k => k !== key).map(k => rectOf(k, scales.get(k) ?? 1));
      if (![...others, ...obstacles].some(o => overlap(mine, o))) { chosen = Number(f.toFixed(2)); break; }
    }
    scales.set(key, chosen);
  }
  return scales;
}
