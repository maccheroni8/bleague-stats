import { useMemo, useState } from "react";
import type { BoxscoreRow } from "../../shared/types";
import { BASKET_X_M, BASKET_Y_M, buildZoneStats, playersWithShots, type ShotEvent } from "../lib/shotChart";

// FIBAハーフコートの概略図（1unit = 10cm）。実寸に近づけた簡易図で、正確な公式図面ではない
const COURT_WIDTH = 150; // 15m（サイドライン間）
const COURT_LENGTH = 140; // 14m（ベースライン〜ハーフコートライン）
const BASKET_Y = 15.75; // 1.575m（ベースラインからリム中心まで）
const RIM_RADIUS = 2.25;
const BACKBOARD_Y = 12;
const BACKBOARD_HALF_WIDTH = 9;
const RESTRICTED_RADIUS = 12.5;
const LANE_HALF_WIDTH = 24.5;
const LANE_LENGTH = 58;
const FT_CIRCLE_RADIUS = 18;
const THREE_RADIUS = 67.5;
const THREE_SIDE_X = 9; // サイドラインから0.9m
const CENTER_X = COURT_WIDTH / 2;
const THREE_CORNER_Y = BASKET_Y + Math.sqrt(THREE_RADIUS ** 2 - (CENTER_X - THREE_SIDE_X) ** 2);

// shotChart.tsが返すx/yは0〜100のフルコート正規化座標（コート全長28m・全幅15mを0〜100に対応）。
// x軸はミラー済みでハーフコート相当（0〜約50が意味を持つ範囲）なのでCOURT_LENGTH(14m)基準、
// y軸はコート全幅15m基準でスケールする
const X_SCALE = COURT_LENGTH / 50; // raw 0-50(=14m) -> 0-140
const Y_SCALE = COURT_WIDTH / 100; // raw 0-100(=15m) -> 0-150
const M_TO_UNIT = 10; // 1unit = 10cm

function HalfCourt() {
  return (
    <g className="shot-court-lines" fill="none">
      <rect x={0} y={0} width={COURT_WIDTH} height={COURT_LENGTH} />
      <rect x={CENTER_X - LANE_HALF_WIDTH} y={0} width={LANE_HALF_WIDTH * 2} height={LANE_LENGTH} />
      <circle cx={CENTER_X} cy={LANE_LENGTH} r={FT_CIRCLE_RADIUS} />
      <path
        d={`M ${CENTER_X - RESTRICTED_RADIUS} ${BASKET_Y} A ${RESTRICTED_RADIUS} ${RESTRICTED_RADIUS} 0 0 0 ${CENTER_X + RESTRICTED_RADIUS} ${BASKET_Y}`}
      />
      <line x1={CENTER_X - BACKBOARD_HALF_WIDTH} y1={BACKBOARD_Y} x2={CENTER_X + BACKBOARD_HALF_WIDTH} y2={BACKBOARD_Y} />
      <circle cx={CENTER_X} cy={BASKET_Y} r={RIM_RADIUS} />
      <path
        d={`M ${THREE_SIDE_X} 0 L ${THREE_SIDE_X} ${THREE_CORNER_Y} A ${THREE_RADIUS} ${THREE_RADIUS} 0 0 0 ${COURT_WIDTH - THREE_SIDE_X} ${THREE_CORNER_Y} L ${COURT_WIDTH - THREE_SIDE_X} 0`}
      />
    </g>
  );
}

function formatShotSummary(shots: ShotEvent[]): string {
  const makes = shots.filter((s) => s.made).length;
  const attempts = shots.length;
  if (attempts === 0) return "0-0";
  return `${makes}-${attempts} (${((makes / attempts) * 100).toFixed(1)}%)`;
}

/** バスケット中心からの距離r(m)・角度θ(度)をSVG座標(cx, cy)に変換する */
function polarToSvgPoint(r: number, thetaDeg: number): { x: number; y: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  const xm = BASKET_X_M + r * Math.cos(rad);
  const ym = BASKET_Y_M + r * Math.sin(rad);
  return { x: ym * M_TO_UNIT, y: xm * M_TO_UNIT };
}

/** 円弧をSVGのA(elliptical arc)コマンドの向き判定を避けるため、折れ線近似で描く */
function arcPoints(r: number, thetaStart: number, thetaEnd: number, steps = 12): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = thetaStart + ((thetaEnd - thetaStart) * i) / steps;
    pts.push(polarToSvgPoint(r, t));
  }
  return pts;
}

function sectorPath(rInner: number, rOuter: number, thetaStart: number, thetaEnd: number): string {
  const outer = arcPoints(rOuter, thetaStart, thetaEnd);
  const inner = rInner > 0 ? arcPoints(rInner, thetaEnd, thetaStart) : [];
  const points = [...outer, ...inner];
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  return `${d} Z`;
}

/** 成功率(0〜1)を寒色(低)〜暖色(高)のヒートマップ色にする。20%〜65%を表示レンジとする */
function zoneHeatColor(pct: number): string {
  const clamped = Math.min(1, Math.max(0, (pct - 0.2) / (0.65 - 0.2)));
  const hue = 210 - clamped * 205;
  return `hsl(${hue}, 65%, 45%)`;
}

function ZoneHeatmap({ shots }: { shots: ShotEvent[] }) {
  const zoneStats = useMemo(() => buildZoneStats(shots), [shots]);
  return (
    <g>
      {zoneStats.map(({ zone, attempts, makes }) => {
        const path = sectorPath(zone.rInner, zone.rOuter, zone.thetaStart, zone.thetaEnd);
        if (attempts === 0) {
          return <path key={zone.id} d={path} className="zone-empty" />;
        }
        const pct = makes / attempts;
        const centroid = polarToSvgPoint((zone.rInner + zone.rOuter) / 2, (zone.thetaStart + zone.thetaEnd) / 2);
        return (
          <g key={zone.id}>
            <path d={path} fill={zoneHeatColor(pct)} className="zone-fill">
              <title>
                {zone.label}: {makes}-{attempts} ({(pct * 100).toFixed(1)}%)
              </title>
            </path>
            <text x={centroid.x} y={centroid.y} className="zone-label">
              {Math.round(pct * 100)}%
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface ShotChartPanelProps {
  teamName: string;
  players: BoxscoreRow[];
  shots: ShotEvent[];
  color: string;
}

export function ShotChartPanel({ teamName, players, shots, color }: ShotChartPanelProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [viewMode, setViewMode] = useState<"dots" | "zones">("dots");
  const selectablePlayers = useMemo(() => playersWithShots(players, shots), [players, shots]);
  const visibleShots = selectedPlayerId ? shots.filter((s) => s.playerId === selectedPlayerId) : shots;

  return (
    <div className="shot-chart-panel">
      <div className="shot-chart-header">
        <h3>{teamName}</h3>
        <select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)}>
          <option value="">チーム全体</option>
          {selectablePlayers.map((p) => (
            <option key={p.PlayerID} value={p.PlayerID}>
              {p.PlayerNameJ}
            </option>
          ))}
        </select>
      </div>
      <div className="shot-chart-controls">
        <div className="mode-toggle">
          <button className={viewMode === "dots" ? "active" : ""} onClick={() => setViewMode("dots")}>
            個別ショット
          </button>
          <button className={viewMode === "zones" ? "active" : ""} onClick={() => setViewMode("zones")}>
            エリア別成功率
          </button>
        </div>
        {viewMode === "dots" && (
          <div className="shot-chart-legend">
            <span className="shot-chart-legend-item">
              <span className="shot-dot-sample shot-made" style={{ borderColor: color, background: color }} />
              成功
            </span>
            <span className="shot-chart-legend-item">
              <span className="shot-dot-sample shot-missed" style={{ borderColor: color }} />
              失敗
            </span>
          </div>
        )}
      </div>
      <p className="shot-chart-summary">{formatShotSummary(visibleShots)}</p>
      <svg viewBox={`0 0 ${COURT_WIDTH} ${COURT_LENGTH}`} className="shot-chart-svg">
        <HalfCourt />
        {viewMode === "dots" ? (
          visibleShots.map((s, i) => (
            <circle
              key={i}
              cx={s.y * Y_SCALE}
              cy={s.x * X_SCALE}
              r={2.4}
              className={`shot-dot ${s.made ? "shot-made" : "shot-missed"}`}
              style={{ stroke: color, fill: s.made ? color : "none" }}
            >
              <title>
                {s.playerName} {s.isThree ? "3P" : "2P"} {s.made ? "成功" : "失敗"}
              </title>
            </circle>
          ))
        ) : (
          <ZoneHeatmap shots={visibleShots} />
        )}
      </svg>
    </div>
  );
}
