// 画面専用。図解「シュート成功率の一覧」の値の取り出し（選手・チーム）。図の部品と検証で同じ手順を使うため lib に置く。
// 文字・値は全選手スタッツ／全チームスタッツと同じ列の定義から取る。
import type { PlayerFigurePoint } from "./figurePlayerPoints";
import { playerFreeColumns, type PlayerFreeCategory } from "./figurePlayerFree";
import { freeColumns, type FreeRow } from "./figureTeamFree";
import { PLAYER_SHOOT_COLUMNS, TEAM_SHOOT_SLOTS, shownNumber, type TeamShootView } from "./figureShootTable";

export interface ShootCell { text: string; value: number | null }
export type ShootCells = Record<string, ShootCell>;

/** 選手の値を取る全選手スタッツの分類（key → 分類） */
const PLAYER_SOURCE: Record<string, PlayerFreeCategory> = { pts: "traditional", efg: "advanced", ts: "advanced", "3ppct": "traditional", ftpct: "traditional", mid2pct: "scoring", paint2pct: "scoring" };

/** ペイント内・ミッドレンジは記録（試投）が1本も無い選手は「-」にする */
const playerHasRecord = (p: PlayerFigurePoint, key: string) => key === "mid2pct" ? p.raw.mid2a > 0 : key === "paint2pct" ? p.raw.paint2a > 0 : true;

/** 選手ごとの各列の文字・値（1試合平均。値は表に出した文字を読んだもの） */
export function playerShootCells(points: readonly PlayerFigurePoint[], season: string): Map<string, ShootCells> {
  const columns = Object.fromEntries(PLAYER_SHOOT_COLUMNS.map(def => [def.key, playerFreeColumns(PLAYER_SOURCE[def.key]!, "perGame", season).find(c => c.key === def.key)!]));
  return new Map(points.map(p => [p.id, Object.fromEntries(PLAYER_SHOOT_COLUMNS.map(def => {
    const text = playerHasRecord(p, def.key) ? columns[def.key]!.text(p) : "-";
    return [def.key, { text, value: shownNumber(text) }];
  })) as ShootCells]));
}

/** チームごとの各列の文字・値（1試合平均。視点で値の取り先が変わる） */
export function teamShootCells(rows: readonly FreeRow[], season: string, view: TeamShootView = "own"): Map<string, ShootCells> {
  const columns = Object.fromEntries(TEAM_SHOOT_SLOTS.map(slot => { const src = slot.source(view); return [slot.key, freeColumns(slot.category, src.perspective, "perGame", season).find(c => c.key === src.column)!]; }));
  return new Map(rows.map(r => [r.teamId, Object.fromEntries(TEAM_SHOOT_SLOTS.map(slot => {
    const text = columns[slot.key]!.text(r);
    return [slot.key, { text, value: shownNumber(text) }];
  })) as ShootCells]));
}

/** 列ごとの色の基準（掲載基準を満たした全員の値。値の無い人は入れない） */
export function shootReference(cells: Iterable<ShootCells>, keys: readonly string[]): Record<string, number[]> {
  const all = [...cells];
  return Object.fromEntries(keys.map(key => [key, all.flatMap(c => c[key]!.value === null ? [] : [c[key]!.value!])]));
}
