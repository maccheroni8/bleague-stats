// チーム詳細の Time to Shot（シーズン別成績）の「画像として保存」を、実際にボタンを押して書き出す確認（手で実行・validate:all には入れない。DESIGN.md 480章）。
// 確認用サーバー（または公開サイト）と Playwright（Chromium）が要る。読み込み・起動の部分は export-schedule-image.mjs と同じ。
//
// 使い方:
//   node scripts/export-team-tts-image.mjs <サイトのURL（末尾 /）> <出力ファイル.png> <チームID> <シーズン> [own|opp|diff] [ttsoの値（例 start,ft）] [s|pct]
//   例: node scripts/export-team-tts-image.mjs http://localhost:5187/bleague-stats/ ../out/tts.png 703 2025-26 own start,ft s
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const [base, outFile, teamId, season, perspective = "own", open = "start,ft", unit = "s"] = process.argv.slice(2);
if (!base || !outFile || !teamId || !season) {
  console.error("使い方: node scripts/export-team-tts-image.mjs <サイトのURL> <出力ファイル.png> <チームID> <シーズン> [own|opp|diff] [ttso] [s|pct]");
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
const query = new URLSearchParams({ season, ttso: open });
if (unit === "pct") query.set("ttsu", "pct");
await page.goto(`${base}#/teams/${teamId}?${query}`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "チームスタッツ", exact: true }).click();
await page.getByRole("button", { name: "Time to Shot", exact: true }).first().click();
if (perspective !== "own") await page.getByRole("button", { name: perspective === "opp" ? "opp" : "+/-", exact: true }).first().click();
await page.locator("table.tts-table tbody tr").first().waitFor();
await page.waitForTimeout(1500);
await page.getByRole("button", { name: "保存", exact: true }).click();
await page.getByRole("menuitem", { name: "画像（Time to Shot）" }).click();
const dialog = page.getByRole("dialog");
console.log("窓の中:", (await dialog.innerText()).replace(/\n+/g, " / "));
const [download] = await Promise.all([page.waitForEvent("download", { timeout: 90000 }), dialog.getByRole("button", { name: "保存する" }).click()]);
mkdirSync(dirname(resolve(outFile)), { recursive: true });
await download.saveAs(resolve(outFile));
console.log("保存:", download.suggestedFilename(), pngSize(resolve(outFile)).join("×"));
await browser.close();
