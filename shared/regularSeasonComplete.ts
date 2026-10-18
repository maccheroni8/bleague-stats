// レギュラーシーズンの全試合が終わったシーズンか（チーム詳細「クラブレコード」と、歴代記録のシーズン記録のワースト側の対象）。
// 9月の区切り（season.ts の currentSeason）ではなく、日程の残り試合で判断する。中止の試合は schedule.json の
// cancelledGames にあり、upcomingGames には入らないので、残り試合に数えない。
// 画面（src/lib/regularSeasonComplete.ts から再公開）と、歴代記録を作るスクリプトで共有する。
import type { ScheduleFileExtended } from "./resultOnlyGames.ts";
import type { GameSummary } from "./types.ts";
import { pendingUpcomingGames } from "./pendingUpcoming.ts";

/**
 * 中止の試合が多く、クラブごとのレギュラーシーズンの試合数がそろわないシーズン（2019-20 は途中で打ち切り。
 * 勝敗表の地区優勝の印を付けないシーズンと同じ）。最少勝利数・最多敗戦数の「数」の記録の対象から外す
 */
export const SHORTENED_REGULAR_SEASONS: readonly string[] = ["2019-20", "2020-21", "2021-22"];

/**
 * 次のどちらかなら、レギュラーシーズンの全試合が終わっている（試合数では判断しない。中止のまま消える試合があるため）。
 * - 開催予定の試合（記録・結果だけの試合を除く）が残っておらず、レギュラーシーズンの試合がすべて終了している
 * - ポストシーズンの試合がある（開催予定には大会の区分が無く、ポストシーズンの試合が載ると上の判定が通らないため）
 */
export function isRegularSeasonComplete(input: {
  schedule: ScheduleFileExtended;
  summaries: readonly GameSummary[];
}): boolean {
  const { schedule, summaries } = input;
  const regular = summaries.filter((g) => g.gameType === "regular");
  if (regular.length === 0) return false;
  if (summaries.some((g) => g.gameType === "playoff")) return true;
  const resultOnlyKeys = new Set((schedule.resultOnlyGames ?? []).map((g) => g.scheduleKey));
  const pending = pendingUpcomingGames(schedule.upcomingGames, summaries).filter((g) => !resultOnlyKeys.has(g.scheduleKey));
  return pending.length === 0 && regular.every((g) => g.gameEndedFlg);
}

/** 日程で確かめるシーズンの数（新しい方から）。それより古いシーズンは、後のシーズンがあるので終わっている */
export const CHECKED_LATEST_SEASONS = 2;
