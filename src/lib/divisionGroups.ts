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

export function groupByDivision(
  teams: StandingsTeamSnapshot[],
): { division: Division; teams: StandingsTeamSnapshot[] }[] {
  const byDivision = new Map<Division, StandingsTeamSnapshot[]>();
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
