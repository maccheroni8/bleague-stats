import { useMemo } from 'react';
import { listParam, useUrlState } from '../lib/urlState';
import { multiSelectAxis, type FilterAxis } from '../lib/filterAxes';
import { teamShortName } from '../../shared/teamNames';
import type { PlayerFigurePoint } from '../lib/figurePlayerPoints';
import type { PlayerRankIndex } from '../lib/figurePlayerRank';
import { NumberTextInput } from '../components/NumberTextInput';

const EMPTY: string[] = [];
const playerCodec = listParam('hpl');
const rankCodec = listParam('hrk');
const parseRank = (v: string): { key: string; n: number } | null => {
  const i = v.lastIndexOf(':');
  const n = Number(v.slice(i + 1));
  return i > 0 && Number.isInteger(n) && n >= 1 ? { key: v.slice(0, i), n } : null;
};

/**
 * 選手の図解の「強調」の、クラブ以外の条件: 選手を名指し（URL hpl＝選手IDのカンマ区切り）・ランキング上位（URL hrk＝「項目:人数」のカンマ区切り。
 * 順位は詳細フィルタの「ランキング◯位以上」と同じ数え方で、同順位は全員入れる）。クラブの強調（useHighlightClubs）と合わせ、どれか1つに当てはまる選手を強調する。
 * 強調の内容はサブタイトルには出さない
 */
export function usePlayerHighlight({ clubHas, rankIndex, points, teams }: {
  /** クラブの強調の判定（useHighlightClubs の has） */
  clubHas: (teamIds: readonly string[]) => boolean;
  rankIndex: PlayerRankIndex;
  /** 名指しの選択肢にする選手 */
  points: readonly PlayerFigurePoint[];
  teams: { teamId: string; teamName: string }[];
}) {
  const [playerIds, setPlayerIds] = useUrlState(playerCodec, EMPTY);
  const [rankParam, setRankParam] = useUrlState(rankCodec, EMPTY);
  const ranks = useMemo(() => rankParam.flatMap(v => { const r = parseRank(v); return r && rankIndex.has(r.key) ? [r] : []; }), [rankParam, rankIndex]);
  const playerSet = useMemo(() => new Set(playerIds), [playerIds]);
  const topIds = useMemo(() => { const s = new Set<string>(); for (const r of ranks) for (const id of rankIndex.topIds(r.key, r.n)) s.add(id); return s; }, [ranks, rankIndex]);
  const has = (teamIds: readonly string[], playerId: string) => clubHas(teamIds) || playerSet.has(playerId) || topIds.has(playerId);
  const options = useMemo(() => [...points].sort((a, b) => a.name.localeCompare(b.name, 'ja')).map(p => ({
    value: p.playerId, label: `${p.name}（${p.teamIds.map(id => teamShortName(id, teams.find(t => t.teamId === id)?.teamName ?? p.teamName)).join('・')}）`,
  })), [points, teams]);
  const playerAxis: FilterAxis = multiSelectAxis({
    id: 'highlightPlayers', label: '強調する選手', options, selected: playerIds, onChangeSelected: setPlayerIds, allLabel: '指定なし', searchable: true, maxShown: 3,
  });
  const rows = rankParam.length ? rankParam : [];
  const setRow = (i: number, key: string, n: string) => setRankParam(rows.map((v, j) => (j === i ? `${key}:${n}` : v)));
  const first = rankIndex.items[0]?.key ?? 'pts';
  const rankAxis: FilterAxis = {
    kind: 'popover', id: 'highlightRank', label: '強調するランキング上位', tier: 'primary', value: rankParam.join(','), defaultValue: '',
    onChange: () => setRankParam(EMPTY),
    summary: ranks.length ? ranks.map(r => `${rankIndex.items.find(i => i.key === r.key)?.label ?? r.key} 上位${r.n}人`).join('・') : '指定なし',
    chipValue: ranks.map(r => `${rankIndex.items.find(i => i.key === r.key)?.label ?? r.key} 上位${r.n}人`).join('・'),
    content: <div className="highlight-rank-editor">
      {rows.map((v, i) => {
        const r = parseRank(v) ?? { key: first, n: 10 };
        return <div key={i} className="stat-condition-row">
          <select className="stat-condition-item" aria-label={`ランキング${i + 1}の項目`} value={r.key} onChange={e => setRow(i, e.target.value, String(r.n))}>
            {rankIndex.items.map(it => <option key={it.key} value={it.key}>{it.label}</option>)}
          </select>
          <span>上位</span>
          <NumberTextInput kind="text" className="stat-condition-value" aria-label={`ランキング${i + 1}の人数`} placeholder="人数" value={String(r.n)}
            onCommit={t => { const n = Number(t.trim()); if (Number.isInteger(n) && n >= 1) setRow(i, r.key, String(n)); }} />
          <span>人（同順位を含む）</span>
          <button type="button" className="stat-condition-remove" aria-label={`ランキング${i + 1}を削除`} onClick={() => setRankParam(rows.filter((_, j) => j !== i))}>×</button>
        </div>;
      })}
      <button type="button" onClick={() => setRankParam([...rows, `${first}:10`])}>＋ ランキング上位を追加</button>
    </div>,
  };
  const reset = () => { setPlayerIds(EMPTY); setRankParam(EMPTY); };
  return { key: `${playerIds.join(',')}|${rankParam.join(',')}`, has, playerAxis, rankAxis, reset, active: playerIds.length > 0 || ranks.length > 0 };
}
