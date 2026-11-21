import { lazy, type ComponentType } from "react";
import { reloadOnceOnLoadFailure } from "./staleReload";

/**
 * ページのプログラムを、そのページを開いたときに読む（DESIGN.md 356章）。
 *
 * 読み込みに失敗したとき（回線が一時的に切れた・新しい版の公開で古いファイルが消えた）は、1回だけ少し待って読み直し、
 * それでも失敗したら、ブラウザに印を残して1回だけページを自動で読み込み直す（公開し直したあとの古いファイルの404は、読み込み直せば新しい版のファイルを読むので直る。
 * `staleReload.ts`・DESIGN.md 457章）。印があるとき（さっき読み込み直した）はエラーにする（ページの場所に PageErrorBoundary の「ページを読み込み直す」が出る）
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        return { default: await load() };
      } catch (error) {
        // 読み込み直したら、このページはもう作り直される。読み込み直しが終わるまで、エラーにせず待つ
        if (reloadOnceOnLoadFailure()) return new Promise<never>(() => {});
        throw error;
      }
    }
  });
}
