import { useMemo } from "react";
import type { GameSummary } from "../../shared/types";
import { fetchTeams, type League } from "./data";
import { buildOpponentRecords, type OpponentRecords } from "./opponentStrength";
import { useJsonData } from "./useJsonData";

/**
 * 試合の概要（games-summary.json）から試合時点の勝率を作り、そのシーズンの teams.json の最新勝率を添える（設計書450章）。
 * season が null のとき・summaries が無いときは undefined。teams.json を読めないときは最新勝率が無いだけ（試合時点の勝率は使える）
 */
export function useOpponentRecords(
  summaries: GameSummary[] | null | undefined,
  season: string | null | undefined,
  league: League,
): OpponentRecords | undefined {
  const { data: teams } = useJsonData(
    () => (summaries && season ? fetchTeams(season, league).catch(() => null) : Promise.resolve(null)),
    [!!summaries, season, league],
    { discardStale: true },
  );
  return useMemo(() => (summaries ? buildOpponentRecords(summaries, teams) : undefined), [summaries, teams]);
}
