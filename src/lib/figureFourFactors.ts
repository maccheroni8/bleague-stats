// 画面専用。Four Factors とレーティングの色分け表（図解 > チーム）。
// 値は全チームスタッツ（Advanced）の列の式をそのまま使う。集計の絞り方は ORtg × DRtg の図と共通（figureRatings.ts）。
import { buildAdvancedColumns, type AllTeamsRow } from "./teamStatsColumns";

export const FF_KEYS = ["netrtg", "ortg", "drtg", "efg", "tovpct", "orbpct", "ftr", "oppefg", "opptovpct", "opporbpct", "oppftr"] as const;
export type FfKey = typeof FF_KEYS[number];

interface FfDef {
  key: FfKey;
  /** 列の見出し（略称は statNames.ts の表記。相手の値は「opp 」を付ける） */
  label: string;
  /** 全チームスタッツの列の key と視点 */
  column: string;
  perspective: "own" | "opp";
  /** 多いほうが良いか。色の向きに使う */
  higherIsBetter: boolean;
  group: "rating" | "offense" | "defense";
}
export const FF_DEFS: readonly FfDef[] = [
  { key: "netrtg", label: "NetRtg", column: "netrtg", perspective: "own", higherIsBetter: true, group: "rating" },
  { key: "ortg", label: "ORtg", column: "ortg", perspective: "own", higherIsBetter: true, group: "rating" },
  { key: "drtg", label: "DRtg", column: "drtg", perspective: "own", higherIsBetter: false, group: "rating" },
  { key: "efg", label: "eFG%", column: "efg", perspective: "own", higherIsBetter: true, group: "offense" },
  { key: "tovpct", label: "TOV%", column: "tovpct", perspective: "own", higherIsBetter: false, group: "offense" },
  { key: "orbpct", label: "OR%", column: "orbpct", perspective: "own", higherIsBetter: true, group: "offense" },
  { key: "ftr", label: "FTR", column: "ftr", perspective: "own", higherIsBetter: true, group: "offense" },
  { key: "oppefg", label: "opp eFG%", column: "efg", perspective: "opp", higherIsBetter: false, group: "defense" },
  { key: "opptovpct", label: "opp TOV%", column: "tovpct", perspective: "opp", higherIsBetter: true, group: "defense" },
  { key: "opporbpct", label: "opp OR%", column: "orbpct", perspective: "opp", higherIsBetter: false, group: "defense" },
  { key: "oppftr", label: "opp FTR", column: "ftr", perspective: "opp", higherIsBetter: false, group: "defense" },
];
export const FF_DEF = Object.fromEntries(FF_DEFS.map(def => [def.key, def])) as Record<FfKey, FfDef>;

const own = buildAdvancedColumns("perGame", "own");
const opp = buildAdvancedColumns("perGame", "opp");
function columnOf(key: FfKey) {
  const def = FF_DEF[key];
  return (def.perspective === "own" ? own : opp).find(column => column.key === def.column)!;
}
/** 表に出す文字（全チームスタッツと同じ書式） */
export const ffText = (key: FfKey, row: AllTeamsRow): string => columnOf(key).format!(row);
/** 色・並べ替えに使う値。表に出す小数第2位までの値にそろえ、表示が同じなら同じ扱いにする */
export function ffValue(key: FfKey, row: AllTeamsRow): number {
  const shown = Number(ffText(key, row).replace(/[^0-9.\-+]/g, ""));
  return Number.isFinite(shown) ? shown : NaN;
}

/** 色の段階。0＝悪い側 … 4＝良い側 */
export const FF_LEVELS = 5;
/**
 * 表示しているチームの中での位置（パーセンタイル）で5段階にする。
 * 位置＝（自分より悪いチーム数＋同値の他チーム数÷2）÷（チーム数−1）。同値は同じ段階。1チームだけなら真ん中。
 */
export function ffLevels(values: readonly number[], higherIsBetter: boolean): number[] {
  const good = values.map(value => higherIsBetter ? value : -value);
  const n = good.length;
  return good.map(value => {
    if (n < 2) return 2;
    const worse = good.filter(other => other < value).length;
    const same = good.filter(other => other === value).length;
    return Math.min(FF_LEVELS - 1, Math.floor((worse + (same - 1) / 2) / (n - 1) * FF_LEVELS));
  });
}

export interface FfRow<T> { item: T; values: Record<FfKey, number>; levels: Record<FfKey, number> }
export function buildFourFactors<T extends { row: AllTeamsRow }>(items: readonly T[]): FfRow<T>[] {
  const rows = items.map(item => ({ item, values: Object.fromEntries(FF_KEYS.map(key => [key, ffValue(key, item.row)])) as Record<FfKey, number>, levels: {} as Record<FfKey, number> }));
  for (const key of FF_KEYS) {
    const levels = ffLevels(rows.map(row => row.values[key]), FF_DEF[key].higherIsBetter);
    rows.forEach((row, i) => { row.levels[key] = levels[i]!; });
  }
  return rows;
}

/** 良い順（higherIsBetter なら大きい順）。同値は元の並びのまま */
export function sortFourFactors<T>(rows: readonly FfRow<T>[], key: FfKey, bestFirst: boolean): FfRow<T>[] {
  const sign = (FF_DEF[key].higherIsBetter ? -1 : 1) * (bestFirst ? 1 : -1);
  return [...rows].sort((a, b) => sign * (a.values[key] - b.values[key]));
}
/** 並べた列の順位（同じ表示値は同順位、次は飛ばす。良い順に数える） */
export function ffRanks<T>(rows: readonly FfRow<T>[], key: FfKey): number[] {
  const def = FF_DEF[key];
  return rows.map(row => 1 + rows.filter(other => def.higherIsBetter ? other.values[key] > row.values[key] : other.values[key] < row.values[key]).length);
}

export const FF_NOTE = "色は表示しているチームの中での位置。緑ほど良い。DRtg・TOV%・相手の eFG%・相手の OR%・相手の FTR は少ないほど良い";
