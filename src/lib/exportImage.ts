import { fitNamesIn } from "./nameLayout";
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
import { exportDebug, exportDebugEnabled, exportExperiments } from "./exportDebugLog";
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
  // 試し方（debug=export のときの exp=…。ふだんは空で、動きは変わらない。244・247章。残しているのは keepimg だけ）
  const exp = exportExperiments();
  const forceWide = env.forceWide;
  // 写真・ロゴ（<img>）は写し取らず、写し取ったあとで同じ位置に戻す（245章。iPhone では写し取った iframe の中の <img> が
  // 読み込み完了（load）を引き止め、html2canvas が先へ進まなかった）。試し方 keepimg のときは前の形（<img> のまま写し取る）
  const detachImages = !exp.has("keepimg");
  const ignoreElements = (node: Element) => detachImages && node.tagName === "IMG";
  const isCloned = (node: Node) =>
    node.nodeType !== Node.ELEMENT_NODE ||
    !((node as Element).tagName === "SCRIPT" || (node as Element).hasAttribute("data-html2canvas-ignore") || ignoreElements(node as Element));
  // 測った寸法から倍率を決めても、描いた結果が上限を超えていたら（測ったあとに寸法が変わったとき）、一度だけ下げて描き直す
  for (let attempt = 0; ; attempt += 1) {
    deadline?.checkpoint();
    deadline?.setPhase("clone");
    exportDebug(
      `html2canvas を呼ぶ（${attempt + 1}回目・倍率 ${requested}・広い画面で描く ${forceWide ? "はい（1280px）" : "いいえ"}・試し方 ${exp.size > 0 ? [...exp].join(", ") : "なし"}）`,
    );
    let cloned = false;
    let slots: ImageSlot[] = [];
    const html2canvasOptions: Html2CanvasOptions = {
      // 背景は常に白。画面がダークでも保存画像はライト（配色の変数も複製側だけライトに固定する。下の onclone）
      backgroundColor: EXPORT_BACKGROUND,
      scale: requested,
      ...(forceWide ? { windowWidth: EXPORT_WINDOW_WIDTH } : {}),
      ignoreElements,
      onclone: (doc, clonedEl) => {
        // ここまでで複製（写真・ロゴの読み込み待ちを含む）が終わり、このあとは canvas に描く
        cloned = true;
        deadline?.setPhase("draw");
        if (exportDebugEnabled()) {
          const images = Array.from(doc.images);
          exportDebug(`複製ができた（写し取った要素 ${doc.getElementsByTagName("*").length}・画像 ${images.length}・読み込み中の画像 ${images.filter((i) => !i.complete).length}）`);
        }
        if (detachImages) restoreImageSlots(doc, clonedEl, slots);
        prepareClone(doc, clonedEl, options);
        // 複製側の寸法（画面幅1280pxで組まれた結果）から倍率を決める。html2canvas は onclone のあとに倍率を読む
        const rect = clonedEl.getBoundingClientRect();
        html2canvasOptions.scale = fitExportScale(Math.ceil(rect.width), Math.ceil(rect.height), requested, env);
        exportDebug(`複製の寸法 ${Math.ceil(rect.width)}×${Math.ceil(rect.height)}px → 倍率 ${html2canvasOptions.scale}（canvas 約 ${Math.floor(rect.width * html2canvasOptions.scale)}×${Math.floor(rect.height * html2canvasOptions.scale)}）`);
      },
    };
    const render = () => {
      const before = html2canvasContainers();
      // 写し取る直前（広い画面に描き直したあと）の、表の中の <img> の位置を覚えておく
      slots = detachImages ? planImageSlots(el, isCloned) : [];
      const promise = html2canvas(el, html2canvasOptions);
      // html2canvas は呼んだその場で iframe を作って表を写し取り終え、そのあと iframe の読み込み完了・フォント・画像を待つ。
      // 記録（debug=export）のときは、その待ちの様子を2秒ごとに見る
      for (const frame of document.querySelectorAll<HTMLIFrameElement>(HTML2CANVAS_CONTAINER_SELECTOR)) {
        if (!before.has(frame)) watchCloneFrame(frame, () => cloned);
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

/** 写し取る前の表の中の <img> と、写し取った側での位置（html2canvas が写し取る子のうち何番目か、をたどる道筋） */
interface ImageSlot {
  img: HTMLImageElement;
  /** 保存する表の要素から <img> の親までの道筋（各段で「写し取られる子」のうち何番目か） */
  path: number[];
  /** 親の「写し取られる子」のうち、<img> の前にあるものの数（ここに戻す） */
  index: number;
}

const PSEUDO_TAG = "HTML2CANVASPSEUDOELEMENT";
const PSEUDO_BEFORE_CLASS = "___html2canvas___pseudoelement_before";

/**
 * 表の中の <img> の位置を覚える（245章）。html2canvas は子を順に写し取り、<script>・data-html2canvas-ignore・ignoreElements に当たる要素だけを外す
 * （文字や注記は写し取る）。同じ決まり（isCloned）で数えれば、写し取った側の同じ位置がたどれる
 */
function planImageSlots(el: HTMLElement, isCloned: (node: Node) => boolean): ImageSlot[] {
  const slots: ImageSlot[] = [];
  const indexAmongCloned = (node: Node): number => {
    let i = 0;
    for (let n = node.parentNode?.firstChild ?? null; n && n !== node; n = n.nextSibling) if (isCloned(n)) i += 1;
    return i;
  };
  for (const img of el.querySelectorAll("img")) {
    const path: number[] = [];
    let ok = true;
    for (let node: Node | null = img.parentNode; node && node !== el; node = node.parentNode) {
      if (!isCloned(node)) ok = false;
      path.unshift(indexAmongCloned(node));
    }
    if (ok && img.parentNode) slots.push({ img, path, index: indexAmongCloned(img) });
  }
  return slots;
}

/**
 * 写し取った側に、覚えておいた <img> を同じ位置へ戻す（onclone の中。245章）。戻す <img> は画面の <img> と同じ属性（loading を除く）で、
 * html2canvas が読む元の寸法（naturalWidth・naturalHeight）だけを、画面の読み込み済みの値で持たせる。html2canvas は絵を自分で読み込み直して
 * （画面の側で。上限15秒）描くので、描き方は前の形と同じで、写し取った iframe の中の読み込みを待たない（iPhone でも止まらない）
 */
function restoreImageSlots(doc: Document, clonedEl: HTMLElement, slots: readonly ImageSlot[]): void {
  const inserted = new Set<Node>();
  const clonedChildren = (node: Node): Node[] =>
    Array.from(node.childNodes).filter((n) => !inserted.has(n) && !(n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === PSEUDO_TAG));
  let restored = 0;
  let notLoaded = 0;
  let missing = 0;
  for (const slot of slots) {
    let parent: Node | undefined = clonedEl;
    for (const i of slot.path) parent = parent ? clonedChildren(parent)[i] : undefined;
    if (!parent) {
      missing += 1;
      continue;
    }
    const replacement = imageReplacement(doc, slot.img);
    restored += 1;
    if (!(slot.img.complete && slot.img.naturalWidth > 0)) notLoaded += 1;
    const list = clonedChildren(parent);
    let ref: Node | null;
    if (slot.index < list.length) {
      ref = list[slot.index]!;
    } else if (list.length > 0) {
      ref = list[list.length - 1]!.nextSibling;
      while (ref && inserted.has(ref)) ref = ref.nextSibling;
    } else {
      // 写し取られる子が無い: ::before の疑似要素の後、ほかに戻したものの後、::after の疑似要素の前
      ref = parent.firstChild;
      if (ref && parent instanceof Element && parent.classList.contains(PSEUDO_BEFORE_CLASS)) ref = ref.nextSibling;
      while (ref && inserted.has(ref)) ref = ref.nextSibling;
    }
    parent.insertBefore(replacement, ref);
    inserted.add(replacement);
  }
  exportDebug(`写真・ロゴを戻した: ${restored}（画面でまだ読み込めていないもの ${notLoaded}）・位置が見つからない ${missing}`);
}

function imageReplacement(doc: Document, img: HTMLImageElement): HTMLImageElement {
  const copy = doc.createElement("img");
  for (const attr of Array.from(img.attributes)) if (attr.name !== "loading" && attr.name !== "srcset" && attr.name !== "sizes") copy.setAttribute(attr.name, attr.value);
  // html2canvas は img.currentSrc || img.src を読み込み直して描く。src は画面で実際に使った URL（絶対 URL）にする
  if (img.currentSrc) copy.setAttribute("src", img.currentSrc);
  if (img.complete && img.naturalWidth > 0) {
    // 写し取った側の <img> はまだ読み込まれていない（naturalWidth が0）。html2canvas が読む元の寸法を、画面の値にする
    Object.defineProperty(copy, "naturalWidth", { configurable: true, value: img.naturalWidth });
    Object.defineProperty(copy, "naturalHeight", { configurable: true, value: img.naturalHeight });
  }
  return copy;
}

/**
 * html2canvas が作った iframe（写し取った側）の待ちの様子を、記録（debug=export）に2秒ごとに出す。iframe の読み込み完了（load）が来たか、
 * 文書の readyState、フォントの読み込み、画像の数と読み込み中の数（3つまで名前）。写し取りが終わる（onclone）か iframe が外されたら止める
 */
function watchCloneFrame(frame: HTMLIFrameElement, done: () => boolean): void {
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
    // 読み込み完了（load）を引き止めうるものの一覧（2秒目と、そのあと6秒ごと）。画像（complete・naturalWidth・loading）・<link>・埋め込み・SVG の画像と、
    // 写し取った側の Performance の resource の記録（読み込み終わったものだけが載る）
    const elapsed = Math.round((performance.now() - started) / 1000);
    if (d && typeof frame.onload === "function" && (elapsed <= 2 || elapsed % 6 === 0)) {
      const short = (url: string) => url.split("/").slice(-2).join("/").slice(0, 40);
      const imgs = images.map((i) => `${short(i.currentSrc || i.src)}[${i.complete ? "済" : "中"}・幅${i.naturalWidth}・${i.loading || "-"}]`);
      const links = Array.from(d.querySelectorAll("link")).map((l) => `${l.rel}:${short(l.href)}`);
      const others = Array.from(d.querySelectorAll("iframe,object,embed,video,audio,source,image,picture")).map((n) => n.tagName.toLowerCase());
      let resources = "不明";
      try {
        const entries = (frame.contentWindow?.performance.getEntriesByType("resource") ?? []) as PerformanceResourceTiming[];
        resources = `${entries.length}件（${entries.slice(-5).map((e) => `${e.initiatorType}:${short(e.name)}`).join("、")}）`;
      } catch (e) {
        resources = `読めない（${e instanceof Error ? e.message : String(e)}）`;
      }
      exportDebug(
        `写し取った側の内訳: 画像 ${imgs.slice(0, 8).join(" ")}${imgs.length > 8 ? ` ほか${imgs.length - 8}` : ""}／link ${links.join(" ") || "なし"}／` +
          `そのほか ${others.join(" ") || "なし"}／resource ${resources}`,
      );
    }
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
  fitNamesIn(clonedEl);
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
    resolveBaseDate: baseDateResolver,
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
      const resolved = baseDateResolver ? { ...options, baseDate: await baseDateResolver() } : options;
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
