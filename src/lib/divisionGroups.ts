import type { Division, StandingsTeamSnapshot } from "../../shared/types";

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
