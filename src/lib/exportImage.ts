import html2canvas from "html2canvas";
import { baseDateFooterText, exportFilenameWithOptions, type ExportOptions } from "./exportFormat";

export { baseDateFooterText, exportFilenameWithOptions };
export type { ExportOptions };

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

/**
 * 画像出力の対象を canvas に描く。複製側のルートに .export-rendering を付けるので、保存する画像の中でだけ
 * 文字を大きくする等のスタイルを index.css に書ける（画面の表示は変わらない）
 */
export async function renderExportCanvas(el: HTMLElement, options: ExportOptions = {}, scale = EXPORT_SCALE): Promise<HTMLCanvasElement> {
  return html2canvas(el, {
    // 背景は常に白。画面がダークでも保存画像はライト（配色の変数も複製側だけライトに固定する。下の onclone）
    backgroundColor: EXPORT_BACKGROUND,
    scale,
    onclone: (doc, clonedEl) => {
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
    },
  });
}

export async function exportElementAsImage(el: HTMLElement, filename: string, options: ExportOptions = {}): Promise<void> {
  const canvas = await renderExportCanvas(el, options);
  // 倍率を上げると data URL が大きくなるため、Blob の URL で保存する
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilenameWithOptions(filename, options);
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
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
