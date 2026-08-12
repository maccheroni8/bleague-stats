import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface ChartTeam {
  teamId: string;
  teamName: string;
}

interface StandingsLineChartProps {
  title: string;
  data: Record<string, number | string>[];
  teams: ChartTeam[];
  /** 順位グラフ用: 1位を上に、数値が大きいほど下に表示する */
  reversed?: boolean;
  height?: number;
}

/** チーム数に応じて均等に色相を割り振る。チーム数が変わっても破綻しない簡易パレット */
function teamColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return `hsl(${hue}, 65%, 55%)`;
}

export function StandingsLineChart({ title, data, teams, reversed = false, height = 320 }: StandingsLineChartProps) {
  return (
    <div className="standings-chart">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} minTickGap={24} />
          <YAxis
            reversed={reversed}
            allowDecimals={!reversed}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg)" }}
            labelStyle={{ color: "var(--fg)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {teams.map((t, i) => (
            <Line
              key={t.teamId}
              type="monotone"
              dataKey={t.teamId}
              name={t.teamName}
              stroke={teamColor(i, teams.length)}
              dot={false}
              strokeWidth={2}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
