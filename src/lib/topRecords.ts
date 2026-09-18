/**
 * 個人詳細ページ「キャリアハイ」・チーム詳細ページ「クラブレコード」の項目名クリックで展開する
 * トップ10（同値タイの場合は末尾の順位を共有する全員を含める）を算出する共通ロジック。
 * 対象は「そのプレイヤー/チーム自身の全試合」で、既存のリーグ全体横断トップ20
 * （scripts/aggregate-league-rankings.tsのrankTopEntries、B.PREMIERレコードタブ用）とは別物。
 * こちらはバックエンド集計を経由せず、既にフロントエンドが持っている試合ログ配列から
 * その場で計算する。
 */

export const TOP_RECORD_N = 10;

/**
 * ワースト方向の展開件数（2026-09-16）。TOV/F/UFOUL等「高い方が悪い」項目
 * （lowerIsBetter: true）は、ワースト側だけトップ10ではなくトップ5にする
 * （ユーザー指定）。ベスト方向・それ以外の項目のワースト方向はTOP_RECORD_Nのまま
 */
export const TOP_RECORD_WORST_BAD_N = 5;

export interface TopRecordEntry<T> {
  /** 競技方式の順位（同値は同じ順位を共有し、次の順位が飛ぶ。例: 1,2,2,4） */
  rank: number;
  value: number;
  game: T;
}

/**
 * 全試合をソートし、上位N件を返す。ただしN件目の順位に同値タイが複数ある場合は、
 * その順位の全員を含める（11件以上になってもよい）。同値内の並びは日付降順
 * （新しい試合が先。CareerHighCard等の既存の「他◯試合」表示と同じ方針）
 */
export function computeTopRecordEntries<T extends { date: string }>(
  games: T[],
  value: (g: T) => number,
  lowerIsBetter: boolean,
  n: number = TOP_RECORD_N,
): TopRecordEntry<T>[] {
  if (games.length === 0) return [];
  const sorted = [...games].sort((a, b) => {
    const diff = value(a) - value(b);
    const primary = lowerIsBetter ? diff : -diff;
    if (primary !== 0) return primary;
    return a.date < b.date ? 1 : a.date > b.date ? -1 : 0;
  });
  const ranked: TopRecordEntry<T>[] = [];
  let rank = 1;
  for (let i = 0; i < sorted.length; i++) {
    const g = sorted[i]!;
    const v = value(g);
    if (i === 0 || v !== value(sorted[i - 1]!)) rank = i + 1;
    ranked.push({ rank, value: v, game: g });
  }
  const cutoffRank = ranked[Math.min(n, ranked.length) - 1]!.rank;
  return ranked.filter((e) => e.rank <= cutoffRank);
}
