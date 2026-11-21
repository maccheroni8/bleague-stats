// デプロイの直後、前の版を開いたままのタブでページを移ると、前の版のプログラムのファイルを探しに行って失敗する。
// そのときだけ、自動で1回だけページを読み込み直す（読み込み直せば新しい版のファイルを読むので直る。DESIGN.md 457章）。
// 何度も読み込み直し続けないよう、ブラウザ（sessionStorage）に読み込み直した印を残し、その印がある間は読み込み直さない。
// 画面・通信に依存しない判定だけをここに置き、実際の読み込み直しは呼ぶ側が渡す（検証のため）

/** 印を残すキー */
export const STALE_RELOAD_KEY = "bleague-stats:stale-reload-at";
/** 印が効く時間（この間は、続けて失敗しても読み込み直さない） */
export const STALE_RELOAD_WINDOW_MS = 10 * 60 * 1000;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 読み込み直してよいか。よいときは印を残して true。印が残せない（保存できない環境）・印が新しい（さっき読み込み直した）ときは false
 * （印が残せないのに読み込み直すと、失敗が続いたとき読み込み直しが止まらなくなるため）
 */
export function takeStaleReloadTurn(storage: StorageLike | null, now: number): boolean {
  if (!storage) return false;
  try {
    const last = Number(storage.getItem(STALE_RELOAD_KEY));
    if (Number.isFinite(last) && last > 0 && now - last >= 0 && now - last < STALE_RELOAD_WINDOW_MS) return false;
    storage.setItem(STALE_RELOAD_KEY, String(now));
    return storage.getItem(STALE_RELOAD_KEY) === String(now);
  } catch {
    return false;
  }
}

function sessionStorageOrNull(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** プログラムの読み込みの失敗か（ブラウザごとに文言が違う） */
export function isLoadFailureMessage(message: string): boolean {
  return /dynamically imported module|Importing a module script failed|error loading dynamically|Loading chunk|Unable to preload CSS/i.test(message);
}

/** 読み込みの失敗のとき、1回だけページを読み込み直す。読み込み直したとき true（呼ぶ側は、その後の処理を止めてよい） */
export function reloadOnceOnLoadFailure(reload: () => void = () => window.location.reload()): boolean {
  if (!takeStaleReloadTurn(sessionStorageOrNull(), Date.now())) return false;
  reload();
  return true;
}

/** サイト全体で、プログラムの読み込みの失敗を拾う。main.tsx から1回呼ぶ */
export function installStaleReload(): void {
  if (typeof window === "undefined") return;
  // Vite が、動的な読み込みの準備（ファイル・CSS の先読み）に失敗したときに出す
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    reloadOnceOnLoadFailure();
  });
  // ほかの動的な読み込み（ボタンを押したときに読むプログラムなど）の失敗
  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as { message?: unknown } | string | undefined;
    const message = typeof reason === "string" ? reason : typeof reason?.message === "string" ? reason.message : "";
    if (isLoadFailureMessage(message)) reloadOnceOnLoadFailure();
  });
}
