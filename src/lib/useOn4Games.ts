// on4 が可能だった試合の読み込みの状態（進み具合つき）。enabled のときだけ、試合の元ファイルを読む（DESIGN.md 352章）。
import { useCallback, useEffect, useMemo, useState } from "react";
import type { League } from "./league";
import { loadOn4Games, type On4Result } from "./on4Games";

export interface On4State {
  result: On4Result | null;
  loading: boolean;
  error: string | null;
  progress: { done: number; total: number } | null;
  retry: () => void;
}

export function useOn4Games(season: string, league: League, scheduleKeys: readonly string[] | null, enabled: boolean): On4State {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<{ key: string; result: On4Result } | null>(null);
  const [failed, setFailed] = useState<{ key: string; message: string } | null>(null);
  const [progress, setProgress] = useState<{ key: string; done: number; total: number } | null>(null);
  const keysId = useMemo(() => (scheduleKeys ? `${scheduleKeys.length}:${[...scheduleKeys].sort().join(",")}` : ""), [scheduleKeys]);
  const id = `${season}|${league}|${keysId}|${attempt}`;
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    if (!enabled || !scheduleKeys || scheduleKeys.length === 0) return;
    const controller = new AbortController();
    loadOn4Games(season, league, scheduleKeys, (done, total) => !controller.signal.aborted && setProgress({ key: id, done, total }), controller.signal).then(
      (result) => !controller.signal.aborted && setLoaded({ key: id, result }),
      (e: unknown) => {
        if (controller.signal.aborted) return;
        setFailed({ key: id, message: e instanceof Error ? e.message : String(e) });
      },
    );
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, id, league]);
  const result = loaded?.key === id ? loaded.result : null;
  const error = failed?.key === id ? failed.message : null;
  const p = progress?.key === id ? progress : null;
  return {
    result,
    loading: enabled && !!scheduleKeys && scheduleKeys.length > 0 && !result && !error,
    error,
    progress: p ? { done: p.done, total: p.total } : null,
    retry,
  };
}
