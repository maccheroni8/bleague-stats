// 2Pシュートのペイント内／ペイント外の内訳（2026-09-26、DESIGN.md 155章）。bleague.jp のプレーバイプレーの公式の区分で数える:
// ActionCD1 = 4（成功）・6（失敗）が「2Pシュートインサイドペイント」、3（成功）・5（失敗）が「2Pシュート アウトサイドペイント」。
// 2016-17 から全試合にあり、得点構成のペイント内得点（shared/playTypePoints.ts の「インサイドペイント」タグ）と同じ出どころ。
// それまではショットチャートの座標（X/Y）から判定していたが、リングのすぐ後ろのシュートがどのゾーンにも入らない・2022-23 は
// 攻撃方向の項目（Side）がほぼ無い、などでペイント内が少なく出ていた
import type { PlayByPlayEvent } from "./types.ts";

export interface PaintSplitCounts {
  paint2m: number;
  paint2a: number;
  nonPaint2m: number;
  nonPaint2a: number;
}

export const ZERO_PAINT_SPLIT_COUNTS: PaintSplitCounts = { paint2m: 0, paint2a: 0, nonPaint2m: 0, nonPaint2a: 0 };

const PAINT_MADE = 4;
const PAINT_MISSED = 6;
const NON_PAINT_MADE = 3;
const NON_PAINT_MISSED = 5;

/** その行が2Pシュートなら公式の区分（"paint" / "nonPaint"）、それ以外は null */
export function officialPaintSplit(ev: Pick<PlayByPlayEvent, "ActionCD1">): "paint" | "nonPaint" | null {
  if (ev.ActionCD1 === PAINT_MADE || ev.ActionCD1 === PAINT_MISSED) return "paint";
  if (ev.ActionCD1 === NON_PAINT_MADE || ev.ActionCD1 === NON_PAINT_MISSED) return "nonPaint";
  return null;
}

/** 選手ごと・チームごとのペイント内外の2P内訳 */
export function buildOfficialPaintSplit(events: PlayByPlayEvent[]): {
  byPlayer: Map<string, PaintSplitCounts>;
  byTeam: Map<string, PaintSplitCounts>;
} {
  const byPlayer = new Map<string, PaintSplitCounts>();
  const byTeam = new Map<string, PaintSplitCounts>();
  const add = (map: Map<string, PaintSplitCounts>, key: string, split: "paint" | "nonPaint", made: boolean) => {
    const entry = map.get(key) ?? { ...ZERO_PAINT_SPLIT_COUNTS };
    if (split === "paint") {
      entry.paint2a += 1;
      if (made) entry.paint2m += 1;
    } else {
      entry.nonPaint2a += 1;
      if (made) entry.nonPaint2m += 1;
    }
    map.set(key, entry);
  };
  for (const ev of events) {
    const split = officialPaintSplit(ev);
    if (!split) continue;
    const made = ev.ActionCD1 === PAINT_MADE || ev.ActionCD1 === NON_PAINT_MADE;
    if (ev.PlayerID1) add(byPlayer, ev.PlayerID1, split, made);
    if (ev.TeamID) add(byTeam, ev.TeamID, split, made);
  }
  return { byPlayer, byTeam };
}
