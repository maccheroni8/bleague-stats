import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface StatRow {
  label: string;
  home: number;
  away: number;
}

interface KeyStatsChartProps {
  title: string;
  rows: StatRow[];
  homeTeamName: string;
  awayTeamName: string;
  valueSuffix?: string;
}

export function KeyStatsChart({ title, rows, homeTeamName, awayTeamName, valueSuffix = "" }: KeyStatsChartProps) {
  return (
    <div className="key-stats-chart">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={rows.length * 40 + 40}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="var(--border)" />
          <XAxis type="number" hide />
          <YAxis type="category" dataKey="label" width={48} tickLine={false} axisLine={false} />
          <Tooltip
            formatter={(value: number) => `${value}${valueSuffix}`}
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="home" name={homeTeamName} fill="var(--accent)" radius={[0, 4, 4, 0]} />
          <Bar dataKey="away" name={awayTeamName} fill="var(--muted)" radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
