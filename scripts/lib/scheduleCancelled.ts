// 公式の日程の「試合中止」のカードを読み、中止の試合を schedule.json の cancelledGames に移す（DESIGN.md 227章）。
// 公式の日程の中止の扱い（2019-20の2020/4/4 千葉-SR渋谷 ScheduleKey=4630 などで確認）:
//   通常のカード : <li class="list-item" id="4556"> … <a class="data-game" href="/game_detail/?ScheduleKey=4556&tab=2"> …
//   中止のカード : <li class="list-item" id="4630"> … <div class="data-game"> … <span class="btn disabled">試合中止</span>
// 中止のカードには試合へのリンク（ScheduleKey=…）が無く、ScheduleKey は li の id にだけある。
// 試合ページ（game_detail）には「中止」の表記が無く、得点0-0・状態欄が空で、未開催の試合と見分けがつかない。
import type { UpcomingGameEntry } from "../../shared/types.ts";

/** 中止のカードのボタン（「試合中止」「開催中止」「中止」）。「配信中止」など、試合の中止ではない文言は拾わない */
const CANCELLED_BUTTON = /class="[^"]*\bbtn\b[^"]*"[^>]*>\s*(?:試合中止|開催中止|中止)\s*</;

export interface ScheduleCards {
  /** 通常のカード（試合へのリンクがある）の ScheduleKey */
  keys: string[];
  /** 中止のカードの ScheduleKey */
  cancelledKeys: string[];
}

/** 日程JSONの topics（カードのHTML断片）から、通常のカードと中止のカードの ScheduleKey を取り出す */
export function parseScheduleCards(topics: string[]): ScheduleCards {
  const html = topics.join("");
  const linked = new Set([...html.matchAll(/ScheduleKey=(\d+)/g)].map((m) => m[1]!));
  const cancelled = new Set<string>();
  for (const card of html.split(/(?=<li class="list-item")/)) {
    if (!CANCELLED_BUTTON.test(card)) continue;
    const id = /^<li[^>]*\bid="(\d+)"/.exec(card)?.[1];
    if (id) cancelled.add(id);
    // 中止のボタンがあるカードのリンクのキーも、通常のカードには数えない
    for (const m of card.matchAll(/ScheduleKey=(\d+)/g)) cancelled.add(m[1]!);
  }
  const keys = [...linked].filter((k) => !cancelled.has(k));
  return { keys, cancelledKeys: [...cancelled] };
}

export interface CancelledReconcileInput {
  /** 前回までの scheduleKeys */
  existingKeys: string[];
  /** 今回の走査で通常のカードに載った ScheduleKey */
  normalKeys: string[];
  /** 今回の走査で中止のカードに載った ScheduleKey */
  cancelledKeys: string[];
  /** 前回までの cancelledGames のキー */
  existingCancelledKeys: string[];
  /** 生データ（games/）がある試合。生データがある試合は中止にしない */
  withBoxscore: Set<string>;
}

export interface CancelledReconcileResult {
  /** 中止を除いた scheduleKeys（昇順） */
  scheduleKeys: string[];
  /** 今回の時点で中止の試合のキー（昇順） */
  cancelled: string[];
  /** 今回新たに中止と判った試合 */
  newlyCancelled: string[];
  /** 中止を外した試合（後から普通のカードで載った。日程の変更で再設定された試合） */
  restored: string[];
}

/**
 * 中止の試合を決める。通常のカードに載っているキーは中止にしない（同じキーが、元の日付の中止のカードと、新しい日付の通常のカードの
 * 両方に載ることがある。そのときは通常のカードを優先し、前に中止にしていたなら外す）。生データがあるキーも中止にしない
 */
export function reconcileCancelled(input: CancelledReconcileInput): CancelledReconcileResult {
  const normal = new Set(input.normalKeys);
  const existingCancelled = new Set(input.existingCancelledKeys);
  const restored = input.existingCancelledKeys.filter((k) => normal.has(k)).sort();
  const newlyCancelled = input.cancelledKeys
    .filter((k) => !normal.has(k) && !input.withBoxscore.has(k) && !existingCancelled.has(k))
    .sort();
  const cancelled = new Set<string>([...input.existingCancelledKeys.filter((k) => !normal.has(k)), ...newlyCancelled]);
  const scheduleKeys = [...new Set([...input.existingKeys, ...input.normalKeys])].filter((k) => !cancelled.has(k)).sort();
  return { scheduleKeys, cancelled: [...cancelled].sort(), newlyCancelled, restored };
}

/** 生データ（games/）がある試合を、開催予定の一覧から外す（生データが揃えば開催予定ではない） */
export function dropUpcomingWithData(upcoming: UpcomingGameEntry[], withBoxscore: Set<string>): UpcomingGameEntry[] {
  return upcoming.filter((g) => !withBoxscore.has(g.scheduleKey));
}
