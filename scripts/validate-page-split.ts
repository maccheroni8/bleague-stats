// ページごとにプログラムを分けた形（DESIGN.md 356章）が崩れていないかの検証。
// 1. App.tsx はページを静的に import しない（lazyPage で開いたときに読む）
// 2. ページ以外のファイル（テストを除く）は、ページを型以外で import しない（読むとそのページが共通の部分に入る・逆向きの依存）。
//    例外は md 出力（aiDetailedExport.ts）がチーム詳細の関数を読むものだけ（md の画面はチーム詳細からしか開かない）
// 3. ページから先で読む CSS（図ごとの CSS・md の画面の CSS を除く）は、main.tsx で index.css より前に読む
//    （CSS の並びを分ける前と同じにする。並びが変わると、同じ強さの指定の勝ち負けが変わり、見た目が変わる）
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
let failures = 0;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? "ok" : "NG"} ${message}`);
  if (!ok) failures += 1;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const rel = (p: string) => path.relative(root, p).split(path.sep).join("/");
const files = walk(path.join(root, "src")).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f));

// 1
const app = readFileSync(path.join(root, "src/App.tsx"), "utf8");
const staticPageImports = [...app.matchAll(/^import\s+(?!type\b)[^;]*from\s+["']\.\/pages\/[^"']+["']/gm)].map((m) => m[0]);
check(staticPageImports.length === 0, `App.tsx はページを静的に import しない（${staticPageImports.length}件）`);
const lazyCount = (app.match(/lazyPage\(\(\) => import\("\.\/pages\//g) ?? []).length;
check(lazyCount >= 12, `App.tsx のページは lazyPage で読む（${lazyCount}件）`);

// 2
const ALLOWED_PAGE_IMPORTS = new Set(["src/lib/aiDetailedExport.ts -> TeamDetailPage"]);
const reverse: string[] = [];
for (const f of files) {
  const r = rel(f);
  if (r.startsWith("src/pages/") || r === "src/App.tsx") continue;
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*from\s+["'](?:\.\.?\/)+pages\/([A-Za-z]+)(?:\.tsx?)?["']/gm)) {
    if (m[1]) continue; // 型だけの import はプログラムに残らない
    const key = `${r} -> ${m[2]}`;
    if (!ALLOWED_PAGE_IMPORTS.has(key)) reverse.push(key);
  }
}
for (const f of files.filter((x) => rel(x).startsWith("src/pages/"))) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/^import\s+(type\s+)?[^;]*from\s+["']\.\/([A-Za-z]+Page)(?:\.tsx?)?["']/gm)) {
    if (!m[1]) reverse.push(`${rel(f)} -> ${m[2]}`);
  }
}
check(reverse.length === 0, `ページ以外・ほかのページからページを（型以外で）import しない${reverse.length ? `: ${reverse.join(", ")}` : ""}`);

// 3
const main = readFileSync(path.join(root, "src/main.tsx"), "utf8");
const mainCss = [...main.matchAll(/^import\s+["']\.\/([^"']+\.css)["']/gm)].map((m) => `src/${m[1]}`);
const indexAt = mainCss.indexOf("src/index.css");
check(indexAt >= 0, "main.tsx が index.css を読む");
const SPLIT_CSS_OK = (css: string) => css.startsWith("src/figures/") && css !== "src/figures/FigurePresets.css" ? true : css === "src/components/AiExportDialog.css";
const missing: string[] = [];
for (const f of files) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/^import\s+["'](\.{1,2}\/[^"']+\.css)["']/gm)) {
    const css = rel(path.resolve(path.dirname(f), m[1]!));
    if (rel(f) === "src/main.tsx" || SPLIT_CSS_OK(css)) continue;
    const at = mainCss.indexOf(css);
    if (at < 0 || at > indexAt) missing.push(`${css}（${rel(f)}）`);
  }
}
check(missing.length === 0, `ページから先で読む CSS は main.tsx で index.css より前に読む${missing.length ? `: ${[...new Set(missing)].join(", ")}` : ""}`);

if (failures > 0) {
  console.error(`\n食い違い ${failures}件`);
  process.exit(1);
}
console.log("\nページごとの分け方の決まりはすべて守られています");
