import { lazy, type ComponentType } from "react";

/**
 * ページのプログラムを、そのページを開いたときに読む（DESIGN.md 356章）。
 *
 * 読み込みに失敗したとき（回線が一時的に切れた・新しい版の公開で古いファイルが消えた）は、1回だけ少し待って読み直し、
 * それでも失敗したらエラーにする（ページの場所に PageErrorBoundary の「ページを読み込み直す」が出る）。
 * 公開し直したあとの古いファイルの404は、ページを読み込み直せば新しい版のファイルを読むので直る
 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  return lazy(async () => {
    try {
      return { default: await load() };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return { default: await load() };
    }
  });
}
