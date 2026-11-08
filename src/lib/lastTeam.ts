import { useCallback } from "react";
import { useActivePlayerIds } from "./activePlayers";
import { isLastTeamRow } from "./lastTeamRule";
import { currentSeason } from "./season";

export { LAST_TEAM_PREFIX, isLastTeamRow } from "./lastTeamRule";

/** 通算など複数シーズンをまたぐ表（allTime）で、行ごとに「最終所属」かどうかを返す関数を作る。シーズンの表では常に false */
export function useLastTeamCheck(allTime: boolean): (lastSeason: string, playerIds: readonly string[]) => boolean {
  const { ids } = useActivePlayerIds(allTime);
  return useCallback((lastSeason, playerIds) => (allTime ? isLastTeamRow(lastSeason, playerIds, ids, currentSeason()) : false), [allTime, ids]);
}
