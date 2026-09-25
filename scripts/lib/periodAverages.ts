// data/{season}/period-averages.json（クォーター別・前後半別の1試合平均と、そのシーズンのリーグ内順位。DESIGN.md 143章）を作る。
// チーム詳細「通算成績」のシーズン別の表で使う。延長戦は含めない（shared/teamPeriodRecords.ts）
import { filterByGameType } from "../../shared/gameType.ts";
import { PERIOD_AVERAGE_STATS, PERIOD_KEYS, periodAverage } from "../../shared/teamPeriodRecords.ts";
import type { LeagueRankingGameType, PeriodAverageRankEntry, PeriodAveragesFile, TeamGameLog } from "../../shared/types.ts";

const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

/** 同じ値は同じ順位（次の順位はその分飛ばす） */
function competitionRanks(values: { teamId: string; value: number }[], lowerFirst: boolean): Map<string, number> {
  const sorted = [...values].sort((a, b) => (lowerFirst ? a.value - b.value : b.value - a.value));
  const ranks = new Map<string, number>();
  let rank = 0;
  sorted.forEach((v, i) => {
    if (i === 0 || v.value !== sorted[i - 1]!.value) rank = i + 1;
    ranks.set(v.teamId, rank);
  });
  return ranks;
}

export function buildPeriodAveragesFile(season: string, logsByTeam: Map<string, TeamGameLog[]>): PeriodAveragesFile {
  const byGameType: PeriodAveragesFile["byGameType"] = { regular: {}, playoff: {}, both: {} };
  for (const gameType of GAME_TYPES) {
    for (const period of PERIOD_KEYS) {
      const rows: { teamId: string; avg: NonNullable<ReturnType<typeof periodAverage>> }[] = [];
      for (const [teamId, logs] of logsByTeam) {
        // オールスター等（gameType が regular/playoff 以外）の試合は除く。擬似チームはこれで対象から外れる
        const real = logs.filter((g) => g.gameType === "regular" || g.gameType === "playoff");
        const avg = periodAverage(filterByGameType(real, gameType), period);
        if (avg) rows.push({ teamId, avg });
      }
      const ranks = Object.fromEntries(
        PERIOD_AVERAGE_STATS.map((s) => [s.key, competitionRanks(rows.map((r) => ({ teamId: r.teamId, value: r.avg[s.key] })), s.lowerFirst)]),
      ) as Record<"pts" | "oppPts" | "diff", Map<string, number>>;
      for (const r of rows) {
        const entry: PeriodAverageRankEntry = {
          games: r.avg.games,
          pts: r.avg.pts,
          oppPts: r.avg.oppPts,
          diff: r.avg.diff,
          ptsRank: ranks.pts.get(r.teamId)!,
          oppPtsRank: ranks.oppPts.get(r.teamId)!,
          diffRank: ranks.diff.get(r.teamId)!,
          teams: rows.length,
        };
        (byGameType[gameType][r.teamId] ??= {})[period] = entry;
      }
    }
  }
  return { season, byGameType };
}
