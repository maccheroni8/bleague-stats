// 画面専用（図解の「条件付きの勝率」）。条件別順位表と同じ材料（試合の概要・結果だけの試合・地区の履歴）を読んで CondEnv を作る。enabled が false の間は何も読まない。
import { useMemo } from "react";
import type { TeamGameLog, TeamSummary } from "../../shared/types";
import { fetchSchedule } from "./data";
import { buildCondEnv, type CondEnv } from "./figureCondWinPct";
import type { League } from "./league";
import { useLeagueSituationalContext } from "./teamRankingData";
import { useJsonData } from "./useJsonData";

export function useCondEnv({ season, league, teams, logs, enabled }: {
  season: string; league: League; teams: readonly TeamSummary[] | undefined; logs: ReadonlyMap<string, TeamGameLog[]> | undefined; enabled: boolean;
}): { env: CondEnv | null; loading: boolean } {
  const context = useLeagueSituationalContext(season, enabled, league);
  const schedule = useJsonData(async () => {
    if (!enabled) return null;
    // 結果だけの試合が読めなくても、試合ログだけで数える（読めた回との差は結果だけの試合のぶん）
    try { return (await fetchSchedule(season, league)).resultOnlyGames ?? null; } catch { return null; }
  }, [season, league, enabled], { discardStale: true });
  const env = useMemo(() => {
    if (!enabled || !teams || !logs || !context.summaries || schedule.loading) return null;
    return buildCondEnv({ season, league, teams, logsByTeam: logs, summaries: context.summaries, resultOnly: schedule.data ?? undefined, divisionHistory: context.divisionHistory });
  }, [enabled, teams, logs, context.summaries, context.divisionHistory, schedule.loading, schedule.data, season, league]);
  return { env, loading: enabled && !env };
}
