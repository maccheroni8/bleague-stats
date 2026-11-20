// 表の「各項目の上位3位（良い数値）」に色を付けるための判定（画面だけ。保存キーの対象外。設計書438章）。
// 同じ値は同じ順位で、自分より良い値のチームが3つ未満なら上位3位（1位・2位・2位・4位のように次を飛ばす順位の付け方。143-3章）。
// 値の無い行（undefined・NaN）は数えず、色も付けない

export type BetterDirection = "high" | "low";

/** rows のうち、valueOf の値が上位3位に入る行の位置（0始まり）と、その順位（1〜3。同じ値は同じ順位）。色の濃さを順位で変えるのに使う */
export function topThreeRanks<T>(rows: readonly T[], valueOf: (row: T) => number | undefined, better: BetterDirection): Map<number, 1 | 2 | 3> {
  const values = rows.map((r) => {
    const v = valueOf(r);
    return v === undefined || Number.isNaN(v) ? undefined : v;
  });
  const result = new Map<number, 1 | 2 | 3>();
  values.forEach((v, i) => {
    if (v === undefined) return;
    const strictlyBetter = values.filter((w) => w !== undefined && (better === "high" ? w > v : w < v)).length;
    if (strictlyBetter < 3) result.set(i, (strictlyBetter + 1) as 1 | 2 | 3);
  });
  return result;
}

/** rows のうち、valueOf の値が上位3位に入る行の位置（0始まり）の集合 */
export function topThreeIndexes<T>(rows: readonly T[], valueOf: (row: T) => number | undefined, better: BetterDirection): Set<number> {
  return new Set(topThreeRanks(rows, valueOf, better).keys());
}
