/** チームと在籍シーズンの範囲を出す行の、チーム名の前に付ける言葉（今季プレーしていない選手） */
export const LAST_TEAM_PREFIX = "最終所属：";

/**
 * 今季にプレーしていない選手の行かどうか（チーム名を「最終所属：〇〇」と書くか）。
 * 今季にプレーしている＝行の最後のシーズンが今季で、今季の B.PREMIER か B.ONE の名簿に載っている（「現役」と同じ名簿。activePlayers.ts）。
 * 名簿を読み込む前・読み込めなかったときは、行の最後のシーズンだけで判定する。複数の選手の行（組み合わせ）は、全員が当てはまるときだけ今季の行
 */
export function isLastTeamRow(lastSeason: string, playerIds: readonly string[], activeIds: ReadonlySet<string> | null, season: string): boolean {
  if (lastSeason !== season) return true;
  if (!activeIds) return false;
  return !playerIds.every((id) => activeIds.has(id));
}
