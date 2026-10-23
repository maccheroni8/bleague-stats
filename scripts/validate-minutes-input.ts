// MIN（出場時間）の入力欄の読み方（src/lib/statConditions.ts の parseConditionInputFor と minutesFormat.ts の formatMinutesColon）の検証スクリプト
// （検証専用）。「20」=20:00・「20:30」・「5:5」=5:05・「20.5」=20:30・全角・読めない入力。使い方: npm run validate:minutes-input。1つでも食い違いがあれば終了コード1

import { parseConditionInputFor } from "../src/lib/statConditions";
import { formatMinutesColon } from "../src/lib/minutesFormat";

let failures = 0;
function tidy(text: string): string | null {
  const v = parseConditionInputFor(text, "minutes");
  return v === null ? null : formatMinutesColon(v);
}
function eq(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${JSON.stringify(actual)}\n   期待: ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok ${label}`);
  }
}

const cases: [string, string | null][] = [
  ["20", "20:00"],
  ["20:00", "20:00"],
  ["20:30", "20:30"],
  ["5:5", "5:05"],
  ["5:05", "5:05"],
  ["20:", "20:00"],
  ["20.5", "20:30"],
  ["２０：３０", "20:30"],
  ["0", "0:00"],
  ["20:60", null],
  ["20:123", null],
  [":30", null],
  ["abc", null],
  ["20:3:0", null],
  ["", null],
];
for (const [input, expected] of cases) eq(`MIN「${input}」→ ${expected ?? "読めない"}`, tidy(input), expected);
eq("MIN以外の項目ではコロンの形を読まない", parseConditionInputFor("20:30", "count"), null);
eq("整えた形はもう一度整えても変わらない", tidy(tidy("5:5") ?? ""), "5:05");

if (failures > 0) {
  console.error(`${failures}件の食い違い`);
  process.exit(1);
}
console.log("すべて一致");
