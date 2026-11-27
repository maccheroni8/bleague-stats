import { useState } from 'react';
import type { FilterAxis, FilterMultiAxis } from '../lib/filterAxes';
import { MultiSelectContent } from '../components/FilterBar';
import type { usePlayerHighlight } from './usePlayerHighlight';

type PlayerHighlight = ReturnType<typeof usePlayerHighlight>;
type Tab = 'club' | 'player' | 'rank';

function HighlightPanel({ club, ph }: { club: FilterMultiAxis; ph?: PlayerHighlight }) {
  const [tab, setTab] = useState<Tab>('club');
  const player = ph?.playerAxis as FilterMultiAxis | undefined;
  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: 'club', label: 'クラブ', count: club.selected.length },
    ...(ph && player ? [{ id: 'player' as const, label: '選手', count: ph.playerCount }, { id: 'rank' as const, label: 'ランキング上位', count: ph.rankCount }] : []),
  ];
  return <div className="highlight-panel">
    {tabs.length > 1 && <div className="highlight-tabs" role="tablist" aria-label="強調の種類">
      {tabs.map(t => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`highlight-tab${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
        {t.label}{t.count > 0 ? `（${t.count}）` : ''}
      </button>)}
    </div>}
    {tab === 'club' && <MultiSelectContent axis={club} />}
    {tab === 'player' && player && <MultiSelectContent axis={player} />}
    {tab === 'rank' && ph && ph.rankAxis.kind === 'popover' && ph.rankAxis.content}
    <p className="highlight-note">どれか1つに当てはまる選手を強調します（サブタイトルには出しません）。</p>
  </div>;
}

/** 図解の「強調」: クラブ・選手・ランキング上位を1つの欄にまとめ、押すと開く窓の中で切り替えて選ぶ。選手の図以外（ph なし）はクラブだけ */
export function highlightAxis(club: FilterAxis, ph?: PlayerHighlight): FilterAxis {
  const clubAxis = club as FilterMultiAxis;
  const total = clubAxis.selected.length + (ph ? ph.playerCount + ph.rankCount : 0);
  const parts = [
    ...(clubAxis.selected.length ? [`クラブ ${clubAxis.summary}`] : []),
    ...(ph && ph.playerCount ? [`選手 ${ph.playerCount}人`] : []),
    ...(ph && ph.rankCount && ph.rankAxis.kind === 'popover' ? [`ランキング ${ph.rankAxis.summary}`] : []),
  ];
  return {
    kind: 'popover', id: 'highlight', label: '強調', tier: 'primary',
    value: total ? `${clubAxis.value}|${ph?.key ?? ''}` : '', defaultValue: '',
    onChange: () => { clubAxis.onChangeSelected([]); ph?.reset(); },
    summary: total ? `${total}件` : 'なし',
    chipValue: parts.join('／'),
    content: <HighlightPanel club={clubAxis} ph={ph} />,
  };
}
