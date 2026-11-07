import { useJsonData } from "./useJsonData";

/** 複数シーズン分のteams.json/players.jsonをまとめて取得する。1シーズンの取得失敗が他シーズンに波及しないようallSettledを使う */
export function useSeasonKeyedData<T>(
  seasonsNeeded: string[],
  fetcher: (season: string) => Promise<T[]>,
  /** 取得の条件が変わる印（リーグなど）。変わったら読み直す（前の条件の結果は返さない） */
  scopeKey = "",
): { dataBySeason: Map<string, T[] | null> | null; loading: boolean } {
  const key = `${scopeKey}|${Array.from(new Set(seasonsNeeded)).sort().join(",")}`;
  const { data, loading } = useJsonData(async () => {
    const uniqueSeasons = Array.from(new Set(seasonsNeeded));
    const settled = await Promise.allSettled(uniqueSeasons.map((s) => fetcher(s)));
    const map = new Map<string, T[] | null>();
    uniqueSeasons.forEach((s, i) => {
      const r = settled[i]!;
      map.set(s, r.status === "fulfilled" ? r.value : null);
    });
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key], { discardStale: true });
  return { dataBySeason: data, loading };
}
