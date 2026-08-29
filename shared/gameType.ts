// レギュラーシーズンのみ/プレーオフのみ/合算の3択フィルタ。個人・チーム双方の
// シーズン集計（src/lib/playerSeasonBoxscore.ts）とバックエンドの歴代クラブ横断集計
// （scripts/aggregate-league-rankings.ts）の両方から同じ定義を参照するため、Phase H7
// （2026-08-29）でsrc/lib/playerSeasonBoxscore.tsからこちらに移設した
// （playerSeasonBoxscore.ts側は後方互換のため再エクスポートしている）。

import type { GameType } from "./types.ts";

export type SeasonGameTypeFilter = GameType | "both";

export const SEASON_GAME_TYPE_LABELS: Record<SeasonGameTypeFilter, string> = {
  regular: "レギュラーシーズン",
  playoff: "プレーオフ",
  both: "合算",
};

export function filterByGameType<T extends { gameType: GameType }>(logs: T[], filter: SeasonGameTypeFilter): T[] {
  if (filter === "both") return logs;
  return logs.filter((g) => g.gameType === filter);
}
