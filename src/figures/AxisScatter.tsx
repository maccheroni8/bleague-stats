import type { ReactNode } from 'react';
import type { AxisDomain } from '../lib/figureAxis';
import './RatingsScatterFigure.css';
import './ScoringScatterFigure.css';
import './UsgPppFigure.css';
import './AxisScatter.css';
import { PlotCounts } from './PlotCounts';

export interface ScatterPoint { id: string; x: number; y: number }

const major = (v: number, step: number) => Math.abs(v / (step * 2) - Math.round(v / (step * 2))) < 1e-6;

/**
 * 図解の散布図の共通の描画（USG% × PPP の図と同じ作り: 方眼・両軸の平均の点線と値・目盛り・吹き出し）。
 * 点の見た目（ロゴ・写真）は renderMarker で渡す。
 */
export function AxisScatter<T extends ScatterPoint>({ points, xDomain, yDomain, xLabel, yLabel, xTick, yTick, avgX, avgY, avgXText, avgYText, renderMarker, tooltip, className = '', zeroLines = false, countLines, onDismiss }: {
  points: readonly T[]; xDomain: AxisDomain; yDomain: AxisDomain; xLabel: string; yLabel: string;
  xTick: (v: number) => string; yTick: (v: number) => string;
  avgX: number | null; avgY: number | null; avgXText: string; avgYText: string;
  renderMarker: (point: T, left: number, top: number) => ReactNode;
  tooltip: { point: T; node: ReactNode } | null;
  className?: string;
  /** 0 の縦線・横線を少し濃くする（+/- の視点） */
  zeroLines?: boolean;
  /** 図の空いているところに出す人数の行（選手の図）。点と重ならない位置に置く */
  countLines?: readonly string[];
  /** 点以外を押したとき（ポップアップを閉じる） */
  onDismiss?: () => void;
}) {
  const x = (v: number) => 100 * (v - xDomain.min) / (xDomain.max - xDomain.min);
  const y = (v: number) => 100 * (yDomain.max - v) / (yDomain.max - yDomain.min);
  return <div className={`ratings-chart axis-scatter ${className}`} onPointerDown={e => { if (onDismiss && !(e.target as Element).closest('.ratings-point')) onDismiss(); }}><div className="ratings-plot-wrap">
    <span className="ratings-y-label">↑ {yLabel}</span>
    <div className="ratings-plot">
      {xDomain.ticks.map(t => <span key={`x${t}`} className={`ratings-grid-v scoring-grid ${major(t, xDomain.step) ? 'is-major' : 'is-minor'}`} style={{ left: `${x(t)}%` }} />)}
      {yDomain.ticks.map(t => <span key={`y${t}`} className={`ratings-grid-h scoring-grid ${major(t, yDomain.step) ? 'is-major' : 'is-minor'}`} style={{ top: `${y(t)}%` }} />)}
      {zeroLines && xDomain.min < 0 && xDomain.max > 0 && <span className="axis-zero-v" style={{ left: `${x(0)}%` }} />}
      {zeroLines && yDomain.min < 0 && yDomain.max > 0 && <span className="axis-zero-h" style={{ top: `${y(0)}%` }} />}
      {avgX !== null && <span className="ratings-average-v" style={{ left: `${x(avgX)}%` }}><span className="avg-line-label avg-line-label-v">{avgXText}</span></span>}
      {avgY !== null && <span className="ratings-average-h" style={{ top: `${y(avgY)}%` }}><span className="avg-line-label avg-line-label-h">{avgYText}</span></span>}
      {points.map(p => renderMarker(p, x(p.x), y(p.y)))}
      {countLines && <PlotCounts points={points.map(p => ({ left: x(p.x), top: y(p.y) }))} lines={countLines} />}
      {tooltip && <div className="ratings-tooltip scoring-tooltip" role="tooltip" style={{ left: `clamp(0px, calc(${x(tooltip.point.x)}% - 130px), calc(100% - 260px))`, top: `clamp(0px, calc(${y(tooltip.point.y)}% + 24px), calc(100% - 130px))` }}>{tooltip.node}</div>}
    </div>
    {xDomain.ticks.filter(t => major(t, xDomain.step)).map(t => <span className="ratings-tick-x" key={t} style={{ left: `${x(t)}%` }}>{xTick(t)}</span>)}
    {yDomain.ticks.filter(t => major(t, yDomain.step)).map(t => <span className="ratings-tick-y" key={t} style={{ top: `${y(t)}%` }}>{yTick(t)}</span>)}
    <span className="ratings-x-label">{xLabel} →</span>
  </div></div>;
}
