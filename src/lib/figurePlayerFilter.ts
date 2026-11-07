import type { Division } from '../../shared/types';
import type { PlayerFigurePoint } from './figurePlayerPoints';
import { playerVennConditionDefs } from './figurePlayerVenn';
import { buildStatConditionItems, filterByStatConditions, hasActiveStatConditions, type StatConditionsState } from './statConditions';

/** 以前の地区の選択（dv）を、その地区のクラブを選んだ状態に読み替える */
export function clubsOfDivisions(teams: readonly { teamId: string }[], divisionOf: (teamId: string) => Division | null | undefined, divisions: readonly string[]): string[] {
  return teams.filter(t => { const d = divisionOf(t.teamId); return !!d && divisions.includes(d); }).map(t => t.teamId);
}

/** 選手の図解の絞り込み: 出場率を通った選手 → 表示するクラブ（移籍した選手は所属したクラブのどれかが当てはまれば残す）→ 詳細フィルター（スタッツの条件） */
export function filterPlayerFigurePoints(ratioPassed: PlayerFigurePoint[], clubs: readonly string[], statConditions: StatConditionsState, season: string) {
  const clubPassed = clubs.length ? ratioPassed.filter(p => p.teamIds.some(id => clubs.includes(id))) : ratioPassed;
  const items = buildStatConditionItems(playerVennConditionDefs(season), clubPassed, 'perGame');
  const eligible = filterByStatConditions(clubPassed, statConditions, items);
  return { clubPassed, items, eligible, active: clubs.length > 0 || hasActiveStatConditions(statConditions, items) };
}
