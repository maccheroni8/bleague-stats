import type { ScheduleFile, UpcomingGameEntry } from "./types.ts";

/**
 * 中止になった試合（schedule.json の cancelledGames。DESIGN.md 227章）。
 * 公式の日程（bleague.jp/schedule）では、中止の試合は元の日付のカードに「試合中止」のボタンが付き、試合へのリンクが無くなる。
 * 日付・対戦・会場は、中止になる前に取れていた開催予定（UpcomingGameEntry）をそのまま持つ。
 * scheduleKeys・upcomingGames には入れない（残り試合数・勝敗表の開催予定・取り込みの問い合わせの対象から外れる）。
 * 古い schedule.json には無い。新しい型は保存キーの対象（shared/types.ts）に足さず、このファイルに置く
 */
export type CancelledGameEntry = UpcomingGameEntry;

export type ScheduleFileWithCancelled = ScheduleFile & { cancelledGames?: CancelledGameEntry[] };
