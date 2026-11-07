import type { Division, PlayerCareerCounts, PlayerSummary } from '../../shared/types';
import { matchesPositionFilter } from './classificationFilter';
import type { PlayerFigurePoint } from './figurePlayerPoints';
import { playerVennConditionDefs } from './figurePlayerVenn';
import { buildStatConditionItems, filterByStatConditions, hasActiveStatConditions, type StatConditionsState } from './statConditions';

/** 以前の地区の選択（dv）を、その地区のクラブを選んだ状態に読み替える */
export function clubsOfDivisions(teams: readonly { teamId: string }[], divisionOf: (teamId: string) => Division | null | undefined, divisions: readonly string[]): string[] {
  return teams.filter(t => { const d = divisionOf(t.teamId); return !!d && divisions.includes(d); }).map(t => t.teamId);
}

/** 選手の図解の絞り込み: 出場率を通った選手 → 表示するクラブ → ポジション（移籍した選手は所属したクラブのどれかが当てはまれば残す）→ 詳細フィルター（スタッツの条件） */
export function filterPlayerFigurePoints(ratioPassed: PlayerFigurePoint[], clubs: readonly string[], statConditions: StatConditionsState, season: string, extra: { positions?: readonly string[]; league?: 'premier' | 'one'; careerOf?: (p: PlayerSummary) => PlayerCareerCounts | undefined } = {}) {
  const clubOnly = clubs.length ? ratioPassed.filter(p => p.teamIds.some(id => clubs.includes(id))) : ratioPassed;
  const positionSet = new Set(extra.positions ?? []);
  const clubPassed = positionSet.size ? clubOnly.filter(p => matchesPositionFilter(p.summary, positionSet)) : clubOnly;
  const items = buildStatConditionItems(playerVennConditionDefs(season, extra.league, extra.careerOf), clubPassed, 'perGame');
  const eligible = filterByStatConditions(clubPassed, statConditions, items);
  return { clubPassed, items, eligible, active: clubs.length > 0 || positionSet.size > 0 || hasActiveStatConditions(statConditions, items) };
}
