import type { UpcomingGameEntry } from "../../shared/types";

/**
 * 開催予定（schedule.json の upcomingGames）のうち、まだ試合の記録（games-summary）が無い試合だけを返す。
 * 記録がある試合は、日程の更新前に一時的に両方に載るほか、更新の対象でない過去のシーズンに外れないまま残ることがあり、
 * そのまま数えると終了したシーズンでも残り試合があることになる（試合消化率・星取り表の残り・条件別順位表の残り試合数）。
 * 日程ページ・勝敗表・チーム日程は、行を作るときに同じ除き方をしている（scheduleKey）。summaries が未取得のときはそのまま返す
 */
export function pendingUpcomingGames(
  upcoming: readonly UpcomingGameEntry[] | undefined,
  summaries: readonly { scheduleKey: string }[] | null | undefined,
): UpcomingGameEntry[] {
  const all = upcoming ?? [];
  if (!summaries) return [...all];
  const recorded = new Set(summaries.map((g) => g.scheduleKey));
  return all.filter((g) => !recorded.has(g.scheduleKey));
}
