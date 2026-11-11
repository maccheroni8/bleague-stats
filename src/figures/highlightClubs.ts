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
// allTime を付けると、1つのシーズンの一括選択（地区・プレーオフ圏内）を出さない（歴代の図。今季の地区を過去のシーズンに当てはめない）
export function useHighlightClubs({ season, category, teams, divisionOf, allTime = false }: {
  season: string; category: Category; teams: { teamId: string; teamName: string }[]; divisionOf: (teamId: string) => Division | null | undefined; allTime?: boolean;
}) {
  const [ids, setIds] = useUrlState(highlightCodec, EMPTY);
  const zonePresets = usePlayoffZonePresets(season, category);
  const presets = allTime ? [] : zonePresets;
  const axis: FilterAxis = teamMultiAxis({
    id: 'highlightClubs', label: '強調するクラブ', options: teams, selected: ids.length ? new Set(ids) : null,
    onChange: v => setIds(v ? [...v] : []), divisionOf: allTime ? undefined : divisionOf, league: category, presets,
  });
  // サブタイトル（「強調：宇都宮・A東京」）。地区のクラブが全部なら「東地区」のようにまとめる
  const labels = useMemo(() => {
    if (!ids.length) return [];
    const groups = allTime ? [] : divisionPresets(teams.map(t => t.teamId), divisionOf, category).map(g => ({ label: g.label, values: g.teamIds }));
    const text = summarizeClubSelection(ids, teams.map(t => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName) })), groups).replace(/、/g, '・');
    return text ? [`強調：${text}`] : [];
  }, [ids, teams, divisionOf, category]);
  /** 強調するクラブの選手か（移籍した選手は、所属したクラブのどれかが当てはまれば強調） */
  const has = (teamIds: readonly string[]) => ids.length > 0 && teamIds.some(id => ids.includes(id));
  return { ids, setIds, axis, labels, has };
}
