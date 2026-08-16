import { useMemo, useState } from "react";
import type { BoxscoreRow } from "../../shared/types";
import { playersWithShots, type ShotEvent } from "../lib/shotChart";

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

interface ShotChartPanelProps {
  teamName: string;
  players: BoxscoreRow[];
  shots: ShotEvent[];
  color: string;
}

export function ShotChartPanel({ teamName, players, shots, color }: ShotChartPanelProps) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
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
      <p className="shot-chart-summary">{formatShotSummary(visibleShots)}</p>
      <svg viewBox={`0 0 ${COURT_WIDTH} ${COURT_LENGTH}`} className="shot-chart-svg">
        <HalfCourt />
        {visibleShots.map((s, i) => (
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
        ))}
      </svg>
    </div>
  );
}
