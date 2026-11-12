import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * 順位推移・勝ち星推移・貯金推移の「アニメーション再生」の時計（設計書378章）。
 *
 * 再生の進み具合は1つの値 progress（日付の番号。小数で、1.5 は2日目と3日目のちょうど間）だけで表す。
 * ラインの先端もロゴも、毎フレームこの同じ値から位置を計算するので、ずれない。
 * 進み具合は React の状態にしない（毎フレーム画面全体を描き直さないため）。グラフは subscribe で値を受け取り、
 * 自分の要素だけを直接動かす。
 */
export interface TrendPlayback {
  /** いまの進み具合（日付の番号。小数） */
  getProgress(): number;
  /** 毎フレーム呼ばれる関数を登録する。戻り値を呼ぶと登録を外す */
  subscribe(listener: (progress: number) => void): () => void;
}

/** 1日分を進めるのにかける時間（ミリ秒）。全体の再生時間＝（日数−1）×この値 */
export const TREND_STEP_MS = 180;

/**
 * @param length 再生する日数（standings-history の件数）
 * @param resetKey 変わったら再生を止める鍵（シーズン・リーグ）
 */
export function useTrendPlayback(length: number, resetKey: string) {
  const [isAnimating, setIsAnimating] = useState(false);
  const store = useRef({ progress: 0, raf: 0, listeners: new Set<(progress: number) => void>() }).current;
  const lengthRef = useRef(length);
  lengthRef.current = length;

  const playback = useMemo<TrendPlayback>(
    () => ({
      getProgress: () => store.progress,
      subscribe: (listener) => {
        store.listeners.add(listener);
        return () => {
          store.listeners.delete(listener);
        };
      },
    }),
    [store],
  );

  const stop = useCallback(() => {
    if (store.raf) cancelAnimationFrame(store.raf);
    store.raf = 0;
    setIsAnimating(false);
  }, [store]);

  // シーズン・リーグが変わったとき、ページを離れたときは止める
  useEffect(() => stop, [resetKey, stop]);

  const play = useCallback(() => {
    const last = lengthRef.current - 1;
    if (last < 1) return;
    if (store.raf) cancelAnimationFrame(store.raf);
    store.progress = 0;
    setIsAnimating(true);
    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      // 経過時間から決める（描画が1フレーム遅れても、全体の再生時間は変わらない）
      const progress = Math.min((now - startedAt) / TREND_STEP_MS, last);
      store.progress = progress;
      store.listeners.forEach((listener) => listener(progress));
      if (progress >= last) {
        stop();
        return;
      }
      store.raf = requestAnimationFrame(tick);
    };
    store.raf = requestAnimationFrame(tick);
  }, [store, stop]);

  return { isAnimating, play, playback };
}
