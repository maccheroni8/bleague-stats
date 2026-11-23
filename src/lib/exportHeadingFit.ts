// 保存画像の見出し・条件の行（サブタイトル）を、複製側で字の大きさを調整して収める（設計書473章）。
// 条件の行は必ず1行。見出しは、折り返せない単位（文節）が行の幅を超えるときだけ字を小さくする。画面は変えない。

function shrinkUntilFits(el: HTMLElement, minPx: number, fits: (e: HTMLElement) => boolean): void {
  const view = el.ownerDocument.defaultView;
  if (!view) return;
  let size = parseFloat(view.getComputedStyle(el).fontSize);
  if (!Number.isFinite(size)) return;
  let guard = 0;
  while (!fits(el) && size > minPx && guard++ < 60) {
    size -= 0.5;
    el.style.fontSize = `${size}px`;
  }
}

export function fitHeadingIn(root: HTMLElement): void {
  // 条件の行（保存画像で出ているものだけ）: 1行に収める
  root.querySelectorAll<HTMLElement>(".condition-title-conditions:not(.export-hide)").forEach((p) => {
    p.style.whiteSpace = "nowrap";
    shrinkUntilFits(p, 9, (e) => e.scrollWidth <= e.clientWidth + 0.5);
  });
  // 見出し: 折り返せない単位が幅を超えるときだけ小さくする
  root.querySelectorAll<HTMLElement>(".export-heading h2").forEach((h) => {
    const over = (e: HTMLElement) => Array.from(e.querySelectorAll<HTMLElement>(".title-nowrap")).every((s) => s.offsetWidth <= e.clientWidth + 0.5);
    shrinkUntilFits(h, 16, over);
  });
}
