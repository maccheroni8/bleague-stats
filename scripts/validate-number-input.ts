// 数値・時間を手で入れる欄の検証（DESIGN.md 337章。検証専用・データを読まない）。使い方: npm run validate:number-input
// 1. 確定したときの読み方（src/lib/numberTextInput.ts の commitNumberText）
// 2. 画面のコードに、数値・時間を手で入れる欄が共通の部品（NumberTextInput）以外で作られていないこと
//    （1文字ごとに親へ渡して書き戻す作りに戻ると、スマホの日本語キーボードで文字が二重に入る）
// スマホの画面を再現して実際に打つ確認は scripts/check-mobile-input.mjs（手で実行。確認用サーバーと Playwright が要る）

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { commitNumberText, type NumberTextKind } from "../src/lib/numberTextInput";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${JSON.stringify(actual)}\n   期待: ${JSON.stringify(expected)}`);
  } else {
    console.log(`ok ${label}`);
  }
}

const cases: [NumberTextKind, string, string | null][] = [
  // スタッツの条件（ふつうの項目）: 全角を半角にするだけ。読めない文字は残す（欄の下で案内）
  ["text", "60", "60"],
  ["text", "６０", "60"],
  ["text", "１５．５", "15.5"],
  ["text", " 0 ", "0"],
  ["text", "", ""],
  ["text", "abc", "abc"],
  ["text", "－５", "-5"],
  // MIN: 読めれば「分:秒」に整える。読めなければ残す
  ["minutes", "20", "20:00"],
  ["minutes", "20:00", "20:00"],
  ["minutes", "２０：００", "20:00"],
  ["minutes", "15.5", "15:30"],
  ["minutes", "5:5", "5:05"],
  ["minutes", "0", "0:00"],
  ["minutes", "20:", "20:00"],
  ["minutes", "20:60", "20:60"],
  ["minutes", "", ""],
  // ベン図の基準の値: 数として読めなければ確定前に戻す（null）
  ["number", "60", "60"],
  ["number", "６０", "60"],
  ["number", "15.5", "15.5"],
  ["number", "１５．５", "15.5"],
  ["number", "0", "0"],
  ["number", "-3.5", "-3.5"],
  ["number", "ー３", "-3"],
  ["number", "15.", "15"],
  ["number", ".5", "0.5"],
  ["number", "", ""],
  ["number", "-", null],
  ["number", "1.2.3", null],
  ["number", "6606000", "6606000"],
  ["number", "abc", null],
  // 最終点差: 0以上の整数（3桁まで）
  ["count", "15", "15"],
  ["count", "１５", "15"],
  ["count", "0", "0"],
  ["count", "007", "7"],
  ["count", "1234", "123"],
  ["count", "", ""],
  ["count", "1.5", null],
  ["count", "-3", null],
];
for (const [kind, input, expected] of cases) eq(`${kind}「${input}」→ ${expected === null ? "元に戻す" : `「${expected}」`}`, commitNumberText(input, kind), expected);

// 2. 画面のコードの見張り: <input> のうち、文字を打つ欄（type が text・number・tel・無指定）は NumberTextInput の中だけに置く
//    （検索欄 type="search"・日付・チェック・スライダーは対象外）
const ALLOWED_FILES = new Set(["src/components/NumberTextInput.tsx"]);
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(name) ? [p] : [];
  });
}
const offenders: string[] = [];
for (const file of walk("src")) {
  const rel = file.split("\\").join("/");
  if (ALLOWED_FILES.has(rel)) continue;
  const text = readFileSync(file, "utf8");
  const re = /<input\b([^>]*?)\/?>/gs;
  for (const m of text.matchAll(re)) {
    const attrs = m[1] ?? "";
    const type = /\btype=["'{]+([\w-]+)/.exec(attrs)?.[1] ?? "text";
    if (["checkbox", "radio", "range", "date", "search", "file", "color", "hidden", "submit", "button"].includes(type)) continue;
    const line = text.slice(0, m.index).split("\n").length;
    offenders.push(`${rel}:${line} <input type="${type}">`);
  }
}
eq("数値・時間を手で入れる欄は NumberTextInput だけ（ほかの <input> で作っていない）", offenders, []);

if (failures > 0) {
  console.error(`${failures}件の食い違い`);
  process.exit(1);
}
console.log("すべて一致");
