// シーズンごとの、結果だけの試合（ボックススコアが公式に無い試合・不戦勝。DESIGN.md 228章）の一覧。
// チーム詳細「クラブレコード」の連勝・連敗（全シーズン）に、結果だけの試合を足すために使う。集計のコードから読まれない場所（保存キーの対象外）に置く。
import { useEffect, useState } from "react";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";
import { fetchSchedule, type League } from "./data";

/** seasons の日程から結果だけの試合を読む。読み込み中・enabled=false は null。読めなかったシーズンは空として扱う */
export function useResultOnlyBySeason(seasons: readonly string[] | null, enabled: boolean, league: League = "premier"): Map<string, ResultOnlyGameEntry[]> | null {
  const key = seasons ? [...seasons].sort().join(",") : "";
  const [state, setState] = useState<{ key: string; bySeason: Map<string, ResultOnlyGameEntry[]> } | null>(null);
  useEffect(() => {
    if (!enabled || !key) return;
    let cancelled = false;
    Promise.all(
      key.split(",").map(async (season) => {
        try {
          return [season, (await fetchSchedule(season, league)).resultOnlyGames ?? []] as const;
        } catch {
          return [season, [] as ResultOnlyGameEntry[]] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) setState({ key, bySeason: new Map(entries) });
    });
    return () => {
      cancelled = true;
    };
  }, [key, enabled, league]);
  return state && state.key === key ? state.bySeason : null;
}
