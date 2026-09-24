// 開催予定試合（schedule.jsonのupcomingGames）が「取得待ち」かどうかの判定（DESIGN.md 8-5章）。
// check-pending-games.ts（頻繁チェックの起動判定）と scrape-boxscore.ts --new-only
// （頻繁チェックで実際に取得を試みる試合の絞り込み）で同じ基準を使う。
import type { UpcomingGameEntry } from "../../shared/types.ts";

// 試合は2時間〜2時間15分程度で終わるため、ティップオフ+2時間から問い合わせ始める（2026-09-25に3時間から短縮。DESIGN.md 8-8章）。
// その時点でまだ試合中なら、途中経過を「watching」で保存し、次の実行（30分後）以降で終了を確認して確定する
export const TIPOFF_GRACE_HOURS = 2;

// 公式サイトで時刻が未定（TIP OFF調整中）の試合等、tipoffTimeが取れない試合は「試合日の13:00開始」とみなす
// （2026-09-25に22:00から変更。DESIGN.md 8-8章）。22:00だとデーゲームが翌1:00まで取り込まれないため、
// 最も早い試合開始に近い13:00にした。夕方以降の試合なら、15:00から試合が終わるまで1回の実行につき1件の
// 空振りの問い合わせ（データなし）が出るが、時刻は深夜実行が今後14日分を取り直すので、当日まで未定のままの試合に限られる。
// 「不明なら常に取得待ち」にしないのは、その試合の日付に関係なく30分ごとに本処理が走り続けるため
export const FALLBACK_TIPOFF_TIME = "13:00";

export function dueAtMs(entry: UpcomingGameEntry): number {
  const time = entry.tipoffTime ?? FALLBACK_TIPOFF_TIME;
  return new Date(`${entry.date}T${time}:00+09:00`).getTime() + TIPOFF_GRACE_HOURS * 3_600_000;
}

export function isDue(entry: UpcomingGameEntry, now: number = Date.now()): boolean {
  return now >= dueAtMs(entry);
}
