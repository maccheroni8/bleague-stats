import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useMediaQuery } from "../lib/useMediaQuery";

/**
 * 割合の100%積み上げ棒グラフ（1行＝1本の横棒）の共通部品（DESIGN.md 141章）。On-Court Foreign・得点構成・得点構成（登録区分）を、
 * 全チーム（1行＝1チーム）・チーム詳細と個人詳細のシーズン別推移（1行＝1シーズン）・選手一覧（1行＝1選手）で同じ見た目にする。
 * - 棒の中の文字: 広い画面は「割合 (内訳)」（幅 wideMinSegment 未満の区分は出さない。On-Court Foreign は62px、得点構成は46px）、スマホ幅（560px以下）は割合だけ（幅34px未満は出さない）。
 *   白文字＋黒縁取りで、背景色を問わず読めるようにする
 * - 右端に行ごとの値（平均人数・1試合平均の得点等）を出せる
 * - 行の見出しは2行まで（シーズン＋規定の上限人数、シーズン＋所属チーム等）
 */
const PCT_TICKS = [0, 25, 50, 75, 100];
const GUIDE_TICKS = [25, 50, 75];
/** 25・50・75% の点線を棒の上に出す（2026-09-26 採用。On-Court Foreign・Scoring % の両方） */
const SHOW_GUIDE_LINES = true;

export interface ShareBarCategory {
  label: string;
  color: string;
}

export interface ShareBarRow {
  key: string;
  /** 行の見出し（1〜2行） */
  labelLines: string[];
  /** "league": リーグ平均の行（棒を薄く・見出しを太字にして区別する。DESIGN.md 149章） */
  variant?: "league";
  /** 区分ごとの割合（0〜100、categories と同じ順） */
  pct: number[];
  /** 広い画面で割合の後ろに括弧で添える内訳（1試合平均の得点・出場時間等）。区分ごと */
  details: string[];
  /** ツールチップの各区分の行で、割合の後ろに添える文字 */
  tooltipDetails: string[];
  /** 右端に出す値（広い画面・スマホ幅） */
  rightLabel?: { wide: string; narrow: string };
  tooltipTitle: string;
  tooltipFooter?: string;
}

interface ChartDatum {
  key: string;
  label: string;
  right: string;
  [pctKey: `pct${number}`]: number;
}

export function ShareBarChart({
  rows,
  categories,
  labelWidth = { wide: 64, narrow: 64 },
  rightWidth = { wide: 72, narrow: 44 },
  emptyMessage = "このシーズンのデータには対応していません",
  footer,
  wideMinSegment = 62,
}: {
  rows: ShareBarRow[];
  categories: ShareBarCategory[];
  labelWidth?: { wide: number; narrow: number };
  rightWidth?: { wide: number; narrow: number };
  emptyMessage?: string;
  /** 凡例の下に添える要素（「もっと見る」等） */
  footer?: ReactNode;
  /** 広い画面で棒の中に文字を出す最小の区分の幅（px） */
  wideMinSegment?: number;
}) {
  const narrow = useMediaQuery("(max-width: 560px)");
  if (rows.length === 0) return <p className="empty-message">{emptyMessage}</p>;

  const twoLines = rows.some((r) => r.labelLines.length > 1);
  const rowHeight = twoLines ? 38 : 30;
  const height = Math.max(twoLines ? 120 : 240, rows.length * rowHeight + 40);
  const hasRight = rows.some((r) => r.rightLabel);
  const data: ChartDatum[] = rows.map((r) => {
    const d: ChartDatum = { key: r.key, label: r.key, right: r.rightLabel ? (narrow ? r.rightLabel.narrow : r.rightLabel.wide) : "" };
    r.pct.forEach((p, i) => {
      d[`pct${i}`] = p;
    });
    return d;
  });
  const rowByKey = new Map(rows.map((r) => [r.key, r]));

  return (
    <div className="foreign-count-chart">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          {/* 目盛りは 0・25・50・75・100% に固定（自動だと右端の値の列の幅によって 0・30・60・100% 等になる） */}
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={PCT_TICKS}
            tickFormatter={(v: number) => `${Math.round(v)}%`}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={narrow ? labelWidth.narrow : labelWidth.wide}
            tick={<RowLabelTick rowByKey={rowByKey} />}
            tickLine={false}
            axisLine={false}
            interval={0}
          />
          {hasRight && (
            <YAxis
              yAxisId="right"
              orientation="right"
              type="category"
              dataKey="right"
              width={narrow ? rightWidth.narrow : rightWidth.wide}
              tick={{ fontSize: 11, fill: "var(--fg)" }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
          )}
          <Tooltip content={<ShareBarTooltip rowByKey={rowByKey} categories={categories} />} cursor={{ fill: "var(--row-hover)" }} />
          {categories.map((c, i) => (
            <Bar
              key={c.label}
              dataKey={`pct${i}`}
              name={c.label}
              stackId="share"
              fill={c.color}
              isAnimationActive={false}
              label={<SegmentLabel category={i} rows={rows} narrow={narrow} wideMin={wideMinSegment} />}
            >
              {rows.map((r) => (
                <Cell
                  key={r.key}
                  fillOpacity={r.variant === "league" ? 0.45 : 1}
                  stroke={r.variant === "league" ? "var(--fg)" : undefined}
                  strokeDasharray={r.variant === "league" ? "3 2" : undefined}
                  strokeWidth={r.variant === "league" ? 1 : 0}
                />
              ))}
            </Bar>
          ))}
          {/* 25・50・75% の点線（棒の上に重ねる） */}
          {SHOW_GUIDE_LINES &&
            GUIDE_TICKS.map((x) => (
              <ReferenceLine key={x} x={x} stroke="var(--fg)" strokeOpacity={0.45} strokeDasharray="2 3" ifOverflow="visible" />
            ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="foreign-count-legend">
        {categories.map((c) => (
          <span key={c.label} className="foreign-count-legend-item">
            <span className="foreign-count-legend-swatch" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
      {footer}
    </div>
  );
}

/** 行の見出し（1〜2行）。recharts の既定の見出しと同じ文字の大きさ・色 */
function RowLabelTick({ x, y, payload, rowByKey }: { x?: number; y?: number; payload?: { value: string }; rowByKey: Map<string, ShareBarRow> }) {
  if (x == null || y == null || !payload) return null;
  const row = rowByKey.get(payload.value);
  const lines = row?.labelLines ?? [payload.value];
  const lineHeight = 13;
  const firstDy = -((lines.length - 1) * lineHeight) / 2;
  const league = row?.variant === "league";
  return (
    <text
      x={x}
      y={y}
      textAnchor="end"
      dominantBaseline="central"
      fontSize={11}
      fill={league ? "var(--fg)" : "#666"}
      fontWeight={league ? 700 : undefined}
    >
      {lines.map((line, i) => (
        <tspan key={i} x={x} dy={i === 0 ? firstDy : lineHeight} fontSize={i === 0 ? 11 : 10}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function SegmentLabel({
  x,
  y,
  width,
  height,
  index,
  category,
  rows,
  narrow,
  wideMin,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  category: number;
  rows: ShareBarRow[];
  narrow: boolean;
  wideMin: number;
}) {
  if (x == null || y == null || width == null || height == null || index == null || width < (narrow ? 34 : wideMin)) return null;
  const row = rows[index];
  if (!row) return null;
  const pct = row.pct[category] ?? 0;
  const detail = row.details[category];
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
      {narrow || !detail ? `${pct.toFixed(1)}%` : `${pct.toFixed(1)}% (${detail})`}
    </text>
  );
}

function ShareBarTooltip({
  active,
  payload,
  rowByKey,
  categories,
}: {
  active?: boolean;
  payload?: { payload: ChartDatum }[];
  rowByKey: Map<string, ShareBarRow>;
  categories: ShareBarCategory[];
}) {
  if (!active || !payload || payload.length === 0) return null;
  const row = rowByKey.get(payload[0]!.payload.key);
  if (!row) return null;
  return (
    <div className="foreign-count-tooltip">
      <div className="foreign-count-tooltip-team">{row.tooltipTitle}</div>
      {categories.map((c, i) => (
        <div key={c.label} className="foreign-count-tooltip-row">
          <span className="foreign-count-tooltip-swatch" style={{ background: c.color }} />
          {c.label}: {(row.pct[i] ?? 0).toFixed(1)}%{row.tooltipDetails[i] ?? ""}
        </div>
      ))}
      {row.tooltipFooter && <div className="foreign-count-tooltip-total">{row.tooltipFooter}</div>}
    </div>
  );
}
