// 登録区分の絞り込みを、選手の1試合行の索引の「試合ごとの区分」で判定する部品（DESIGN.md 298章）。
// 2026-27 以降の索引は行ごとの区分（rows.cls）を持ち、シーズンの途中で区分が変わった選手は試合ごとに区分が違う。
// 試合単位で絞れない集計（On/Off・組み合わせの出場区間など）で、「その区分で出場した試合だけ」を数えるために使う。
// 画面だけの部品（保存キーの対象外）。
import type { PlayerGameIndexFile } from "../../shared/gameIndex";
import { indexRowClassMatches, type ClassificationGroupFilter } from "./classificationFilter";

export interface IndexClassScope {
  /** そのシーズンの出場試合が、すべてその区分 → "all"、1試合も無い（出場が無い選手も） → "none"、一部だけ（途中で区分が変わった） → "some" */
  status(playerId: string): "all" | "none" | "some";
  /** その試合（scheduleKey）で、その選手がその区分で出場したか */
  inClass(playerId: string, scheduleKey: string): boolean;
}

const cache = new WeakMap<object, Map<string, IndexClassScope>>();

export function indexClassScope(file: Pick<PlayerGameIndexFile, "players" | "rows" | "games">, filter: ClassificationGroupFilter): IndexClassScope {
  let byFilter = cache.get(file);
  if (!byFilter) {
    byFilter = new Map();
    cache.set(file, byFilter);
  }
  const hit = byFilter.get(filter);
  if (hit) return hit;
  const { rows, players, games } = file;
  // 選手ごとの [当てはまる試合数, 出場試合数] と、当てはまる試合の集合
  const counts = new Map<string, [number, number]>();
  const matched = new Map<string, Set<string>>();
  for (let i = 0; i < rows.player.length; i++) {
    const id = players[rows.player[i]!]![0];
    const c = counts.get(id) ?? [0, 0];
    c[1] += 1;
    if (filter === "all" || indexRowClassMatches(file, i, filter)) {
      c[0] += 1;
      let set = matched.get(id);
      if (!set) {
        set = new Set();
        matched.set(id, set);
      }
      set.add(games.key[rows.game[i]!]!);
    }
    counts.set(id, c);
  }
  const scope: IndexClassScope = {
    status: (id) => {
      const c = counts.get(id);
      if (!c || c[0] === 0) return "none";
      return c[0] === c[1] ? "all" : "some";
    },
    inClass: (id, key) => matched.get(id)?.has(key) ?? false,
  };
  byFilter.set(filter, scope);
  return scope;
}
