// チーム詳細のラインナップタブの「画像として保存」（オンザコート別・よく使われるラインナップ・ラインナップ検索）を、実際にボタンを押して書き出す確認
// （手で実行・validate:all には入れない。DESIGN.md 483章）。確認用サーバー（または公開サイト）と Playwright（Chromium）が要る。読み込み・起動の部分は export-schedule-image.mjs と同じ。
//
// 使い方:
//   node scripts/export-team-lineups-image.mjs <サイトのURL（末尾 /）> <出力フォルダ> <チームID> <シーズン> [選手名をカンマ区切り（ラインナップ検索で選ぶ）] [rating|traditional|advanced] [width]
//   例: node scripts/export-team-lineups-image.mjs http://localhost:5187/bleague-stats/ ../out 703 2026-27 "ギャビン・エドワーズ,小川 敦也,比江島 慎"
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const [base, outDir, teamId, season, playersArg = "", tab = "rating", widthArg = "1280"] = process.argv.slice(2);
if (!base || !outDir || !teamId || !season) {
  console.error("使い方: node scripts/export-team-lineups-image.mjs <サイトのURL> <出力フォルダ> <チームID> <シーズン> [選手名,...] [rating|traditional|advanced] [width]");
  process.exit(2);
}
const TAB_LABELS = { rating: "得失点・レーティング", traditional: "Traditional", advanced: "Advanced" };

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
const width = Number(widthArg);
const page = await browser.newPage({ viewport: { width, height: 900 }, acceptDownloads: true });
page.on("pageerror", (e) => console.error("pageerror:", e.message));
await page.goto(`${base}#/teams/${teamId}?tab=lineups&season=${season}`, { waitUntil: "networkidle" });
await page.locator(".lineup-search-dropdown-button").waitFor({ timeout: 60000 });
const players = playersArg ? playersArg.split(",") : [];
if (players.length > 0) {
  await page.locator(".lineup-search-dropdown-button").click();
  for (const name of players) {
    // スマホ幅では名字だけで出るので、前方・後方の一致も見る
    const option = page.locator(".lineup-search-option").filter({ hasText: name }).first();
    await option.locator("input").check();
  }
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: TAB_LABELS[tab], exact: true }).click();
}
await page.getByRole("button", { name: "保存", exact: true }).click();
const imageItem = page.getByRole("menuitem", { name: "画像", exact: true });
if (await imageItem.count()) await imageItem.click();
const dialog = page.getByRole("dialog");
console.log("窓の中:", (await dialog.innerText()).replace(/\n+/g, " / "));
const all = dialog.getByLabel("すべて選ぶ");
if (await all.isEnabled()) await all.check();
mkdirSync(resolve(outDir), { recursive: true });
const downloads = [];
page.on("download", (d) => downloads.push(d));
await dialog.getByRole("button", { name: "保存する" }).click();
const expected = await page.evaluate(() => [...document.querySelectorAll(".export-multi-item:not(.export-multi-all) input")].filter((i) => i.checked).length);
const started = Date.now();
while (downloads.length < expected && Date.now() - started < 120000) await page.waitForTimeout(500);
for (const d of downloads) {
  const file = resolve(outDir, d.suggestedFilename());
  await d.saveAs(file);
  console.log("保存:", d.suggestedFilename(), pngSize(file).join("×"));
}
await browser.close();
