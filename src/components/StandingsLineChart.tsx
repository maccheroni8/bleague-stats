import { useMemo, useState } from "react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { teamLogoUrl } from "../lib/data";
import { teamShortName } from "../../shared/teamNames";
import type { TeamColors } from "../../shared/types";

export interface ChartTeam {
  teamId: string;
  teamName: string;
}

interface StandingsLineChartProps {
  title: string;
  data: Record<string, number | string>[];
  teams: ChartTeam[];
  /** 順位グラフ用: 1位を上に、数値が大きいほど下に表示する */
  reversed?: boolean;
  height?: number;
  /** 指定時、折れ線の色にチームカラー（primary）を使う。未取得のチーム（過去在籍のみの
   * クラブ等、data/team-colors.jsonに無いチーム）は従来通りインデックス由来の虹色にフォールバックする */
  teamColors?: Record<string, TeamColors>;
  /** アニメーション再生中: 末端のロゴ（フォールバック時は円）がCSSトランジションで
   * 前の位置から新しい位置へ滑らかに移動するようにする（再生中以外は瞬時に位置更新する） */
  isAnimating?: boolean;
}

/** チーム数に応じて均等に色相を割り振る簡易パレット。teamColorsに無いチーム用のフォールバック */
function fallbackColor(index: number, total: number): string {
  const hue = Math.round((index * 360) / Math.max(total, 1));
  return `hsl(${hue}, 65%, 55%)`;
}

const LOGO_SIZE = 20;

export function StandingsLineChart({
  title,
  data,
  teams,
  reversed = false,
  height = 320,
  teamColors,
  isAnimating = false,
}: StandingsLineChartProps) {
  // アニメーション再生中はdataが徐々に伸びていくため、折れ線の末端（=最新地点）の位置は
  // dataの長さそのものではなく「そのチームの値が定義済みの最後のindex」から都度求める
  // （ワイルドカードグラフ等、チームによって値が欠ける日があるため）
  const lastValidIndexByTeam = useMemo(() => {
    const result = new Map<string, number>();
    for (const t of teams) {
      for (let i = data.length - 1; i >= 0; i--) {
        const v = data[i]![t.teamId];
        if (v !== undefined && v !== null && !Number.isNaN(v as number)) {
          result.set(t.teamId, i);
          break;
        }
      }
    }
    return result;
  }, [data, teams]);

  const [failedLogos, setFailedLogos] = useState<Set<string>>(new Set());
  const markLogoFailed = (teamId: string) => {
    setFailedLogos((prev) => (prev.has(teamId) ? prev : new Set(prev).add(teamId)));
  };

  return (
    <div className="standings-chart">
      <h3>{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 8, right: 24, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} minTickGap={24} />
          <YAxis
            reversed={reversed}
            allowDecimals={!reversed}
            tick={{ fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          <Tooltip
            contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg)" }}
            labelStyle={{ color: "var(--fg)" }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {teams.map((t, i) => {
            const color = teamColors?.[t.teamId]?.primary ?? fallbackColor(i, teams.length);
            const lastIndex = lastValidIndexByTeam.get(t.teamId);
            return (
              <Line
                key={t.teamId}
                type="monotone"
                dataKey={t.teamId}
                name={teamShortName(t.teamId, t.teamName)}
                stroke={color}
                dot={(props: any) => {
                  const { cx, cy, index } = props;
                  if (index !== lastIndex || cx === undefined || cy === undefined) {
                    return <circle key={`${t.teamId}-dot-${index}`} cx={cx} cy={cy} r={0} fill="none" />;
                  }
                  if (failedLogos.has(t.teamId)) {
                    return (
                      <circle
                        key={`${t.teamId}-dot-${index}`}
                        cx={cx}
                        cy={cy}
                        r={4}
                        fill={color}
                        style={isAnimating ? { transition: "cx 90ms linear, cy 90ms linear" } : undefined}
                      />
                    );
                  }
                  return (
                    <image
                      key={`${t.teamId}-logo`}
                      href={teamLogoUrl(t.teamId)}
                      x={cx - LOGO_SIZE / 2}
                      y={cy - LOGO_SIZE / 2}
                      width={LOGO_SIZE}
                      height={LOGO_SIZE}
                      onError={() => markLogoFailed(t.teamId)}
                      style={isAnimating ? { transition: "x 90ms linear, y 90ms linear" } : undefined}
                    />
                  );
                }}
                strokeWidth={2}
                connectNulls
                isAnimationActive={false}
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
