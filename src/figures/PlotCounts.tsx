import './PlotCounts.css';

/**
 * 散布図の右上、グラフの外（枠のすぐ上。左の縦軸の名前と同じ行の右端）に、表示人数と登録区分ごとの人数を1行で出す（保存画像にも入る）。
 * 写真や点に重ならないよう、グラフの中には置かない（DESIGN.md 475章。以前は点の少ない所を探して中に置いていた）
 */
export function PlotCounts({ lines }: { lines: readonly string[] }) {
  return <div className="plot-counts" aria-label="表示している人数">{lines.join('／')}</div>;
}
