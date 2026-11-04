// 図解「Four Factors」（色分け表）の検証。人工データで色の段階（向き・同値・1チーム）を確かめ、
// 実データでは各チームの値を試合ログの合計から独立に計算し直して突き合わせ、色の段階が向きを含めて正しいことを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types";
import { filterByGameType, type SeasonGameTypeFilter } from "../shared/gameType";
import { buildRatingScatter } from "../src/lib/figureRatings";
import { buildAdvancedColumns, sumTeamGameLogs, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import { filterGameLogs, type SituationalRange } from "../src/lib/situational";
import { buildFourFactors, ffLevels, ffRanks, ffText, ffValue, sortFourFactors, FF_DEF, FF_DEFS, FF_KEYS, FF_NOTE, type FfKey } from "../src/lib/figureFourFactors";
import { FIGURES } from "../src/figures/catalog";

// --- 人工データ: 色の段階 ---
{
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(ffLevels(values, true), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], "多いほうが良い列: 大きいほど緑（4）");
  assert.deepEqual(ffLevels(values, false), [4, 4, 3, 3, 2, 2, 1, 1, 0, 0], "少ないほうが良い列: 向きが逆");
  assert.deepEqual(ffLevels([5], true), [2], "1チームだけなら真ん中");
  assert.deepEqual(ffLevels([], true), []);
  assert.deepEqual(ffLevels([1, 9], true), [0, 4], "2チームは両端");
  const tied = ffLevels([3, 3, 3, 3], true);
  assert.ok(tied.every(level => level === tied[0]), "全部同値なら同じ段階");
  assert.equal(tied[0], 2, "全部同値は真ん中（黄）");
  const mid = ffLevels([1, 5, 5, 9], true);
  assert.equal(mid[1], mid[2], "同値は同じ段階");
  assert.equal(mid[0], 0); assert.equal(mid[3], 4);
  // 26チーム: 最良＝4、最悪＝0、段階は良い順に増えるだけ（逆転しない）
  const many = Array.from({ length: 26 }, (_, i) => i * 1.37);
  for (const higher of [true, false]) {
    const levels = ffLevels(many, higher);
    assert.equal(levels[higher ? 25 : 0], 4); assert.equal(levels[higher ? 0 : 25], 0);
    const goodOrder = (higher ? [...levels] : [...levels].reverse());
    assert.ok(goodOrder.every((l, i) => i === 0 || l >= goodOrder[i - 1]!), "良い順に段階が下がらない");
    for (let l = 0; l < 5; l++) assert.ok(levels.includes(l), "26チームなら5段階すべて使う");
  }
  // 向きの定義（少ないほうが良い列は、依頼の一覧と一致）
  const lowerBetter = FF_DEFS.filter(def => !def.higherIsBetter).map(def => def.key).sort();
  assert.deepEqual(lowerBetter, ["drtg", "oppefg", "oppftr", "opporbpct", "tovpct"].sort(), "少ないほうが良い列＝DRtg・TOV%・相手のeFG%・OR%・FTR");
  assert.equal(FF_DEF.opptovpct.higherIsBetter, true, "相手のTOV%は多いほうが良い");
  assert.equal(FF_DEF.netrtg.higherIsBetter, true);
  assert.deepEqual(FF_DEFS.map(def => def.key), [...FF_KEYS], "列の並び");
  assert.deepEqual(FF_DEFS.map(def => def.label), ["NetRtg", "ORtg", "DRtg", "eFG%", "TOV%", "OR%", "FTR", "opp eFG%", "opp TOV%", "opp OR%", "opp FTR"]);
  assert.ok(FF_NOTE.includes("緑ほど良い") && FF_NOTE.includes("少ないほど良い"));
  assert.ok(FIGURES.some(f => f.id === "four-factors" && f.entity === "team"), "図解（チーム）に登録");
  console.log("Four Factors: 色の段階（向き・同値・1チーム・26チーム）・列の向き OK");
}

// --- 人工データ: 並べ替え・順位 ---
{
  const mk = (id: string, v: number, d: number) => ({ item: { id }, values: { netrtg: v, drtg: d } as unknown as Record<FfKey, number>, levels: {} as Record<FfKey, number> });
  const rows = [mk("a", 1, 100), mk("b", 5, 110), mk("c", 5, 90)];
  assert.deepEqual(sortFourFactors(rows, "netrtg", true).map(r => r.item.id).slice(0, 2).sort(), ["b", "c"], "NetRtg は大きい順");
  assert.deepEqual(sortFourFactors(rows, "drtg", true).map(r => r.item.id), ["c", "a", "b"], "DRtg は小さいほうが先");
  assert.deepEqual(sortFourFactors(rows, "drtg", false).map(r => r.item.id), ["b", "a", "c"], "押し直すと逆");
  assert.deepEqual(ffRanks(sortFourFactors(rows, "netrtg", true), "netrtg"), [1, 1, 3], "同値は同順位・次は飛ばす");
  console.log("Four Factors: 並べ替え・順位 OK");
}

// --- 実データ ---
const source = process.argv[2];
if (source) {
  const own = buildAdvancedColumns("perGame", "own"), opp = buildAdvancedColumns("perGame", "opp");
  let seasons = 0, compared = 0, colorChecks = 0;
  const read = (file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString());
  for (const season of readdirSync(source).filter(s => /^\d{4}-\d{2}$/.test(s))) {
    for (const [category, base] of [["premier", path.join(source, season)], ["one", path.join(source, season, "one")]] as const) {
      const teamFile = path.join(base, "teams.json.gz");
      if (!existsSync(teamFile)) continue;
      const teams = read(teamFile) as { teamId: string; teamName: string }[];
      const logs = new Map<string, TeamGameLog[]>();
      for (const team of teams) {
        const f = path.join(base, "team-games", team.teamId + ".json.gz");
        if (existsSync(f)) logs.set(team.teamId, read(f));
      }
      if (!logs.size) continue;
      for (const range of [{ kind: "all" }, { kind: "recent", n: 10 }] as SituationalRange[]) for (const gameType of ["regular", "playoff", "both"] as SeasonGameTypeFilter[]) {
        const model = buildRatingScatter(teams, logs, null, { season, category, range, gameType });
        if (!model.points.length) continue;
        const ff = buildFourFactors(model.points);
        for (const row of ff) {
          const point = row.item;
          // 全チームスタッツと同じ行（期間→試合区分→合計）を別に作る
          const selected = filterByGameType(filterGameLogs(logs.get(point.teamId)!, { range, includePlayoffs: true }, undefined, undefined, undefined, undefined, category), gameType);
          const ref: AllTeamsRow = { team: point, gamesPlayed: selected.length, wins: 0, losses: 0, totals: sumTeamGameLogs(selected) };
          const t = ref.totals;
          for (const key of FF_KEYS) {
            const def = FF_DEF[key];
            const column = (def.perspective === "own" ? own : opp).find(c => c.key === def.column)!;
            assert.equal(ffText(key, point.row), column.format!(ref), `${season} ${category} ${point.teamId} ${key} 全チームスタッツと同じ表示`);
            compared++;
          }
          // 式から独立に計算し直す（表示は小数第2位）
          const near = (key: FfKey, expected: number, label: string) => assert.ok(Math.abs(ffValue(key, point.row) - expected) <= 0.0051, `${season} ${category} ${point.teamId} ${label}: ${ffValue(key, point.row)} vs ${expected}`);
          near("efg", 100 * (t.fgm + 0.5 * t.tpm) / t.fga, "eFG%");
          near("oppefg", 100 * (t.oppFgm + 0.5 * t.oppTpm) / t.oppFga, "opp eFG%");
          near("tovpct", 100 * t.tov / (t.fga + 0.44 * t.fta + t.tov), "TOV%");
          near("opptovpct", 100 * t.oppTov / (t.oppFga + 0.44 * t.oppFta + t.oppTov), "opp TOV%");
          near("orbpct", 100 * t.oreb / (t.oreb + t.oppDreb), "OR%");
          near("opporbpct", 100 * t.oppOreb / (t.oppOreb + t.dreb), "opp OR%（相手のOR÷(相手のOR＋自チームのDR)）");
          near("ftr", 100 * t.fta / t.fga, "FTR");
          near("oppftr", 100 * t.oppFta / t.oppFga, "opp FTR");
          near("ortg", 100 * t.pts / t.poss, "ORtg");
          near("drtg", 100 * t.oppPts / t.poss, "DRtg");
          near("netrtg", 100 * (t.pts - t.oppPts) / t.poss, "NetRtg");
        }
        // 色: 表示値が良いチームほど段階が下がらない（向きを含む）。最良の値のチームは4、最悪は0
        for (const key of FF_KEYS) {
          const def = FF_DEF[key];
          const goodFirst = [...ff].sort((a, b) => (def.higherIsBetter ? b.values[key] - a.values[key] : a.values[key] - b.values[key]));
          goodFirst.forEach((row, i) => { if (i) assert.ok(row.levels[key] <= goodFirst[i - 1]!.levels[key], `${season} ${category} ${key} 良い順に段階が下がる`); });
          if (ff.length >= 2 && goodFirst[0]!.values[key] !== goodFirst.at(-1)!.values[key]) {
            assert.equal(goodFirst[0]!.levels[key], 4, `${season} ${category} ${key} 最良は緑`);
            assert.equal(goodFirst.at(-1)!.levels[key], 0, `${season} ${category} ${key} 最悪は赤`);
          }
          // ポップアップの順位（表示しているチームの中・良い順）が色の段階と矛盾しない: 順位が上なら段階は同じか良い。1位は最良の値
          const ranks = ffRanks(ff, key);
          assert.equal(Math.min(...ranks), 1, `${season} ${category} ${key} 1位がある`);
          ff.forEach((a, i) => ff.forEach((b, j) => {
            if (ranks[i]! < ranks[j]!) assert.ok(a.levels[key] >= b.levels[key], `${season} ${category} ${key} 順位と段階が矛盾`);
            if (ranks[i] === ranks[j]) assert.equal(a.values[key], b.values[key], `${season} ${category} ${key} 同順位は同じ値`);
            if (ranks[i]! < ranks[j]!) assert.ok(def.higherIsBetter ? a.values[key] > b.values[key] : a.values[key] < b.values[key], `${season} ${category} ${key} 上位は良い値（向き）`);
          }));
          const best = ff.filter((_, i) => ranks[i] === 1);
          assert.ok(best.every(row => row.values[key] === goodFirst[0]!.values[key]), `${season} ${category} ${key} 1位は最良の値`);
          colorChecks++;
        }
        // 絞り込み（先頭の半分だけ）では、残ったチームの中で色を決め直す
        const half = buildFourFactors(model.points.slice(0, Math.max(1, Math.ceil(model.points.length / 2))));
        for (const key of FF_KEYS) assert.deepEqual(half.map(r => r.levels[key]), ffLevels(half.map(r => r.values[key]), FF_DEF[key].higherIsBetter), `${season} ${category} ${key} 表示チームの中で色を決める`);
      }
      seasons++;
    }
  }
  assert.ok(seasons > 0 && compared > 0, "突き合わせる導出データが必要");
  console.log(`Four Factors: ${seasons}（シーズン×リーグ）で、${compared}件の値が全チームスタッツの表示と一致・式からの再計算と一致、色の段階 ${colorChecks}件の向き OK`);
}
