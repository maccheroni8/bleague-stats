// レギュラーシーズンの全試合が終わったシーズンか（チーム詳細「クラブレコード」のシーズン記録のワースト側の対象）。
// 9月の区切り（season.ts の currentSeason）ではなく、日程の残り試合で判断する。中止の試合は schedule.json の
// cancelledGames にあり、upcomingGames には入らないので、残り試合に数えない。
import { useEffect, useState } from "react";
import type { GameSummary } from "../../shared/types";
import type { ScheduleFileExtended } from "../../shared/resultOnlyGames";
import { fetchGameSummaries, fetchSchedule } from "./data";
import { pendingUpcomingGames } from "./pendingUpcoming";

/**
 * 中止の試合が多く、クラブごとのレギュラーシーズンの試合数がそろわないシーズン（2019-20 は途中で打ち切り。
 * 勝敗表の地区優勝の印を付けないシーズンと同じ）。最少勝利数・最多敗戦数の「数」の記録の対象から外す
 */
export const SHORTENED_REGULAR_SEASONS: readonly string[] = ["2019-20", "2020-21", "2021-22"];

/**
 * 次のどちらかなら、レギュラーシーズンの全試合が終わっている（試合数では判断しない。中止のまま消える試合があるため）。
 * - 開催予定の試合（記録・結果だけの試合を除く）が残っておらず、レギュラーシーズンの試合がすべて終了している
 * - ポストシーズンの試合がある（開催予定には大会の区分が無く、ポストシーズンの試合が載ると上の判定が通らないため）
 */
export function isRegularSeasonComplete(input: {
  schedule: ScheduleFileExtended;
  summaries: readonly GameSummary[];
}): boolean {
  const { schedule, summaries } = input;
  const regular = summaries.filter((g) => g.gameType === "regular");
  if (regular.length === 0) return false;
  if (summaries.some((g) => g.gameType === "playoff")) return true;
  const resultOnlyKeys = new Set((schedule.resultOnlyGames ?? []).map((g) => g.scheduleKey));
  const pending = pendingUpcomingGames(schedule.upcomingGames, summaries).filter((g) => !resultOnlyKeys.has(g.scheduleKey));
  return pending.length === 0 && regular.every((g) => g.gameEndedFlg);
}

/** 日程で確かめるシーズンの数（新しい方から）。それより古いシーズンは、後のシーズンがあるので終わっている */
const CHECKED_LATEST_SEASONS = 2;

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
