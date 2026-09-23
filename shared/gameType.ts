// レギュラーシーズンのみ/ポストシーズン（CS・プレーオフ）のみ/合算の3択フィルタ。個人・チーム双方の
// シーズン集計（src/lib/playerSeasonBoxscore.ts）とバックエンドの歴代クラブ横断集計
// （scripts/aggregate-league-rankings.ts）の両方から同じ定義を参照するため、Phase H7
// （2026-08-29）でsrc/lib/playerSeasonBoxscore.tsからこちらに移設した
// （playerSeasonBoxscore.ts側は後方互換のため再エクスポートしている）。

import type { GameType } from "./types.ts";

export type SeasonGameTypeFilter = GameType | "both";

/** B.PREMIER（2026-27〜）でポストシーズンの公式名称が「B.LEAGUE PREMIER PLAYOFFS」に変わった最初のシーズン */
const PLAYOFFS_NAME_FIRST_SEASON = "2026-27";

/**
 * ポストシーズンの表示名（DESIGN.md 107章）。サイト全体の表記はここから取る。
 * - 2025-26シーズンまで: 「CS」（long指定時は「CS（チャンピオンシップ）」）
 * - 2026-27シーズンから: 「プレーオフ」（公式名称「B.LEAGUE PREMIER PLAYOFFS」に合わせる）
 * - season=null（通算成績・歴代記録など複数シーズンをまたぐ表示）: 「ポストシーズン」
 *   （どちらの時代も含む中立の表記。用語集に注記あり）
 */
export function postseasonLabel(season: string | null, opts: { long?: boolean } = {}): string {
  if (season === null) return "ポストシーズン";
  if (season < PLAYOFFS_NAME_FIRST_SEASON) return opts.long ? "CS（チャンピオンシップ）" : "CS";
  return "プレーオフ";
}

/**
 * レギュラーシーズン/ポストシーズン/合算の3択の表示名。ポストシーズンの名称はシーズンで変わるため
 * season（複数シーズンをまたぐ表示ではnull）を必ず渡す
 */
export function seasonGameTypeLabels(season: string | null): Record<SeasonGameTypeFilter, string> {
  return { regular: "レギュラーシーズン", playoff: postseasonLabel(season), both: "合算" };
}

/** 3択の並び順（表示名はseasonGameTypeLabels()から取る） */
export const SEASON_GAME_TYPE_KEYS: SeasonGameTypeFilter[] = ["regular", "playoff", "both"];

export function filterByGameType<T extends { gameType: GameType }>(logs: T[], filter: SeasonGameTypeFilter): T[] {
  if (filter === "both") return logs;
  return logs.filter((g) => g.gameType === filter);
}
