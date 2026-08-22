// src/lib/shotChart.tsのショットチャート座標処理のうち、バックエンド（scripts/aggregate.ts）の
// シーズン集計（PAINT2M/PAINT2A/MID2M/MID2A）でも必要な純粋関数だけを移植した版。
// フロントエンド側は既存のsrc/lib/shotChart.tsをそのまま使い続ける（重複を許容し、
// 十分に検証済みの既存コードへの改修リスクを避ける。DESIGN.md参照）。
//
// X/Y/AreaCDは2022-23シーズン以降のみ存在する（呼び出し側でseasonCoverage()による
// season制約を別途かけること）。ゾーン分類・座標反転ロジックの根拠はsrc/lib/shotChart.tsの
// コメント・DESIGN.md 11章を参照。

import type { PlayByPlayEvent } from "./types.ts";

const MADE_ACTION_CODES = new Set([1, 3, 4]);
const MISSED_ACTION_CODES = new Set([2, 5, 6]);
const THREE_POINT_ACTION_CODES = new Set([1, 2]);

export interface ShotEvent {
  playerId: string;
  teamId: string | null;
  made: boolean;
  isThree: boolean;
  /** ハーフコート正規化済み座標（0〜100、バスケット方向・左右とも正規化済み） */
  x: number;
  y: number;
}

export function buildShotEvents(events: PlayByPlayEvent[]): ShotEvent[] {
  const shots: ShotEvent[] = [];
  for (const ev of events) {
    const made = MADE_ACTION_CODES.has(ev.ActionCD1);
    const missed = MISSED_ACTION_CODES.has(ev.ActionCD1);
    if (!made && !missed) continue;
    if (ev.X === undefined || ev.Y === undefined || !ev.PlayerID1) continue;
    const mirror = ev.Side === "right";
    shots.push({
      playerId: ev.PlayerID1,
      teamId: ev.TeamID,
      made,
      isThree: THREE_POINT_ACTION_CODES.has(ev.ActionCD1),
      x: mirror ? 100 - ev.X : ev.X,
      y: mirror ? 100 - ev.Y : ev.Y,
    });
  }
  return shots;
}

const M_PER_X_UNIT = 28 / 100; // xは0-100でコート全長28m
const M_PER_Y_UNIT = 15 / 100; // yは0-100でコート全幅15m
const BASKET_X_M = 1.575;
const BASKET_Y_M = 7.5;

const CENTER_HALF_ANGLE = 22;
const WING_MAX_ANGLE = 76;
const RESTRICTED_R = 1.25;
const PAINT_R = 3.6;
const ARC_R = 6.75;
const OUTER_R = 9.5;

type ZoneId =
  | "restricted"
  | "paint"
  | "shortCornerLeft"
  | "shortCornerRight"
  | "midLeft"
  | "midCenter"
  | "midRight"
  | "corner3Left"
  | "corner3Right"
  | "wing3Left"
  | "wing3Center"
  | "wing3Right";

interface ZoneDef {
  id: ZoneId;
  rInner: number;
  rOuter: number;
  thetaStart: number;
  thetaEnd: number;
}

const ZONE_DEFS: ZoneDef[] = [
  { id: "restricted", rInner: 0, rOuter: RESTRICTED_R, thetaStart: -90, thetaEnd: 90 },
  { id: "paint", rInner: RESTRICTED_R, rOuter: PAINT_R, thetaStart: -WING_MAX_ANGLE, thetaEnd: WING_MAX_ANGLE },
  { id: "shortCornerLeft", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: -90, thetaEnd: -WING_MAX_ANGLE },
  { id: "shortCornerRight", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: WING_MAX_ANGLE, thetaEnd: 90 },
  { id: "midLeft", rInner: PAINT_R, rOuter: ARC_R, thetaStart: -WING_MAX_ANGLE, thetaEnd: -CENTER_HALF_ANGLE },
  { id: "midCenter", rInner: PAINT_R, rOuter: ARC_R, thetaStart: -CENTER_HALF_ANGLE, thetaEnd: CENTER_HALF_ANGLE },
  { id: "midRight", rInner: PAINT_R, rOuter: ARC_R, thetaStart: CENTER_HALF_ANGLE, thetaEnd: WING_MAX_ANGLE },
  { id: "corner3Left", rInner: ARC_R, rOuter: OUTER_R, thetaStart: -90, thetaEnd: -WING_MAX_ANGLE },
  { id: "corner3Right", rInner: ARC_R, rOuter: OUTER_R, thetaStart: WING_MAX_ANGLE, thetaEnd: 90 },
  { id: "wing3Left", rInner: ARC_R, rOuter: OUTER_R, thetaStart: -WING_MAX_ANGLE, thetaEnd: -CENTER_HALF_ANGLE },
  { id: "wing3Center", rInner: ARC_R, rOuter: OUTER_R, thetaStart: -CENTER_HALF_ANGLE, thetaEnd: CENTER_HALF_ANGLE },
  { id: "wing3Right", rInner: ARC_R, rOuter: OUTER_R, thetaStart: CENTER_HALF_ANGLE, thetaEnd: WING_MAX_ANGLE },
];

function zoneForShot(shot: ShotEvent): ZoneId | null {
  const dx = shot.x * M_PER_X_UNIT - BASKET_X_M;
  const dy = shot.y * M_PER_Y_UNIT - BASKET_Y_M;
  const r = Math.sqrt(dx * dx + dy * dy);
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
  for (const zone of ZONE_DEFS) {
    if (r >= zone.rInner && r < zone.rOuter && theta >= zone.thetaStart && theta < zone.thetaEnd) {
      return zone.id;
    }
  }
  return null;
}

const PAINT_ZONE_IDS: ReadonlySet<ZoneId> = new Set(["restricted", "paint"]);

export type PaintSplit = "paint" | "nonPaint";

/**
 * 2Pシュートをペイント内／ペイント外に分類する。3Pシュート、またはゾーン判定不能
 * （ヒーブ級の外れ値）の場合はnullを返す
 */
export function paintSplitForShot(shot: ShotEvent): PaintSplit | null {
  if (shot.isThree) return null;
  const zoneId = zoneForShot(shot);
  if (!zoneId) return null;
  return PAINT_ZONE_IDS.has(zoneId) ? "paint" : "nonPaint";
}
