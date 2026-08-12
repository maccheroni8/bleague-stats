import html2canvas from "html2canvas";

export async function exportElementAsImage(el: HTMLElement, filename: string): Promise<void> {
  const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const canvas = await html2canvas(el, {
    backgroundColor: isDark ? "#15171a" : "#ffffff",
    scale: 2,
  });
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
}
