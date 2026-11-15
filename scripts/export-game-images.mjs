// 試合詳細の「画像を保存（6枚）」を、実際にボタンを押して書き出す確認（手で実行・validate:all には入れない）。
// 確認用サーバー（または公開サイト）と Playwright（Chromium）が要る。
//
// 使い方:
//   node scripts/export-game-images.mjs <サイトのURL（末尾 /）> <出力フォルダ> <シーズン:試合ID[:one]> [...]
//   例: node scripts/export-game-images.mjs http://localhost:5188/bleague-stats/ ../out 2026-27:506381
// 試合ごとに <出力フォルダ>/<試合ID>/ に6枚を置き、大きさ（幅×高さ・バイト数）を出す。5MB を超える・2160×2700 でない画像があれば終了コード1
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const [base, outDir, ...targets] = process.argv.slice(2);
if (!base || !outDir || targets.length === 0) {
  console.error("使い方: node scripts/export-game-images.mjs <サイトのURL> <出力フォルダ> <シーズン:試合ID[:one]> [...]");
  process.exit(2);
}

function loadPlaywright() {
  const dirs = [process.env.PLAYWRIGHT_DIR, process.cwd()].filter(Boolean);
  const npx = join(homedir(), ".npm/_npx");
  if (existsSync(npx)) for (const d of readdirSync(npx)) dirs.push(join(npx, d));
  for (const d of dirs) {
    try {
      return createRequire(join(d, "node_modules/"))("playwright");
    } catch {
      /* 次の場所 */
    }
  }
  console.error("playwright が見つかりません（npx playwright --version で一度入れるか、PLAYWRIGHT_DIR を渡してください）");
  process.exit(2);
}

/** PNG・JPEG の幅と高さ */
function imageSize(file) {
  const b = readFileSync(file);
  if (b[0] === 0x89) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  for (let i = 2; i < b.length; ) {
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc3) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return [0, 0];
}

/** 入っている Chromium（Playwright の版と合わないときのため、手元にある最新のものを使う。CHROMIUM_PATH で変えられる） */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  if (!shell) return undefined;
  const p = join(cache, shell, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
  return existsSync(p) ? p : undefined;
}

const { chromium } = loadPlaywright();
const executablePath = chromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, acceptDownloads: true, locale: "ja-JP" });
let bad = 0;
for (const target of targets) {
  const [season, key, league] = target.split(":");
  const dir = resolve(outDir, key);
  mkdirSync(dir, { recursive: true });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.error(`  ページのエラー: ${e.message}`));
  await page.goto(`${base}#/games/${key}?season=${season}${league === "one" ? "&league=one" : ""}`);
  await page.getByRole("button", { name: "画像を保存（6枚）" }).click({ timeout: 60_000 });
  const saveAll = page.getByRole("button", { name: "6枚まとめて保存" });
  await saveAll.waitFor({ timeout: 60_000 });
  await page.waitForFunction(() => document.querySelectorAll(".game-images-thumb svg").length === 6, null, { timeout: 60_000 });
  const files = [];
  page.on("download", (d) => files.push(d.saveAs(join(dir, d.suggestedFilename())).then(() => d.suggestedFilename())));
  await saveAll.click();
  await page.getByText(/枚を保存しました|保存できませんでした/).waitFor({ timeout: 120_000 });
  const names = (await Promise.all(files)).sort();
  console.log(`${target}: ${names.length}枚 → ${dir}`);
  if (names.length !== 6) bad += 1;
  for (const n of names) {
    const f = join(dir, n);
    const [w, h] = imageSize(f);
    const size = statSync(f).size;
    const ok = w === 2160 && h === 2700 && size <= 5 * 1024 * 1024;
    if (!ok) bad += 1;
    console.log(`  ${ok ? "○" : "×"} ${n}  ${w}×${h}  ${(size / 1024 / 1024).toFixed(2)}MB`);
  }
  await page.close();
}
await browser.close();
process.exit(bad > 0 ? 1 : 0);
