import { useMemo } from 'react';
import { listParam, useUrlState } from '../lib/urlState';
import { teamMultiAxis, type FilterAxis } from '../lib/filterAxes';
import { usePlayoffZonePresets } from '../lib/playoffZone';
import { divisionPresets, summarizeClubSelection } from '../lib/divisionGroups';
import { teamShortName } from '../../shared/teamNames';
import type { Category, Division } from '../../shared/types';

const EMPTY: string[] = [];
const highlightCodec = listParam('hcl');

/** 選手の図解で共通の「強調するクラブ」。選んだクラブの選手を手前に出し、少し大きく表示する（消さない）。URL は hcl（カンマ区切り） */
export function useHighlightClubs({ season, category, teams, divisionOf }: {
  season: string; category: Category; teams: { teamId: string; teamName: string }[]; divisionOf: (teamId: string) => Division | null | undefined;
}) {
  const [ids, setIds] = useUrlState(highlightCodec, EMPTY);
  const presets = usePlayoffZonePresets(season, category);
  const axis: FilterAxis = teamMultiAxis({
    id: 'highlightClubs', label: '強調するクラブ', options: teams, selected: ids.length ? new Set(ids) : null,
    onChange: v => setIds(v ? [...v] : []), divisionOf, league: category, presets,
  });
  // サブタイトル（「強調：宇都宮・A東京」）。地区のクラブが全部なら「東地区」のようにまとめる
  const labels = useMemo(() => {
    if (!ids.length) return [];
    const groups = divisionPresets(teams.map(t => t.teamId), divisionOf, category).map(g => ({ label: g.label, values: g.teamIds }));
    const text = summarizeClubSelection(ids, teams.map(t => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName) })), groups).replace(/、/g, '・');
    return text ? [`強調：${text}`] : [];
  }, [ids, teams, divisionOf, category]);
  /** 強調するクラブの選手か（移籍した選手は、所属したクラブのどれかが当てはまれば強調） */
  const has = (teamIds: readonly string[]) => ids.length > 0 && teamIds.some(id => ids.includes(id));
  return { ids, setIds, axis, labels, has };
}
