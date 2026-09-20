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
