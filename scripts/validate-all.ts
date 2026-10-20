// package.json の scripts のうち validate: で始まるもの全部を順に流す（コミット前に全validateを通す決まり。CLAUDE.md・DESIGN.md 278章）。
// 自分自身（validate:all）は流さない。1本ずつ結果（終了コード・秒数）を出し、失敗したものは出力の末尾を添えて、最後に一覧する。1本でも失敗すれば終了コード1。
// 事前に `npm run build:data`（導出データの作成）が済んでいること（多くの検証が data/ の導出データを読む）。全部で約12分かかる。
//
// 使い方: npm run validate:all [-- --skip 名前,名前] [-- --only 名前,名前]（名前は validate: を除いた部分。例: --only dnp-rows,stat-names）
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const listArg = (flag: string): string[] | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1]!.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
};
const skip = new Set(listArg("--skip") ?? []);
const only = listArg("--only");

const scripts = (JSON.parse(readFileSync("package.json", "utf8")).scripts ?? {}) as Record<string, string>;
const names = Object.keys(scripts)
  .filter((k) => k.startsWith("validate:") && k !== "validate:all")
  .map((k) => k.slice("validate:".length))
  .filter((n) => !skip.has(n) && (!only || only.includes(n)));

const failed: { name: string; tail: string }[] = [];
const started = Date.now();
for (const name of names) {
  const t = Date.now();
  const r = spawnSync("npm", ["run", `validate:${name}`], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const sec = Math.round((Date.now() - t) / 1000);
  const ok = r.status === 0;
  console.log(`${ok ? "ok" : "NG"}  validate:${name}  ${sec}秒`);
  if (!ok) failed.push({ name, tail: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim().split("\n").slice(-15).join("\n") });
}
console.log(`\n${names.length} 本を ${Math.round((Date.now() - started) / 1000)} 秒で実行`);
if (failed.length === 0) {
  console.log("OK: すべて通りました");
} else {
  for (const f of failed) console.log(`\n--- 失敗: validate:${f.name} ---\n${f.tail}`);
  console.log(`\nNG: ${failed.length} 本が失敗: ${failed.map((f) => f.name).join("・")}`);
  process.exit(1);
}
