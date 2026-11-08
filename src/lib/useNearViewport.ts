import { useCallback, useEffect, useState } from "react";

/**
 * 目印の要素が画面に近づいた（rootMargin の範囲に入った）か、すでに画面より上へ通り過ぎたら true になる（一度 true になったら戻さない）。
 * 画面の下のほうの欄が使うデータを、その欄に近づいたときに読み始めるために使う。
 * 一気に下までスクロールして目印を通り過ぎたときも true になる（通り過ぎたときの通知で、要素が画面の上にあることを見る）。
 * IntersectionObserver が無い環境では、目印が出た時点で true にする（読み込みを止めない）。
 * 戻り値の ref を目印の要素に付ける
 */
export function useNearViewport(rootMargin = "800px 0px", settleMs = 600): [(el: Element | null) => void, boolean] {
  const [target, setTarget] = useState<Element | null>(null);
  const [near, setNear] = useState(false);
  const ref = useCallback((el: Element | null) => setTarget(el), []);

  useEffect(() => {
    if (near || !target) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    // 画面の読み込み中は、上の表がまだ出来ていなくて目印が一時的に画面の近くに来ることがある。近づいた状態が少し続いたときだけ true にする
    let nearNow = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[entries.length - 1];
        if (!entry) return;
        const rootTop = entry.rootBounds?.top ?? 0;
        nearNow = entry.isIntersecting || entry.boundingClientRect.top < rootTop;
        if (nearNow && timer === null) {
          timer = setTimeout(() => {
            timer = null;
            if (nearNow) setNear(true);
          }, settleMs);
        }
      },
      { rootMargin },
    );
    observer.observe(target);
    return () => {
      observer.disconnect();
      if (timer !== null) clearTimeout(timer);
    };
  }, [target, near, rootMargin, settleMs]);

  return [ref, near];
}
