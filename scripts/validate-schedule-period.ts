import assert from "node:assert/strict";
import {
  addDays,
  clampToDates,
  daysInclusive,
  monthRangeOf,
  schedulePeriod,
  schedulePeriodLabel,
  weekRangeOf,
  weeksCovering,
} from "../src/lib/schedulePeriod.ts";

// 週は月曜〜日曜（日曜・月曜・年またぎ）
assert.deepEqual(weekRangeOf("2026-11-15"), { from: "2026-11-09", to: "2026-11-15" });
assert.deepEqual(weekRangeOf("2026-11-09"), { from: "2026-11-09", to: "2026-11-15" });
assert.deepEqual(weekRangeOf("2027-01-01"), { from: "2026-12-28", to: "2027-01-03" });
// 月（うるう年の2月・12月）
assert.deepEqual(monthRangeOf("2028-02-10"), { from: "2028-02-01", to: "2028-02-29" });
assert.deepEqual(monthRangeOf("2026-12-31"), { from: "2026-12-01", to: "2026-12-31" });
// 日数は両端を含み、終了日が前なら0
assert.equal(daysInclusive("2026-11-09", "2026-11-15"), 7);
assert.equal(daysInclusive("2026-11-15", "2026-11-15"), 1);
assert.equal(daysInclusive("2026-11-16", "2026-11-15"), 0);
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
// 選び方ごとの期間・開始日と終了日が逆なら入れ替える
assert.deepEqual(schedulePeriod("day", "2026-11-12", "", ""), { from: "2026-11-12", to: "2026-11-12" });
assert.deepEqual(schedulePeriod("week", "2026-11-12", "", ""), { from: "2026-11-09", to: "2026-11-15" });
assert.deepEqual(schedulePeriod("month", "2026-11-12", "", ""), { from: "2026-11-01", to: "2026-11-30" });
assert.deepEqual(schedulePeriod("custom", "2026-11-12", "2026-11-20", "2026-11-13"), { from: "2026-11-13", to: "2026-11-20" });
// サブタイトル・ファイル名の書き方
assert.equal(schedulePeriodLabel({ from: "2026-11-09", to: "2026-11-15" }), "期間: 2026/11/09〜2026/11/15");
assert.equal(schedulePeriodLabel({ from: "2026-11-15", to: "2026-11-15" }), "期間: 2026/11/15");
// カレンダーの週: 期間を含む月曜始まりの週をすべて並べる（月をまたぐ・1日だけ）
const weeks = weeksCovering({ from: "2026-10-30", to: "2026-11-09" });
assert.equal(weeks.length, 3);
assert.equal(weeks[0]![0], "2026-10-26");
assert.equal(weeks[2]![6], "2026-11-15");
assert.equal(weeksCovering({ from: "2026-11-11", to: "2026-11-11" }).length, 1);
// 初期の基準日は、試合のある日の範囲に収める
assert.equal(clampToDates("2026-11-15", "2026-10-03", "2027-05-30"), "2026-11-15");
assert.equal(clampToDates("2026-11-15", "2025-10-03", "2026-05-30"), "2026-05-30");
assert.equal(clampToDates("2026-08-01", "2026-10-03", "2027-05-30"), "2026-10-03");
assert.equal(clampToDates("2026-08-01", undefined, undefined), "2026-08-01");
console.log("validate:schedule-period OK");
