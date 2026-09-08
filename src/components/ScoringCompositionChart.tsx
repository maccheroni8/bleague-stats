import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OpposedBarRow } from "./OpposedBar";
import { formatPct100 } from "../lib/format";
import type { TeamSummary } from "../../shared/types";

const CATEGORY_LABELS = ["3P", "ペイント内", "ミッドレンジ", "FT"] as const;
const CATEGORY_COLORS = ["#1f78c1", "#0b3d7a", "#7cc4f7", "#c4c4c4"] as const;

interface CompositionRow {
  teamId: string;
  teamName: string;
  pct: [number, number, number, number];
  pct0: number;
  pct1: number;
  pct2: number;
  pct3: number;
}

/**
 * 得点構成/失点構成（全チーム横断、Phase H10）。TeamDetailPageの得点構成セクション
 * （OpposedBarRow、自チーム vs 相手チームの2値比較）とは異なり、こちらは26チームを
 * 一度に比較する必要があるため、既存のForeignPlayerCourtTimeChart（84章）と同じ
 * 100%積み上げ棒グラフ（recharts BarChart、1チーム1本）を採用する
 */
export function ScoringCompositionChart({ teams, mode }: { teams: TeamSummary[]; mode: "own" | "opponent" }) {
  const rows: CompositionRow[] = teams
    .map((t) => {
      const pct: [number, number, number, number] =
        mode === "own"
          ? [
              t.advanced.threePointPointsSharePct,
              t.advanced.paintPointsSharePct,
              t.advanced.midRangePointsSharePct,
              t.advanced.ftPointsSharePct,
            ]
          : [
              t.advanced.opponentThreePointPointsSharePct,
              t.advanced.opponentPaintPointsSharePct,
              t.advanced.opponentMidRangePointsSharePct,
              t.advanced.opponentFtPointsSharePct,
            ];
      return { teamId: t.teamId, teamName: t.teamName, pct, pct0: pct[0], pct1: pct[1], pct2: pct[2], pct3: pct[3] };
    })
    .sort((a, b) => b.pct1 - a.pct1);

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
          <YAxis type="category" dataKey="teamName" width={92} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CompositionTooltip />} cursor={{ fill: "var(--row-hover)" }} />
          <Bar dataKey="pct0" name={CATEGORY_LABELS[0]} stackId="scoring" fill={CATEGORY_COLORS[0]} isAnimationActive={false} />
          <Bar dataKey="pct1" name={CATEGORY_LABELS[1]} stackId="scoring" fill={CATEGORY_COLORS[1]} isAnimationActive={false} />
          <Bar dataKey="pct2" name={CATEGORY_LABELS[2]} stackId="scoring" fill={CATEGORY_COLORS[2]} isAnimationActive={false} />
          <Bar dataKey="pct3" name={CATEGORY_LABELS[3]} stackId="scoring" fill={CATEGORY_COLORS[3]} isAnimationActive={false} />
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

function CompositionTooltip({ active, payload }: { active?: boolean; payload?: { payload: CompositionRow }[] }) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]!.payload;
  return (
    <div className="foreign-count-tooltip">
      <div className="foreign-count-tooltip-team">{row.teamName}</div>
      {CATEGORY_LABELS.map((label, i) => (
        <div key={label} className="foreign-count-tooltip-row">
          <span className="foreign-count-tooltip-swatch" style={{ background: CATEGORY_COLORS[i] }} />
          {label}: {row.pct[i]!.toFixed(1)}%
        </div>
      ))}
    </div>
  );
}

/**
 * FG% / opp FG%を、既存のキースタッツセクション（試合詳細ページ）と同じOpposedBarRowで
 * チームごとに対向表示する。labelにチーム名を使うことで、26チーム分を1つの縦並びリストとして
 * 表現する（他の2値比較OpposedBarRowと同じコンポーネントをそのまま再利用）
 */
export function TeamFgPctBars({ teams }: { teams: TeamSummary[] }) {
  const rows = teams
    .map((t) => ({
      teamId: t.teamId,
      teamName: t.teamName,
      own: t.shooting.fgPct * 100,
      opp: t.opponentShooting.fgPct * 100,
    }))
    .sort((a, b) => b.own - a.own);

  if (rows.length === 0) {
    return <p className="empty-message">このシーズンのデータには対応していません</p>;
  }

  return (
    <div className="key-stats-card">
      {rows.map((r) => (
        <OpposedBarRow
          key={r.teamId}
          label={r.teamName}
          homeValue={r.own}
          awayValue={r.opp}
          homeColor="var(--accent)"
          awayColor="var(--muted)"
          format={(v) => formatPct100(v)}
          scale="fixed100"
        />
      ))}
    </div>
  );
}
