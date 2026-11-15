// 試合の保存画像: 画面の SVG を 2160×2700 の画像ファイルにする。
// PNG で 5MB を超えるときだけ、画質を保った JPEG（品質 0.95）にする。
import { teamLogoUrl } from "../data";

export const GAME_IMAGE_WIDTH = 2160;
export const GAME_IMAGE_HEIGHT = 2700;
export const GAME_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

/** ロゴを画像の中に埋め込める形（data URL）で読む。読めなければ undefined（ロゴなしで描く） */
export async function loadLogoDataUrl(teamId: string): Promise<string | undefined> {
  try {
    const res = await fetch(teamLogoUrl(teamId));
    if (!res.ok) return undefined;
    const blob = await res.blob();
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : undefined);
      reader.onerror = () => resolve(undefined);
      reader.readAsDataURL(blob);
    });
  } catch {
    return undefined;
  }
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("画像にできませんでした"))), type, quality));
}

export interface RenderedGameImage {
  blob: Blob;
  ext: "png" | "jpg";
}

export async function renderGameImage(svg: SVGSVGElement): Promise<RenderedGameImage> {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(GAME_IMAGE_WIDTH));
  clone.setAttribute("height", String(GAME_IMAGE_HEIGHT));
  const source = new XMLSerializer().serializeToString(clone);
  const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("画像を読み込めませんでした"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = GAME_IMAGE_WIDTH;
    canvas.height = GAME_IMAGE_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("画像を描けませんでした");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await canvasBlob(canvas, "image/png");
    if (png.size <= GAME_IMAGE_MAX_BYTES) return { blob: png, ext: "png" };
    return { blob: await canvasBlob(canvas, "image/jpeg", 0.95), ext: "jpg" };
  } finally {
    URL.revokeObjectURL(url);
  }
}
