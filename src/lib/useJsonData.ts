import { useEffect, useState } from "react";

interface UseJsonDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface UseJsonDataOptions {
  /**
   * true のとき、条件（deps）が変わった直後は前の条件の結果を返さず、読み込み中（data=null・loading=true）にする。
   * 選手・リーグ・シーズンなど「この組み合わせの結果だけを使いたい」読み込みで使う
   */
  discardStale?: boolean;
}

/** 結果を取得したときの条件（deps）が、今の条件と同じか */
export function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
}

/** fetcher()が返すPromiseの結果をロード状態付きで扱う共通フック。depsが変わるたびに再取得する */
export function useJsonData<T>(fetcher: () => Promise<T>, deps: unknown[], options?: UseJsonDataOptions): UseJsonDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [dataDeps, setDataDeps] = useState<unknown[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setDataDeps(deps);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  if (options?.discardStale && !(dataDeps && sameDeps(dataDeps, deps))) {
    // 今の条件の結果がまだ無い（前の条件の結果が残っている・読み込み前）。エラーも前の条件のものは出さない
    return { data: null, loading: error === null, error };
  }
  return { data, loading, error };
}
