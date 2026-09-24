import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { useMediaQuery } from "../lib/useMediaQuery";
import { teamShortName } from "../../shared/teamNames";
import type { TeamSummary } from "../../shared/types";

interface ForeignPlayerCourtTimeChartProps {
  teams: TeamSummary[];
  order?: ForeignCourtOrder;
  /**
   * そのシーズンに同時に出られる外国籍・特別枠の最大人数（season-rules.json の maxForeignOnCourt）。これを超える人数の区分
   * （規定上ありえない。公式記録の選手の取り違え等で生じる）は並べ替えの比較に使わない。グラフの表示はそのまま。未指定なら全区分を使う
   */
  maxOnCourt?: number;
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
  /** 平均人数（Σ 人数×割合）。棒の右に出すラベル */
  average: number;
  averageLabel: string;
}

/**
 * チーム詳細ページ「よく使われるラインナップ」等と同じくPBP在コート復元に依存するため、
 * classificationが不明な選手を含むラインナップは除外される（合計時間が実際の出場時間より
 * 短くなりうる。DESIGN.md参照）。合計出場時間が0のチーム（データ欠落）は表示しない
 */
/**
 * チームの並び順（全チームスタッツのOn-Court Foreign。DESIGN.md 135章）。比べる値は画面に出している割合（%、丸める前）。
 * - foreignDesc: 外国籍が多い順。人数の多い区分の割合から順に比べる（4名→3名→2名→1名→0名。規定上ありえない人数の区分は飛ばす）（初期値）
 * - averageDesc / averageAsc: 平均人数（Σ 人数×割合）が多い順 / 少ない順。同じなら外国籍が多い順
 */
export type ForeignCourtOrder = "foreignDesc" | "averageDesc" | "averageAsc";

export const FOREIGN_COURT_ORDER_LABELS: Record<ForeignCourtOrder, string> = {
  foreignDesc: "外国籍が多い順",
  averageDesc: "平均人数が多い順",
  averageAsc: "平均人数が少ない順",
};

function averageForeignCount(pct: readonly number[]): number {
  return pct.reduce((sum, p, count) => sum + (count * p) / 100, 0);
}

function compareByBuckets(a: readonly number[], b: readonly number[], buckets: readonly number[]): number {
  for (const i of buckets) {
    const diff = b[i]! - a[i]!;
    if (diff !== 0) return diff;
  }
  return 0;
}

function compareRows(order: ForeignCourtOrder, a: ChartRow, b: ChartRow, buckets: readonly number[]): number {
  const byForeign = compareByBuckets(a.pct, b.pct, buckets);
  if (order === "averageDesc") return b.average - a.average || byForeign;
  if (order === "averageAsc") return a.average - b.average || byForeign;
  return byForeign;
}

export function ForeignPlayerCourtTimeChart({ teams, order = "foreignDesc", maxOnCourt }: ForeignPlayerCourtTimeChartProps) {
  const narrow = useMediaQuery("(max-width: 560px)");
  // 比べる区分: 人数の多い順（規定の上限を超える区分は除く）
  const buckets = [4, 3, 2, 1, 0].filter((n) => maxOnCourt === undefined || n <= maxOnCourt);
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
        average: averageForeignCount(pct),
        averageLabel: "",
      };
    })
    .filter((r) => r.totalSeconds > 0)
    .sort((a, b) => compareRows(order, a, b, buckets) || a.teamId.localeCompare(b.teamId))
    .map((r) => ({ ...r, averageLabel: `${narrow ? "" : "平均"}${r.average.toFixed(2)}人` }));

  if (rows.length === 0) {
    return <p className="empty-message">このシーズンのデータには対応していません</p>;
  }

  const height = Math.max(240, rows.length * 30 + 40);

  return (
    <div className="foreign-count-chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
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
          {/* 棒の右端に平均人数（試行。DESIGN.md 135章）。並び順の設定に関係なく常に出す */}
          <YAxis
            yAxisId="average"
            orientation="right"
            type="category"
            dataKey="averageLabel"
            width={narrow ? 44 : 72}
            tick={{ fontSize: 11, fill: "var(--fg)" }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip content={<ForeignCountTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="pct0" name={BUCKET_LABELS[0]} stackId="foreign" fill={BUCKET_COLORS[0]} isAnimationActive={false} label={<SegmentLabel bucket={0} rows={rows} narrow={narrow} />} />
          <Bar dataKey="pct1" name={BUCKET_LABELS[1]} stackId="foreign" fill={BUCKET_COLORS[1]} isAnimationActive={false} label={<SegmentLabel bucket={1} rows={rows} narrow={narrow} />} />
          <Bar dataKey="pct2" name={BUCKET_LABELS[2]} stackId="foreign" fill={BUCKET_COLORS[2]} isAnimationActive={false} label={<SegmentLabel bucket={2} rows={rows} narrow={narrow} />} />
          <Bar dataKey="pct3" name={BUCKET_LABELS[3]} stackId="foreign" fill={BUCKET_COLORS[3]} isAnimationActive={false} label={<SegmentLabel bucket={3} rows={rows} narrow={narrow} />} />
          <Bar dataKey="pct4" name={BUCKET_LABELS[4]} stackId="foreign" fill={BUCKET_COLORS[4]} isAnimationActive={false} label={<SegmentLabel bucket={4} rows={rows} narrow={narrow} />} />
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
  narrow = false,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  bucket: number;
  rows: ChartRow[];
  /** スマホ幅（560px以下）: 割合だけ（例「35.8%」）を出し、それも収まらない狭い区分には出さない */
  narrow?: boolean;
}) {
  if (x == null || y == null || width == null || height == null || index == null || width < (narrow ? 34 : 62)) return null;
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
      {narrow
        ? `${row.pct[bucket]!.toFixed(1)}%`
        : `${row.pct[bucket]!.toFixed(1)}% (${formatMinutesFromSeconds(row.secondsPerGame[bucket]!)})`}
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
