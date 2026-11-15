// 日程の「画像として保存」を、実際にボタンを押して書き出す確認（手で実行・validate:all には入れない）。
// 確認用サーバー（または公開サイト）と Playwright（Chromium）が要る。
//
// 使い方:
//   node scripts/export-schedule-image.mjs <サイトのURL（末尾 /）> <出力ファイル.png> <シーズン> <list|calendar> <期間の選び方: day|week|month|custom> <基準の日付 or 開始日> [終了日]
//   例: node scripts/export-schedule-image.mjs http://localhost:5194/bleague-stats/ ../out/week.png 2025-26 list week 2025-11-12
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [base, outFile, season, view, mode, date, endDate] = process.argv.slice(2);
if (!base || !outFile || !season || !view || !mode || !date) {
  console.error("使い方: node scripts/export-schedule-image.mjs <サイトのURL> <出力ファイル.png> <シーズン> <list|calendar> <day|week|month|custom> <日付> [終了日]");
  process.exit(2);
}
const MODE_LABELS = { day: "1日", week: "1週間", month: "1か月", custom: "期間を指定" };

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

function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  if (!existsSync(cache)) return undefined;
  const shell = readdirSync(cache).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  if (!shell) return undefined;
  const p = join(cache, shell, "chrome-headless-shell-mac-arm64/chrome-headless-shell");
  return existsSync(p) ? p : undefined;
}

function pngSize(file) {
  const b = readFileSync(file);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

const { chromium } = loadPlaywright();
const executablePath = chromiumPath();
const browser = await chromium.launch(executablePath ? { executablePath } : {});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(`${base}#/schedule?season=${season}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: view === "calendar" ? "カレンダー表示" : "リスト表示" }).click();
await page.getByRole("button", { name: "画像として保存" }).click();
const dialog = page.getByRole("dialog");
await dialog.getByRole("button", { name: MODE_LABELS[mode], exact: true }).click();
if (mode === "custom") {
  const inputs = dialog.locator('input[type="date"]');
  await inputs.nth(0).fill(date);
  await inputs.nth(1).fill(endDate ?? date);
} else {
  await dialog.locator('input[type="date"]').fill(date);
}
console.log("窓の中:", (await dialog.innerText()).replace(/\n+/g, " / "));
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), dialog.getByRole("button", { name: "保存する" }).click()]);
mkdirSync(dirname(resolve(outFile)), { recursive: true });
await download.saveAs(resolve(outFile));
console.log("保存:", download.suggestedFilename(), pngSize(resolve(outFile)).join("×"));
await browser.close();
