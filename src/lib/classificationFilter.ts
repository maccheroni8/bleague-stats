import type { PlayerSummary } from "../../shared/types";

/**
 * 選手の登録区分（日本人/外国籍/帰化選手/アジア特別枠）による複数選択フィルタ。
 * 「全選手スタッツ」タブ（PlayersListPage.tsx）・ランキングページ選手版（RankingsPage.tsx）の
 * 両方から共通利用する（元はPlayersListPage.tsxに実装されていたものを抽出）
 */
export const CLASSIFICATION_OPTIONS: NonNullable<PlayerSummary["classification"]>[] = [
  "日本人",
  "外国籍",
  "帰化選手",
  "アジア特別枠",
];

export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** selectedが空集合のときは「全選手」（絞り込みなし）を意味する */
export function matchesClassificationFilter(
  p: PlayerSummary,
  selected: Set<NonNullable<PlayerSummary["classification"]>>,
): boolean {
  return selected.size === 0 || (p.classification !== undefined && selected.has(p.classification));
}
