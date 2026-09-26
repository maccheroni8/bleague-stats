// ショットチャート用のデータ整形。Lead Tracker・出場交代バーと同じ方針で、games/{scheduleKey}.jsonの
// PlayByPlays（GeniusAPI生データ）からフロントエンドでその場構築する（バックエンド集計ファイルは
// 増やさない）。X/Y/AreaCDは2022-23シーズン以降のみ存在（DESIGN.md 2-7章）。
//
// ActionCD1の意味は実データ（2024-25・2025-26シーズン計1541試合・約20万ショット）で確認済み:
// - 1: 3Pシュート成功 / 2: 3Pシュート失敗
// - 3, 4: 2Pシュート成功（複数ゾーン） / 5, 6: 2Pシュート失敗（同）
// フリースロー（成功=7・失敗=8）はX/Y自体が存在しない（常に同じ位置のため座標記録なし）ので対象外。
//
// X/Yは0〜100のフルコート座標（コート全長を0〜100に正規化）で、Side（"left"/"right"）が
// どちらのバスケット方向へのショットかを表す。両チームともハーフごとに攻撃方向が入れ替わるため、
// 同一チームの得点が両方のSideにまたがる。ハーフコート図に描くため、Side==="right"のショットは
// X・Y両軸をコート中心（50, 50）基準に180度回転して片方のバスケット基準に正規化する。
//
// 【重要】Yも反転が必要（Xだけでは不十分）。AreaCDフィールド（コートゾーンコード）を使った
// 実データ検証で判明: 同一チーム・同一シーズンでも、Side="left"時とSide="right"時とで、
// 同じAreaCD値のショットの絶対Y座標が正反対になる（例: AreaCD=9はSide=left時は平均Y=82.9、
// Side=right時は平均Y=18.3）。これはAreaCDが「アタッキングチーム視点の左右」で採番されている
// ことを意味し、コート幅方向の絶対位置（Y）はSideに紐づかない一貫した値ではない。
// X・Y両方を反転して初めて、同一選手・同一チームのショット傾向が試合全体を通して同じ側に
// 一貫して表示される（DESIGN.md 11章参照。以前の実装ではXのみ反転しておりこの点が誤っていた）。

import type { BoxscoreRow, PlayByPlayEvent } from "../../shared/types";

const MADE_ACTION_CODES = new Set([1, 3, 4]);
const MISSED_ACTION_CODES = new Set([2, 5, 6]);
const THREE_POINT_ACTION_CODES = new Set([1, 2]);

export interface ShotEvent {
  playerId: string;
  playerName: string;
  teamId: string | null;
  made: boolean;
  isThree: boolean;
  /** ハーフコート正規化済み座標（0〜100、バスケット方向・左右とも正規化済み） */
  x: number;
  y: number;
  /** 発生したピリオド（1〜4=各Q、5以降=延長）。試合/Q別/前半後半の絞り込みに使う */
  period: number;
  /** センターラインより後ろから打ったロングシュート（座標はセンターラインの位置に寄せてある。ゾーンの集計には入れない） */
  longShot?: boolean;
}

/** ピリオドの残り時間（"m:ss"）を秒に */
function restSeconds(rest: string | undefined): number {
  const m = /^(\d+):(\d+)$/.exec(rest ?? "");
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.POSITIVE_INFINITY;
}

export function buildShotEvents(events: PlayByPlayEvent[]): ShotEvent[] {
  const shots: ShotEvent[] = [];
  for (const ev of events) {
    const made = MADE_ACTION_CODES.has(ev.ActionCD1);
    const missed = MISSED_ACTION_CODES.has(ev.ActionCD1);
    if (!made && !missed) continue;
    if (ev.X === undefined || ev.Y === undefined || !ev.PlayerID1) continue;
    // 攻撃方向（Side）が無い行は座標から補う（2022-23 はほぼ全行で Side が無い。2026-09-26、DESIGN.md 155章）。
    // ショットは攻撃するバスケット側の半面から打たれるので、X が中央（50）より大きければ右のバスケット向き
    const mirror = ev.Side === "right" || (ev.Side !== "left" && ev.X > 50);
    const isThree = THREE_POINT_ACTION_CODES.has(ev.ActionCD1);
    let x = mirror ? 100 - ev.X : ev.X;
    let y = mirror ? 100 - ev.Y : ev.Y;
    let longShot = false;
    // 半面（センターラインまで）の外に出る試投（2026-09-26、DESIGN.md 155-5）:
    // - 2P は半面の外からは打てないので、攻撃方向の記録の誤りとみて反転する
    // - 3P は、反対側のゴールからの距離が通常の3Pの範囲（3Pライン6.75m〜9.5m）で、ピリオドの残りが3秒より多ければ、攻撃方向の
    //   記録の誤りとみて反転する。それ以外（ブザー間際に自陣から投げたロングシュート等）はセンターラインの位置に寄せて印を付ける
    if (x > 50) {
      const opp = toPolar(100 - x, 100 - y);
      if (!isThree || (opp.r >= ARC_R && opp.r < OUTER_R && restSeconds(ev.RestTime) > 3)) {
        x = 100 - x;
        y = 100 - y;
      } else {
        longShot = true;
        x = 50;
      }
    }
    shots.push({
      playerId: ev.PlayerID1,
      playerName: ev.PlayerNameJ1,
      teamId: ev.TeamID,
      made,
      isThree,
      x,
      y: Math.min(100, Math.max(0, y)),
      period: ev.Period,
      ...(longShot ? { longShot } : {}),
    });
  }
  return shots;
}

/** ショットチャートの選手セレクタ用の最小限の選手情報（PlayerID/PlayerNameJのみ参照する）。
 * BoxscoreRowはこの形を満たすため、試合詳細ページは従来通りBoxscoreRow[]をそのまま渡せる */
export type ShotChartPlayerOption = Pick<BoxscoreRow, "PlayerID" | "PlayerNameJ">;

/** ショットチャートの選手セレクタ用に、実際にショットを打った選手だけをボックススコア順で抽出する */
export function playersWithShots<T extends ShotChartPlayerOption>(players: T[], shots: ShotEvent[]): T[] {
  const idsWithShots = new Set(shots.map((s) => s.playerId));
  return players.filter((p) => idsWithShots.has(p.PlayerID));
}

// ---- エリア別成功率ビュー用のゾーン定義 ----
//
// AreaCD（コートゾーンコード）を2024-25・2025-26シーズン計1541試合・約20万ショットの
// X/Y分布から逆引きした結果（DESIGN.md 11章）に基づき、バスケット中心からの距離r(m)・角度θ(度、
// 正面=0度・ベースライン沿い=±90度)で12ゾーンに分類する。AreaCDフィールドそのものではなく、
// この距離・角度から幾何学的に分類する（AreaCD値には稀に外れ値があり、境界が滑らかな距離・角度
// ベースの方が堅牢なため）。極端なハーフコート超えのヒーブショット（AreaCD=13相当）は
// どのゾーンにも属させず自然に除外する

const M_PER_X_UNIT = 28 / 100; // xは0-100でコート全長28m
const M_PER_Y_UNIT = 15 / 100; // yは0-100でコート全幅15m
/** ベースラインからリム中心までの距離(m)。ShotChart.tsxのSVG描画でも同じ値を使う */
export const BASKET_X_M = 1.575;
/** コート幅方向の中心(m)。ShotChart.tsxのSVG描画でも同じ値を使う */
export const BASKET_Y_M = 7.5;

const CENTER_HALF_ANGLE = 22; // |θ| <= 22度を「中央」とする
const WING_MAX_ANGLE = 76; // 22〜76度を「ウイング」、76〜90度を「コーナー/ベースライン」とする
const RESTRICTED_R = 1.25; // リストリクテッドエリア半径(m)、FIBA基準
const PAINT_R = 3.6; // ミッドレンジのゾーンのラベル位置の内側の目安(m)。ペイントの判定には使わない（2026-09-26 から長方形）
/** ペイント（制限区域）の長方形。FIBA: 幅4.9m・ベースラインから5.8m（フリースローラインの外側まで）。公式の「インサイドペイント」の区分と一致する */
export const LANE_HALF_WIDTH_M = 2.45;
export const LANE_LENGTH_M = 5.8;
const ARC_R = 6.75; // FIBA 3Pライン半径(m)
const OUTER_R = 9.5; // ゾーン描画上の3P外縁(m)。これを超えるヒーブ級はどのゾーンにも属さない

export type ZoneId =
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

export interface ZoneDef {
  id: ZoneId;
  label: string;
  rInner: number;
  rOuter: number;
  thetaStart: number;
  thetaEnd: number;
  /** "lane": ペイントの長方形そのもの（描画もこの形）。"outsideLane": 扇形のうちペイントの長方形の外側だけ（ミッドレンジ・ショートコーナー） */
  shape?: "lane" | "outsideLane";
  /** ラベルを置く半径（省略時は rInner と rOuter の中間） */
  labelR?: number;
  /** ラベルを置く角度（省略時は thetaStart と thetaEnd の中間） */
  labelTheta?: number;
}

export const ZONE_DEFS: ZoneDef[] = [
  // 角度の範囲は描画にも使う。リング周りは円全体、ベースライン沿いのゾーン（ショートコーナー・コーナー3）はリングの裏（±180度）まで
  // （判定では角度を±90度に寄せるため、リングの中心よりベースライン側はこれらのゾーンに入る。描画もベースラインまで塗る。2026-09-26）
  { id: "restricted", label: "Restricted Area", rInner: 0, rOuter: RESTRICTED_R, thetaStart: -180, thetaEnd: 180, labelR: 0 },
  { id: "paint", label: "Paint", rInner: RESTRICTED_R, rOuter: LANE_LENGTH_M, thetaStart: -90, thetaEnd: 90, shape: "lane" },
  { id: "shortCornerLeft", label: "Short Corner (L)", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: -180, thetaEnd: -WING_MAX_ANGLE, shape: "outsideLane", labelR: 4.6, labelTheta: -83 },
  { id: "shortCornerRight", label: "Short Corner (R)", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: WING_MAX_ANGLE, thetaEnd: 180, shape: "outsideLane", labelR: 4.6, labelTheta: 83 },
  { id: "midLeft", label: "Mid-range (L)", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: -WING_MAX_ANGLE, thetaEnd: -CENTER_HALF_ANGLE, shape: "outsideLane", labelR: (PAINT_R + ARC_R) / 2 },
  { id: "midCenter", label: "Mid-range (C)", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: -CENTER_HALF_ANGLE, thetaEnd: CENTER_HALF_ANGLE, shape: "outsideLane", labelR: 6.0 },
  { id: "midRight", label: "Mid-range (R)", rInner: RESTRICTED_R, rOuter: ARC_R, thetaStart: CENTER_HALF_ANGLE, thetaEnd: WING_MAX_ANGLE, shape: "outsideLane", labelR: (PAINT_R + ARC_R) / 2 },
  { id: "corner3Left", label: "Corner 3 (L)", rInner: ARC_R, rOuter: OUTER_R, thetaStart: -180, thetaEnd: -WING_MAX_ANGLE, labelTheta: -83 },
  { id: "corner3Right", label: "Corner 3 (R)", rInner: ARC_R, rOuter: OUTER_R, thetaStart: WING_MAX_ANGLE, thetaEnd: 180, labelTheta: 83 },
  { id: "wing3Left", label: "Wing 3 (L)", rInner: ARC_R, rOuter: OUTER_R, thetaStart: -WING_MAX_ANGLE, thetaEnd: -CENTER_HALF_ANGLE },
  { id: "wing3Center", label: "Top 3", rInner: ARC_R, rOuter: OUTER_R, thetaStart: -CENTER_HALF_ANGLE, thetaEnd: CENTER_HALF_ANGLE },
  { id: "wing3Right", label: "Wing 3 (R)", rInner: ARC_R, rOuter: OUTER_R, thetaStart: CENTER_HALF_ANGLE, thetaEnd: WING_MAX_ANGLE },
];

/** ショット座標（0〜100正規化済み）からバスケット中心を基準にした距離r(m)・角度θ(度)を求める */
export function toPolar(x: number, y: number): { r: number; theta: number } {
  const dx = x * M_PER_X_UNIT - BASKET_X_M;
  const dy = y * M_PER_Y_UNIT - BASKET_Y_M;
  const r = Math.sqrt(dx * dx + dy * dy);
  const theta = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { r, theta };
}

/** ショット座標（0〜100正規化済み）がペイントの長方形の中か */
export function isInLane(x: number, y: number): boolean {
  const xm = x * M_PER_X_UNIT;
  const dy = y * M_PER_Y_UNIT - BASKET_Y_M;
  return xm <= LANE_LENGTH_M && Math.abs(dy) <= LANE_HALF_WIDTH_M;
}

export function zoneForShot(shot: ShotEvent): ZoneId | null {
  // センターラインより後ろからのロングシュートはどのゾーンにも入れない（ブザー間際の投げ込みが多く、3Pの成功率をゆがめるため）
  if (shot.longShot) return null;
  const { r, theta: rawTheta } = toPolar(shot.x, shot.y);
  // リングから1.25m以内は角度を問わずリング周り。リングの中心よりベースライン側（角度が±90度を超える）のシュートも、
  // ベースライン沿い（±90度）として扱う（それまではどのゾーンにも入らず、FG試投構成でMid-rangeに数えられていた。2026-09-26）
  if (r < RESTRICTED_R) return "restricted";
  // ペイントは実際の長方形（幅4.9m・ベースラインから5.8m）で判定する（2026-09-26。公式の区分と 99.9〜100% 一致）
  if (isInLane(shot.x, shot.y)) return "paint";
  const theta = Math.max(-90, Math.min(89.999, rawTheta));
  for (const zone of ZONE_DEFS) {
    if (zone.shape === "lane" || zone.id === "restricted") continue;
    if (r >= zone.rInner && r < zone.rOuter && theta >= zone.thetaStart && theta < zone.thetaEnd) {
      return zone.id;
    }
  }
  return null;
}

/** リストリクテッドエリア＋ペイント＝「ペイント内」。それ以外の2Pゾーン（ミッドレンジ・ショートコーナー）は「ペイント外」（ボックススコアのスコアリングタブ用） */
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

export interface ZoneStat {
  zone: ZoneDef;
  attempts: number;
  makes: number;
}

/** ゾーンごとの試投数・成功数を集計する（0試投のゾーンも含めて全ゾーン返す） */
export function buildZoneStats(shots: ShotEvent[]): ZoneStat[] {
  const counts = new Map<ZoneId, { attempts: number; makes: number }>();
  for (const shot of shots) {
    const zoneId = zoneForShot(shot);
    if (!zoneId) continue;
    const c = counts.get(zoneId) ?? { attempts: 0, makes: 0 };
    c.attempts += 1;
    if (shot.made) c.makes += 1;
    counts.set(zoneId, c);
  }
  return ZONE_DEFS.map((zone) => ({ zone, ...(counts.get(zone.id) ?? { attempts: 0, makes: 0 }) }));
}
