// 表の見出しの列の数と、中身の行の列の数がそろっているかを、画面を操作して確かめる（DESIGN.md 420章。手で実行・validate:all には入れない）。
// 確認用サーバー（または公開サイト）と Playwright（Chromium）が要る。
//
// 使い方:
//   node scripts/check-table-columns.mjs <サイトのURL（末尾 /）> [iphone|pc|both]
//   例: node scripts/check-table-columns.mjs http://localhost:5194/bleague-stats/ both
// Playwright の場所は PLAYWRIGHT_DIR、ブラウザは CHROMIUM_PATH で変えられる。1つでも食い違いがあれば終了コード1
//
// 数え方: 見出しの列数＝見出しの各行の colSpan の合計の最大。中身の各行＝colSpan の合計。
// セルが1つだけの行（グループの見出し・「対象がありません」など）は対象外。
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("サイトのURLを渡してください（例: http://localhost:5194/bleague-stats/）");
  process.exit(2);
}
const which = process.argv[3] ?? "both";
const only = process.argv[4]; // 画面の名前の一部（省略すると全部）

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
  console.error("playwright が見つかりません（PLAYWRIGHT_DIR を渡してください）");
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
const { chromium, devices } = loadPlaywright();

/** ページ内で全部の表を調べ、食い違いの一覧を返す */
const CHECK = () => {
  const out = [];
  document.querySelectorAll("table").forEach((t, i) => {
    const hr = t.tHead?.rows;
    if (!hr || !hr.length) return;
    const w = (r) => [...r.cells].reduce((a, c) => a + c.colSpan, 0);
    const hw = Math.max(...[...hr].map(w));
    const bad = new Set();
    [...t.tBodies].forEach((b) =>
      [...b.rows].forEach((r) => {
        if (r.cells.length > 1 && w(r) !== hw) bad.add(w(r));
      }),
    );
    if (bad.size) out.push({ table: i, className: t.className, header: hw, body: [...bad] });
  });
  return out;
};

const failures = [];
let checked = 0;

async function check(page, label) {
  checked++;
  const r = await page.evaluate(CHECK);
  for (const f of r) failures.push(`${label}: 表${f.table}（${f.className}） 見出し${f.header}列 / 中身${f.body.join("・")}列`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clickButton = async (page, text, nth = 0) => {
  const loc = page.locator("button", { hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\%]/g, "\\$&")}\\s*$`) });
  if ((await loc.count()) <= nth) return false;
  await loc.nth(nth).click();
  await sleep(700);
  return true;
};
const setSelect = async (page, sel, value) => {
  await sel.selectOption(value);
  await sleep(1300);
};

async function sweepTeamDetail(page, label) {
  await clickButton(page, "チームスタッツ");
  const tabs = ["Traditional", "Advanced", "Misc", "Scoring", "Shooting", "Forced TOV", "On-Court Foreign", "Scoring %", "Periods", "Time to Shot", "Streaks"];
  for (const tab of tabs) {
    if (!(await clickButton(page, tab))) continue;
    await sleep(900);
    await check(page, `${label} ${tab}`);
    // ▸ で開く登録区分の行
    const toggles = page.locator("button.season-class-toggle");
    const n = Math.min(await toggles.count(), 2);
    for (let k = 0; k < n; k++) if ((await toggles.nth(k).getAttribute("aria-expanded")) !== "true") await toggles.nth(k).click();
    if (n) {
      await sleep(1200);
      await check(page, `${label} ${tab} ▸`);
    }
    // 区間（Q別・前後半・延長・クラッチ）と視点
    const periodSel = page.locator("select").filter({ has: page.locator("option", { hasText: "クラッチ" }) }).last();
    if (await periodSel.count()) {
      const values = await periodSel.locator("option").evaluateAll((os) => os.map((o) => o.value));
      for (const v of values) {
        await setSelect(page, periodSel, v);
        await check(page, `${label} ${tab} 区間=${v}`);
      }
      await setSelect(page, periodSel, values[0]);
    }
    const persp = page.locator("select").filter({ has: page.locator("option", { hasText: "opp" }) }).last();
    if (await persp.count()) {
      const values = await persp.locator("option").evaluateAll((os) => os.map((o) => o.value));
      for (const v of values) {
        await setSelect(page, persp, v);
        await check(page, `${label} ${tab} 視点=${v}`);
      }
      await setSelect(page, persp, values[0]);
    }
  }
}

const PAGES = [
  { name: "チーム詳細(宇都宮)", hash: "/teams/703?season=2026-27", team: true },
  { name: "チーム詳細(琉球)", hash: "/teams/701?season=2026-27", team: true },
  { name: "全チームスタッツ", hash: "/teams?season=2026-27" },
  { name: "全選手スタッツ", hash: "/players?season=2026-27" },
  { name: "ランキング(チーム)", hash: "/rankings?season=2026-27" },
  { name: "ランキング(個人)", hash: "/rankings?season=2026-27&m=player" },
  { name: "個人詳細", hash: "/players/51000524?season=2026-27" },
  { name: "順位表", hash: "/standings?season=2026-27" },
];

const profiles = [];
if (which === "pc" || which === "both") profiles.push({ name: "PC", opts: { viewport: { width: 1400, height: 900 } } });
if (which === "iphone" || which === "both") profiles.push({ name: "iPhone(375)", opts: { ...devices["iPhone 13"], viewport: { width: 375, height: 812 } } });

const browser = await chromium.launch({ executablePath: chromiumPath() });
for (const prof of profiles) {
  const ctx = await browser.newContext(prof.opts);
  const page = await ctx.newPage();
  for (const p of PAGES) {
    if (only && !p.name.includes(only)) continue;
    await page.goto(`${base}#${p.hash}`);
    await sleep(2500);
    const label = `${prof.name} ${p.name}`;
    await check(page, label);
    if (p.team) await sweepTeamDetail(page, label);
    else {
      // タブ・カテゴリのボタンを順に押す
      for (const tab of ["Traditional", "Advanced", "Misc", "Scoring", "Shooting", "Forced TOV", "On-Court Foreign", "Scoring %", "Periods", "Streaks"]) {
        if (await clickButton(page, tab)) await check(page, `${label} ${tab}`);
      }
    }
  }
  await ctx.close();
}
await browser.close();

if (failures.length) {
  console.error(`NG: 見出しと中身の列の数が合わない表が ${failures.length} 件（確認した画面 ${checked}）`);
  for (const f of [...new Set(failures)]) console.error(" - " + f);
  process.exit(1);
}
console.log(`OK: 確認した画面 ${checked} か所で、見出しと中身の列の数がそろっています`);
