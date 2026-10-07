// ルーキーの判定（shared/rookieEligibility.ts）で使う、シーズン途中に移籍した選手の「所属するチームの行った試合」の数え方（DESIGN.md 215章）。
//
// 選手がそのシーズンに載った試合の記録（出場時間0のベンチ入りを含む）を日付順に並べ、同じチームが続く区間（所属区間）に分ける。
// 各区間は、そのチームでの最初の試合の日付から、次の区間の最初の試合の日付の前日まで（最初の区間はシーズンの初め、最後の区間はシーズンの終わりまで）。
// 区間ごとに、そのチームがその間に行ったレギュラーシーズンの試合数を数え、足し合わせる。
// 1チームだけの選手は、そのチームのレギュラーシーズンの試合数（シーズン途中に加入した選手も、チームの全試合で割る。選手一覧の出場試合率と同じ）。
// 移籍した選手は、シーズンの全期間をどれかのチームの所属とみなすので、足した合計は、チームの試合数と同じくらいの大きさになる。

export interface PlayerTeamGame {
  date: string;
  teamId: string;
}

/**
 * @param playerGames その選手のレギュラーシーズンの試合の記録（日付・所属チーム。順不同でよい）
 * @param teamGameDates チームID → そのチームのレギュラーシーズンの試合の日付（順不同でよい）
 * @returns 所属したチームの行った試合の数。試合の記録が無ければ 0
 */
export function teamGamesDuringTenure(playerGames: PlayerTeamGame[], teamGameDates: ReadonlyMap<string, readonly string[]>): number {
  const sorted = [...playerGames].sort((a, b) => a.date.localeCompare(b.date));
  const runs: PlayerTeamGame[] = [];
  for (const g of sorted) if (runs.length === 0 || runs[runs.length - 1]!.teamId !== g.teamId) runs.push(g);
  let total = 0;
  runs.forEach((run, i) => {
    const from = i === 0 ? "" : run.date;
    const to = i === runs.length - 1 ? "￿" : runs[i + 1]!.date;
    for (const d of teamGameDates.get(run.teamId) ?? []) if (d >= from && d < to) total += 1;
  });
  return total;
}
