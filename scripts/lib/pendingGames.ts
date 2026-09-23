// 開催予定試合（schedule.jsonのupcomingGames）が「取得待ち」かどうかの判定（DESIGN.md 8-5章）。
// check-pending-games.ts（頻繁チェックの起動判定）と scrape-boxscore.ts --new-only
// （頻繁チェックで実際に取得を試みる試合の絞り込み）で同じ基準を使う。
import type { UpcomingGameEntry } from "../../shared/types.ts";

export const TIPOFF_GRACE_HOURS = 3;

// 公式サイトで時刻が未定の試合等、tipoffTimeが取れない試合は「試合日の22:00開始」とみなす。
// 「不明なら常に取得待ち」にすると、その試合の日付に関係なく30分ごとに本処理が走り続けるため。
// 22:00はB.LEAGUEの試合開始として実質あり得ない遅さで、実際の試合終了後には確実に判定が通る
export const FALLBACK_TIPOFF_TIME = "22:00";

export function dueAtMs(entry: UpcomingGameEntry): number {
  const time = entry.tipoffTime ?? FALLBACK_TIPOFF_TIME;
  return new Date(`${entry.date}T${time}:00+09:00`).getTime() + TIPOFF_GRACE_HOURS * 3_600_000;
}

export function isDue(entry: UpcomingGameEntry, now: number = Date.now()): boolean {
  return now >= dueAtMs(entry);
}
