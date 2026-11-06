// 図解「ベン図」（選手）の検証。人工データで基準の値の境目・向き・重なりへの振り分け・名前の配置を確かめ、
// 実データでは、選手の試合ログの合計から独立に値を出し直して（PTS・AST・3P%・TOV）、いくつかの条件で円に入る選手が一致することを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from "../shared/types";
import type { ScorerData } from "../src/lib/figureTopScorers";
import { buildPlayerFigurePoints } from "../src/lib/figurePlayerPoints";
import {
  availablePlayerVennItems, computePlayerVenn, DEFAULT_PLAYER_VENN_ITEMS, defaultPlayerVennThreshold, playerVennItemId, playerVennItems, resolvePlayerVennSelection,
} from "../src/lib/figurePlayerVenn";
import { layoutVennNames, VENN_MASKS, type VennMask } from "../src/lib/figureVenn";
import { FIGURES } from "../src/figures/catalog";

// --- 人工データ: 名前の配置 ---
{
  const mk = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ key: `${prefix}${i}`, label: `選手${i}` }));
  const few = new Map<VennMask, { key: string; label: string }[]>([[1, mk(2, "a")], [2, mk(2, "b")], [4, mk(2, "c")], [3, mk(1, "d")], [7, mk(1, "e")]]);
  const l1 = layoutVennNames(few, { size: 640, font: 11 });
  assert.equal(l1.placements.size, 8, "少ないときは全員の名前を置く");
  assert.equal(l1.collapsed.size, 0);
  const many = new Map<VennMask, { key: string; label: string }[]>([[1, mk(80, "a")], [2, mk(3, "b")], [4, mk(3, "c")], [7, mk(2, "e")]]);
  const l2 = layoutVennNames(many, { size: 640, font: 11 });
  assert.ok(l2.collapsed.has(1), "人数が多い領域は人数だけにする");
  assert.ok(!l2.collapsed.has(2) && !l2.collapsed.has(4), "少ない領域は名前のまま");
  assert.equal(l2.placements.size, 8, "ほかの領域の名前は全員置く");
  for (const [a, pa] of l2.placements) for (const [b, pb] of l2.placements) if (a < b) assert.ok(Math.abs(pa.x - pb.x) >= l2.box.width - 1 || Math.abs(pa.y - pb.y) >= l2.box.height - 1, `${a}と${b}が重ならない`);
  const set = new Set<VennMask>(VENN_MASKS);
  for (const m of l2.collapsed.keys()) assert.ok(set.has(m));
  console.log("選手のベン図: 名前の配置（全員表示・人数だけへの切り替え・重ならない）OK");
}

// --- 項目の選び方 ---
{
  const items = playerVennItems("2026-27");
  assert.ok(items.some(i => i.id === "traditional.pts") && items.some(i => i.id === "advanced.ortg") && items.some(i => i.id === "misc.stl" || i.category === "misc") && items.some(i => i.category === "scoring"), "4つのカテゴリの項目");
  assert.equal(new Set(items.map(i => i.id)).size, items.length, "項目の重複なし");
  const all = new Set(items.map(i => i.id)), order = items.map(i => i.id);
  assert.deepEqual(resolvePlayerVennSelection([], all, order), [...DEFAULT_PLAYER_VENN_ITEMS]);
  const dup = resolvePlayerVennSelection(["traditional.ast", "traditional.ast", "nothing"], all, order);
  assert.equal(new Set(dup).size, 3, "同じ項目・存在しない項目は直す");
  assert.equal(dup[0], "traditional.ast");
  assert.equal(defaultPlayerVennThreshold("traditional.pts", []), 15); assert.equal(defaultPlayerVennThreshold("traditional.ast", []), 5); assert.equal(defaultPlayerVennThreshold("traditional.3ppct", []), 40);
  assert.ok(FIGURES.some(f => f.id === "player-venn" && f.entity === "player" && f.label === "ベン図"), "選手の図に登録");
  console.log("選手のベン図: 項目の選び方・初期の基準の値OK");
}

// --- 実データ ---
const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };
const round2 = (v: number) => Number(v.toFixed(2));
const seasons = readdirSync("data").filter(s => /^20\d\d-\d\d$/.test(s)).sort();
const targets = [seasons[seasons.length - 1]!, seasons[seasons.length - 2]!, seasons[0]!];
let checked = 0, scenarios = 0;
for (const season of targets) for (const category of ["premier", "one"] as const) {
  const dir = `data/${season}${category === "one" ? "/one" : ""}`;
  if (!existsSync(`${dir}/players.json.gz`) && !existsSync(`${dir}/players.json`)) continue;
  const players = read<PlayerSummary[]>(`${dir}/players.json`), teams = read<ScorerData["teams"]>(`${dir}/teams.json`);
  const data: ScorerData = { players, teams, playerLogs: new Map(players.map(p => [p.playerId, read<PlayerGameLog[]>(`${dir}/player-games/${p.playerId}.json`)])), teamLogs: new Map(teams.map(t => [t.teamId, read<TeamGameLog[]>(`${dir}/team-games/${t.teamId}.json`)])), divisions: null, registrations: existsSync(`${dir}/registrations.json`) ? read(`${dir}/registrations.json`) : null };
  for (const gameType of ["regular", "both"] as const) {
    const points = buildPlayerFigurePoints(data, { season, category, range: { kind: "all" }, gameType, classification: "all" });
    if (!points.length) continue;
    for (const minRatio of [0, 50, 85]) {
      const eligible = points.filter(p => p.ratio >= minRatio);
      if (!eligible.length) continue;
      const available = availablePlayerVennItems(eligible, season);
      for (const id of ["traditional.pts", "traditional.ast", "traditional.3ppct", "traditional.tov"]) assert.ok(available.has(id) || eligible.every(p => p.raw.tpa === 0), `${id} は選べる`);
      const ids = [playerVennItemId("traditional", "pts"), playerVennItemId("traditional", "ast"), playerVennItemId("traditional", "3ppct")];
      const cases: [number, number, number][] = [[15, 5, 40], [8, 2, 30], [20, 7, 35.5], [0, 0, 0]];
      for (const thr of cases) {
        const { model } = computePlayerVenn(eligible, ids, season, thr);
        // 独立に出し直す: 試合ログの合計から1試合平均を出し、表示と同じ小数第2位に丸めて基準と比べる
        const expectedMask = (p: typeof eligible[number]) => {
          const g = p.raw.gamesPlayed;
          const pts = round2(p.raw.pts / g), ast = round2(p.raw.ast / g), three = p.raw.tpa > 0 ? round2(100 * p.raw.tpm / p.raw.tpa) : Number.NaN;
          return (pts >= thr[0] - 1e-9 ? 1 : 0) | (ast >= thr[1] - 1e-9 ? 2 : 0) | (three >= thr[2] - 1e-9 ? 4 : 0);
        };
        for (const p of eligible) { assert.equal(model.maskOf.get(p.id), expectedMask(p), `${season} ${category} ${p.name} 基準${thr.join("/")}`); checked++; }
        const regionTotal = [...model.regions.values()].reduce((s, l) => s + l.length, 0);
        assert.equal(regionTotal, eligible.length, "全員がどこかの領域（どれにも入らない含む）にいる");
        for (let i = 0; i < 3; i++) assert.equal(model.members[i]!.length, eligible.filter(p => (expectedMask(p) >> i) & 1).length, "円の人数");
        scenarios++;
      }
      // 少ないほうが良い項目（TOV）は「以下」
      const tovIds = [playerVennItemId("traditional", "tov"), playerVennItemId("traditional", "pts"), playerVennItemId("traditional", "ast")];
      const { model } = computePlayerVenn(eligible, tovIds, season, [2, 10, 3]);
      for (const p of eligible) {
        const g = p.raw.gamesPlayed, tov = round2(p.raw.tov / g), pts = round2(p.raw.pts / g), ast = round2(p.raw.ast / g);
        assert.equal(model.maskOf.get(p.id), (tov <= 2 + 1e-9 ? 1 : 0) | (pts >= 10 - 1e-9 ? 2 : 0) | (ast >= 3 - 1e-9 ? 4 : 0), `${season} ${p.name} TOV以下`);
      }
      // 基準を空にした円には誰も入らない
      assert.equal(computePlayerVenn(eligible, ids, season, [null, 5, 40]).model.members[0].length, 0);
      scenarios++;
    }
    // 配置: 現実の人数でも、置いた名前は重ならず、置けない領域は人数だけになる
    const eligible = points.filter(p => p.ratio >= 50);
    if (eligible.length) {
      const { model } = computePlayerVenn(eligible, [...DEFAULT_PLAYER_VENN_ITEMS], season, [8, 2, 30]);
      const groups = new Map<VennMask, { key: string; label: string }[]>();
      for (const [mask, list] of model.regions) if (mask !== 0) groups.set(mask, list.map(p => ({ key: p.id, label: p.name })));
      const layout = layoutVennNames(groups, { size: 640, font: 11 });
      const shown = new Set(layout.placements.keys());
      for (const [mask, list] of groups) assert.ok(layout.collapsed.has(mask) ? list.every(i => !shown.has(i.key)) : list.every(i => shown.has(i.key)), `領域${mask}は全員表示か人数だけのどちらか`);
    }
  }
}
assert.ok(checked > 0, "実データを確かめた");
console.log(`選手のベン図: 実データ ${targets.join("・")} で ${scenarios} 通りの条件・延べ ${checked} 人の振り分けが独立計算と一致 OK`);
