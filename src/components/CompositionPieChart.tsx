import { Cell, Pie, PieChart } from "recharts";
import { formatDecimal } from "../lib/format";
import { useMediaQuery } from "../lib/useMediaQuery";

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

/** 外側ラベルの文字の大きさ・太さ（index.css の .composition-pie-outer-label と揃える） */
const OUTER_LABEL_FONT_PX = 11;
const OUTER_LABEL_FONT_WEIGHT = 600;
const OUTER_LABEL_LINE_EM = 1.1;
/** これより長い名称は「・」の位置で折り返す（「外国籍・帰化・アジア」→「外国籍・」「帰化・アジア」） */
const MAX_LABEL_LINE_PX = 72;

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureText(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement("canvas").getContext("2d");
    if (measureCtx) {
      measureCtx.font = `${OUTER_LABEL_FONT_WEIGHT} ${OUTER_LABEL_FONT_PX}px ${getComputedStyle(document.body).fontFamily}`;
    }
  }
  // 計測できない環境では全角1文字＝1em、半角＝0.6emで見積もる
  if (!measureCtx) return [...text].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 1 : 0.6) * OUTER_LABEL_FONT_PX, 0);
  return measureCtx.measureText(text).width;
}

/** 長い名称を「・」の後ろで折り返して行に分ける（1行が MAX_LABEL_LINE_PX を超えないように詰める） */
function wrapLabel(label: string): string[] {
  if (measureText(label) <= MAX_LABEL_LINE_PX) return [label];
  const parts = label.split(/(?<=・)/);
  const lines: string[] = [];
  let current = "";
  for (const part of parts) {
    if (current && measureText(current + part) > MAX_LABEL_LINE_PX) {
      lines.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface OuterLabelLayout {
  lines: string[];
  /** 円の中心から見た、ラベル線の終点（中心基準の相対座標） */
  endX: number;
  endY: number;
  anchor: "start" | "end";
  width: number;
}

/**
 * 3〜4分割の円グラフ。各セグメントに外側ラベル（名称・割合%）と内側ラベル（実数値）を表示する
 * （添付画像のFG試投割合の円グラフと同じ形式、Batch 4）。recharts単体のlabel機能では
 * 「外側にラベル、内側に実数値」という2種類の表示を同時に描画できないため、Pieのlabel/labelLine
 * propに渡すカスタム描画関数の中で両方のtext要素を組み立てている。
 *
 * 外側ラベルが描画範囲からはみ出して切れないよう（DESIGN.md 137章。左側に来た「外国籍・帰化・アジア」が切れていた）、
 * 描画前にラベルの位置と文字幅を計算し、はみ出す分だけ描画範囲を左右上下に広げて円の中心をずらす。長い名称は「・」で折り返す。
 * スマホ幅（560px以下）は円を小さくし、ラベル線も短くして画面幅に収める
 */
export function CompositionPieChart({ title, segments, size = 320, valueDigits = 1 }: CompositionPieChartProps) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const pieSize = narrow ? Math.min(size, 220) : size;
  const outerRadius = pieSize * 0.26;
  const labelBendOffset = narrow ? 12 : 18;
  const labelEndOffset = narrow ? 28 : 44;

  // recharts の Pie と同じ角度の取り方（0度＝右、反時計回り、startAngle=0・endAngle=360）で各セグメントの中央の角度を求め、
  // 外側ラベルの位置と大きさを先に決める
  const layouts: OuterLabelLayout[] = [];
  let acc = 0;
  for (const seg of segments) {
    const mid = total > 0 ? ((acc + seg.value / 2) / total) * 360 : 0;
    acc += seg.value;
    const end = polarToCartesian(0, 0, outerRadius + labelEndOffset, mid);
    const lines = wrapLabel(seg.label);
    const width = Math.max(...lines.map(measureText), measureText("100.0%"));
    layouts.push({ lines, endX: end.x, endY: end.y, anchor: end.x >= 0 ? "start" : "end", width });
  }
  const lineHeight = OUTER_LABEL_FONT_PX * OUTER_LABEL_LINE_EM;
  let minX = -pieSize / 2;
  let maxX = pieSize / 2;
  let minY = -pieSize / 2;
  let maxY = pieSize / 2;
  for (const l of layouts) {
    const textX = l.endX + (l.anchor === "start" ? 4 : -4);
    minX = Math.min(minX, l.anchor === "start" ? textX : textX - l.width);
    maxX = Math.max(maxX, l.anchor === "start" ? textX + l.width : textX);
    // 行は終点の高さを中心に、名称の行＋割合の行を上下に並べる
    const blockHeight = (l.lines.length + 1) * lineHeight;
    minY = Math.min(minY, l.endY - blockHeight / 2);
    maxY = Math.max(maxY, l.endY + blockHeight / 2);
  }
  const margin = 4;
  const width = Math.ceil(maxX - minX + margin * 2);
  const height = Math.ceil(maxY - minY + margin * 2);
  const cx = margin - minX;
  const cy = margin - minY;

  const renderLabel = (props: unknown) => {
    const p = props as { cx: number; cy: number; midAngle: number; percent: number; index: number };
    const seg = segments[p.index];
    const layout = layouts[p.index];
    if (!seg || !layout) return null;
    const textX = p.cx + layout.endX + (layout.anchor === "start" ? 4 : -4);
    const firstDy = -(layout.lines.length / 2) * OUTER_LABEL_LINE_EM + OUTER_LABEL_LINE_EM / 2;
    const valuePos = polarToCartesian(p.cx, p.cy, outerRadius * 0.62, p.midAngle);
    return (
      <g key={seg.key}>
        <text
          x={textX}
          y={p.cy + layout.endY}
          textAnchor={layout.anchor}
          dominantBaseline="central"
          className="composition-pie-outer-label"
        >
          {layout.lines.map((line, i) => (
            <tspan key={i} x={textX} dy={`${i === 0 ? firstDy : OUTER_LABEL_LINE_EM}em`}>
              {line}
            </tspan>
          ))}
          <tspan x={textX} dy={`${OUTER_LABEL_LINE_EM}em`}>
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
        <div className="composition-pie-chart-canvas" style={{ width, height }}>
          <PieChart width={width} height={height} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
            <Pie
              data={segments}
              dataKey="value"
              nameKey="label"
              cx={cx}
              cy={cy}
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
        </div>
      )}
    </div>
  );
}
