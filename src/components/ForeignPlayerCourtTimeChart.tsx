import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { teamShortName } from "../../shared/teamNames";
import type { TeamSummary } from "../../shared/types";

interface ForeignPlayerCourtTimeChartProps {
  teams: TeamSummary[];
}

// 2026-09-23に「3+」を「3」「4」に分割（4人を超える組み合わせは集計側で4に合算済み）
const BUCKET_LABELS = ["0", "1", "2", "3", "4"] as const;
const BUCKET_COLORS = ["#c4c4c4", "#7cc4f7", "#1f78c1", "#0b3d7a", "#7b3fa0"] as const;

interface ChartRow {
  teamId: string;
  teamName: string;
  teamShort: string;
  totalSeconds: number;
  seconds: [number, number, number, number, number];
  /** 1試合あたりの平均在コート秒数（レギュラーシーズンの試合数で割る。整数秒に丸め済み） */
  secondsPerGame: [number, number, number, number, number];
  pct: [number, number, number, number, number];
  pct0: number;
  pct1: number;
  pct2: number;
  pct3: number;
  pct4: number;
}

/**
 * チーム詳細ページ「よく使われるラインナップ」等と同じくPBP在コート復元に依存するため、
 * classificationが不明な選手を含むラインナップは除外される（合計時間が実際の出場時間より
 * 短くなりうる。DESIGN.md参照）。合計出場時間が0のチーム（データ欠落）は表示しない
 */
export function ForeignPlayerCourtTimeChart({ teams }: ForeignPlayerCourtTimeChartProps) {
  const rows: ChartRow[] = teams
    .map((t) => {
      // 区分数の変更（2026-09-23に4区分→5区分）の直後は、ブラウザのHTTPキャッシュに残った
      // 旧形式のteams.json（4要素）が新しいコードに渡ることがある。要素が足りない・フィールド
      // 自体が無い場合も0秒として扱い、ツールチップのtoFixed等で落ちないようにする
      const raw = t.foreignPlayerCourtSeconds as readonly number[] | undefined;
      const seconds = BUCKET_LABELS.map((_, i) => raw?.[i] ?? 0) as [number, number, number, number, number];
      const total = seconds.reduce((a, b) => a + b, 0);
      const pct = seconds.map((s) => (total > 0 ? (100 * s) / total : 0)) as [number, number, number, number, number];
      // foreignPlayerCourtSecondsはレギュラーシーズンのみの集計で、gamesPlayedもレギュラーシーズンの試合数
      const games = t.gamesPlayed > 0 ? t.gamesPlayed : 0;
      const secondsPerGame = seconds.map((s) => (games > 0 ? Math.round(s / games) : 0)) as [number, number, number, number, number];
      return {
        teamId: t.teamId,
        teamName: t.teamName,
        teamShort: teamShortName(t.teamId, t.teamName),
        totalSeconds: total,
        seconds,
        secondsPerGame,
        pct,
        pct0: pct[0],
        pct1: pct[1],
        pct2: pct[2],
        pct3: pct[3],
        pct4: pct[4],
      };
    })
    .filter((r) => r.totalSeconds > 0)
    .sort((a, b) => b.pct3 + b.pct4 - (a.pct3 + a.pct4) || b.pct2 - a.pct2);

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
            dataKey="teamShort"
            width={64}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ForeignCountTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="pct0" name={BUCKET_LABELS[0]} stackId="foreign" fill={BUCKET_COLORS[0]} isAnimationActive={false} label={<SegmentLabel bucket={0} rows={rows} />} />
          <Bar dataKey="pct1" name={BUCKET_LABELS[1]} stackId="foreign" fill={BUCKET_COLORS[1]} isAnimationActive={false} label={<SegmentLabel bucket={1} rows={rows} />} />
          <Bar dataKey="pct2" name={BUCKET_LABELS[2]} stackId="foreign" fill={BUCKET_COLORS[2]} isAnimationActive={false} label={<SegmentLabel bucket={2} rows={rows} />} />
          <Bar dataKey="pct3" name={BUCKET_LABELS[3]} stackId="foreign" fill={BUCKET_COLORS[3]} isAnimationActive={false} label={<SegmentLabel bucket={3} rows={rows} />} />
          <Bar dataKey="pct4" name={BUCKET_LABELS[4]} stackId="foreign" fill={BUCKET_COLORS[4]} isAnimationActive={false} label={<SegmentLabel bucket={4} rows={rows} />} />
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

/** 各セグメント上に割合(%)と1試合あたりの平均在コート時間（MIN）を表示する。ScoringCompositionChartの
 * SegmentLabelと同じ見た目（白文字＋黒縁取り）で、幅が足りないセグメントは非表示にする（ツールチップで確認できる） */
function SegmentLabel({
  x,
  y,
  width,
  height,
  index,
  bucket,
  rows,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  bucket: number;
  rows: ChartRow[];
}) {
  if (x == null || y == null || width == null || height == null || index == null || width < 62) return null;
  const row = rows[index];
  if (!row) return null;
  return (
    <text
      x={x + width / 2}
      y={y + height / 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={10}
      fill="#fff"
      stroke="#000"
      strokeWidth={2.5}
      paintOrder="stroke"
    >
      {`${row.pct[bucket]!.toFixed(1)}% (${formatMinutesFromSeconds(row.secondsPerGame[bucket]!)})`}
    </text>
  );
}

function ForeignCountTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  return (
    <div className="foreign-count-tooltip">
      <div className="foreign-count-tooltip-team">{row.teamShort}</div>
      {BUCKET_LABELS.map((label, i) => (
        <div key={label} className="foreign-count-tooltip-row">
          <span className="foreign-count-tooltip-swatch" style={{ background: BUCKET_COLORS[i] }} />
          {label}: {row.pct[i]!.toFixed(1)}%（平均{formatMinutesFromSeconds(row.secondsPerGame[i]!)}／合計{formatMinutesFromSeconds(row.seconds[i]!)}）
        </div>
      ))}
      <div className="foreign-count-tooltip-total">捕捉できた合計出場時間: {formatMinutesFromSeconds(row.totalSeconds)}</div>
    </div>
  );
}
