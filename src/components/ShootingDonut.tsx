import { Cell, Pie, PieChart, ResponsiveContainer } from "recharts";

interface ShootingDonutProps {
  label: string;
  /** 0〜100のパーセンテージ値 */
  value: number;
  color: string;
  size?: number;
}

/** バー・数値ボックスと太さを揃える円環の幅(px)。OpposedBarのトラック高さ(22px)と一致させる */
const RING_THICKNESS = 22;

/** FG%等を円環グラフ＋中央数値で表示する。塗りつぶし部分がvalue、残りはトラック色 */
export function ShootingDonut({ label, value, color, size = 120 }: ShootingDonutProps) {
  const clamped = Math.max(0, Math.min(100, value));
  const data = [
    { key: "filled", value: clamped },
    { key: "rest", value: 100 - clamped },
  ];
  const outerRadius = size / 2;
  const innerRadius = Math.max(outerRadius - RING_THICKNESS, outerRadius * 0.3);

  return (
    <div className="shooting-donut" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            startAngle={90}
            endAngle={-270}
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            stroke="none"
            isAnimationActive={false}
          >
            <Cell fill={color} />
            <Cell fill="var(--border)" />
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="shooting-donut-center">
        <span className="shooting-donut-value">{clamped.toFixed(1)}</span>
        <span className="shooting-donut-label">{label}</span>
      </div>
    </div>
  );
}
