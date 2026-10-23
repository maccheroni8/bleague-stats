// 概要のシチュエーション別勝敗だけで使う、相手の最新のレギュラーシーズン勝率。
// teams.json の wins/losses は結果だけの試合も含む。試合ログの母集団は変えない。
// 保存キー対象の集計や、他画面の「試合前勝率」フィルタからは使わない。
import type { TeamSummary } from "../../shared/types";

export type OpponentSeasonRecord = Pick<TeamSummary, "teamId" | "wins" | "losses">;
export type OpponentSeasonTier = "under50" | "atLeast50" | "atLeast60";

/** 終了季は最終、進行中は現時点の成績。0試合・欠損・不正な勝敗は推測せず載せない。 */
export function buildOpponentSeasonWinRates(teams: readonly OpponentSeasonRecord[] | null | undefined): ReadonlyMap<string, number> {
  const rates = new Map<string, number>();
  for (const team of teams ?? []) {
    const games = team.wins + team.losses;
    if (!Number.isSafeInteger(team.wins) || !Number.isSafeInteger(team.losses) ||
        team.wins < 0 || team.losses < 0 || !Number.isSafeInteger(games) || games <= 0) continue;
    rates.set(team.teamId, team.wins / games);
  }
  return rates;
}

/** 6割以上は5割以上にも含める。消化試合数の下限は設けない。 */
export function matchesOpponentSeasonWinRate(
  opponentTeamId: string,
  tier: OpponentSeasonTier,
  rates: ReadonlyMap<string, number>,
): boolean {
  const rate = rates.get(opponentTeamId);
  if (rate === undefined) return false;
  switch (tier) {
    case "under50": return rate < 0.5;
    case "atLeast50": return rate >= 0.5;
    case "atLeast60": return rate >= 0.6;
  }
}
