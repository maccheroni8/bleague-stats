// 全選手スタッツの既存の初期値・判定をそのまま移したもの。図解でも同じ計算を使う。
export const DEFAULT_MIN_RATIO = 60;
export const DEFAULT_MAX_RATIO = 100;
export const DEFAULT_GAMES_RATIO_RANGE: [number, number] = [DEFAULT_MIN_RATIO, DEFAULT_MAX_RATIO];

/**
 * 出場試合率が下限〜上限（%）の範囲か。remaining を渡すと下限を「達成可能」で判定する
 * （今の出場試合数＋チームの残り試合数）÷（チームの今までの試合数＋残り試合数）が下限以上。上限は今の出場試合率のまま
 */
export function matchesGamesPlayedRatioRange(gamesPlayed: number, teamGames: number | undefined, min: number, max: number, remaining?: number): boolean {
  if (!teamGames) return false;
  const ratio = (100 * gamesPlayed) / teamGames;
  if (ratio > max) return false;
  const lowerRatio = remaining === undefined ? ratio : (100 * (gamesPlayed + remaining)) / (teamGames + remaining);
  return !(lowerRatio < min);
}
