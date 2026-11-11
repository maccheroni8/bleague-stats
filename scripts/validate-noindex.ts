// 検索サイトに載せない目印（robots の meta タグ）が index.html にあるかの検証（DESIGN.md 373章）。
// 公開サイトは index.html 1枚から全画面を出す作りなので、ここにあれば全ページに効く。外のサイトに問い合わせない。
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "index.html");
const html = readFileSync(file, "utf-8");
let failed = 0;
function check(name: string, ok: boolean): void {
  console.log(`${ok ? "ok  " : "NG  "} ${name}`);
  if (!ok) failed++;
}
for (const metaName of ["robots", "googlebot"]) {
  const m = new RegExp(`<meta\\s+name="${metaName}"\\s+content="([^"]*)"`).exec(html);
  const tokens = (m?.[1] ?? "").split(",").map((t) => t.trim());
  for (const t of ["noindex", "nofollow", "noimageindex"]) check(`${metaName} に ${t}`, tokens.includes(t));
}

if (failed) process.exit(1);
