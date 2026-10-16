import html2canvas from "html2canvas";
import {
  baseDateFooterText,
  exportFilenameWithOptions,
  ExportImageError,
  EXPORT_PHASE_LABELS,
  EXPORT_TIMEOUT_MS,
  fitExportScale,
  IOS_CANVAS_MAX_AREA,
  IOS_CANVAS_MAX_SIDE,
  runWithinDeadline,
  type ExportDeadline,
  type ExportOptions,
  type ExportPhase,
} from "./exportFormat";
import { exportDebug, exportDebugEnabled, exportExperiments, type ExportExperiment } from "./exportDebugLog";
import { NARROW_QUERY } from "./teamLabel";
import { withForcedViewportWidth } from "./useMediaQuery";

export { baseDateFooterText, exportFilenameWithOptions };
export type { ExportOptions };
export { ExportImageError, exportErrorMessage } from "./exportFormat";

/** 画像の右下に入れるアカウント名 */
export const EXPORT_ACCOUNT_NAME = "@dthiro1208";

/**
 * 画像出力の共通処理（保存画像の「共通の型」。DESIGN.md 239章）。保存する画像は、画面の表示設定（ライト/ダーク・画面幅）に関わらず、
 * 白い背景・上端のブレックスの紺の帯・中央揃えの見出し・上下左右32pxの余白・下端のフッター
 * （左＝データの基準日、右＝アカウント名。保存した日は出さない）にそろえる。
 * 帯・余白・白い背景は index.css の `.export-rendering` が、フッターのアカウント名はここで html2canvas が作る複製側にだけ足す
 * （画面上の表示・DOMは変わらない。見出しの揃え・表の行・比較の列見出しなどの「型」は画面と共有する `.export-wide`。DESIGN.md 240章）
 */

/** 保存する画像の描画の倍率。画面の1pxを何ピクセルで描くか（DESIGN.md 170章） */
export const EXPORT_SCALE = 3;

/** 保存する画像の背景色（サイトの表示設定に依存しない画像専用の指定） */
export const EXPORT_BACKGROUND = "#ffffff";

/** スマホ幅から保存するとき、複製側（html2canvas の iframe）の画面幅として使う値。PCの画面幅（1280px）で見たときと同じ画像にする（DESIGN.md 241章） */
export const EXPORT_WINDOW_WIDTH = 1280;

/** 保存の描画の環境（画面の幅・端末の種類で決まる。検証のために引数で差し替えられる） */
export interface ExportEnvironment {
  /** 画面がスマホ幅（560px以下）で、表記・CSSを広い画面にして描く必要があるか */
  forceWide: boolean;
  /** canvas の面積の上限（無ければ null） */
  maxArea: number | null;
  /** canvas の1辺の上限（無ければ null） */
  maxSide: number | null;
}

/** iPhone・iPad か（iPadOS の Safari は「Macintosh」を名乗るので、タッチ対応の Mac も含める） */
export function isIOSDevice(): boolean {
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

export function detectExportEnvironment(): ExportEnvironment {
  const ios = isIOSDevice();
  return {
    forceWide: window.matchMedia(NARROW_QUERY).matches,
    maxArea: ios ? IOS_CANVAS_MAX_AREA : null,
    maxSide: ios ? IOS_CANVAS_MAX_SIDE : null,
  };
}

/** 描いた結果の情報（解像度を下げたかどうかを画面に出すため） */
export interface ExportRenderInfo {
  /** 求めた倍率（EXPORT_SCALE） */
  requestedScale: number;
  /** 実際に描いた倍率 */
  scale: number;
  /** 画像の寸法（ピクセル） */
  width: number;
  height: number;
}

type Html2CanvasOptions = NonNullable<Parameters<typeof html2canvas>[1]>;

/**
 * 画像出力の対象を canvas に描く。複製側のルートに .export-rendering を付けるので、保存する画像の中でだけ
 * 文字を大きくする等のスタイルを index.css に書ける（画面の表示は変わらない）。
 *
 * スマホ幅の画面からでも、PC幅で見たときと同じ画像にする（DESIGN.md 241章）: ①`useMediaQuery` を「広い画面」にした状態で画面のDOMを複製する
 * （html2canvas は呼んだ時点で複製し終えるので、複製したらすぐ元に戻す。画面には一度も描かれない。選んだ並べ替え・開閉などの状態は画面のDOMのまま引き継がれる）、
 * ②複製側の画面幅（windowWidth）を 1280px にして、CSSの @media もPC幅で評価させる。
 * iPhone・iPad では、描く前に複製側の寸法を測り、canvas の上限を超えるなら倍率を下げる。
 * deadline を渡すと、段階（複製・描画）を伝え、時間の上限を超えたあとは描き直しに進まない（DESIGN.md 242章）
 */
export async function renderExportCanvas(
  el: HTMLElement,
  options: ExportOptions = {},
  scale = EXPORT_SCALE,
  env: ExportEnvironment = detectExportEnvironment(),
  deadline?: ExportDeadline,
): Promise<{ canvas: HTMLCanvasElement; info: ExportRenderInfo }> {
  let requested = scale;
  // 原因を絞るための試し方（debug=export のときの exp=…。ふだんは空で、動きは変わらない。DESIGN.md 244章）
  const exp = exportExperiments();
  const forceWide = env.forceWide && !exp.has("nowide");
  const ignoreElements = exp.has("ignore") || exp.has("noimg") ? (node: Element) => ignoredByExperiment(node, el, exp) : undefined;
  // 測った寸法から倍率を決めても、描いた結果が上限を超えていたら（測ったあとに寸法が変わったとき）、一度だけ下げて描き直す
  for (let attempt = 0; ; attempt += 1) {
    deadline?.checkpoint();
    deadline?.setPhase("clone");
    exportDebug(
      `html2canvas を呼ぶ（${attempt + 1}回目・倍率 ${requested}・広い画面で描く ${forceWide ? "はい（1280px）" : "いいえ"}・試し方 ${exp.size > 0 ? [...exp].join(", ") : "なし"}）`,
    );
    let cloned = false;
    const html2canvasOptions: Html2CanvasOptions = {
      // 背景は常に白。画面がダークでも保存画像はライト（配色の変数も複製側だけライトに固定する。下の onclone）
      backgroundColor: EXPORT_BACKGROUND,
      scale: requested,
      ...(forceWide ? { windowWidth: EXPORT_WINDOW_WIDTH } : {}),
      ...(ignoreElements ? { ignoreElements } : {}),
      onclone: (doc, clonedEl) => {
        // ここまでで複製（写真・ロゴの読み込み待ちを含む）が終わり、このあとは canvas に描く
        cloned = true;
        deadline?.setPhase("draw");
        if (exportDebugEnabled()) {
          const images = Array.from(doc.images);
          exportDebug(`複製ができた（写し取った要素 ${doc.getElementsByTagName("*").length}・画像 ${images.length}・読み込み中の画像 ${images.filter((i) => !i.complete).length}）`);
        }
        prepareClone(doc, clonedEl, options);
        // 複製側の寸法（画面幅1280pxで組まれた結果）から倍率を決める。html2canvas は onclone のあとに倍率を読む
        const rect = clonedEl.getBoundingClientRect();
        html2canvasOptions.scale = fitExportScale(Math.ceil(rect.width), Math.ceil(rect.height), requested, env);
        exportDebug(`複製の寸法 ${Math.ceil(rect.width)}×${Math.ceil(rect.height)}px → 倍率 ${html2canvasOptions.scale}（canvas 約 ${Math.floor(rect.width * html2canvasOptions.scale)}×${Math.floor(rect.height * html2canvasOptions.scale)}）`);
      },
    };
    const render = () => {
      const before = html2canvasContainers();
      const promise = html2canvas(el, html2canvasOptions);
      // html2canvas は呼んだその場で iframe を作って表を写し取り終え、そのあと iframe の読み込み完了・フォント・画像を待つ。
      // 記録（debug=export）のときは、その待ちの様子を2秒ごとに見る。試し方（nofonts・forceload）もここで iframe に効かせる
      for (const frame of document.querySelectorAll<HTMLIFrameElement>(HTML2CANVAS_CONTAINER_SELECTOR)) {
        if (!before.has(frame)) watchCloneFrame(frame, exp, () => cloned);
      }
      return promise;
    };
    const canvas = await (forceWide ? withForcedViewportWidth(EXPORT_WINDOW_WIDTH, render) : render());
    const drawn = html2canvasOptions.scale ?? requested;
    exportDebug(`描いた canvas ${canvas.width}×${canvas.height}（面積 ${canvas.width * canvas.height}・倍率 ${drawn}）`);
    const overArea = env.maxArea !== null && canvas.width * canvas.height > env.maxArea;
    const overSide = env.maxSide !== null && Math.max(canvas.width, canvas.height) > env.maxSide;
    if ((overArea || overSide) && attempt === 0) {
      requested = fitExportScale(canvas.width / drawn, canvas.height / drawn, drawn, env);
      if (requested < drawn) continue;
    }
    return { canvas, info: { requestedScale: scale, scale: drawn, width: canvas.width, height: canvas.height } };
  }
}

/**
 * 試し方 ignore・noimg（DESIGN.md 244章）: 写し取らない要素か。ignore＝保存する表とその祖先・子孫、<head> の中以外は写し取らない。
 * noimg＝画像（<img>）を写し取らない（画像の読み込みを待たずに描けるかの確認。画像の無い画像になる）
 */
function ignoredByExperiment(node: Element, target: HTMLElement, exp: ReadonlySet<ExportExperiment>): boolean {
  if (exp.has("noimg") && node.tagName === "IMG") return true;
  if (exp.has("ignore")) {
    if (node.ownerDocument.head?.contains(node)) return false;
    return !(node.contains(target) || target.contains(node));
  }
  return false;
}

/**
 * html2canvas が作った iframe（写し取った側）の待ちの様子を、記録（debug=export）に2秒ごとに出す。iframe の読み込み完了（load）が来たか、
 * 文書の readyState、フォントの読み込み、画像の数と読み込み中の数（3つまで名前）。写し取りが終わる（onclone）か iframe が外されたら止める。
 * 試し方 nofonts は写し取った側の document.fonts.ready を待たないようにし、forceload は1秒たっても load が来なければ来たことにする
 */
function watchCloneFrame(frame: HTMLIFrameElement, exp: ReadonlySet<ExportExperiment>, done: () => boolean): void {
  const doc = frame.contentDocument;
  if (exp.has("nofonts") && doc?.fonts) {
    try {
      Object.defineProperty(doc.fonts, "ready", { configurable: true, get: () => Promise.resolve(doc.fonts) });
      exportDebug("試し方 nofonts: 写し取った側のフォントの読み込みを待たない");
    } catch (e) {
      exportDebug(`試し方 nofonts を効かせられない: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (exp.has("forceload")) {
    setTimeout(() => {
      if (done() || !frame.isConnected) return;
      const onload = frame.onload;
      if (typeof onload === "function") {
        exportDebug("試し方 forceload: 1秒たっても iframe の load が来ないので、来たことにする");
        onload.call(frame, new Event("load"));
      } else {
        exportDebug("試し方 forceload: load は来ている（何もしない）");
      }
    }, 1000);
  }
  if (!exportDebugEnabled()) return;
  const started = performance.now();
  const probe = () => {
    if (done() || !frame.isConnected) return;
    const d = frame.contentDocument;
    const images = d ? Array.from(d.images) : [];
    const pending = images.filter((i) => !i.complete);
    const names = pending.slice(0, 3).map((i) => `${(i.currentSrc || i.src).split("/").slice(-2).join("/")}（${i.loading || "-"}）`);
    exportDebug(
      `写し取った側の様子（${Math.round((performance.now() - started) / 1000)}秒）: load ${typeof frame.onload === "function" ? "まだ" : "済み"}・readyState ${d?.readyState ?? "なし"}・` +
        `フォント ${d?.fonts?.status ?? "不明"}・要素 ${d?.getElementsByTagName("*").length ?? 0}・画像 ${images.length}・読み込み中 ${pending.length}${names.length > 0 ? `（${names.join("、")}）` : ""}`,
    );
    setTimeout(probe, 2000);
  };
  setTimeout(probe, 2000);
}

/** 複製側（html2canvas の iframe の中）を、保存画像の型にする */
function prepareClone(doc: Document, clonedEl: HTMLElement, options: ExportOptions): void {
  // 色の変数（--bg・--fg 等）を複製側だけライトにする（OSのダーク設定・手動のダーク切り替えのどちらでも）
  doc.documentElement.setAttribute("data-theme", "light");
  // 画面と同じ部品を、PC表記の型（.export-wide）で描く。上端の帯・余白・アカウント名・白い背景・注記の要点は .export-rendering の側
  clonedEl.classList.add("export-rendering", "export-wide");
  if (options.plain) clonedEl.classList.add("export-plain");
  if (options.top10) clonedEl.classList.add("export-top10");
  convertModernColors(clonedEl);
  // フッターは画面の表の下に出している要素（ExportTarget）をそのまま使い、アカウント名だけを足す。基準日は保存のときに求めた値
  let footer = Array.from(clonedEl.children).find((c): c is HTMLElement => c.classList.contains("export-footer"));
  if (!footer) {
    footer = doc.createElement("div");
    footer.className = "export-footer";
    clonedEl.appendChild(footer);
  }
  let date = footer.querySelector<HTMLElement>(".export-footer-date");
  if (!date) {
    date = doc.createElement("span");
    date.className = "export-footer-date";
    footer.prepend(date);
  }
  date.textContent = baseDateFooterText(options.baseDate);
  const account = doc.createElement("span");
  account.className = "export-footer-account";
  account.textContent = EXPORT_ACCOUNT_NAME;
  footer.append(account);
}

/** 画像にして、保存（共有・ダウンロード）に渡せる形にしたもの */
export interface PreparedExportImage {
  file: File;
  info: ExportRenderInfo;
}

/** 解像度を下げて描いたか（iPhone・iPad で canvas の上限に収めたとき） */
export function exportScaleReduced(info: ExportRenderInfo): boolean {
  return info.scale < info.requestedScale;
}

/** html2canvas が複製のために画面に足す iframe（描き終えると html2canvas が外す。途中で止まったり失敗したりすると残る） */
const HTML2CANVAS_CONTAINER_SELECTOR = "iframe.html2canvas-container";

function html2canvasContainers(): Set<Element> {
  return new Set(document.querySelectorAll(HTML2CANVAS_CONTAINER_SELECTOR));
}

/**
 * 画像（PNGの File）を作る。ボタンを押してから画像ファイルができるまで（基準日の取得・複製・描画・PNG化）に時間の上限（30秒）を設け、
 * 超えたとき・途中で失敗したときは、どの段階かを持った ExportImageError を投げる（画面にそのまま出す。DESIGN.md 242章）。
 * そのとき、この保存で html2canvas が画面に足した iframe が残っていれば外す
 */
export async function prepareExportImage(
  el: HTMLElement,
  filename: string,
  {
    options = {},
    resolveBaseDate,
    timeoutMs = EXPORT_TIMEOUT_MS,
    env = detectExportEnvironment(),
    onPhase,
  }: {
    options?: ExportOptions;
    /** データの基準日を求める（上限の時間に含める）。無ければ options.baseDate のまま */
    resolveBaseDate?: () => Promise<string | undefined>;
    timeoutMs?: number;
    env?: ExportEnvironment;
    /** 段階が進んだとき（ボタンの文字を段階ごとに変えるため。DESIGN.md 243章） */
    onPhase?: (phase: ExportPhase) => void;
  } = {},
): Promise<PreparedExportImage> {
  const before = html2canvasContainers();
  try {
    return await runWithinDeadline(async (raw) => {
      // 段階の切り替えを、ボタンの文字と調べるための記録にも伝える
      let current: ExportPhase = "baseDate";
      const deadline: ExportDeadline = {
        checkpoint: raw.checkpoint,
        setPhase: (phase) => {
          raw.setPhase(phase);
          if (phase === current) return;
          exportDebug(`段階: ${EXPORT_PHASE_LABELS[current]} 終わり → ${EXPORT_PHASE_LABELS[phase]} 開始`);
          current = phase;
          onPhase?.(phase);
        },
      };
      exportDebug(`段階: ${EXPORT_PHASE_LABELS.baseDate} 開始`);
      onPhase?.("baseDate");
      const resolved = resolveBaseDate ? { ...options, baseDate: await resolveBaseDate() } : options;
      deadline.checkpoint();
      const { canvas, info } = await renderExportCanvas(el, resolved, EXPORT_SCALE, env, deadline);
      deadline.checkpoint();
      deadline.setPhase("file");
      // 倍率を上げると data URL が大きくなるため、Blob で扱う。canvas が大きすぎて描けなかったとき（iOS）などは null が返る
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      deadline.checkpoint();
      exportDebug(blob ? `画像ファイル ${blob.size} バイト（${EXPORT_PHASE_LABELS.file} 終わり）` : "toBlob の結果が空（null）");
      if (!blob) throw new ExportImageError("file", "failed", timeoutMs);
      const file = new File([blob], exportFilenameWithOptions(filename, resolved), { type: "image/png" });
      return { file, info };
    }, timeoutMs);
  } catch (e) {
    let removed = 0;
    for (const iframe of document.querySelectorAll(HTML2CANVAS_CONTAINER_SELECTOR)) {
      if (!before.has(iframe)) {
        iframe.remove();
        removed += 1;
      }
    }
    if (removed > 0) exportDebug(`残った html2canvas の iframe を ${removed} 個外した`);
    throw e;
  }
}

/** ファイルとしてダウンロードする（パソコン・Android。共有シートが使えない端末の既定） */
export function downloadExportImage(file: File): void {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  exportDebug(`ダウンロードを始める（${file.name}・${file.size} バイト）`);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * 共有シート（navigator.share）でファイルを渡せるか。iPhone・iPad だけ（共有シートの「画像を保存」で写真に入れられる）。
 * パソコンや Android は、今までどおりダウンロード
 */
export function canShareExportImage(file: File): boolean {
  const ios = isIOSDevice();
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (!ios) {
    exportDebug("共有シートの判定: iPhone・iPad ではない → 使わない");
    return false;
  }
  const hasShare = typeof nav.share === "function";
  const hasCanShare = typeof nav.canShare === "function";
  let can = false;
  try {
    can = hasShare && hasCanShare && nav.canShare!({ files: [file] });
  } catch (e) {
    exportDebug(`canShare が失敗: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`);
  }
  exportDebug(`共有シートの判定: iPhone・iPad／share ${hasShare ? "あり" : "なし"}／canShare ${hasCanShare ? "あり" : "なし"}／ファイルを渡せる ${can ? "はい" : "いいえ"}`);
  return can;
}

/** 共有シートの結果。shared＝渡した／cancelled＝閉じた／blocked＝ボタンを押した直後でないため開けない（もう一度押してもらう）／failed＝使えない */
export type ShareResult = "shared" | "cancelled" | "blocked" | "failed";

/**
 * 共有シートを開く。iPhone・iPad では「写真に保存」を押した処理の中で、await を挟まずに呼ぶ（押した直後でないと開けない。
 * この関数は呼んだその場で navigator.share を呼ぶ）。iOS では結果が返らないことがあるので、呼ぶ側は結果を待つ間に画面を止めない（DESIGN.md 242章）
 */
export async function shareExportImage(file: File): Promise<ShareResult> {
  try {
    exportDebug(`navigator.share を呼ぶ（${file.size} バイト）`);
    await navigator.share({ files: [file] });
    exportDebug("navigator.share の結果: 成功");
    return "shared";
  } catch (e) {
    const name = e instanceof DOMException ? e.name : "";
    exportDebug(`navigator.share の結果: 失敗（${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}）`);
    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError") return "blocked";
    return "failed";
  }
}

/**
 * html2canvas は color-mix() の計算結果（Chrome では "color(srgb 0.1 0.13 0.21)" 形式）を読めず、画像出力ごと失敗する
 * （比較の表の良い方の値の塗り等。DESIGN.md 134-4）。複製側の要素だけ、その形式の色を rgb() に直して インライン指定する
 */
const COLOR_PROPS = ["background-color", "color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color"] as const;

function srgbToRgb(value: string): string | null {
  const m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(value.trim());
  if (!m) return null;
  const [r, g, b] = [m[1], m[2], m[3]].map((v) => Math.round(Number(v) * 255));
  return m[4] !== undefined ? `rgba(${r}, ${g}, ${b}, ${m[4]})` : `rgb(${r}, ${g}, ${b})`;
}

function convertModernColors(root: HTMLElement): void {
  const view = root.ownerDocument.defaultView;
  if (!view) return;
  for (const el of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    const style = view.getComputedStyle(el);
    for (const prop of COLOR_PROPS) {
      const value = style.getPropertyValue(prop);
      if (!value.startsWith("color(")) continue;
      const rgb = srgbToRgb(value);
      if (rgb) el.style.setProperty(prop, rgb);
    }
  }
}
