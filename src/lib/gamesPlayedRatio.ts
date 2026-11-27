// 出場率の範囲（下限〜上限）と「85%以上達成可能」の判定・書き方（ランキング・全選手スタッツ・図解・チーム内リーダーで共通。DESIGN.md 476章）。
// 画面だけの部品（保存キーの対象外）。
export const DEFAULT_MIN_RATIO = 60;
export const DEFAULT_MAX_RATIO = 100;
export const DEFAULT_GAMES_RATIO_RANGE: [number, number] = [DEFAULT_MIN_RATIO, DEFAULT_MAX_RATIO];

/** 「達成可能」の基準（%）。スライダーを動かしても動かない（残り試合にすべて出場すれば出場率85%以上に届く選手） */
export const ACHIEVABLE_BASE_PERCENT = 85;

/**
 * 出場率が下限〜上限（整数%）の範囲か。範囲は「下限以上、上限+1 未満」（例: 0〜84% は 84.9% まで。85%以上と隙間なくつながる）。上限100%は上限なし。
 * remaining を渡すと「達成可能」でも判定する: 今の出場率の範囲に加えて、（今の出場試合数＋残り試合数）÷（チームの今までの試合数＋残り試合数）が85%以上。
 * 下限が85%以上のときは、下限を「今の出場率」でなくこの「届く出場率」で見る（85%以上達成可能＝今は85%に届いていなくても、残りに全部出れば届く選手を含む。366章の意味のまま）
 */
export function matchesGamesPlayedRatioRange(gamesPlayed: number, teamGames: number | undefined, min: number, max: number, remaining?: number): boolean {
  if (!teamGames || teamGames <= 0) return false;
  const ratio = (100 * gamesPlayed) / teamGames;
  if (max < 100 && ratio >= max + 1) return false;
  if (remaining === undefined) return !(ratio < min);
  const reach = (100 * (gamesPlayed + remaining)) / (teamGames + remaining);
  if (reach < Math.max(min, ACHIEVABLE_BASE_PERCENT)) return false;
  return min >= ACHIEVABLE_BASE_PERCENT || !(ratio < min);
}

/** 出場率の範囲と「達成可能」の書き方。上限100%なら「出場率85%以上」、上限があれば「出場率0〜84.9%」、達成可能は「出場率0〜84.9%（85%以上達成可能）」 */
export function ratioRangeLabel(minPct: number, maxPct: number, achievable = false): string {
  const lo = Math.round(minPct);
  const hi = Math.round(maxPct);
  const unbounded = hi >= 100;
  // 上限は「上限+1 未満」までなので、84%なら84.9%まで入る。書き方もそれに合わせる（出場率0〜84.9%）
  const hiText = `${hi}.9`;
  if (!achievable) return unbounded ? `出場率${lo}%以上` : `出場率${lo}〜${hiText}%`;
  // 下限が85%以上のときは下限そのものが「届く出場率」の基準（85%以上のままなら「出場率85%以上達成可能」の1つにまとめる）
  if (lo >= ACHIEVABLE_BASE_PERCENT) return unbounded ? `出場率${lo}%以上達成可能` : `出場率${lo}〜${hiText}%（${lo}%以上達成可能）`;
  return unbounded && lo === 0 ? `出場率${ACHIEVABLE_BASE_PERCENT}%以上達成可能` : unbounded ? `出場率${lo}%以上（${ACHIEVABLE_BASE_PERCENT}%以上達成可能）` : `出場率${lo}〜${hiText}%（${ACHIEVABLE_BASE_PERCENT}%以上達成可能）`;
}
