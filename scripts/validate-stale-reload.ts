// デプロイ直後の「前の版のファイルが無い」ときの自動の読み込み直しが、1回だけになっているかの検証（DESIGN.md 457章）
import { STALE_RELOAD_KEY, STALE_RELOAD_WINDOW_MS, isLoadFailureMessage, takeStaleReloadTurn } from "../src/lib/staleReload.ts";

let failures = 0;
const check = (ok: boolean, message: string) => {
  console.log(`${ok ? "ok" : "NG"} ${message}`);
  if (!ok) failures += 1;
};

function memoryStorage(): { getItem(k: string): string | null; setItem(k: string, v: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

const t0 = 1_700_000_000_000;
const st = memoryStorage();
check(takeStaleReloadTurn(st, t0) === true, "印が無いとき、1回目は読み込み直す");
check(st.data.get(STALE_RELOAD_KEY) === String(t0), "読み込み直すとき、印（時刻）を残す");
check(takeStaleReloadTurn(st, t0 + 1000) === false, "印があるとき（直後）は、続けて失敗しても読み込み直さない");
check(takeStaleReloadTurn(st, t0 + STALE_RELOAD_WINDOW_MS - 1) === false, "印の効く時間の終わりぎわも読み込み直さない");
check(takeStaleReloadTurn(st, t0 + STALE_RELOAD_WINDOW_MS) === true, "時間がたてば（次のデプロイなど）また1回読み込み直せる");
check(takeStaleReloadTurn(null, t0) === false, "保存できない環境では読み込み直さない（止まらなくなるのを防ぐ）");
const broken = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
check(takeStaleReloadTurn(broken, t0) === false, "保存がエラーになる環境でも読み込み直さない");
const silent = { getItem: () => null, setItem: () => {} };
check(takeStaleReloadTurn(silent, t0) === false, "印を書いても残らない環境では読み込み直さない");

for (const m of [
  "Failed to fetch dynamically imported module: https://x/assets/Page-abc.js",
  "error loading dynamically imported module",
  "Importing a module script failed.",
  "Unable to preload CSS for /assets/x.css",
]) check(isLoadFailureMessage(m), `読み込みの失敗の文言として拾う: ${m}`);
for (const m of ["Network request failed", "undefined is not an object", ""]) check(!isLoadFailureMessage(m), `ほかのエラーは拾わない: ${m || "（空）"}`);

if (failures > 0) {
  console.error(`${failures}件 NG`);
  process.exit(1);
}
console.log("全件 ok");
