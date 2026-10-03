import type { StoredGame } from "../../shared/types";

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
