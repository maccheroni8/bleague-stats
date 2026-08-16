import type { CSSProperties } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PeriodBoundary, ScorePoint, TimeoutMark } from "../lib/leadTracker";

interface LeadTrackerChartProps {
  points: ScorePoint[];
  timeouts: TimeoutMark[];
  periodBoundaries: PeriodBoundary[];
  totalSeconds: number;
  homeTeamName: string;
  awayTeamName: string;
  /** data/team-colors.json由来のチームカラー。未指定時は既存のvar(--accent)/var(--muted)にフォールバックする */
  homeColor?: string;
  awayColor?: string;
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
  homeColor,
  awayColor,
  height = 280,
}: LeadTrackerChartProps) {
  const maxAbsDiff = points.reduce((max, p) => Math.max(max, Math.abs(p.diff)), 0);
  const halfRange = Math.max(5, Math.ceil((maxAbsDiff + 2) / 5) * 5);

  const boundaryLabels = new Map(periodBoundaries.map((b) => [b.startSec, b.label]));
  const homeStroke = homeColor ?? "var(--accent)";
  const awayStroke = awayColor ?? "var(--muted)";

  // linearGradientはデフォルトでobjectBoundingBox（描画されたAreaの実際の最大値〜最小値の矩形）を
  // 基準にオフセットを解釈するため、単純に50%で区切ると「得失点差0」の位置とズレる
  // （ホームの最大リードとアウェイの最大リードの大きさが非対称な場合、境界がホーム/アウェイ
  // どちらかの色に偏って侵食する）。Rechartsの定番パターンに倣い、実データのmax/minから
  // 0が来る位置の比率を計算し、そこを色の境界に使う
  const dataMaxDiff = points.reduce((max, p) => Math.max(max, p.diff), -Infinity);
  const dataMinDiff = points.reduce((min, p) => Math.min(min, p.diff), Infinity);
  const zeroOffset =
    dataMaxDiff <= 0 ? 0 : dataMinDiff >= 0 ? 1 : dataMaxDiff / (dataMaxDiff - dataMinDiff);

  return (
    <div className="lead-tracker-chart">
      <div className="lead-tracker-legend">
        <span
          className="lead-tracker-legend-item home"
          style={{ "--legend-dot-color": homeStroke } as CSSProperties}
        >
          {homeTeamName}リード
        </span>
        <span
          className="lead-tracker-legend-item away"
          style={{ "--legend-dot-color": awayStroke } as CSSProperties}
        >
          {awayTeamName}リード
        </span>
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={points} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <defs>
            <linearGradient id="leadTrackerGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset={zeroOffset} stopColor={homeStroke} stopOpacity={0.9} />
              <stop offset={zeroOffset} stopColor={awayStroke} stopOpacity={0.9} />
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
          {timeouts.map((t, i) =>
            t.homeAway === null ? (
              <ReferenceLine
                key={`timeout-${i}`}
                x={t.elapsedSec}
                stroke="var(--fg)"
                strokeDasharray="2 3"
                strokeOpacity={0.9}
                strokeWidth={1.5}
              />
            ) : (
              <ReferenceLine
                key={`timeout-${i}`}
                x={t.elapsedSec}
                stroke={t.homeAway === 1 ? homeStroke : awayStroke}
                strokeDasharray="2 3"
                strokeOpacity={0.6}
              />
            ),
          )}
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
      <p className="lead-tracker-note">
        点線: タイムアウト（{homeTeamName}色/{awayTeamName}色。オフィシャルタイムアウトは白/黒）
      </p>
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
