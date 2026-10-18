// 結果だけの試合（DESIGN.md 228章）を、勝敗の行にする部品。画面（src/lib/resultOnlyGames.ts から再公開）と、歴代記録を作るスクリプトで共有する。
import type { ResultOnlyGameEntry } from "./resultOnlyGames.ts";
import type { GameSummary, TeamGameLog } from "./types.ts";

/** 生データ（games-summary）に載っていない結果だけの試合を、日程・勝敗表の行の形（GameSummary）にする */
export function resultOnlySummaries(
  entries: ResultOnlyGameEntry[] | undefined,
  recorded: { scheduleKey: string }[] | Set<string> | null | undefined,
): GameSummary[] {
  if (!entries || entries.length === 0) return [];
  const recordedKeys = recorded instanceof Set ? recorded : new Set((recorded ?? []).map((g) => g.scheduleKey));
  return entries
    .filter((g) => !recordedKeys.has(g.scheduleKey))
    .map((g) => ({
      scheduleKey: g.scheduleKey,
      date: g.date,
      homeTeamId: g.homeTeamId,
      homeTeamName: g.homeTeamName,
      awayTeamId: g.awayTeamId,
      awayTeamName: g.awayTeamName,
      homeScore: g.homeScore,
      awayScore: g.awayScore,
      gameEndedFlg: true,
      gameType: g.gameType,
      venue: g.venue,
      tipoffTime: g.tipoffTime,
    }));
}

/**
 * 順位表の補助（ホーム/アウェー・直近5試合・連勝連敗）と条件別順位表に足す、1チーム分の勝敗の行。
 * 試合ログ（TeamGameLog）のうち、日付・ホーム/アウェー・勝敗・得点・相手だけを持つ。スタッツの項目は持たない
 * （それらを集計する画面には渡さない）
 */
export function resultOnlyLogsForTeam(
  entries: ResultOnlyGameEntry[] | undefined,
  teamId: string,
  recorded?: Set<string> | { scheduleKey: string }[] | null,
): TeamGameLog[] {
  const reasonByKey = new Map((entries ?? []).map((e) => [e.scheduleKey, e.reason] as const));
  return resultOnlySummaries(entries, recorded)
    .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
    .map((g) => {
      const isHome = g.homeTeamId === teamId;
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const opponentScore = isHome ? g.awayScore : g.homeScore;
      return {
        scheduleKey: g.scheduleKey,
        date: g.date,
        gameType: g.gameType,
        isHome,
        win: teamScore > opponentScore,
        teamScore,
        opponentScore,
        opponentTeamId: isHome ? g.awayTeamId : g.homeTeamId,
        opponentTeamName: isHome ? g.awayTeamName : g.homeTeamName,
        // 結果だけの試合の印（連勝・連敗の注釈・試合ページへのリンクを付けない判定に使う）
        resultOnlyReason: reasonByKey.get(g.scheduleKey),
      } as unknown as TeamGameLog;
    });
}
