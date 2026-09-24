import html2canvas from "html2canvas";
import { todayBaseDateLabel } from "./age";

/** 画像の右下に入れるアカウント名 */
export const EXPORT_ACCOUNT_NAME = "@dthiro1208";

/**
 * 画像出力の共通処理。保存する画像の下端に、左下＝保存日（「2026/09/20 現在」形式）・右下＝アカウント名の
 * フッターを付ける。フッターは html2canvas が作る複製側にだけ追加するので、画面上の表示・DOMは変わらず、
 * 画像出力の対象（.export-target）を使う全ページに1か所で反映される。ConditionTitle（表の直上のタイトル）とは別物
 */
export async function exportElementAsImage(el: HTMLElement, filename: string): Promise<void> {
  // 背景色は「今画面に適用されている配色」の --bg から取る。OSの prefers-color-scheme で決めると、
  // OSがダークでサイトを手動でライトにしている（逆も）ときに、背景と文字の配色が食い違って読めなくなる
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const savedDateLabel = todayBaseDateLabel();
  const canvas = await html2canvas(el, {
    backgroundColor: bg || "#ffffff",
    scale: 2,
    onclone: (doc, clonedEl) => {
      convertModernColors(clonedEl);
      const footer = doc.createElement("div");
      footer.className = "export-footer";
      const date = doc.createElement("span");
      date.textContent = savedDateLabel;
      const account = doc.createElement("span");
      account.textContent = EXPORT_ACCOUNT_NAME;
      footer.append(date, account);
      clonedEl.appendChild(footer);
    },
  });
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
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
