import type { Category, Division, DivisionHistoryFile, StandingsTeamSnapshot } from "../../shared/types";

// 地区数は可変（東西2地区制のシーズンもあれば、過去の東・中・西3地区制のシーズンもある。
// DESIGN.md参照）。表示順は固定のこの並びとし、latestSnapshotに実際に存在する地区だけを表示する
export const DIVISION_ORDER: Division[] = ["east", "central", "west", "north", "south"];
export const DIVISION_LABELS: Record<Division, string> = {
  east: "東地区",
  west: "西地区",
  central: "中地区",
  north: "北地区",
  south: "南地区",
};

export function groupByDivision<T extends StandingsTeamSnapshot>(
  teams: T[],
): { division: Division; teams: T[] }[] {
  const byDivision = new Map<Division, T[]>();
  for (const t of teams) {
    if (!t.division) continue;
    const list = byDivision.get(t.division) ?? [];
    list.push(t);
    byDivision.set(t.division, list);
  }
  for (const list of byDivision.values()) {
    list.sort((a, b) => (a.divisionRank ?? 0) - (b.divisionRank ?? 0));
  }
  return DIVISION_ORDER.filter((d) => byDivision.has(d)).map((division) => ({
    division,
    teams: byDivision.get(division)!,
  }));
}

/**
 * クラブの複数選択に置く「◯地区を選択」ボタン（DESIGN.md 144章）。選択肢のクラブを、そのシーズンの地区構成（divisionOf）で
 * 地区ごとにまとめる。地区の数・名前はシーズンで変わる（東西2地区制・東中西3地区制）ので、選択肢に実際にいる地区だけを
 * DIVISION_ORDER の順に返す。地区が分からないクラブはどのボタンにも入れない
 */
export function divisionPresets(
  teamIds: string[],
  divisionOf: (teamId: string) => Division | null | undefined,
): { label: string; teamIds: string[] }[] {
  const byDivision = new Map<Division, string[]>();
  for (const id of teamIds) {
    const d = divisionOf(id);
    if (!d) continue;
    byDivision.set(d, [...(byDivision.get(d) ?? []), id]);
  }
  return DIVISION_ORDER.filter((d) => byDivision.has(d)).map((d) => ({ label: DIVISION_LABELS[d], teamIds: byDivision.get(d)! }));
}

/**
 * そのシーズンにある地区（data/division-history.json）を DIVISION_ORDER の順に返す。履歴にそのシーズンが無ければ空（地区の絞り込みの選択肢を出さない）。
 * 地区の数はシーズンで違う（東・中・西の3地区制と、東・西の2地区制）ので、選択肢はこの結果だけにする（DESIGN.md 213章）
 */
export function seasonDivisions(
  history: DivisionHistoryFile | null | undefined,
  season: string,
  category: Category = "premier",
): Division[] {
  const bySeason = history?.[category]?.[season];
  if (!bySeason) return [];
  const present = new Set<Division>(Object.values(bySeason));
  return DIVISION_ORDER.filter((d) => present.has(d));
}

/**
 * クラブの複数選択の表示（ボタン・チップ・タイトルの下の行で共通。DESIGN.md 252章）。
 * - 地区のクラブが全部選ばれているときは「東地区」のように地区名で書く。
 * - 地区のほとんど（外れているのが2クラブ以下で、選ばれているほうが多い）が選ばれているときは「東地区（群馬を除く）」と書く。
 * - 地区に入りきらない個別のクラブは、選択肢の並びでクラブ名を並べる（maxShown件まで。超えた分は「他N」）。
 * 例: 東地区を選ぶ → 「東地区」／東地区＋広島 → 「東地区、広島」／東地区から群馬を外す → 「東地区（群馬を除く）」。
 * 何も選んでいなければ空文字（呼び出し側が「全クラブ」を出す）。groups は地区ごとの一括選択（divisionPresets）と同じ形
 */
export function summarizeClubSelection(
  selectedIds: readonly string[],
  options: readonly { value: string; label: string }[],
  groups: readonly { label: string; values: readonly string[] }[],
  maxShown = 3,
): string {
  const selected = new Set(selectedIds);
  if (selected.size === 0) return "";
  const labelById = new Map(options.map((o) => [o.value, o.label]));
  const covered = new Set<string>();
  const groupParts: string[] = [];
  for (const g of groups) {
    const values = g.values.filter((v) => labelById.has(v));
    const missing = values.filter((v) => !selected.has(v));
    const chosen = values.length - missing.length;
    if (values.length === 0 || chosen === 0) continue;
    if (missing.length === 0) {
      groupParts.push(g.label);
    } else if (missing.length <= 2 && chosen > missing.length) {
      groupParts.push(`${g.label}（${missing.map((v) => labelById.get(v)!).join("、")}を除く）`);
    } else {
      continue;
    }
    for (const v of values) if (selected.has(v)) covered.add(v);
  }
  const rest = options.filter((o) => selected.has(o.value) && !covered.has(o.value)).map((o) => o.label);
  const text = [...groupParts, ...rest.slice(0, maxShown)].join("、");
  return rest.length > maxShown ? `${text} 他${rest.length - maxShown}` : text;
}
