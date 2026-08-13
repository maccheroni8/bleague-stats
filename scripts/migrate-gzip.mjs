// data/配下の既存.jsonファイルを全て.json.gzに変換する一回限りの移行スクリプト（DESIGN.md 8-3章）。
// 変換後は元の.jsonファイルを削除する。以降の書き込みはscripts/lib/storage.tsが
// 自動的に.json.gzで行うため、このスクリプトの再実行は不要（.jsonファイルが残っていなければ何もしない）。
//
// 使い方: node scripts/migrate-gzip.mjs

import { readdirSync, statSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(SCRIPTS_DIR, "..", "data");

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, files);
    else if (entry.endsWith(".json")) files.push(full);
  }
  return files;
}

const jsonFiles = walk(DATA_DIR);
console.log(`変換対象: ${jsonFiles.length}件`);

let totalBefore = 0;
let totalAfter = 0;
for (const file of jsonFiles) {
  const buf = readFileSync(file);
  const compressed = gzipSync(buf);
  writeFileSync(`${file}.gz`, compressed);
  unlinkSync(file);
  totalBefore += buf.length;
  totalAfter += compressed.length;
}

console.log(
  `完了: ${(totalBefore / 1024 / 1024).toFixed(2)}MB → ${(totalAfter / 1024 / 1024).toFixed(2)}MB` +
    `（${(100 - (totalAfter / totalBefore) * 100).toFixed(1)}%削減）`,
);
