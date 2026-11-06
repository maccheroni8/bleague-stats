import { useLayoutEffect, useRef, useState } from 'react';
import { chooseCountPlacement } from '../lib/figurePlayerCounts';
import './PlotCounts.css';

/**
 * 散布図の中の空いているところに、表示人数と登録区分ごとの人数を出す（保存画像にも入る）。
 * 位置は、図の中を走査して点がいちばん重ならない所（図の大きさが変わったら選び直す。割合で持つので、保存のときに図が広くなっても枠は点から離れる方向にしか動かない）
 */
export function PlotCounts({ points, lines }: { points: readonly { left: number; top: number }[]; lines: readonly string[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [size, setSize] = useState('');
  const signature = points.map(p => `${Math.round(p.left * 4)},${Math.round(p.top * 4)}`).join(';');
  useLayoutEffect(() => {
    const el = ref.current, plot = el?.parentElement;
    if (!el || !plot) return;
    const measure = () => setSize(`${plot.clientWidth}x${plot.clientHeight}`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const el = ref.current, plot = el?.parentElement;
    if (!el || !plot || !plot.clientWidth) return;
    const plotSize = { width: plot.clientWidth, height: plot.clientHeight };
    const r = chooseCountPlacement(points, plotSize, { width: el.offsetWidth, height: el.offsetHeight });
    setPos({ left: 100 * r.left / plotSize.width, top: 100 * r.top / plotSize.height });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, size, lines.join('|')]);
  return <div ref={ref} className="plot-counts" style={pos ? { left: `${pos.left}%`, top: `${pos.top}%`, right: 'auto' } : undefined} aria-label="表示している人数">{lines.map((l, i) => <span key={i}>{l}</span>)}</div>;
}
