import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import type { TeamSummary } from "../../shared/types";

interface ForeignPlayerCourtTimeChartProps {
  teams: TeamSummary[];
}

const BUCKET_LABELS = ["0人", "1人", "2人", "3人以上"] as const;
const BUCKET_COLORS = ["#c4c4c4", "#7cc4f7", "#1f78c1", "#0b3d7a"] as const;

interface ChartRow {
  teamId: string;
  teamName: string;
  totalSeconds: number;
  seconds: [number, number, number, number];
  pct: [number, number, number, number];
  pct0: number;
  pct1: number;
  pct2: number;
  pct3: number;
}

/**
 * チーム詳細ページ「よく使われるラインナップ」等と同じくPBP在コート復元に依存するため、
 * classificationが不明な選手を含むラインナップは除外される（合計時間が実際の出場時間より
 * 短くなりうる。DESIGN.md参照）。合計出場時間が0のチーム（データ欠落）は表示しない
 */
export function ForeignPlayerCourtTimeChart({ teams }: ForeignPlayerCourtTimeChartProps) {
  const rows: ChartRow[] = teams
    .map((t) => {
      const seconds = t.foreignPlayerCourtSeconds;
      const total = seconds.reduce((a, b) => a + b, 0);
      const pct = seconds.map((s) => (total > 0 ? (100 * s) / total : 0)) as [number, number, number, number];
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        totalSeconds: total,
        seconds,
        pct,
        pct0: pct[0],
        pct1: pct[1],
        pct2: pct[2],
        pct3: pct[3],
      };
    })
    .filter((r) => r.totalSeconds > 0)
    .sort((a, b) => b.pct3 - a.pct3 || b.pct2 - a.pct2);

  if (rows.length === 0) {
    return <p className="empty-message">このシーズンのデータには対応していません</p>;
  }

  const height = Math.max(240, rows.length * 30 + 40);

  return (
    <div className="foreign-count-chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${Math.round(v)}%`}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="teamName"
            width={92}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ForeignCountTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="pct0" name={BUCKET_LABELS[0]} stackId="foreign" fill={BUCKET_COLORS[0]} isAnimationActive={false} />
          <Bar dataKey="pct1" name={BUCKET_LABELS[1]} stackId="foreign" fill={BUCKET_COLORS[1]} isAnimationActive={false} />
          <Bar dataKey="pct2" name={BUCKET_LABELS[2]} stackId="foreign" fill={BUCKET_COLORS[2]} isAnimationActive={false} />
          <Bar dataKey="pct3" name={BUCKET_LABELS[3]} stackId="foreign" fill={BUCKET_COLORS[3]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
      <div className="foreign-count-legend">
        {BUCKET_LABELS.map((label, i) => (
          <span key={label} className="foreign-count-legend-item">
            <span className="foreign-count-legend-swatch" style={{ background: BUCKET_COLORS[i] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function ForeignCountTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  return (
    <div className="foreign-count-tooltip">
      <div className="foreign-count-tooltip-team">{row.teamName}</div>
      {BUCKET_LABELS.map((label, i) => (
        <div key={label} className="foreign-count-tooltip-row">
          <span className="foreign-count-tooltip-swatch" style={{ background: BUCKET_COLORS[i] }} />
          {label}: {row.pct[i]!.toFixed(1)}%（{formatMinutesFromSeconds(row.seconds[i]!)}）
        </div>
      ))}
      <div className="foreign-count-tooltip-total">捕捉できた合計出場時間: {formatMinutesFromSeconds(row.totalSeconds)}</div>
    </div>
  );
}
