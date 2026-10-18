import type { GameSummary, TeamGameLog } from "../../shared/types";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";

/**
 * 結果だけの試合（schedule.json の resultOnlyGames。ボックススコアが公式に無い試合・不戦勝。DESIGN.md 228章）を画面で扱うための部品。
 * 勝敗・得失点を数える画面（順位表・勝敗表・条件別順位表・日程・チームの日程結果）だけに渡す。スタッツ・試合ログ・ランキングには渡さない。
 */

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

/** チームごとの試合ログに、結果だけの試合の行を足したものを返す（元の Map・配列は変えない）。足す試合が無ければ元の Map をそのまま返す */
export function withResultOnlyLogs(
  logsByTeam: Map<string, TeamGameLog[]> | null,
  entries: ResultOnlyGameEntry[] | undefined,
): Map<string, TeamGameLog[]> | null {
  if (!logsByTeam || !entries || entries.length === 0) return logsByTeam;
  const out = new Map<string, TeamGameLog[]>();
  for (const [teamId, logs] of logsByTeam) {
    const extra = resultOnlyLogsForTeam(entries, teamId, new Set(logs.map((l) => l.scheduleKey)));
    out.set(teamId, extra.length > 0 ? [...logs, ...extra] : logs);
  }
  return out;
}

/** 結果だけの試合の理由の表記（日程・勝敗表のツールチップ用） */
export function resultOnlyReasonLabel(reason: ResultOnlyGameEntry["reason"]): string {
  return reason === "forfeit" ? "不戦勝／不戦敗（試合の記録なし）" : "試合は行われたが、ボックススコアが公式に無い";
}

/**
 * 比較の表の「G」の勝敗に添える説明。結果だけの試合を公式の勝敗に含むチーム・シーズンで、その枠の範囲（試合種別・条件なし）に
 * 該当の試合があるときだけ返す。比較の試合数・勝敗はスタッツのある試合だけ（試合ログ）なので、公式の勝敗とは試合数が違う。
 * 公式の勝敗は「試合ログの勝敗＋結果だけの試合の勝敗」。条件で絞った枠（ホームだけ等）は公式の勝敗と並べられないので出さない
 */
export function resultOnlyCompareNote(
  entries: ResultOnlyGameEntry[] | null | undefined,
  teamId: string,
  gameType: "regular" | "playoff" | "both",
  record: { wins: number; losses: number } | undefined,
  /** 条件なし（シーズン全体）の枠か */
  noCondition: boolean,
): string | undefined {
  if (!entries || !record || !noCondition) return undefined;
  const mine = entries.filter(
    (g) => (g.homeTeamId === teamId || g.awayTeamId === teamId) && (gameType === "both" || g.gameType === gameType),
  );
  if (mine.length === 0) return undefined;
  const won = mine.filter((g) => (g.homeTeamId === teamId ? g.homeScore > g.awayScore : g.awayScore > g.homeScore)).length;
  const wins = record.wins + won;
  const losses = record.losses + (mine.length - won);
  return `公式の勝敗（${wins}-${losses}）は、スタッツの無い試合（結果だけの試合）を${mine.length}試合含みます。この比較の試合数・勝敗には入っていません`;
}

