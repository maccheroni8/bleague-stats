// 中止の試合の検出・振り分け（scripts/lib/scheduleCancelled.ts。DESIGN.md 227章）の検証。
// 公式の日程JSONの実際のカード（2019-20の通常のカードと、2020/4/4 千葉-SR渋谷 ScheduleKey=4630 の中止のカード）の抜粋を使う
import { dropUpcomingWithData, parseScheduleCards, reconcileCancelled } from "./lib/scheduleCancelled.ts";
import type { UpcomingGameEntry } from "../shared/types.ts";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}${ok || !detail ? "" : `（${detail}）`}`);
  if (!ok) failed++;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const NORMAL_CARD =
  '<li class="list-item" id="4556"><div class="inner"><a class="data-game click_schedule_report" href="/game_detail/?ScheduleKey=4556&tab=2"><div class="game "><span class="team home"><span class="team-name">千葉</span></span><span class="point font-blg"><span class="number home-score gr"><span>80</span></span><span class="hifun"></span><span class="number away-score "><span>88</span></span></span><span class="team away"><span class="team-name">宇都宮</span></span></div><div class="info"><div class="info-scorestate"><span>FINAL</span></div></div></a><div class="data-link"><a href="javascript:void(0)" class="btn disabled" style="pointer-events:none;">配信終了</a><p><a class="text-link" href="/game_detail/?ScheduleKey=4556&tab=2"><span class="link-line">試合レポート</span></a><p></div></div></li>';
const CANCELLED_CARD =
  '<li class="list-item" id="4630"><script> (function(j$){ _contexts_s3id[4630]=0; })(jQuery); </script><div class="inner"><div class="data-game"><div class="game "><span class="team home"><span class="team-name">千葉</span></span><span class="point font-blg"></span><span class="team away"><span class="team-name">SR渋谷</span></span></div><div class="info"><div class="info-arena"><span >第33節</span><span>千葉県 | 船アリ</span><span>15:05</span></div><div class="info-scorestate"></div></div></div><div class="data-link"><span class="btn disabled">試合中止</span></div></div></li>';
// 配信（ライブ配信）が中止になった通常の試合: 試合の中止ではない
const STREAM_CANCELLED_CARD =
  '<li class="list-item" id="4562"><div class="inner"><a class="data-game" href="/game_detail/?ScheduleKey=4562&tab=2"><div class="game "></div></a><div class="data-link"><a href="javascript:void(0)" class="btn disabled">配信中止</a></div></div></li>';

// 1. カードの読み取り
{
  const r = parseScheduleCards([NORMAL_CARD, CANCELLED_CARD, STREAM_CANCELLED_CARD]);
  check("通常のカードのキーを取る", r.keys.includes("4556") && r.keys.includes("4562"), JSON.stringify(r));
  check("中止のカード（リンクなし）のキーを li の id から取る", same(r.cancelledKeys, ["4630"]), JSON.stringify(r.cancelledKeys));
  check("中止のカードは通常のカードに数えない", !r.keys.includes("4630"));
  check("「配信中止」は試合の中止にしない", !r.cancelledKeys.includes("4562"));
  const joined = parseScheduleCards([NORMAL_CARD + CANCELLED_CARD]);
  check("1つの断片に複数のカードが続いていても分ける", same(joined.keys, ["4556"]) && same(joined.cancelledKeys, ["4630"]));
  const none = parseScheduleCards([]);
  check("カードが無ければ空", none.keys.length === 0 && none.cancelledKeys.length === 0);
}

// 2. 中止の振り分け
{
  const base = { existingKeys: ["4556", "4630", "4640"], normalKeys: ["4556"], cancelledKeys: ["4630"], existingCancelledKeys: [] as string[], withBoxscore: new Set<string>() };
  const r = reconcileCancelled(base);
  check("中止のキーは scheduleKeys から外れる", same(r.scheduleKeys, ["4556", "4640"]), JSON.stringify(r.scheduleKeys));
  check("新たに中止と判った試合に入る", same(r.newlyCancelled, ["4630"]) && same(r.cancelled, ["4630"]));

  const again = reconcileCancelled({ ...base, existingKeys: ["4556", "4640"], existingCancelledKeys: ["4630"] });
  check("次の実行でも中止のまま・新規扱いにしない", same(again.cancelled, ["4630"]) && again.newlyCancelled.length === 0 && same(again.scheduleKeys, ["4556", "4640"]));

  const carried = reconcileCancelled({ ...base, normalKeys: [], cancelledKeys: [], existingKeys: ["4556"], existingCancelledKeys: ["4630"] });
  check("その日を走査しない実行でも、前回の中止は引き継ぐ", same(carried.cancelled, ["4630"]));

  const restored = reconcileCancelled({ ...base, existingKeys: ["4556"], normalKeys: ["4556", "4630"], cancelledKeys: [], existingCancelledKeys: ["4630"] });
  check("後から通常のカードに載れば中止を外して scheduleKeys に戻す", same(restored.restored, ["4630"]) && restored.cancelled.length === 0 && restored.scheduleKeys.includes("4630"));

  const both = reconcileCancelled({ ...base, normalKeys: ["4556", "4630"], cancelledKeys: ["4630"] });
  check("中止のカードと通常のカードの両方に載れば通常を優先する", both.cancelled.length === 0 && both.scheduleKeys.includes("4630"));

  const hasData = reconcileCancelled({ ...base, withBoxscore: new Set(["4630"]) });
  check("生データがある試合は中止にしない", hasData.cancelled.length === 0 && hasData.scheduleKeys.includes("4630"));
}

// 3. 生データがある試合を開催予定から外す
{
  const mk = (k: string): UpcomingGameEntry => ({ scheduleKey: k, date: "2022-09-29", homeTeamName: "A", awayTeamName: "B" });
  const out = dropUpcomingWithData([mk("500017"), mk("500018")], new Set(["500017"]));
  check("生データがある試合は開催予定から外れる", same(out.map((g) => g.scheduleKey), ["500018"]));
}

if (failed > 0) {
  console.error(`\n${failed} 件が失敗しました`);
  process.exitCode = 1;
} else {
  console.log("\nすべて ok");
}
