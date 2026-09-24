import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { teamShortName } from "../../shared/teamNames";
import type { TeamSummary } from "../../shared/types";
import { CLASSIFICATION_COLORS } from "../lib/classificationFilter";

// 表示順: 日本人/外国籍・帰化・アジア。配色は各カテゴリに固定で割り当てる
const CATEGORY_LABELS = ["Japanese", "Foreign"] as const;
const CATEGORY_COLORS = [CLASSIFICATION_COLORS.japanese, CLASSIFICATION_COLORS.international] as const;
type CategoryIndex = 0 | 1;

type SortKey = "total" | "cat0" | "cat1";

interface CompositionRow {
  teamId: string;
  teamShort: string;
  total: number;
  pct: [number, number];
  value: [number, number];
  pct0: number;
  pct1: number;
}

function sortValueOf(row: CompositionRow, key: SortKey): number {
  if (key === "total") return row.total;
  const idx = Number(key.slice(3)) as CategoryIndex;
  return row.value[idx];
}

/**
 * 得点構成/失点構成（登録区分別）。全26チームを一度に比較する必要があるため、
 * 既存のScoringCompositionChart（Phase H10、3P/FT/ミッドレンジ/ペイント内の4区分）と
 * 同じ100%積み上げ棒グラフ（recharts BarChart、1チーム1本）の構成を、日本人/
 * 外国籍・帰化・アジアの2区分に置き換えて実装したもの。classification未定義の選手の
 * 得点はどちらのセグメントにも計上しないため、2セグメントの合計が総得点に満たないことがある
 */
export function ClassificationCompositionChart({ teams, mode }: { teams: TeamSummary[]; mode: "own" | "opponent" }) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const rows: CompositionRow[] = useMemo(() => {
    return teams.map((t) => {
      const totalPerGame = mode === "own" ? t.perGame.pts : t.opponentPerGame.pts;
      const pct: [number, number] =
        mode === "own"
          ? [t.advanced.japanesePointsSharePct, t.advanced.foreignPointsSharePct + t.advanced.naturalizedOrAsianPointsSharePct]
          : [
              t.advanced.opponentJapanesePointsSharePct,
              t.advanced.opponentForeignPointsSharePct + t.advanced.opponentNaturalizedOrAsianPointsSharePct,
            ];
      const value = pct.map((p) => (p / 100) * totalPerGame) as [number, number];
      return {
        teamId: t.teamId,
        teamShort: teamShortName(t.teamId, t.teamName),
        total: totalPerGame,
        pct,
        value,
        pct0: pct[0],
        pct1: pct[1],
      };
    });
  }, [teams, mode]);

  const sortedRows = useMemo(() => {
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => (sortValueOf(a, sortKey) - sortValueOf(b, sortKey)) * factor);
  }, [rows, sortKey, sortDir]);

  if (sortedRows.length === 0) {
    return <p className="empty-message">このシーズンのデータには対応していません</p>;
  }

  const height = Math.max(240, sortedRows.length * 30 + 40);

  const handleSortClick = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const indicator = (key: SortKey) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  return (
    <div className="foreign-count-chart">
      <p className="page-subtitle">※現在の登録情報に基づく参考値</p>
      <div className="mode-toggle">
        <button type="button" className={sortKey === "total" ? "active" : ""} onClick={() => handleSortClick("total")}>
          Avg PTS{indicator("total")}
        </button>
        {CATEGORY_LABELS.map((label, i) => {
          const key = `cat${i}` as SortKey;
          return (
            <button key={key} type="button" className={sortKey === key ? "active" : ""} onClick={() => handleSortClick(key)}>
              {label}
              {indicator(key)}
            </button>
          );
        })}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={sortedRows} layout="vertical" margin={{ top: 8, right: 24, bottom: 8, left: 8 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, 100]}
            tickFormatter={(v: number) => `${Math.round(v)}%`}
            tick={{ fontSize: 11 }}
            tickLine={false}
          />
          <YAxis type="category" dataKey="teamShort" width={64} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CompositionTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          {CATEGORY_LABELS.map((label, i) => (
            <Bar
              key={label}
              dataKey={`pct${i}`}
              name={label}
              stackId="classification"
              fill={CATEGORY_COLORS[i]}
              isAnimationActive={false}
              label={<SegmentLabel catIndex={i as CategoryIndex} rows={sortedRows} />}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <div className="foreign-count-legend">
        {CATEGORY_LABELS.map((label, i) => (
          <span key={label} className="foreign-count-legend-item">
            <span className="foreign-count-legend-swatch" style={{ background: CATEGORY_COLORS[i] }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** 各セグメント上に割合(%)と実数値（1試合あたり平均得点）を表示する。セグメント幅が
 * 狭すぎて文字が収まらない場合は非表示にする。背景色を問わず視認できるよう、白文字＋
 * 黒縁取り（paintOrder="stroke"）で統一する */
function SegmentLabel({
  x,
  y,
  width,
  height,
  index,
  catIndex,
  rows,
}: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  index?: number;
  catIndex: CategoryIndex;
  rows: CompositionRow[];
}) {
  if (x == null || y == null || width == null || height == null || index == null || width < 46) return null;
  const row = rows[index];
  if (!row) return null;
  const pct = row.pct[catIndex];
  const value = row.value[catIndex];
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
      {`${pct.toFixed(1)}% (${value.toFixed(1)})`}
    </text>
  );
}

function CompositionTooltip({ active, payload }: { active?: boolean; payload?: { payload: CompositionRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  return (
    <div className="foreign-count-tooltip">
      <div className="foreign-count-tooltip-team">{row.teamShort}</div>
      {CATEGORY_LABELS.map((label, i) => (
        <div key={label} className="foreign-count-tooltip-row">
          <span className="foreign-count-tooltip-swatch" style={{ background: CATEGORY_COLORS[i] }} />
          {label}: {row.pct[i]!.toFixed(1)}%（{row.value[i]!.toFixed(1)} pts）
        </div>
      ))}
      <div className="foreign-count-tooltip-total">Avg PTS: {row.total.toFixed(1)}</div>
    </div>
  );
}
