// 画像保存の調べるための記録（DESIGN.md 243章）。URL に debug=export があるときだけ記録し、画面の下に出す（ふだんの利用者には見えない）。
// iPhone で「出力中...」のあと、エラーも「写真に保存」も出ずにボタンが戻る件の原因を、実機で確かめるためのもの。
// ページが読み込み直されても（タブがメモリ不足で落ちて再読み込みされた等）前の記録が残るよう、localStorage にも書く

const STORAGE_KEY = "bleague-stats:export-debug-log";
const MAX_LINES = 300;

const FLAG_KEY = "bleague-stats:export-debug";

/**
 * 記録するか。URL（? のあとか、# のあとの ? のあと）に debug=export があれば、そのタブでは以後ずっと記録する
 * （ページの中を移動して URL から debug が消えても、タブが読み込み直されても続ける。debug=off で止める）
 */
export function exportDebugEnabled(): boolean {
  if (typeof window === "undefined") return false;
  const { search, hash } = window.location;
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  const values = [search, hashQuery].flatMap((q) => new URLSearchParams(q).getAll("debug"));
  try {
    if (values.includes("export")) window.sessionStorage.setItem(FLAG_KEY, "1");
    else if (values.includes("off")) window.sessionStorage.removeItem(FLAG_KEY);
    return window.sessionStorage.getItem(FLAG_KEY) === "1";
  } catch {
    return values.includes("export");
  }
}

/**
 * 試し方（URL の exp=…。debug=export のときだけ効く。DESIGN.md 244・247章）。原因の切り分けに使った ignore・nowide・noimg・nofonts・forceload・eager は外し、
 * keepimg＝写真・ロゴを写し取りのあとで戻す形（245章）を使わず、前の形（<img> のまま写し取る）にする、だけを残す
 * （iOS が変わって 245章の形が要らなくなったか・また止まるかを、実機で確かめるため）
 */
export const EXPORT_EXPERIMENTS = ["keepimg"] as const;
export type ExportExperiment = (typeof EXPORT_EXPERIMENTS)[number];

export function exportExperiments(): ReadonlySet<ExportExperiment> {
  if (!exportDebugEnabled()) return new Set();
  const { search, hash } = window.location;
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?")) : "";
  const values = [search, hashQuery]
    .flatMap((q) => new URLSearchParams(q).getAll("exp"))
    .flatMap((v) => v.split(","))
    .map((v) => v.trim());
  return new Set(EXPORT_EXPERIMENTS.filter((e) => values.includes(e)));
}

let lines: string[] | null = null;
const listeners = new Set<() => void>();
/** 今の保存を押した時刻（performance.now()。経過時間の起点） */
let startedAt: number | null = null;

function load(): string[] {
  if (lines) return lines;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    lines = saved ? (JSON.parse(saved) as string[]) : [];
  } catch {
    lines = [];
  }
  return lines;
}

function save(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(lines ?? []));
  } catch {
    // 保存できなくても画面の記録は続ける
  }
}

function clock(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** 記録に1行足す（debug=export のときだけ）。保存の途中なら、押した時刻からの経過ミリ秒を付ける */
export function exportDebug(message: string): void {
  if (!exportDebugEnabled()) return;
  const elapsed = startedAt === null ? "" : ` +${Math.round(performance.now() - startedAt)}ms`;
  // 画面の表示（useSyncExternalStore）が変化に気づくよう、配列は作り直す
  lines = [...load(), `${clock()}${elapsed} ${message}`].slice(-MAX_LINES);
  save();
  for (const l of [...listeners]) l();
}

/**
 * 保存を押したとき（経過時間の起点）。画像を作る処理（kind="export"）は、終わりの記録（exportDebugEnd）が無いまま次の読み込みになったら、
 * 途中で止まったと分かる。「写真に保存」（kind="share"）は、iOS では結果が返らないことがあるので、その判定には使わない
 */
export function exportDebugStart(message: string, kind: "export" | "share" = "export"): void {
  if (!exportDebugEnabled()) return;
  startedAt = performance.now();
  exportDebug(`${kind === "export" ? "■ 開始" : "▶ 共有"}: ${message}`);
}

export function exportDebugEnd(reason: string, kind: "export" | "share" = "export"): void {
  if (!exportDebugEnabled()) return;
  exportDebug(`${kind === "export" ? "■ 終了" : "▶ 共有の終わり"}: ${reason}`);
  startedAt = null;
}

const EMPTY: readonly string[] = [];

export function exportDebugLines(): readonly string[] {
  return exportDebugEnabled() ? load() : EMPTY;
}

export function clearExportDebugLog(): void {
  lines = [];
  save();
  for (const l of [...listeners]) l();
}

export function subscribeExportDebugLog(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** エラーを1行にする（種類・文） */
export function describeError(e: unknown): string {
  if (e instanceof Error) return `${e.name}: ${e.message}`;
  return `${typeof e}: ${String(e)}`;
}

let installed = false;

/**
 * ページを開いたときに1回だけ: 前の記録が「開始」のまま終わっていないかを見て、ページの読み込みの種類（再読み込みか）を記録する。
 * あわせて、保存の途中に起きたページの非表示・エラー・html2canvas のログ（console.debug）も記録に入れる
 */
export function installExportDebug(): void {
  if (installed || !exportDebugEnabled()) return;
  installed = true;
  const all = load();
  const lastStart = all.map((l) => l.includes("■ 開始")).lastIndexOf(true);
  const lastEnd = all.map((l) => l.includes("■ 終了")).lastIndexOf(true);
  const nav = performance.getEntriesByType?.("navigation")[0] as PerformanceNavigationTiming | undefined;
  exportDebug(`● ページを読み込んだ（読み込みの種類: ${nav?.type ?? "不明"}・画面幅 ${window.innerWidth}px・倍率 ${window.devicePixelRatio}）`);
  if (lastStart > lastEnd) {
    exportDebug("● 注意: 前回の保存は「終了」の記録が無いまま、ページが読み込み直された（タブの再読み込み・メモリ不足で落ちた等の可能性）");
  }
  window.addEventListener("pagehide", () => {
    if (startedAt !== null) exportDebug("● ページが隠された／閉じられた（pagehide）");
  });
  document.addEventListener("visibilitychange", () => {
    if (startedAt !== null) exportDebug(`● 表示の状態: ${document.visibilityState}`);
  });
  window.addEventListener("error", (e) => {
    if (startedAt !== null) exportDebug(`● 画面のエラー: ${e.message}`);
  });
  window.addEventListener("unhandledrejection", (e) => {
    if (startedAt !== null) exportDebug(`● 処理されなかった失敗: ${describeError(e.reason)}`);
  });
  // html2canvas は進み具合を console.debug に出す（「#1 120ms Starting renderer ...」）。保存の途中だけ記録に写す（画像の読み込み1件ごとの行は省く）
  const original = console.debug.bind(console);
  console.debug = (...args: unknown[]) => {
    original(...args);
    const text = args.map(String).join(" ");
    if (startedAt !== null && /^#\d+ \d+ms/.test(text) && !/Added image/.test(text)) exportDebug(`html2canvas ${text}`);
  };
}
