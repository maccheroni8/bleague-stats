import { useEffect, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { matchesAtViewportWidth } from "./exportFormat";

/**
 * 画像保存の間だけ、画面幅を固定の値として扱う（DESIGN.md 241章）。null のときは実際の画面幅。
 * スマホ幅（560px以下）で保存しても、チーム名の略称・選手の名字・比較の並びなどを「広い画面」の表記で描くためのもの
 */
let forcedViewportWidth: number | null = null;
const forcedListeners = new Set<() => void>();

function subscribeForcedWidth(listener: () => void): () => void {
  forcedListeners.add(listener);
  return () => forcedListeners.delete(listener);
}

function getForcedWidth(): number | null {
  return forcedViewportWidth;
}

function setForcedViewportWidth(width: number | null): void {
  forcedViewportWidth = width;
  for (const listener of [...forcedListeners]) listener();
}

/**
 * 画面幅を `width` として扱った状態で `run` を実行する（`run` の前後で、画面は同期で描き直す）。
 * `run` の中で画面のDOMを複製すれば、複製側は広い画面の表記になる。`run` の実行が終わったらすぐ元の画面幅に戻す
 * （`run` が返した Promise の完了は待たない。html2canvas は呼んだ時点で画面のDOMを複製し終えるので、その後は戻してよい。
 *  描き直しと戻しは同じ処理の中で終わるので、画面には一度も描かれない）。
 */
export function withForcedViewportWidth<T>(width: number, run: () => T): T {
  flushSync(() => setForcedViewportWidth(width));
  try {
    return run();
  } finally {
    flushSync(() => setForcedViewportWidth(null));
  }
}

/** CSSのメディアクエリに一致しているかを返す（画面幅の変化にも追従する）。SSRは無いのでwindow前提 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  const forced = useSyncExternalStore(subscribeForcedWidth, getForcedWidth);
  if (forced !== null) {
    const atForced = matchesAtViewportWidth(query, forced);
    if (atForced !== null) return atForced;
  }
  return matches;
}
