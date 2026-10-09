import type { StoredGame } from "./types.ts";

/**
 * 1試合のピリオド別の得点（試合詳細ページ用）。公式のクォーター別スコア（StoredGame.quarterScores）をそのまま使うが、
 * 2016-17〜2019-20の延長戦の試合（と、一部の後のシーズンの試合）は、公式のクォーター別スコアに延長が入っていない
 * （4ピリオド分だけ。合計が最終スコアと合わない）。その場合は、同じ試合の集計行（PeriodCategory 5〜14＝各延長）の数を延長の数とし、
 * 試合の生データ（Game の HomeTeamScore05〜）から延長の得点を補う。補った結果の合計が最終スコアと一致しないときは補わない
 * （公式のスコアのまま）
 */
export function gamePeriodScores(game: StoredGame): { home: number[]; away: number[] } {
  const official = game.quarterScores;
  const otPeriods = new Set<number>();
  for (const s of game.raw.Summaries ?? []) {
    if (s.PeriodCategory >= 5 && s.PeriodCategory <= 14) otPeriods.add(s.PeriodCategory);
  }
  const total = Math.max(official.home.length, official.away.length, otPeriods.size > 0 ? Math.max(...otPeriods) : 0);
  if (total <= official.home.length) return official;

  const raw = game.raw.Game as Record<string, unknown>;
  const scoreOf = (side: "Home" | "Away", period: number): number => Number(raw[`${side}TeamScore${String(period).padStart(2, "0")}`] ?? 0);
  const build = (side: "Home" | "Away", base: number[]): number[] =>
    Array.from({ length: total }, (_, i) => (i < base.length ? base[i]! : scoreOf(side, i + 1)));
  const home = build("Home", official.home);
  const away = build("Away", official.away);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  if (sum(home) !== game.homeScore || sum(away) !== game.awayScore) return official;
  return { home, away };
}

/**
 * 延長戦のあった試合か。保存した `quarterScores` が5ピリオド以上、または集計行に延長（PeriodCategory 5〜14）がある試合。
 * 2016-17〜2019-20の延長戦は `quarterScores` が4ピリオド分なので、集計行でも判定する
 */
export function gameHasOvertime(game: StoredGame): boolean {
  if (game.quarterScores.home.length > 4) return true;
  return (game.raw.Summaries ?? []).some((s) => s.PeriodCategory >= 5 && s.PeriodCategory <= 14);
}

/**
 * 延長の本数（延長なしは 0）。ピリオド別の得点（上の gamePeriodScores）のピリオド数から4を引いた数と、集計行（PeriodCategory 5〜14＝第1〜第10延長）の
 * 一番後ろの延長から数えた本数の、大きい方。全試合でこの2つは一致する（2016-17〜2026-27の6,304試合）。公式のクォーター別スコアが
 * 途中までの試合（2021-22の7863、2024-25の502982）や前後半5分の特別な試合は、ピリオド数が4未満になるが延長ではないので 0
 */
export function overtimeCount(game: StoredGame): number {
  const fromScores = Math.max(0, gamePeriodScores(game).home.length - 4);
  let lastOvertimeCategory = 0;
  for (const s of game.raw.Summaries ?? []) {
    if (s.PeriodCategory >= 5 && s.PeriodCategory <= 14) lastOvertimeCategory = Math.max(lastOvertimeCategory, s.PeriodCategory);
  }
  return Math.max(fromScores, lastOvertimeCategory > 0 ? lastOvertimeCategory - 4 : 0);
}
