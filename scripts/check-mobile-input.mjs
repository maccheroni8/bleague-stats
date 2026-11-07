// スマホの画面を再現して、数値・時間を手で入れる欄に実際に打つ確認（DESIGN.md 337章。手で実行・validate:all には入れない）。
// 確認用サーバー（または公開サイト）と Playwright（Chromium）が要る。日本語キーボードの「確定前の文字」は Chromium の
// 開発者用の機能（Input.imeSetComposition）で再現する。iPhone の Safari そのものではない（WebKit は使わない）。
//
// 使い方:
//   node scripts/check-mobile-input.mjs <サイトのURL（末尾 /）> [iphone|android|both] [欄の名前の一部]
//   例: node scripts/check-mobile-input.mjs http://localhost:5191/bleague-stats/ both
// Playwright の場所は PLAYWRIGHT_DIR（playwright が入った node_modules の親）、ブラウザは CHROMIUM_PATH で変えられる。
// 1つでも食い違いがあれば終了コード1
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const base = process.argv[2];
if (!base) {
  console.error("サイトのURLを渡してください（例: http://localhost:5191/bleague-stats/）");
  process.exit(2);
}
const which = process.argv[3] ?? "both";
const only = process.argv[4];

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
const { chromium, devices } = loadPlaywright();

const full = (t) => t.replace(/[0-9]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0)).replace(/:/g, "：").replace(/\./g, "．");

/** 欄ごとの確かめ方。expect は確定後に欄に出る文字、param は確定後のURLに入る文字 */
const FIELDS = [
  { name: "選手ベン図・基準の値", hash: "/figures?entity=player&figure=player-venn&season=2026-27", label: "PTSの基準の値",
    texts: [["60", "60", "vta=60"], ["15.5", "15.5", "vta=15.5"], ["0", "0", "vta=0"]] },
  { name: "チームベン図・基準の値", hash: "/figures?entity=team&figure=team-venn&season=2026-27&vbs=value", selector: ".venn-threshold",
    texts: [["60", "60", "vta=60"], ["15.5", "15.5", "vta=15.5"], ["0", "0", "vta=0"]] },
  { name: "ランキング個人シーズン・プレータイム", hash: "/rankings?season=2026-27&m=player&sc=min.ge.", advanced: true, label: "条件1の値",
    texts: [["20:00", "20:00", "sc=min.ge.20:00"], ["15.5", "15:30", "sc=min.ge.15:30"], ["0", "0:00", "sc=min.ge.0:00"], ["20", "20:00", "sc=min.ge.20:00"]] },
  { name: "ランキング個人1試合・プレータイム", hash: "/rankings?season=2026-27&m=player&k=game&sc=min.ge.", advanced: true, label: "条件1の値",
    texts: [["20:00", "20:00", "sc=min.ge.20:00"], ["15.5", "15:30", "sc=min.ge.15:30"]] },
  { name: "ランキングチームシーズン・スタッツの条件", hash: "/rankings?season=2026-27&sc=pts.ge.", advanced: true, label: "条件1の値",
    texts: [["60", "60", "sc=pts.ge.60"], ["15.5", "15.5", "sc=pts.ge.15.5"], ["0", "0", "sc=pts.ge.0"]] },
  { name: "ランキング個人1試合・最終点差", hash: "/rankings?season=2026-27&m=player&k=game", margin: true, label: "最終点差の下限（点）",
    texts: [["60", "60", "fm=60-"], ["15", "15", "fm=15-"], ["0", "0", "fm=0-"]] },
  { name: "ランキング達成記録・しきい値", hash: "/rankings?season=2026-27&m=player&k=thr", label: "条件1の値",
    texts: [["60", "60", "sc=pts.ge.60"], ["15.5", "15.5", "sc=pts.ge.15.5"], ["0", "0", "sc=pts.ge.0"]] },
  { name: "全選手スタッツ・スタッツの条件", hash: "/players?season=2026-27&sc=min.ge.", advanced: true, label: "条件1の値",
    texts: [["20:00", "20:00", "sc=min.ge.20:00"], ["0", "0:00", "sc=min.ge.0:00"]] },
  { name: "全チームスタッツ・スタッツの条件", hash: "/teams?season=2026-27&sc=pts.ge.", advanced: true, label: "条件1の値",
    texts: [["60", "60", "sc=pts.ge.60"], ["15.5", "15.5", "sc=pts.ge.15.5"]] },
  { name: "選手ベン図・詳細フィルター", hash: "/figures?entity=player&figure=player-venn&season=2026-27&sc=min.ge.", advanced: true, label: "条件1の値",
    texts: [["20:00", "20:00", "sc=min.ge.20:00"], ["0", "0:00", "sc=min.ge.0:00"]] },
];

const failures = [];
const rows = [];

async function runDevice(deviceName) {
  const device = deviceName === "android" ? devices["Pixel 7"] : devices["iPhone 13"];
  const browser = await chromium.launch({ executablePath: chromiumPath() });
  const ctx = await browser.newContext({ ...device, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  const wait = (ms) => page.waitForTimeout(ms);
  const query = () => decodeURIComponent(page.url().split("?")[1] ?? "").split("&");
  /** 表・グラフの中身（入力欄の外）の指紋 */
  const fingerprint = () => page.evaluate(() => {
    const main = document.querySelector("main") ?? document.body;
    return [...main.querySelectorAll("table, svg, .venn-export, .empty-message")].map((e) => e.textContent).join("|").length + ":" + (main.textContent ?? "").replace(/\s+/g, "").length;
  });

  async function open(f) {
    await page.goto(`${base}#${f.hash}`);
    await wait(2500);
    if (f.advanced || f.margin) {
      const b = page.locator(".filter-advanced-toggle").first();
      if ((await b.getAttribute("aria-expanded")) !== "true") await b.tap();
      await wait(400);
    }
    if (f.margin && !(await page.getByLabel(f.label).count())) {
      await page.getByRole("button", { name: /最終点差/ }).first().tap();
      await wait(400);
    }
    const loc = f.selector ? page.locator(f.selector).first() : page.getByLabel(f.label, { exact: true }).first();
    await loc.waitFor({ timeout: 10000 });
    return loc;
  }
  async function clear(loc) {
    await loc.tap();
    await loc.press("ControlOrMeta+a");
    await loc.press("Backspace");
    await wait(300);
  }
  async function typeKeys(text) {
    for (const ch of text) {
      await page.keyboard.type(ch);
      await wait(60);
    }
  }
  async function typeIme(text) {
    let acc = "";
    for (const ch of text) {
      acc += ch;
      await cdp.send("Input.imeSetComposition", { text: acc, selectionStart: acc.length, selectionEnd: acc.length });
      await wait(80);
    }
    await cdp.send("Input.insertText", { text: acc });
    await wait(150);
  }
  const check = (field, what, actual, expected) => {
    const ok = actual === expected;
    rows.push({ device: deviceName, field, what, actual, expected, ok });
    if (!ok) failures.push(`${deviceName} ${field} ${what}: 実際 ${JSON.stringify(actual)} 期待 ${JSON.stringify(expected)}`);
  };

  for (const f of FIELDS) {
    if (only && !f.name.includes(only)) continue;
    for (const [text, expect, param] of f.texts) {
      for (const mode of ["数字キー", "日本語（半角）", "日本語（全角）"]) {
        const what = `${mode}「${text}」`;
        try {
          const loc = await open(f);
          await clear(loc);
          await loc.press("Enter"); // 空で確定（ベン図は初期値に戻る）
          await wait(600);
          await clear(loc);
          const before = await fingerprint();
          const typed = mode === "日本語（全角）" ? full(text) : text;
          if (mode === "数字キー") await typeKeys(text);
          else await typeIme(typed);
          await wait(400);
          check(f.name, `${what} 入力中の表示`, await loc.inputValue(), typed);
          check(f.name, `${what} 入力中はURLを変えない`, query().includes(param), false);
          await loc.press("Enter");
          await wait(900);
          check(f.name, `${what} 確定後の表示`, await loc.inputValue(), expect);
          check(f.name, `${what} 確定後のURL`, query().includes(param), true);
          check(f.name, `${what} 確定で表・グラフが変わる`, (await fingerprint()) !== before, true);
          await clear(loc);
          check(f.name, `${what} 消せる`, await loc.inputValue(), "");
          await typeKeys("7");
          await loc.evaluate((el) => el.blur());
          await wait(700);
          check(f.name, `${what} 入れ直して離れると確定`, query().some((q) => q.endsWith(".7") || q.endsWith(".7:00") || q === "vta=7" || q === "fm=7-"), true);
        } catch (e) {
          check(f.name, what, `エラー ${String(e).slice(0, 120)}`, "エラーなし");
        }
      }
    }
  }

  // 「:」のボタン（プレータイム）: 20 → : → 15 → Enter で 20:15
  if (!only || "プレータイム".includes(only)) {
    try {
      const f = FIELDS[2];
      const loc = await open(f);
      await clear(loc);
      await typeKeys("20");
      await page.getByRole("button", { name: "コロン（:）を入力" }).first().tap();
      await wait(200);
      await typeKeys("15");
      check("プレータイム・「:」ボタン", "20 → : → 15 の表示", await loc.inputValue(), "20:15");
      await loc.press("Enter");
      await wait(800);
      check("プレータイム・「:」ボタン", "確定後のURL", query().includes("sc=min.ge.20:15"), true);
    } catch (e) {
      check("プレータイム・「:」ボタン", "操作", `エラー ${String(e).slice(0, 120)}`, "エラーなし");
    }
  }
  // 「−」のボタン（ベン図の負になりうる項目。チームの +/- 視点）
  if (!only || "ベン図".includes(only)) {
    try {
      await page.goto(`${base}#/figures?entity=team&figure=team-venn&season=2026-27&vbs=value`);
      await wait(2500);
      await page.locator(".venn-picker select").nth(1).selectOption("diff");
      await wait(600);
      const loc = page.locator(".venn-threshold").first();
      await clear(loc);
      await typeKeys("3");
      await page.locator(".venn-sign").first().tap();
      await wait(200);
      check("チームベン図・「−」ボタン", "3 → − の表示", await loc.inputValue(), "-3");
      await loc.press("Enter");
      await wait(800);
      check("チームベン図・「−」ボタン", "確定後のURL", query().includes("vta=-3"), true);
    } catch (e) {
      check("チームベン図・「−」ボタン", "操作", `エラー ${String(e).slice(0, 120)}`, "エラーなし");
    }
  }
  // 最終点差: 打ったあと欄の外を触って閉じても確定する
  if (!only || "最終点差".includes(only)) {
    try {
      const f = FIELDS[5];
      const loc = await open(f);
      await clear(loc);
      await typeKeys("12");
      await page.locator("h1").first().tap();
      await wait(800);
      check("最終点差・外を触って閉じる", "確定後のURL", query().includes("fm=12-"), true);
    } catch (e) {
      check("最終点差・外を触って閉じる", "操作", `エラー ${String(e).slice(0, 120)}`, "エラーなし");
    }
  }
  await browser.close();
}

for (const d of which === "both" ? ["iphone", "android"] : [which]) await runDevice(d);

const summary = new Map();
for (const r of rows) {
  const k = `${r.device}\t${r.field}`;
  const s = summary.get(k) ?? { ok: 0, ng: 0 };
  r.ok ? s.ok++ : s.ng++;
  summary.set(k, s);
}
for (const [k, s] of summary) console.log(`${s.ng === 0 ? "ok" : "NG"}\t${k}\t${s.ok}/${s.ok + s.ng}`);
if (failures.length) {
  console.error(failures.join("\n"));
  console.error(`${failures.length}件の食い違い`);
  process.exit(1);
}
console.log("すべて一致");
