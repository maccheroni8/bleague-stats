// レギュラーシーズンの全試合が終わったシーズンか（チーム詳細「クラブレコード」のシーズン記録のワースト側の対象）。判定そのものは shared/regularSeasonComplete.ts
import { useEffect, useState } from "react";
import { CHECKED_LATEST_SEASONS, isRegularSeasonComplete } from "../../shared/regularSeasonComplete";
import { fetchGameSummaries, fetchSchedule } from "./data";

export { CHECKED_LATEST_SEASONS, SHORTENED_REGULAR_SEASONS, isRegularSeasonComplete } from "../../shared/regularSeasonComplete";

/**
 * seasons（古い順・新しい順どちらでもよい）のうち、レギュラーシーズンの全試合が終わったシーズン。
 * 新しい2シーズンだけ日程・試合の一覧を読んで確かめる。読み込み中・enabled=false は null。読めなかったシーズンは終わっていない扱い
 */
export function useCompletedRegularSeasons(seasons: readonly string[] | null, enabled: boolean): Set<string> | null {
  const key = seasons ? [...seasons].sort().join(",") : "";
  const [state, setState] = useState<{ key: string; completed: Set<string> } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    const sorted = key.split(",");
    const checked = sorted.slice(-CHECKED_LATEST_SEASONS);
    const older = sorted.slice(0, -CHECKED_LATEST_SEASONS);
    Promise.all(
      checked.map(async (season) => {
        try {
          const [schedule, summaries] = await Promise.all([fetchSchedule(season), fetchGameSummaries(season)]);
          return isRegularSeasonComplete({ schedule, summaries }) ? season : null;
        } catch {
          return null;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setState({ key, completed: new Set([...older, ...results.filter((s): s is string => s !== null)]) });
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled]);
  return state && state.key === key ? state.completed : null;
}
