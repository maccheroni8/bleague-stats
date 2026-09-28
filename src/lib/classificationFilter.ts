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

/**
 * 登録区分の配色（日本人＝赤、外国籍・帰化・アジア＝青）。得点構成・失点構成（登録区分）の棒グラフ、チーム詳細・試合詳細の
 * 登録区分別の円グラフは、すべてここから色を取る（DESIGN.md 136章）
 */
export const CLASSIFICATION_COLORS = {
  japanese: "#e06666",
  international: "#5b9bd5",
} as const;

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

/**
 * ポジションの絞り込み（DESIGN.md 171章）。選択肢は登録どおり（完全一致）だけで、ポジションの順に PG・PG/SG・SG・SG/SF・SF・SF/PF・PF・C/PF・C。
 * 「PG」は登録が PG だけの選手（PG/SG は入らない）。PF/C と C/PF は同じ組み合わせの書き方の違い（2019-20まで PF/C、2020-21から C/PF）なので、
 * 値は "C/PF" に固定して1つにまとめる。複数選択は、どれかに当てはまれば一致（OR）。未選択は絞り込みなし
 */
const POSITION_FILTER_ORDER = ["PG", "PG/SG", "SG", "SG/SF", "SF", "SF/PF", "PF", "C/PF", "C"] as const;
/** 同じ組み合わせの別の書き方 → URL等で使う値 */
const POSITION_ALIASES: Record<string, string> = { "PF/C": "C/PF" };

/** 登録ポジション（"PG"・"PG/SG"・"PF/C" 等）→ 絞り込みの値（"PG"・"PG/SG"・"C/PF" 等） */
function positionFilterValue(position: string): string {
  return POSITION_ALIASES[position] ?? position;
}

export function matchesPositionFilter(p: PlayerSummary, selected: ReadonlySet<string>): boolean {
  if (selected.size === 0) return true;
  if (!p.position) return false;
  return selected.has(positionFilterValue(p.position));
}

/**
 * ポジションの絞り込みの選択肢。そのシーズンの選手に実際にある登録だけを出す（URL 等で選択中のものは、そのシーズンに無くても外せるよう残す）。
 * まとめた組み合わせ（C/PF）の表記は、そのシーズンで多い方の書き方
 */
export function positionFilterOptions(
  players: Pick<PlayerSummary, "position">[] | null | undefined,
  selected: readonly string[] = [],
): { value: string; label: string }[] {
  const counts = new Map<string, number>();
  for (const p of players ?? []) if (p.position) counts.set(p.position, (counts.get(p.position) ?? 0) + 1);
  const present = new Set([...counts.keys()].map(positionFilterValue));
  const selectedSet = new Set(selected);
  const labelOf = (value: string): string => {
    // まとめた組み合わせは、そのシーズンで多い方の書き方（同数・どちらも無いときは値の書き方）
    const aliases = Object.entries(POSITION_ALIASES).filter(([, to]) => to === value).map(([from]) => from);
    return [value, ...aliases].reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a));
  };
  return POSITION_FILTER_ORDER.filter((v) => present.has(v) || selectedSet.has(v)).map((v) => ({ value: v, label: labelOf(v) }));
}

export function selectedPositionLabels(options: { value: string; label: string }[], selected: readonly string[]): string[] {
  const set = new Set(selected);
  return options.filter((o) => set.has(o.value)).map((o) => o.label);
}
