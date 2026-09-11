import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";
import { formatDecimal } from "../lib/format";

const RADIAN = Math.PI / 180;

export interface PieSegmentInput {
  key: string;
  label: string;
  color: string;
  /** セグメントの実数値（1試合あたり平均等、既に整形済みの単位で渡す） */
  value: number;
}

interface CompositionPieChartProps {
  title: string;
  segments: PieSegmentInput[];
  size?: number;
  valueDigits?: number;
}

function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  return {
    x: cx + radius * Math.cos(-angleDeg * RADIAN),
    y: cy + radius * Math.sin(-angleDeg * RADIAN),
  };
}

/**
 * 3〜4分割の円グラフ。各セグメントに外側ラベル（名称・割合%）と内側ラベル（実数値）を表示する
 * （添付画像のFG試投割合の円グラフと同じ形式、Batch 4）。recharts単体のlabel機能では
 * 「外側にラベル、内側に実数値」という2種類の表示を同時に描画できないため、Pieのlabel/labelLine
 * propに渡すカスタム描画関数の中で両方のtext要素を組み立てている
 */
export function CompositionPieChart({ title, segments, size = 320, valueDigits = 1 }: CompositionPieChartProps) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const outerRadius = size * 0.26;
  const labelBendOffset = 18;
  const labelEndOffset = 44;

  const renderLabel = (props: unknown) => {
    const p = props as { cx: number; cy: number; midAngle: number; percent: number; index: number };
    const seg = segments[p.index];
    if (!seg) return null;
    const bend = polarToCartesian(p.cx, p.cy, outerRadius + labelBendOffset, p.midAngle);
    const end = polarToCartesian(p.cx, p.cy, outerRadius + labelEndOffset, p.midAngle);
    const textAnchor = end.x >= p.cx ? "start" : "end";
    const textX = end.x + (textAnchor === "start" ? 4 : -4);
    const valuePos = polarToCartesian(p.cx, p.cy, outerRadius * 0.62, p.midAngle);
    return (
      <g key={seg.key}>
        <text x={textX} y={end.y} textAnchor={textAnchor} dominantBaseline="central" className="composition-pie-outer-label">
          <tspan x={textX} dy="-0.5em">
            {seg.label}
          </tspan>
          <tspan x={textX} dy="1.1em">
            {formatDecimal(p.percent * 100, 1)}%
          </tspan>
        </text>
        <text x={valuePos.x} y={valuePos.y} textAnchor="middle" dominantBaseline="central" className="composition-pie-value-label">
          {formatDecimal(seg.value, valueDigits)}
        </text>
      </g>
    );
  };

  const renderLabelLine = (props: unknown) => {
    const p = props as { cx: number; cy: number; midAngle: number };
    const start = polarToCartesian(p.cx, p.cy, outerRadius, p.midAngle);
    const bend = polarToCartesian(p.cx, p.cy, outerRadius + labelBendOffset, p.midAngle);
    const end = polarToCartesian(p.cx, p.cy, outerRadius + labelEndOffset, p.midAngle);
    return <polyline points={`${start.x},${start.y} ${bend.x},${bend.y} ${end.x},${end.y}`} stroke="var(--muted)" fill="none" />;
  };

  return (
    <div className="composition-pie-chart">
      <h4>{title}</h4>
      {total <= 0 ? (
        <p className="empty-message">データがありません</p>
      ) : (
        <div className="composition-pie-chart-canvas" style={{ width: size, height: size }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={segments}
                dataKey="value"
                nameKey="label"
                cx="50%"
                cy="50%"
                outerRadius={outerRadius}
                stroke="var(--bg)"
                strokeWidth={2}
                isAnimationActive={false}
                label={renderLabel}
                labelLine={renderLabelLine}
              >
                {segments.map((seg) => (
                  <Cell key={seg.key} fill={seg.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
