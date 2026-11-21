// 画面専用。順位表の列「対戦相手の強さ」（ここまで）と「残り相手勝率」（残り）の値を、順位表と同じ材料・同じ手順で出す1か所。
// 順位表（StandingsPage）と図解の散布図が同じ関数を通すので、同じ値になる（設計書460章）。
import type { GameSummary, PlayoffRaceFile, StandingsTeamSnapshot } from "../../shared/types";
import type { ScheduleFileExtended } from "../../shared/resultOnlyGames";
import { pendingUpcomingGames } from "./pendingUpcoming";
import { resultOnlySummaries } from "./resultOnlyGames";
import { withUnplayedTeams } from "./standingsTeams";
import { computeOpponentStrength, computeRemainingOpponentStrength, type OpponentStrength } from "./opponentStrength";

export interface StandingsOpponentStrengths {
  /** ここまでの相手の強さ（順位表の「対戦相手の強さ」）。結果だけの試合も戦った試合に含める */
  sofar: Map<string, OpponentStrength>;
  /** 残りの相手の強さ（順位表の「残り相手勝率」）。日程が決まっていない試合・結果だけの試合は入らない */
  remaining: Map<string, OpponentStrength> | null;
}

/**
 * teams は順位表の最新のスナップショットのチーム、gameSummaries は試合の概要（結果だけの試合は schedule から足す）。
 * 順位表と同じく、試合の概要を読み込むまでは出さない（gameSummaries が null なら sofar は空）、日程を読み込むまでは残りを出さない（schedule が null なら remaining は null）
 */
export function computeStandingsOpponentStrengths(input: {
  teams: StandingsTeamSnapshot[];
  gameSummaries: GameSummary[] | null | undefined;
  schedule: ScheduleFileExtended | null | undefined;
  playoffRace: PlayoffRaceFile | null | undefined;
}): StandingsOpponentStrengths {
  const { teams, gameSummaries, schedule, playoffRace } = input;
  const resultOnlyRows = resultOnlySummaries(schedule?.resultOnlyGames, gameSummaries);
  const gamesForGrid = gameSummaries ? [...gameSummaries, ...resultOnlyRows] : null;
  const standingsTeams = withUnplayedTeams(teams, playoffRace ?? null);
  const pendingUpcoming = pendingUpcomingGames(schedule?.upcomingGames, gameSummaries);
  return {
    sofar: gamesForGrid ? computeOpponentStrength(teams, gamesForGrid) : new Map(),
    remaining: schedule
      ? computeRemainingOpponentStrength(
          teams,
          pendingUpcoming,
          new Map(standingsTeams.map((t) => [t.teamName, t.teamId])),
          new Set((schedule.resultOnlyGames ?? []).map((g) => g.scheduleKey)),
        )
      : null,
  };
}
