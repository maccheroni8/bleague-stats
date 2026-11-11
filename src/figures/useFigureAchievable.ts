import { useUrlState } from '../lib/urlState';
import { useAchievableSupport } from '../lib/achievableSupport';
import { ACHIEVABLE_PARAM, remainingForScope, useRemainingGames } from '../lib/achievableGames';
import type { SeasonGameTypeFilter } from '../../shared/gameType';
import type { SituationalRange } from '../lib/situational';
import type { Category } from '../../shared/types';

/**
 * 図解の掲載基準の「◯%以上達成可能」（ランキングと同じ。URL `ach=1`・初期はチェックなし・B.ONE は日程がそろうまで出さない）。
 * achievable＝チェックが入っていて、出せるとき。remaining＝出場率の判定に足すチームごとの残り試合数
 * （期間・試合区分で分母が変わる図では、全期間のレギュラーシーズンだけ。remainingForScope）。
 * range・gameType を渡さない図（分母がシーズンの成績の年齢分布）は、ランキングと同じ全体の残り試合数
 */
export function useFigureAchievable(season: string, category: Category, scope?: { range: SituationalRange; gameType: SeasonGameTypeFilter }) {
  const [checked, setChecked] = useUrlState(ACHIEVABLE_PARAM, false);
  const supported = useAchievableSupport(season, category);
  const achievable = checked && supported;
  const { remainingByTeam } = useRemainingGames(season, category, achievable);
  const remaining = scope ? remainingForScope(remainingByTeam, scope.range, scope.gameType) : remainingByTeam;
  return { achievable, supported, remaining, axis: { checked, onChange: setChecked, supported }, reset: () => setChecked(false) };
}
