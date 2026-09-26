import { useId, useMemo, useState } from "react";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  BASKET_X_M,
  BASKET_Y_M,
  buildZoneStats,
  LANE_HALF_WIDTH_M,
  LANE_LENGTH_M,
  playersWithShots,
  type ShotChartPlayerOption,
  type ShotEvent,
  type ZoneDef,
} from "../lib/shotChart";

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
/** センターラインより後ろからのロングシュートの印（ひし形）の大きさ */
const LONG_SHOT_MARK_SIZE = 3;

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
  if (attempts === 0) return "0/0";
  return `${makes}/${attempts} (${((makes / attempts) * 100).toFixed(1)}%)`;
}

/** バスケット中心からの距離r(m)・角度θ(度)をSVG座標(cx, cy)に変換する */
function polarToSvgPoint(r: number, thetaDeg: number): { x: number; y: number } {
  const rad = (thetaDeg * Math.PI) / 180;
  const xm = BASKET_X_M + r * Math.cos(rad);
  const ym = BASKET_Y_M + r * Math.sin(rad);
  return { x: ym * M_TO_UNIT, y: xm * M_TO_UNIT };
}

/** 円弧をSVGのA(elliptical arc)コマンドの向き判定を避けるため、折れ線近似で描く */
function arcPoints(r: number, thetaStart: number, thetaEnd: number, steps = Math.max(12, Math.ceil(Math.abs(thetaEnd - thetaStart) / 5))): { x: number; y: number }[] {
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

/** ヒートマップの塗り不透明度。濃すぎて数値ラベルの視認性を損なわないよう抑える */
const ZONE_FILL_OPACITY = 0.6;

/**
 * ラベル位置をコート図（viewBox 0 0 COURT_WIDTH COURT_LENGTH）の可視範囲内に収める。
 * コーナー3のような扇形は角度レンジの中間点でセントロイドを取ると実際のコート外（サイドライン
 * 外側）にはみ出すことがあり、そのままだとラベルが枠外に出て見えなくなる（実データで確認済み）
 */
function clampLabelPoint(point: { x: number; y: number }): { x: number; y: number } {
  const margin = 9;
  return {
    x: Math.min(COURT_WIDTH - margin, Math.max(margin, point.x)),
    y: Math.min(COURT_LENGTH - margin, Math.max(margin, point.y)),
  };
}

/** ペイントの長方形（SVG座標）。ゾーンの判定（src/lib/shotChart.ts の isInLane）と同じ幅4.9m・ベースラインから5.8m */
const LANE_RECT_PATH = (() => {
  const x0 = (BASKET_Y_M - LANE_HALF_WIDTH_M) * M_TO_UNIT;
  const x1 = (BASKET_Y_M + LANE_HALF_WIDTH_M) * M_TO_UNIT;
  const y1 = LANE_LENGTH_M * M_TO_UNIT;
  return `M ${x0} 0 L ${x1} 0 L ${x1} ${y1} L ${x0} ${y1} Z`;
})();

/** ゾーンの形。ペイントは長方形からリング周り（半円）を抜いた形、ミッドレンジ・ショートコーナーは扇形（長方形の外側だけ切り抜いて描く） */
function zonePath(zone: ZoneDef): string {
  // ペイントは長方形からリング周りの円を抜いた形（evenodd）
  if (zone.shape === "lane") return `${LANE_RECT_PATH} ${sectorPath(0, 1.25, -180, 180)}`;
  return sectorPath(zone.rInner, zone.rOuter, zone.thetaStart, zone.thetaEnd);
}

function zoneLabelPoint(zone: ZoneDef): { x: number; y: number } {
  if (zone.shape === "lane") return polarToSvgPoint(3.3, 0);
  return polarToSvgPoint(zone.labelR ?? (zone.rInner + zone.rOuter) / 2, zone.labelTheta ?? (zone.thetaStart + zone.thetaEnd) / 2);
}

function ZoneHeatmap({ shots }: { shots: ShotEvent[] }) {
  const zoneStats = useMemo(() => buildZoneStats(shots), [shots]);
  // 1ページに複数のショットチャートが並ぶため、切り抜き（clipPath）の id は図ごとに変える
  const clipId = `outside-lane-${useId().replace(/:/g, "")}`;
  const zoneProps = (zone: ZoneDef) => ({
    d: zonePath(zone),
    fillRule: "evenodd" as const,
    clipPath: zone.shape === "outsideLane" ? `url(#${clipId})` : undefined,
  });
  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <path d={`M 0 0 L ${COURT_WIDTH} 0 L ${COURT_WIDTH} ${COURT_LENGTH} L 0 ${COURT_LENGTH} Z ${LANE_RECT_PATH}`} clipRule="evenodd" />
        </clipPath>
      </defs>
      {zoneStats.map(({ zone, attempts, makes }) => {
        const centroid = clampLabelPoint(zoneLabelPoint(zone));
        if (attempts === 0) {
          // 試投0本のゾーンも塗る（白く抜けると、どのゾーンにも入らない場所に見えるため）
          return (
            <g key={zone.id}>
              <path {...zoneProps(zone)} className="zone-empty">
                <title>{zone.label}: 0-0</title>
              </path>
              <text x={centroid.x} y={centroid.y + 1} className="zone-label-sub zone-label-empty">
                0/0
              </text>
            </g>
          );
        }
        const pct = makes / attempts;
        return (
          <g key={zone.id}>
            <path {...zoneProps(zone)} fill={zoneHeatColor(pct)} fillOpacity={ZONE_FILL_OPACITY} className="zone-fill">
              <title>
                {zone.label}: {makes}-{attempts} ({(pct * 100).toFixed(1)}%)
              </title>
            </path>
            <text x={centroid.x} y={centroid.y - 1.8} className="zone-label">
              {(pct * 100).toFixed(1)}%
            </text>
            <text x={centroid.x} y={centroid.y + 2.6} className="zone-label-sub">
              {makes}/{attempts}
            </text>
          </g>
        );
      })}
    </g>
  );
}

interface ShotChartPanelProps {
  teamName: string;
  /** スマホ幅（560px以下）で見出しが2行に折り返さないよう、代わりに出す略称（省略時は常にteamName） */
  shortName?: string;
  players: ShotChartPlayerOption[];
  shots: ShotEvent[];
  /** ショット点（成功=塗りつぶし・失敗=枠線）の色。通常はチームカラー */
  color: string;
  /** チームカラー（data/team-colors.json）。カード左端のアクセント線に使う */
  accentColor?: string;
  /** 選手選択プルダウンの表示可否。既にshotsが単一選手分に絞られている場合（個人詳細ページの
   * シーズン集計版等）はfalseで非表示にする。省略時はtrue（試合詳細ページの既存動作） */
  showPlayerSelector?: boolean;
}

export function ShotChartPanel({ teamName, shortName, players, shots, color, accentColor, showPlayerSelector = true }: ShotChartPanelProps) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [viewMode, setViewMode] = useState<"dots" | "zones">("dots");
  const selectablePlayers = useMemo(() => playersWithShots(players, shots), [players, shots]);
  const visibleShots = showPlayerSelector && selectedPlayerId ? shots.filter((s) => s.playerId === selectedPlayerId) : shots;
  const longShotCount = visibleShots.filter((s) => s.longShot).length;

  return (
    <div className="shot-chart-panel" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
      <div className="shot-chart-header">
        <h3>{narrow && shortName ? shortName : teamName}</h3>
        {showPlayerSelector && (
          <select value={selectedPlayerId} onChange={(e) => setSelectedPlayerId(e.target.value)}>
            <option value="">All players</option>
            {selectablePlayers.map((p) => (
              <option key={p.PlayerID} value={p.PlayerID}>
                {p.PlayerNameJ}
              </option>
            ))}
          </select>
        )}
      </div>
      <div className="shot-chart-controls">
        <div className="mode-toggle">
          <button className={viewMode === "dots" ? "active" : ""} onClick={() => setViewMode("dots")}>
            Shots
          </button>
          <button className={viewMode === "zones" ? "active" : ""} onClick={() => setViewMode("zones")}>
            Zones
          </button>
        </div>
        {viewMode === "dots" && (
          <div className="shot-chart-legend">
            <span className="shot-chart-legend-item">
              <span className="shot-dot-sample shot-made" style={{ borderColor: color, background: color }} />
              Made
            </span>
            <span className="shot-chart-legend-item">
              <span className="shot-dot-sample shot-missed" style={{ borderColor: color }} />
              Missed
            </span>
            {longShotCount > 0 && (
              <span className="shot-chart-legend-item">
                <span className="shot-long-sample" style={{ borderColor: color }} />
                センターラインより後ろ
              </span>
            )}
          </div>
        )}
      </div>
      <p className="shot-chart-summary">{formatShotSummary(visibleShots)}</p>
      {viewMode === "zones" && longShotCount > 0 && (
        <p className="shot-chart-note">センターラインより後ろからのロングシュート{longShotCount}本は、ゾーンの集計に入れていません</p>
      )}
      <svg viewBox={`0 0 ${COURT_WIDTH} ${COURT_LENGTH}`} className="shot-chart-svg">
        <HalfCourt />
        {viewMode === "dots" ? (
          visibleShots.map((s, i) => {
            const title = (
              <title>
                {s.playerName} {s.isThree ? "3P" : "2P"} {s.made ? "Made" : "Missed"}
                {s.longShot ? "（センターラインより後ろからのロングシュート）" : ""}
              </title>
            );
            if (s.longShot) {
              // センターラインより後ろからのロングシュートは、センターラインの位置にひし形で描く（2026-09-26）
              const cx = s.y * Y_SCALE;
              const cy = COURT_LENGTH - LONG_SHOT_MARK_SIZE;
              const d = LONG_SHOT_MARK_SIZE;
              return (
                <path
                  key={i}
                  d={`M ${cx} ${cy - d} L ${cx + d} ${cy} L ${cx} ${cy + d} L ${cx - d} ${cy} Z`}
                  className={`shot-dot shot-long ${s.made ? "shot-made" : "shot-missed"}`}
                  stroke={color}
                  fill={s.made ? color : "none"}
                >
                  {title}
                </path>
              );
            }
            return (
              <circle
                key={i}
                cx={s.y * Y_SCALE}
                cy={s.x * X_SCALE}
                r={2.4}
                className={`shot-dot ${s.made ? "shot-made" : "shot-missed"}`}
                stroke={color}
                fill={s.made ? color : "none"}
              >
                {title}
              </circle>
            );
          })
        ) : (
          <ZoneHeatmap shots={visibleShots} />
        )}
      </svg>
    </div>
  );
}
