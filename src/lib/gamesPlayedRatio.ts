// 全選手スタッツの既存の初期値・判定をそのまま移したもの。図解でも同じ計算を使う。
export const DEFAULT_MIN_RATIO = 60;
export const DEFAULT_MAX_RATIO = 100;
export const DEFAULT_GAMES_RATIO_RANGE: [number, number] = [DEFAULT_MIN_RATIO, DEFAULT_MAX_RATIO];

export function matchesGamesPlayedRatioRange(gamesPlayed: number, teamGames: number | undefined, min: number, max: number): boolean {
  if (!teamGames) return false;
  const ratio = (100 * gamesPlayed) / teamGames;
  return !(ratio < min || ratio > max);
}
