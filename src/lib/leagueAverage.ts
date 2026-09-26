// リーグ平均（DESIGN.md 149章。NBA準拠: 割合は合計÷合計、1試合平均は合計÷延べ試合数）。
// シーズン単位の値は scripts/aggregate.ts が data/{season}/league-average.json に出す。条件で絞った一覧（全チームスタッツ）は、
// 画面で絞った全チームの合計から averageTotals で出す（カウント系をチーム数で割る。「合計」表示では平均的な1チームの合計）
export const LEAGUE_TEAM_ID = "league";
export const LEAGUE_TEAM_NAME = "リーグ平均";

/** 比較でのリーグ平均の色（チームカラーの代わり。見出しの線・良い方の値の塗り）。灰色系（既存の --muted） */
export const LEAGUE_COLOR = "var(--muted)";

/** 比較の枠でリーグ平均を選んだときの注記 */
export const LEAGUE_SLOT_NOTE = "リーグ平均はシーズン全体の値です（シチュエーションの絞り込みはありません）";

/** 同じ形の数値のオブジェクトを足してから件数で割る */
export function averageTotals<T extends object>(list: T[]): T {
  const sum: Record<string, number> = {};
  for (const item of list) {
    for (const [k, v] of Object.entries(item)) if (typeof v === "number") sum[k] = (sum[k] ?? 0) + v;
  }
  for (const k of Object.keys(sum)) sum[k] = sum[k]! / list.length;
  return sum as T;
}
