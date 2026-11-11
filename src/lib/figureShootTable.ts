// 画面専用。図解「シュート成功率の一覧」（選手・チーム）の純粋な部分。
// 値・書式は全選手スタッツ／全チームスタッツと同じ列の定義をそのまま使う（図の部品で列を作る）。
// ここには「色の段階（パーセンタイル）」「対象の選び方」「並べ替え」だけを置く。

/** 色の段階の数。0＝悪い側 … 4＝良い側 */
export const SHOOT_LEVELS = 5;

/** 表に出した文字から数値を読む（「51.23%」→ 51.23、「-」→ null）。表示が同じ値は同じ扱いにするため、色・並べ替え・選び方はこの値を使う */
export function shownNumber(text: string): number | null {
  const t = text.trim();
  if (t === "" || t === "-" || t === "—") return null;
  const n = Number(t.replace(/[%,]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * 掲載基準を満たした全員（reference）の中での位置（パーセンタイル）で5段階にする。
 * 位置＝（自分より悪い人数＋同値の他の人数÷2）÷（人数−1）。同値は同じ段階。1人だけなら真ん中。
 * 表示する人を絞っても reference は変わらないので、色は変わらない。
 */
export function percentileLevel(value: number, reference: readonly number[], higherIsBetter = true): number {
  const n = reference.length;
  if (n < 2) return 2;
  const sign = higherIsBetter ? 1 : -1;
  const v = sign * value;
  let worse = 0, same = 0;
  for (const other of reference) {
    const o = sign * other;
    if (o < v) worse++;
    else if (o === v) same++;
  }
  const position = (worse + Math.max(same - 1, 0) / 2) / (n - 1);
  return Math.min(SHOOT_LEVELS - 1, Math.max(0, Math.floor(position * SHOOT_LEVELS)));
}

/** 対象の選手の決め方 */
export type ShootSelection = { kind: "min"; value: number } | { kind: "top"; n: number };
export const DEFAULT_SHOOT_MIN_PTS = 15;
export const DEFAULT_SHOOT_TOP_N = 20;

/**
 * 得点（表示した小数第2位までの値）で対象を選ぶ。
 * min＝得点が value 以上。top＝得点の多い順に上位 n 人（n 番目と同じ得点の人は全員入れる）。
 * 得点の値が無い人は入らない。
 */
export function selectByPoints<T>(rows: readonly T[], ptsOf: (row: T) => number | null, selection: ShootSelection): T[] {
  const valued = rows.flatMap(row => { const v = ptsOf(row); return v === null ? [] : [{ row, v }]; });
  if (selection.kind === "min") return valued.filter(x => x.v >= selection.value).map(x => x.row);
  const n = Math.max(0, Math.floor(selection.n));
  if (n === 0 || !valued.length) return [];
  const sorted = [...valued].sort((a, b) => b.v - a.v);
  if (sorted.length <= n) return sorted.map(x => x.row);
  const border = sorted[n - 1]!.v;
  return sorted.filter(x => x.v >= border).map(x => x.row);
}

/** 並べ替え。値の無い行は向きによらず最後。同値は元の並びのまま */
export function sortByValue<T>(rows: readonly T[], valueOf: (row: T) => number | null, descending: boolean): T[] {
  return rows.map((row, i) => ({ row, i, v: valueOf(row) })).sort((a, b) => {
    if (a.v === null && b.v === null) return a.i - b.i;
    if (a.v === null) return 1;
    if (b.v === null) return -1;
    return a.v === b.v ? a.i - b.i : descending ? b.v - a.v : a.v - b.v;
  }).map(x => x.row);
}

/** 並べた列の順位（同じ表示値は同順位、次は飛ばす）。並べ替えた行の並びに対応 */
export function sharedRanks<T>(rows: readonly T[], valueOf: (row: T) => number | null, descending: boolean): (number | null)[] {
  return rows.map(row => {
    const v = valueOf(row);
    if (v === null) return null;
    return 1 + rows.filter(other => { const o = valueOf(other); return o !== null && (descending ? o > v : o < v); }).length;
  });
}

/** 表の列。color が true の列（成功率）は色を塗る。higherIsBetter は色の向き */
export interface ShootColumnDef {
  key: string;
  /** 列の見出し（略称。statNames.ts の表記） */
  label: string;
  color: boolean;
  higherIsBetter: boolean;
}

export const PLAYER_SHOOT_COLUMNS: readonly ShootColumnDef[] = [
  { key: "pts", label: "PTS", color: false, higherIsBetter: true },
  { key: "efg", label: "eFG%", color: true, higherIsBetter: true },
  { key: "ts", label: "TS%", color: true, higherIsBetter: true },
  { key: "3ppct", label: "3P%", color: true, higherIsBetter: true },
  { key: "mid2pct", label: "MID2%", color: true, higherIsBetter: true },
  { key: "paint2pct", label: "PAINT2%", color: true, higherIsBetter: true },
];

/** チームの列。perspective は全チームスタッツの視点（own＝自チーム、opp＝相手＝失点、diff＝差） */
export interface TeamShootColumnDef extends ShootColumnDef {
  category: "traditional" | "advanced" | "misc";
  column: string;
  perspective: "own" | "opp" | "diff";
  group: "points" | "rating" | "shooting";
}
export const TEAM_SHOOT_COLUMNS: readonly TeamShootColumnDef[] = [
  { key: "pts", label: "PTS", category: "traditional", column: "pts", perspective: "own", color: false, higherIsBetter: true, group: "points" },
  { key: "opppts", label: "opp PTS", category: "traditional", column: "pts", perspective: "opp", color: false, higherIsBetter: false, group: "points" },
  { key: "diffpts", label: "PTS +/-", category: "traditional", column: "pts", perspective: "diff", color: false, higherIsBetter: true, group: "points" },
  { key: "ortg", label: "ORtg", category: "advanced", column: "ortg", perspective: "own", color: false, higherIsBetter: true, group: "rating" },
  { key: "drtg", label: "DRtg", category: "advanced", column: "drtg", perspective: "own", color: false, higherIsBetter: false, group: "rating" },
  { key: "netrtg", label: "NetRtg", category: "advanced", column: "netrtg", perspective: "own", color: false, higherIsBetter: true, group: "rating" },
  { key: "efg", label: "eFG%", category: "advanced", column: "efg", perspective: "own", color: true, higherIsBetter: true, group: "shooting" },
  { key: "ts", label: "TS%", category: "advanced", column: "ts", perspective: "own", color: true, higherIsBetter: true, group: "shooting" },
  { key: "3ppct", label: "3P%", category: "traditional", column: "3ppct", perspective: "own", color: true, higherIsBetter: true, group: "shooting" },
  { key: "mid2pct", label: "MID2%", category: "misc", column: "mid2pct", perspective: "own", color: true, higherIsBetter: true, group: "shooting" },
  { key: "paint2pct", label: "PAINT2%", category: "misc", column: "paint2pct", perspective: "own", color: true, higherIsBetter: true, group: "shooting" },
];
