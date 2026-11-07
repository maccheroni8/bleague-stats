import { useMemo } from 'react';
import { divisionListParam, listParam, statConditionsParam, useUrlState } from '../lib/urlState';
import { POSITION_PARAM } from '../lib/urlFilterParams';
import { multiSelectAxis } from '../lib/filterAxes';
import { positionFilterOptions, selectedPositionLabels } from '../lib/classificationFilter';
import { multiSelectLabels } from '../lib/conditionLabels';
import { CAREER_CONDITION_KEY_PREFIX } from '../lib/playerConditionItems';
import { fetchPlayerCareers } from '../lib/data';
import { useJsonData } from '../lib/useJsonData';
import { teamMultiAxis, type FilterAxis } from '../lib/filterAxes';
import { usePlayoffZonePresets } from '../lib/playoffZone';
import { divisionPresets } from '../lib/divisionGroups';
import { clubSelectionLabels } from '../lib/conditionLabels';
import { teamShortName } from '../../shared/teamNames';
import { DEFAULT_STAT_CONDITIONS, statConditionLabels } from '../lib/statConditions';
import { statConditionsBarExtra } from '../components/StatConditionsEditor';
import { clubsOfDivisions, filterPlayerFigurePoints } from '../lib/figurePlayerFilter';
import type { PlayerFigurePoint } from '../lib/figurePlayerPoints';
import type { Category, Division, PlayerSummary } from '../../shared/types';

const EMPTY: string[] = [];
const NO_DIVISIONS: Division[] = [];
const NO_POSITIONS: string[] = [];

/**
 * 選手の図解で共通の「表示するクラブ」と詳細フィルター（スタッツの条件。ベン図・ランキング（個人）と同じ部品と項目）。
 * 出場率の基準を通った選手 → 表示するクラブ → 詳細フィルターの順に絞る。点・人数・一覧・保存画像の見出しのすべてに効く。
 * 以前の地区の選択（dv）は、その地区のクラブを選んだ状態に読み替える
 */
export function usePlayerFigureFilter({ season, category, teams, divisionOf, ratioPassed, clubKey, legacyDivisionKey, axisId, label }: {
  season: string; category: Category; teams: { teamId: string; teamName: string }[];
  divisionOf: (teamId: string) => Division | null | undefined;
  /** 出場率の基準を通った選手 */
  ratioPassed: PlayerFigurePoint[];
  /** 表示するクラブの URL キー */
  clubKey: string;
  /** 以前の地区の選択の URL キー（あれば読み替える） */
  legacyDivisionKey?: string;
  axisId: string;
  /** チップ・見出しの先頭（保存画像の見出し） */
  label?: string;
}) {
  const clubCodec = useMemo(() => listParam(clubKey), [clubKey]);
  const legacyCodec = useMemo(() => divisionListParam(legacyDivisionKey ?? '_none'), [legacyDivisionKey]);
  const [clubParam, setClubParam] = useUrlState(clubCodec, EMPTY);
  const [legacy, setLegacy] = useUrlState(legacyCodec, NO_DIVISIONS);
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);
  const [positions, setPositions] = useUrlState(POSITION_PARAM, NO_POSITIONS);
  const presets = usePlayoffZonePresets(season, category);
  // キャリアの条件を使っているときだけ、選手のキャリアの記録を読む（B.ONE には無い）
  const careersNeeded = category === 'premier' && statConditions.conditions.some(c => c.key.startsWith(CAREER_CONDITION_KEY_PREFIX));
  const careers = useJsonData(() => careersNeeded ? fetchPlayerCareers() : Promise.resolve(null), [careersNeeded]).data;
  const careerOf = useMemo(() => (p: PlayerSummary) => careers?.seasons[season]?.[p.playerId], [careers, season]);
  // 地区の選択が残っていて、クラブの選択が無いときは、その地区のクラブ
  const clubs = useMemo(() => {
    if (clubParam.length) return clubParam;
    if (!legacyDivisionKey || !legacy.length) return EMPTY;
    return clubsOfDivisions(teams, divisionOf, legacy);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubParam.join('|'), legacy.join('|'), legacyDivisionKey, teams]);
  const setClubs = (ids: string[]) => { setClubParam(ids); if (legacyDivisionKey && legacy.length) setLegacy(NO_DIVISIONS); };
  const clubAxis: FilterAxis = teamMultiAxis({
    id: axisId, label: label ?? '表示するクラブ', options: teams, selected: clubs.length ? new Set(clubs) : null,
    onChange: v => setClubs(v ? [...v] : []), divisionOf, league: category, presets,
  });
  const { items: conditionItems, eligible, active } = useMemo(() => filterPlayerFigurePoints(ratioPassed, clubs, statConditions, season, { positions, league: category, careerOf }), [ratioPassed, clubs, statConditions, season, positions, category, careerOf]);
  const groups = divisionPresets(teams.map(t => t.teamId), divisionOf, category).map(g => ({ label: g.label, values: g.teamIds }));
  const clubLabels = clubs.length ? clubSelectionLabels('表示クラブ', clubs, teams.map(t => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName) })), groups) : [];
  const positionOptions = useMemo(() => positionFilterOptions(ratioPassed.map(p => p.summary), positions), [ratioPassed, positions]);
  const positionAxis: FilterAxis = multiSelectAxis({ id: 'position', label: 'ポジション', options: positionOptions, selected: positions, onChangeSelected: setPositions, allLabel: '全ポジション', maxShown: Infinity });
  const positionLabels = positions.length ? multiSelectLabels('ポジション', selectedPositionLabels(positionOptions, positions), '全ポジション', Infinity) : [];
  const labels = [...clubLabels, ...positionLabels, ...statConditionLabels(statConditions, conditionItems)];
  /** FilterBar の advancedExtra（詳細フィルター） */
  const advancedExtra = statConditionsBarExtra(statConditions, setStatConditions, conditionItems, { defaultKey: 'min' });
  const reset = () => { setPositions(NO_POSITIONS); setClubParam(EMPTY); if (legacyDivisionKey) setLegacy(NO_DIVISIONS); setStatConditions(DEFAULT_STAT_CONDITIONS); };
  /** クラブか詳細フィルターで絞っているか */
  return { clubs, clubAxis, positionAxis, eligible, labels, advancedExtra, reset, statConditions, active };
}
