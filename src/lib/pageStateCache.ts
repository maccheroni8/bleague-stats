import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * 個人詳細ページ・チーム詳細ページ等、タブやフィルタの数が多いページで、ブラウザバック
 * （他ページへ遷移→ブラウザバックで戻る）によりコンポーネントが一度アンマウント・
 * 再マウントされても、直前に設定していたフィルタ条件を復元するための仕組み。
 *
 * react-router（HashRouter）は、同じルート（例: /players/:playerId）内で
 * playerIdだけが変わる遷移ではコンポーネントをアンマウントしない（既存のuseEffect依存
 * 配列によるリセットパターンで対応済み）が、別ルートを経由してブラウザバックで戻ってくる
 * 場合は新しいコンポーネントインスタンスとしてマウントされ、useStateの初期値に戻って
 * しまう。この問題を解消するため、タブを開いている間（セッション中）だけ有効な
 * モジュールスコープのメモリキャッシュを持ち、同じkeyでの再マウント時に直前の値を復元する。
 *
 * リロードやタブを閉じると消える（sessionStorage等への永続化はしない）。フィルタ項目数が
 * 多く、全てをURLクエリパラメータにするとURLが煩雑になりすぎるため、この方式を採用した。
 */
const pageStateCache = new Map<string, unknown>();

function readCache<T>(key: string, initialValue: T | (() => T)): T {
  if (pageStateCache.has(key)) return pageStateCache.get(key) as T;
  return typeof initialValue === "function" ? (initialValue as () => T)() : initialValue;
}

/**
 * useStateと同じ使い勝手のフック。keyごとにモジュールスコープのキャッシュへ値を書き戻し、
 * 同じkeyで別のコンポーネントインスタンスがマウントされた際はその値を初期値として復元する。
 *
 * 注意: keyが変わっても（例: 選手ページを別の選手に切り替えた場合）このフック自体は
 * 状態をリセットしない（useStateの初期値引数は初回マウント時にしか評価されないため）。
 * 「keyの元になる値（playerId等）が変わったら既定値にリセットする」という既存の挙動は、
 * 呼び出し側が持つ既存のuseEffect（[playerId]依存等）にそのまま任せる設計。このフックは
 * あくまで「同じkeyで再マウントされた時に直前の値を復元する」役割のみを担う
 */
export function usePageState<T>(key: string, initialValue: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const [state, setState] = useState<T>(() => readCache(key, initialValue));

  useEffect(() => {
    pageStateCache.set(key, state);
  }, [key, state]);

  return [state, setState];
}

/**
 * 「keyが変わったら既定値にリセットする」既存のuseEffectパターン（[playerId]依存等）が、
 * コンポーネントの初回マウント時にも必ず1回発火してしまい、usePageStateで復元した直後の
 * 値を上書きしてしまう問題への対処。呼び出し側は対象のeffectと同じ依存値（例: playerId）を
 * 渡し、返された関数をeffect内で呼ぶ。
 *
 * 「初回実行かどうか」ではなく「直前に実際にリセットを行った時のkeyと今回のkeyが同じか」で
 * 判定する（単純な「1回目はtrue」フラグだと、React 18 StrictMode（開発モード）がeffectを
 * マウント直後にもう1回余分に実行する挙動により、2回目の実行時にフラグが既にfalseになって
 * いて誤ってリセットが発火してしまう。詳細は同ファイルの利用箇所コメント参照）。
 * key比較方式なら、StrictModeの二重実行（同じkeyで2回呼ばれる）は正しくスキップし、
 * 実際にkeyが変わった時（例: 別の選手ページへの遷移）だけリセットを実行させられる
 */
export function useSkipFirstEffectRun<T>(key: T): () => boolean {
  const lastKeyRef = useRef(key);
  return () => {
    if (lastKeyRef.current === key) return true;
    lastKeyRef.current = key;
    return false;
  };
}
