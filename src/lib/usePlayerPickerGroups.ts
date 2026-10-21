// 比較ページの選手の一覧（チームごとの並び。DESIGN.md 281章）に要るデータの読み込みと、並べ替えの組み立て。
import { useMemo } from "react";
import type { PlayerGameIndexFile } from "../../shared/gameIndex";
import type { PlayerSummary, PlayoffRaceFile, StandingsSnapshot } from "../../shared/types";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchPlayoffRace, fetchStandingsHistory } from "./data";
import { loadPlayerGameIndex } from "./gameIndexLoad";
import { buildPlayerPickerGroups, pickerTeamOrder, type PickerGroup } from "./playerPickerOrder";
import { useSeasonKeyedData } from "./useSeasonKeyedData";

/** useSeasonKeyedData は配列を返す取得関数を取るので、1件（または無し）の配列にして渡す */
const fetchRaceList = (season: string) => fetchPlayoffRace(season).then((r): PlayoffRaceFile[] => (r ? [r] : []));
const fetchIndexList = (season: string) => loadPlayerGameIndex(season).then((v): PlayerGameIndexFile[] => (v ? [v.file] : []));

export interface PickerSources {
  standingsBySeason: Map<string, StandingsSnapshot[] | null> | null;
  raceBySeason: Map<string, PlayoffRaceFile[] | null> | null;
  indexBySeason: Map<string, PlayerGameIndexFile[] | null> | null;
  loading: boolean;
}

/** 選手の一覧を並べるのに要るデータ（順位表・日程の地区割り・出場時間の索引）を、使うシーズン分読む */
export function usePickerSources(seasons: string[]): PickerSources {
  const a = useSeasonKeyedData(seasons, fetchStandingsHistory);
  const b = useSeasonKeyedData(seasons, fetchRaceList);
  const c = useSeasonKeyedData(seasons, fetchIndexList);
  return { standingsBySeason: a.dataBySeason, raceBySeason: b.dataBySeason, indexBySeason: c.dataBySeason, loading: a.loading || b.loading || c.loading };
}

/** 1スロット分の、チームごとにまとめた選手の一覧 */
export function usePlayerPickerGroups(
  season: string,
  gameType: SeasonGameTypeFilter,
  players: PlayerSummary[] | null,
  sources: PickerSources,
): PickerGroup[] {
  const standings = sources.standingsBySeason?.get(season) ?? null;
  const race = sources.raceBySeason?.get(season)?.[0] ?? null;
  const index = sources.indexBySeason?.get(season)?.[0] ?? null;
  return useMemo(() => {
    if (!players) return [];
    const latest = standings && standings.length > 0 ? standings[standings.length - 1]!.teams : null;
    const indexNames = new Map((index?.teams ?? []).map((t) => [t[0], t[1]]));
    const standingNames = new Map((latest ?? []).map((t) => [t.teamId, t.teamName]));
    return buildPlayerPickerGroups({
      players,
      index,
      gameType,
      teamOrder: pickerTeamOrder(latest, race),
      teamNameOf: (id) => indexNames.get(id) ?? standingNames.get(id),
    });
  }, [players, standings, race, index, gameType]);
}
