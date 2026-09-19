import type { PlayerSummary } from "../../shared/types";

/**
 * 選手の登録区分フィルタ・表示区分。
 *
 * classification（日本人/外国籍/帰化選手/アジア特別枠の4値、shared/types.ts参照）は
 * シーズン非依存の設計のため、リーグの保有枠ルール（帰化選手1名まで等）による
 * 「実際は帰化済みだが当該シーズンは外国籍枠で登録」というケースを正確には表現できない。
 * 一方「日本人かどうか」は確実に判定できるため、UI・集計・表示は全て
 * 「全選手/日本人/外国籍・帰化・アジア」の3区分（＝classificationの2区分への統合）に
 * 統一する。4値のclassification自体は、帰化選手・アジア特別枠選手が日本人と誤判定されるのを
 * 防ぐ目的（playerClassificationOverrides.ts参照）でデータ層には残す。
 *
 * 「全選手」タブ（PlayersListPage.tsx）・ランキングページ選手版（RankingsPage.tsx）の
 * 両方から共通利用する（元はPlayersListPage.tsxに実装されていたものを抽出）。
 */
export type ClassificationGroup = "日本人" | "外国籍・帰化・アジア";

export const CLASSIFICATION_GROUP_OPTIONS: ClassificationGroup[] = ["日本人", "外国籍・帰化・アジア"];

export function classificationGroup(
  c: PlayerSummary["classification"],
): ClassificationGroup | undefined {
  if (c === undefined) return undefined;
  return c === "日本人" ? "日本人" : "外国籍・帰化・アジア";
}

export type ClassificationGroupFilter = "all" | ClassificationGroup;

/** filterが"all"のときは絞り込みなし */
export function matchesClassificationGroupFilter(
  p: PlayerSummary,
  filter: ClassificationGroupFilter,
): boolean {
  return filter === "all" || classificationGroup(p.classification) === filter;
}

export function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export const POSITION_OPTIONS = ["PG", "SG", "SF", "PF", "C"] as const;

/** ポジションは「SG/SF」のような複数区分の併記がありうるため、"/"区切りのいずれかが
 * 選択中の区分に含まれていれば一致とみなす（複数選択はOR）。未選択は絞り込みなし */
export function matchesPositionFilter(p: PlayerSummary, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  if (!p.position) return false;
  return p.position.split("/").some((token) => selected.has(token));
}
