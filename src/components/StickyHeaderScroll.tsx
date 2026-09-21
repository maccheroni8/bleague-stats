import { useEffect, useRef, type ReactNode } from "react";

/**
 * 縦に長く横にも広い表のための包み。ページ全体のスクロールで見出し行を画面上端に追随させつつ、横スクロールも保つ。
 *
 * CSSだけでは両立できない: `overflow-x: auto` を付けた要素は仕様上 overflow-y も auto になり、`position: sticky` の基準が
 * ページではなくその要素になる（従来は max-height＋内部スクロールで対処していた）。そのため次の2つをJSで補う。
 * 1. 見出し行の複製を `position: fixed; top: 0` で出し、横スクロール量（scrollLeft）を本体と同期させる。
 *    表が画面上端をまたいでいる間だけ表示する。列幅は本体の見出しセルの実測値をそのまま当てる
 * 2. 表が縦に長いと横スクロールバーが表の一番下にしか出ないため、本体の横スクロールバーは隠し、代わりに
 *    `position: sticky; bottom: 0` のスクロールバー（本体と同期）を表の直下に置いて、表が見えている間は画面下端に貼り付ける
 *
 * children は <table>（thead付き）1つを想定する。表の中身が変わっても（タブ切り替え等）MutationObserverで追随する
 */
export function StickyHeaderScroll({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const cloneRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const scroll = scrollRef.current;
    const clone = cloneRef.current;
    const bar = barRef.current;
    const spacer = spacerRef.current;
    if (!scroll || !clone || !bar || !spacer) return;

    let frame = 0;
    let lastSignature = "";
    let syncingFromBar = false;
    let syncingFromScroll = false;
    const cloneTable = document.createElement("table");
    clone.appendChild(cloneTable);

    const update = () => {
      frame = 0;
      const table = scroll.querySelector("table");
      const thead = table?.querySelector("thead");
      if (!table || !thead) {
        clone.style.display = "none";
        bar.style.display = "none";
        return;
      }
      const tableWidth = table.getBoundingClientRect().width;
      spacer.style.width = `${tableWidth}px`;
      bar.style.display = tableWidth > scroll.clientWidth + 1 ? "block" : "none";

      const rect = scroll.getBoundingClientRect();
      const headHeight = thead.getBoundingClientRect().height;
      // 本体の見出し行が画面上端より上に出ていて、表の末尾がまだ見出し1行分以上残っている間だけ複製を出す
      const show = rect.top < 0 && rect.bottom > headHeight;
      if (!show) {
        clone.style.display = "none";
        return;
      }
      clone.style.display = "block";
      clone.style.left = `${rect.left}px`;
      clone.style.width = `${scroll.clientWidth}px`;

      const cells = [...thead.querySelectorAll("tr:first-child th")];
      const widths = cells.map((c) => c.getBoundingClientRect().width);
      const signature = `${table.className}|${thead.textContent}|${widths.join(",")}`;
      if (signature !== lastSignature) {
        lastSignature = signature;
        cloneTable.className = table.className;
        cloneTable.style.width = `${tableWidth}px`;
        cloneTable.style.tableLayout = "fixed";
        cloneTable.replaceChildren(thead.cloneNode(true));
        [...cloneTable.querySelectorAll("tr:first-child th")].forEach((c, i) => {
          const w = `${widths[i] ?? 0}px`;
          (c as HTMLElement).style.width = w;
          (c as HTMLElement).style.minWidth = w;
          (c as HTMLElement).style.maxWidth = w;
        });
      }
      clone.scrollLeft = scroll.scrollLeft;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    const onScroll = () => {
      if (!syncingFromBar) {
        syncingFromScroll = true;
        bar.scrollLeft = scroll.scrollLeft;
        syncingFromScroll = false;
      }
      clone.scrollLeft = scroll.scrollLeft;
    };
    const onBarScroll = () => {
      if (syncingFromScroll) return;
      syncingFromBar = true;
      scroll.scrollLeft = bar.scrollLeft;
      syncingFromBar = false;
    };

    scroll.addEventListener("scroll", onScroll, { passive: true });
    bar.addEventListener("scroll", onBarScroll, { passive: true });
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const resizeObserver = new ResizeObserver(schedule);
    resizeObserver.observe(scroll);
    const table = scroll.querySelector("table");
    if (table) resizeObserver.observe(table);
    const mutationObserver = new MutationObserver(schedule);
    mutationObserver.observe(scroll, { childList: true, subtree: true, characterData: true });
    schedule();

    return () => {
      if (frame) cancelAnimationFrame(frame);
      scroll.removeEventListener("scroll", onScroll);
      bar.removeEventListener("scroll", onBarScroll);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      cloneTable.remove();
    };
  }, []);

  return (
    <div className="sticky-header-scroll">
      <div className="table-scroll sticky-header-scroll-body" ref={scrollRef}>
        {children}
      </div>
      <div className="sticky-header-scroll-bar" ref={barRef} aria-hidden="true">
        <div ref={spacerRef} className="sticky-header-scroll-spacer" />
      </div>
      <div className="sticky-header-scroll-clone table-scroll" ref={cloneRef} aria-hidden="true" />
    </div>
  );
}
