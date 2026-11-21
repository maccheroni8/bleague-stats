// 画面専用（図解の「全試合／ホーム／アウェイ」）。散布図・ベン図（チーム・選手）で共通。URL は `ven`（ほかのページの会場の条件と同じ名前・値）。
import type { UrlCodec } from './urlState';
import type { FilterAxis } from './filterAxes';

export type FigureVenue = 'all' | 'home' | 'away';
export const VENUE_LABELS: Record<FigureVenue, string> = { all: '全試合', home: 'ホーム', away: 'アウェイ' };
export const venueCodec: UrlCodec<FigureVenue> = {
  keys: ['ven'],
  read: p => { const v = p.get('ven'); return v === 'home' || v === 'away' ? v : undefined; },
  write: (p, v) => { if (v !== 'all') p.set('ven', v); },
};
/** 試合ログの絞り込み（filterGameLogs の filter）に足す部分。全試合なら何も足さない */
export const venueFilter = (venue: FigureVenue): { homeAway?: 'home' | 'away' } => (venue === 'all' ? {} : { homeAway: venue });
/** 試合ログの配列を会場で絞る（filterGameLogs を通さない集計用） */
export const filterByVenue = <T extends { isHome: boolean }>(logs: T[], venue: FigureVenue): T[] => (venue === 'all' ? logs : logs.filter(g => g.isHome === (venue === 'home')));
/** 保存画像のサブタイトル・条件の行に出す文字（全試合は載せない） */
export const venueConditionLabel = (venue: FigureVenue): string[] => (venue === 'all' ? [] : [`${VENUE_LABELS[venue]}の試合だけ`]);
export function venueAxis(value: FigureVenue, onChange: (v: FigureVenue) => void, disabledReason?: string): FilterAxis {
  return {
    kind: 'select', id: 'figVenue', label: '会場', tier: 'primary', value, defaultValue: 'all', disabledReason,
    options: (['all', 'home', 'away'] as const).map(v => ({ value: v, label: VENUE_LABELS[v] })),
    onChange: v => onChange(v as FigureVenue),
  };
}
