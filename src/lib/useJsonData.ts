import { useEffect, useState } from "react";

interface UseJsonDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** fetcher()が返すPromiseの結果をロード状態付きで扱う共通フック。depsが変わるたびに再取得する */
export function useJsonData<T>(fetcher: () => Promise<T>, deps: unknown[]): UseJsonDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetcher()
      .then((result) => {
        if (!cancelled) setData(result);
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

  return { data, loading, error };
}
