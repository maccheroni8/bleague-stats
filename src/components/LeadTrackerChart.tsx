import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PeriodBoundary, ScorePoint, TimeoutMark } from "../lib/leadTracker";

interface LeadTrackerChartProps {
  points: ScorePoint[];
  timeouts: TimeoutMark[];
  periodBoundaries: PeriodBoundary[];
  totalSeconds: number;
  homeTeamName: string;
  awayTeamName: string;
  height?: number;
}

function formatRestTime(period: number, restTime: string, boundaries: PeriodBoundary[]): string {
  const boundary = boundaries.find((b) => b.period === period);
  return `${boundary?.label ?? `${period}Q`} 残り${restTime}`;
}

export function LeadTrackerChart({
  points,
  timeouts,
  periodBoundaries,
  totalSeconds,
  homeTeamName,
  awayTeamName,
  height = 280,
}: LeadTrackerChartProps) {
  const maxAbsDiff = points.reduce((max, p) => Math.max(max, Math.abs(p.diff)), 0);
  const halfRange = Math.max(5, Math.ceil((maxAbsDiff + 2) / 5) * 5);

  const boundaryLabels = new Map(periodBoundaries.map((b) => [b.startSec, b.label]));

  return (
    <div className="lead-tracker-chart">
      <div className="lead-tracker-legend">
        <span className="lead-tracker-legend-item home">{homeTeamName}リード</span>
        <span className="lead-tracker-legend-item away">{awayTeamName}リード</span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="leadTrackerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.9} />
              <stop offset="50%" stopColor="var(--accent)" stopOpacity={0.9} />
              <stop offset="50%" stopColor="var(--muted)" stopOpacity={0.9} />
              <stop offset="100%" stopColor="var(--muted)" stopOpacity={0.9} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis
            type="number"
            dataKey="elapsedSec"
            domain={[0, totalSeconds]}
            ticks={periodBoundaries.map((b) => b.startSec)}
            tickFormatter={(value: number) => boundaryLabels.get(value) ?? ""}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            domain={[-halfRange, halfRange]}
            allowDecimals={false}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip content={<LeadTrackerTooltip boundaries={periodBoundaries} homeTeamName={homeTeamName} awayTeamName={awayTeamName} />} />
          <ReferenceLine y={0} stroke="var(--fg)" strokeOpacity={0.5} />
          {periodBoundaries
            .filter((b) => b.startSec > 0)
            .map((b) => (
              <ReferenceLine key={`period-${b.period}`} x={b.startSec} stroke="var(--border)" />
            ))}
          {timeouts.map((t, i) => (
            <ReferenceLine
              key={`timeout-${i}`}
              x={t.elapsedSec}
              stroke={t.homeAway === 1 ? "var(--accent)" : t.homeAway === 2 ? "var(--muted)" : "var(--border)"}
              strokeDasharray="2 3"
              strokeOpacity={0.6}
            />
          ))}
          <Area
            type="stepAfter"
            dataKey="diff"
            stroke="url(#leadTrackerGradient)"
            fill="url(#leadTrackerGradient)"
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="lead-tracker-note">点線: タイムアウト（{homeTeamName}色/{awayTeamName}色/オフィシャルは灰色）</p>
    </div>
  );
}

function LeadTrackerTooltip({
  active,
  payload,
  boundaries,
  homeTeamName,
  awayTeamName,
}: {
  active?: boolean;
  payload?: { payload: ScorePoint }[];
  boundaries: PeriodBoundary[];
  homeTeamName: string;
  awayTeamName: string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]!.payload;
  const leader = point.diff === 0 ? "同点" : point.diff > 0 ? homeTeamName : awayTeamName;

  return (
    <div className="lead-tracker-tooltip">
      <div className="lead-tracker-tooltip-time">{formatRestTime(point.period, point.restTime, boundaries)}</div>
      <div className="lead-tracker-tooltip-score">
        {point.homeScore} - {point.awayScore}（{leader}{point.diff !== 0 ? ` +${Math.abs(point.diff)}` : ""}）
      </div>
      {point.playText && <div className="lead-tracker-tooltip-play">{point.playText}</div>}
    </div>
  );
}
