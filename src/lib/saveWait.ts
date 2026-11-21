// 保存の直前に画面のタブ・表を切り替えたあと、その表が描き終わるのを待つ（チーム詳細の保存。DESIGN.md 463章）。
// 目印（data-save-key が選んだ表のものになった）と、読み込み中の表示（.loading）が無いこと、中身がしばらく変わらないこと（順位が入り終わった）を見る。
// 画面・通信に依存しない（DOM を読むだけ）

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** getEl() が返す枠の中に、data-save-key が key の要素が現れ、読み込み中の表示が無く、中身が落ち着くまで待つ。時間内に終わらなければ例外 */
export async function waitForSaveRender(getEl: () => HTMLElement | null, key: string, timeoutMs = 40000): Promise<void> {
  const started = Date.now();
  let last = -1;
  let stable = 0;
  while (Date.now() - started < timeoutMs) {
    const el = getEl();
    const marked = el?.matches(`[data-save-key="${key}"]`) || !!el?.querySelector(`[data-save-key="${key}"]`);
    if (el && marked && !el.querySelector(".loading")) {
      const size = el.innerHTML.length;
      stable = size === last ? stable + 1 : 0;
      last = size;
      if (stable >= 3) return;
    } else {
      last = -1;
      stable = 0;
    }
    await sleep(300);
  }
  throw new Error("表の表示が終わらなかったため、保存を止めました");
}
