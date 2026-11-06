// 図解「ベン図」の検証。人工データで上位の選び方（向き・同じ値・上位の数）と配置を確かめ、
// 実データでは、ランキング（RankedList）と同じ手順で独立に順位を付け直して、選んだ項目の値・順位・上位の入れ方が一致することを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types";
import { filterByGameType, type SeasonGameTypeFilter } from "../shared/gameType";
import { filterGameLogs, type SituationalRange } from "../src/lib/situational";
import { sumTeamGameLogs, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import { computeVenn, displayNumber, layoutVenn, vennEmphasisScales, rankVennRows, thresholdVennRows, topVennRows, vennLabelBoxes, vennMaskAt, VENN_MASKS, VENN_DESIGN_WIDTH, type VennMask } from "../src/lib/figureVenn";
import {
  buildVennRows, computeTeamVenn, defaultVennThreshold, formatVennThreshold, vennLeagueRow, DEFAULT_VENN_SELECTION, itemHasPerspective, resolveVennSelection, vennColumn, vennItemId, vennItemLabel, vennItems, VENN_CATEGORIES, type VennSelection,
} from "../src/lib/figureVennItems";
import { FIGURES } from "../src/figures/catalog";

// --- 人工データ: 上位の選び方 ---
{
  const mk = (values: number[], text = (v: number) => v.toFixed(2)) => values.map((value, i) => ({ row: `t${i}`, value, text: text(value) }));
  const members = (values: number[], n: number, higher = true, text?: (v: number) => string) => topVennRows(rankVennRows(mk(values, text), higher), n).map(r => r.row).sort();
  assert.deepEqual(members([5, 9, 7, 8, 6], 2), ["t1", "t3"], "多いほうが良い: 大きい2つ");
  assert.deepEqual(members([5, 9, 7, 8, 6], 2, false), ["t0", "t4"], "少ないほうが良い（DRtg・TOV%）: 小さい2つ");
  assert.deepEqual(members([10, 9, 9, 9, 5], 1), ["t0"], "上位1: 同じ値の境目なし");
  assert.deepEqual(members([10, 9, 9, 9, 5], 2), ["t0", "t1", "t2", "t3"], "境目（2番目）が同じ値のとき、同じ値を全部入れる");
  assert.deepEqual(members([10, 9, 9, 9, 5], 3), ["t0", "t1", "t2", "t3"], "3番目も同じ値の中: 全部入れる");
  assert.deepEqual(members([10, 9, 9, 9, 5], 4), ["t0", "t1", "t2", "t3"], "4番目まで同じ値でちょうど");
  assert.deepEqual(members([10, 9, 9, 9, 5], 5), ["t0", "t1", "t2", "t3", "t4"]);
  assert.deepEqual(members([9, 9, 9], 2), ["t0", "t1", "t2"], "全部同じ値なら全部");
  assert.deepEqual(members([9, 8, 8, 7], 2), ["t0", "t1", "t2"], "上位2＝2位が同率の2チーム");
  assert.deepEqual(members([9, 8, 8, 7, 7], 4), ["t0", "t1", "t2", "t3", "t4"], "4位が7の同率なら両方");
  assert.deepEqual(members([9, 8, 8, 7, 6], 3), ["t0", "t1", "t2"], "3番目が2位同率の2番目: 次の7は入れない");
  assert.deepEqual(members([1, 2, 3], 10), ["t0", "t1", "t2"], "チーム数より大きい上位の数");
  assert.deepEqual(members([], 5), []);
  // 同じ値かどうかは、画面に表示している値（丸めた後）で決める（ランキングと同じ）
  assert.deepEqual(members([1.001, 1.002, 0.5], 1), ["t0", "t1"], "表示が同じ（1.00）なら同じ値");
  assert.deepEqual(members([1.001, 1.009, 0.5], 1), ["t1"], "表示が違えば別の値");
  assert.deepEqual(members([Number.NaN, 3, 2], 1), ["t1"], "値のない行は並びに入れない");
  const ranked = rankVennRows(mk([10, 9, 9, 9, 5]), true);
  assert.deepEqual(ranked.map(r => r.rank), [1, 2, 2, 2, 5], "同順位の次は飛ばす");
  console.log("ベン図: 上位の選び方（向き・同じ値の境目・上位の数・表示値での同値）OK");
}

// --- 人工データ: 重なりへの振り分け ---
{
  const rows = ["a", "b", "c", "d", "e", "f", "g", "h"];
  const val = [[8, 7, 6, 5, 4, 3, 2, 1], [1, 8, 7, 6, 2, 3, 4, 5], [3, 4, 8, 7, 6, 5, 2, 1]];
  const specs = val.map(v => ({ value: (r: string) => v[rows.indexOf(r)]!, text: (r: string) => String(v[rows.indexOf(r)]), higherIsBetter: true })) as unknown as Parameters<typeof computeVenn<string>>[2];
  const venn = computeVenn(rows, r => r, specs, 3);
  // 円1の上位3＝a,b,c、円2＝b,c,d、円3＝c,d,e
  assert.deepEqual(venn.members.map(m => m.map(x => x.row).sort()), [["a", "b", "c"], ["b", "c", "d"], ["c", "d", "e"]]);
  assert.equal(venn.maskOf.get("c"), 7, "3つとも入るのは真ん中");
  assert.equal(venn.maskOf.get("a"), 1); assert.equal(venn.maskOf.get("b"), 3); assert.equal(venn.maskOf.get("d"), 6); assert.equal(venn.maskOf.get("e"), 4);
  assert.deepEqual((venn.regions.get(0) ?? []).sort(), ["f", "g", "h"], "どれにも入らない");
  assert.equal([...venn.regions.values()].flat().length, rows.length, "すべてのチームがどこかに置かれる");
  assert.equal(venn.rankOf[0]!.get("a"), 1);
  console.log("ベン図: 重なりへの振り分け（真ん中・2つの重なり・どれにも入らない）OK");
}

// --- 人工データ: 値で絞る ---
{
  assert.equal(displayNumber("115.00"), 115); assert.equal(displayNumber("35.06%"), 35.06); assert.equal(displayNumber("+3.20"), 3.2); assert.equal(displayNumber("-1.50"), -1.5);
  assert.equal(displayNumber("1,234"), 1234); assert.equal(displayNumber("28:30"), 28.5); assert.ok(Number.isNaN(displayNumber("-")));
  const mk = (values: number[], text = (v: number) => v.toFixed(2)) => values.map((value, i) => ({ row: `t${i}`, value, text: text(value) }));
  const pick = (values: number[], thr: number, higher: boolean) => thresholdVennRows(rankVennRows(mk(values), higher), thr, higher).map(r => r.row).sort();
  assert.deepEqual(pick([110, 115, 120, 105], 115, true), ["t1", "t2"], "多いほうが良い項目は「以上」（基準と同じ値は入る）");
  assert.deepEqual(pick([100, 108, 110, 120], 108, false), ["t0", "t1"], "少ないほうが良い項目は「以下」（基準と同じ値は入る）");
  assert.deepEqual(pick([115.004, 114.996, 120], 115, true), ["t0", "t1", "t2"], "表示値（115.00）で比べるので、115.00と表示されるチームは入る");
  assert.deepEqual(pick([1, 2, 3], 10, true), [], "基準が厳しすぎれば0チーム");
  assert.deepEqual(pick([1, 2, 3], -5, true), ["t0", "t1", "t2"], "基準がゆるければ全部");
  assert.deepEqual(pick([Number.NaN, 5], 0, true), ["t1"], "値のないチームは入らない");
  assert.equal(formatVennThreshold(115, "109.16"), "115.00"); assert.equal(formatVennThreshold(35, "35.06%"), "35.00%"); assert.equal(formatVennThreshold(3, "+3.20"), "+3.00"); assert.equal(formatVennThreshold(1234, "1,234"), "1234"); assert.equal(formatVennThreshold(28.5, "28:30"), "28:30");
  // computeVenn は値で絞る関数も受け取る
  const rows = ["a", "b", "c", "d"], vals = [[9, 8, 7, 6], [1, 2, 3, 4], [5, 5, 5, 5]];
  const specs = vals.map((v, i) => ({ value: (r: string) => v[rows.indexOf(r)]!, text: (r: string) => v[rows.indexOf(r)]!.toFixed(2), higherIsBetter: i !== 1 })) as unknown as Parameters<typeof computeVenn<string>>[2];
  const venn = computeVenn(rows, r => r, specs, (ranked, i) => thresholdVennRows(ranked, [8, 2, 5][i]!, specs[i]!.higherIsBetter));
  assert.deepEqual(venn.members.map(m => m.map(x => x.row).sort()), [["a", "b"], ["a", "b"], ["a", "b", "c", "d"]]);
  assert.equal(venn.maskOf.get("a"), 7); assert.equal(venn.maskOf.get("c"), 4); assert.deepEqual(venn.regions.get(0), undefined);
  console.log("ベン図: 値で絞る（以上・以下の向き・基準と同じ値・表示値での比較・0チーム・全部）OK");
}

// --- 配置: 領域の外に出ない・重ならない ---
function checkLayout(counts: Record<number, number>, size: number, labelFont: number, name: string) {
  const groups = new Map<VennMask, { key: string; label: string }[]>();
  for (const mask of VENN_MASKS) { const n = counts[mask] ?? 0; if (n) groups.set(mask, Array.from({ length: n }, (_, i) => ({ key: `${mask}-${i}`, label: "宇都宮" }))); }
  const names = vennLabelBoxes(size, [["ORtg", "115.00以上"], ["DRtg", "上位10"], ["3P%", "上位10"]], labelFont + 1);
  const layout = layoutVenn(groups, { size, labelFont, obstacles: names });
  const scale = size / VENN_DESIGN_WIDTH;
  names.forEach((b, i) => { assert.equal(vennMaskAt(b.x, b.y, scale), 1 << i, `${name} 円${i}の名前は、その円だけの場所`); assert.ok(b.x - b.width / 2 >= 0 && b.x + b.width / 2 <= size, `${name} 円の名前が図の幅に収まる`); });
  const boxes: { x: number; y: number }[] = [];
  for (const [mask, items] of groups) for (const item of items) {
    const p = layout.placements.get(item.key)!;
    assert.ok(p, `${name} 置き場所がある`);
    if (layout.fitted) {
      for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1]) assert.equal(vennMaskAt(p.x + dx * layout.box.width * 0.35, p.y + dy * layout.box.height * 0.35, scale), mask, `${name} 箱の中心部が領域${mask}の中`);
      names.forEach((b, i) => assert.ok(Math.abs(p.x - b.x) >= (layout.box.width + b.width) / 2 || Math.abs(p.y - b.y) >= (layout.box.height + b.height) / 2, `${name} ロゴが円の名前と重ならない`));
      for (const q of boxes) assert.ok(Math.abs(p.x - q.x) >= layout.box.width || Math.abs(p.y - q.y) >= layout.box.height, `${name} 箱が重ならない`);
    }
    boxes.push(p);
  }
  // 強調するクラブの倍率: 1〜1.3倍で、ほかの枠・円の名前の枠と重ならない（重なるときは倍率を下げる）
  const keys = [...layout.placements.keys()];
  const emphasized = new Set(keys.filter((_, i) => i % 3 === 0));
  const scales = vennEmphasisScales(layout.placements, layout.box, emphasized, names);
  assert.equal(scales.size, emphasized.size);
  for (const [k, f] of scales) {
    assert.ok(f >= 1 && f <= 1.3 + 1e-9, `${name} 倍率 ${f}`);
    const a = layout.placements.get(k)!;
    for (const other of keys) if (other !== k) { const q = layout.placements.get(other)!, g = scales.get(other) ?? 1; if (f > 1 || g > 1) assert.ok(Math.abs(a.x - q.x) >= (layout.box.width * (f + g)) / 2 - 1e-6 || Math.abs(a.y - q.y) >= (layout.box.height * (f + g)) / 2 - 1e-6 || (f === 1 && g === 1), `${name} 強調したロゴが重ならない`); }
  }
  return layout;
}
{
  for (const [size, font] of [[640, 11], [760, 11], [375, 9], [340, 9], [320, 9]] as const) {
    for (const counts of [{ 7: 3, 3: 2, 5: 2, 6: 1, 1: 2, 2: 1, 4: 2 }, { 7: 1, 3: 2, 5: 2, 6: 2, 1: 3, 2: 3, 4: 3 }, { 7: 4, 3: 3, 5: 2, 6: 2, 1: 3, 2: 3, 4: 3 }, { 7: 5, 1: 4, 2: 4, 4: 4 }, { 1: 10 }] as Record<number, number>[]) {
      const layout = checkLayout(counts, size, font, `幅${size} ${JSON.stringify(counts)}`);
      assert.ok(layout.fitted, `幅${size}で収まる ${JSON.stringify(counts)}`);
      assert.ok(layout.logo >= (size >= 600 ? 16 : 14), `幅${size}のロゴの大きさ ${layout.logo}`);
      if (size >= 600) assert.ok(layout.labels, "PC幅では略称も出す");
    }
  }
  // 3つの円が同じ10チームで重なる極端な場合は、収まらなくても置き場所は返す（落ちない）
  const extreme = checkLayout({ 7: 10 }, 640, 11, "極端な重なり");
  assert.equal(extreme.placements.size, 10);
  // 隣が離れていれば1.3倍、すき間がなければ1倍のまま
  const far = vennEmphasisScales(new Map([["a", { x: 0, y: 0 }], ["b", { x: 500, y: 0 }]]), { width: 40, height: 50 }, new Set(["a"]));
  assert.equal(far.get("a"), 1.3, "離れていれば1.3倍");
  const near = vennEmphasisScales(new Map([["a", { x: 0, y: 0 }], ["b", { x: 42, y: 0 }]]), { width: 40, height: 50 }, new Set(["a"]));
  assert.ok(near.get("a")! < 1.3 && near.get("a")! >= 1, "すき間が小さければ倍率を下げる");
  assert.equal(vennEmphasisScales(new Map([["a", { x: 0, y: 0 }], ["b", { x: 40, y: 0 }]]), { width: 40, height: 50 }, new Set(["a"])).get("a"), 1, "接していれば1倍");
  console.log("ベン図: 配置（領域の中・重ならない・強調の倍率。幅320〜760px）OK");
}

// --- 項目の定義 ---
{
  for (const season of ["2025-26", "2026-27"]) {
    const items = vennItems(season);
    assert.equal(new Set(items.map(i => i.id)).size, items.length, `${season} 項目が重ならない`);
    assert.ok(items.some(i => i.id === vennItemId("advanced", "ortg")) && items.some(i => i.id === vennItemId("traditional", "3ppct")), "初期の3項目がある");
    for (const sel of DEFAULT_VENN_SELECTION) assert.ok(vennColumn(items.find(i => i.id === sel.item)!, sel.perspective, season), "初期の項目の列がある");
  }
  assert.deepEqual(VENN_CATEGORIES.map(c => c.key), ["traditional", "advanced", "misc", "scoring"]);
  // 同じ項目は2つの円で選べない
  const dup = resolveVennSelection([{ item: "advanced.ortg", perspective: "own" }, { item: "advanced.ortg", perspective: "opp" }, { item: "nothing", perspective: "own" }], "2025-26");
  assert.equal(new Set(dup.map(s => s.item)).size, 3, "同じ項目・存在しない項目は直される");
  assert.equal(dup[0]!.item, "advanced.ortg"); assert.equal(dup[1]!.item, "advanced.drtg"); assert.equal(dup[2]!.item, "traditional.3ppct");
  assert.equal(resolveVennSelection([{ item: "advanced.ortg", perspective: "opp" }, ...DEFAULT_VENN_SELECTION.slice(1)], "2025-26", () => false)[0]!.perspective, "own", "視点のない項目は自チームに固定");
  assert.equal(vennItemLabel(vennItems("2025-26").find(i => i.key === "efg")!, "opp"), "opp eFG%");
  assert.ok(FIGURES.some(f => f.id === "team-venn" && f.entity === "team"), "図解（チーム）に登録");
  console.log("ベン図: 項目の一覧・同じ項目を選べない・初期の3項目 OK");
}

// --- 実データ ---
const source = process.argv[2];
if (source) {
  const read = (file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString());
  let sets = 0, checks = 0, tied = 0, valueChecks = 0;
  const selections: VennSelection[][] = [
    [...DEFAULT_VENN_SELECTION],
    [{ item: "advanced.efg", perspective: "opp" }, { item: "advanced.tovpct", perspective: "own" }, { item: "advanced.orbpct", perspective: "own" }],
    [{ item: "traditional.pts", perspective: "own" }, { item: "traditional.tov", perspective: "own" }, { item: "advanced.netrtg", perspective: "own" }],
    [{ item: "traditional.fgpct", perspective: "diff" }, { item: "advanced.pace", perspective: "own" }, { item: "advanced.drtg", perspective: "opp" }],
  ];
  for (const season of readdirSync(source).filter(s => /^\d{4}-\d{2}$/.test(s))) {
    for (const [category, base] of [["premier", path.join(source, season)], ["one", path.join(source, season, "one")]] as const) {
      const teamFile = path.join(base, "teams.json.gz");
      if (!existsSync(teamFile)) continue;
      const teams = read(teamFile) as { teamId: string; teamName: string; advanced?: { offRtg?: number; defRtg?: number } }[];
      const logs = new Map<string, TeamGameLog[]>();
      for (const team of teams) { const f = path.join(base, "team-games", team.teamId + ".json.gz"); if (existsSync(f)) logs.set(team.teamId, read(f)); }
      if (!logs.size) continue;
      for (const range of [{ kind: "all" }, { kind: "recent", n: 10 }] as SituationalRange[]) for (const gameType of ["regular", "playoff", "both"] as SeasonGameTypeFilter[]) {
        const rows = buildVennRows(teams, logs, { category, range, gameType });
        if (rows.length < 3) continue;
        // 全チームスタッツと同じ行（期間→試合区分→合計）を別に作る
        const ref = new Map<string, AllTeamsRow>();
        for (const team of teams) {
          const selected = filterByGameType(filterGameLogs(logs.get(team.teamId) ?? [], { range, includePlayoffs: true }, undefined, undefined, undefined, undefined, category), gameType);
          if (selected.length) ref.set(team.teamId, { team, gamesPlayed: selected.length, wins: 0, losses: 0, totals: sumTeamGameLogs(selected) });
        }
        assert.equal(rows.length, ref.size, `${season} ${category} チーム数`);
        for (const selection of selections) {
          const items = vennItems(season);
          const resolved = resolveVennSelection(selection, season, id => itemHasPerspective(items.find(i => i.id === id)!, rows, season));
          for (const n of [5, 8, 10]) {
            const venn = computeTeamVenn(rows, resolved, season, n);
            resolved.forEach((sel, i) => {
              const column = vennColumn(items.find(it => it.id === sel.item)!, sel.perspective, season)!;
              const higher = column.higherIsBetter ?? true;
              // ランキング（RankedList）と同じ手順: 値で並べ、隣り合う行の表示値が同じなら同順位
              const list = [...ref.values()].filter(r => Number.isFinite(Number(column.sortValue(r)))).sort((a, b) => (Number(column.sortValue(a)) - Number(column.sortValue(b))) * (higher ? -1 : 1));
              const text = (r: AllTeamsRow) => column.format ? column.format(r) : String(column.sortValue(r));
              const rankAt = (idx: number) => { let j = idx; while (j > 0 && text(list[j - 1]!) === text(list[idx]!)) j--; return j + 1; };
              list.forEach((r, idx) => {
                assert.equal(venn.rankOf[i]!.get(r.team.teamId), rankAt(idx), `${season} ${category} ${range.kind} ${gameType} ${sel.item}/${sel.perspective} ${r.team.teamId} 順位`);
                assert.equal(text(venn.rankOf[i] ? rows.find(x => x.team.teamId === r.team.teamId)! : r), text(r), "表示値");
                checks++;
              });
              // 上位 n: n 番目の表示値と同じか、それより良い値のチームだけ
              const nth = list[Math.min(n, list.length) - 1]!;
              const expected = list.filter((r, idx) => idx < n || text(r) === text(nth)).map(r => r.team.teamId).sort();
              assert.deepEqual(venn.members[i]!.map(m => m.row.team.teamId).sort(), expected, `${season} ${category} ${gameType} ${sel.item} 上位${n}`);
              if (expected.length > n) tied++;
              // 上位に入らないチームは、境目の値より悪い（向きを含む）
              for (const r of list) if (!expected.includes(r.team.teamId)) assert.ok(higher ? Number(column.sortValue(r)) <= Number(column.sortValue(nth)) : Number(column.sortValue(r)) >= Number(column.sortValue(nth)), `${season} ${sel.item} 外のチームは境目より悪い`);
            });
            if (n === 5) {
              // 値で絞る: 基準の初期値＝リーグ平均（表示値）。良い側（以上／以下）に入るチームが円に入る。表示値で独立に数え直す
              const league = vennLeagueRow(rows)!;
              const thresholds = resolved.map(sel => defaultVennThreshold(items.find(it => it.id === sel.item)!, sel.perspective, season, league));
              const byValue = computeTeamVenn(rows, resolved, season, { basis: "value", top: n, thresholds });
              resolved.forEach((sel, i) => {
                const column = vennColumn(items.find(it => it.id === sel.item)!, sel.perspective, season)!;
                const higher = column.higherIsBetter ?? true;
                const text = (r: AllTeamsRow) => column.format ? column.format(r) : String(column.sortValue(r));
                const leagueText = text(league);
                assert.ok(thresholds[i] !== null && Number.isFinite(thresholds[i]!), `${season} ${sel.item} 基準の初期値がある`);
                assert.equal(formatVennThreshold(thresholds[i]!, leagueText), leagueText.replace(/^\+/, "") === leagueText ? leagueText : leagueText, "基準の初期値の書き方は、リーグ平均の表示と同じ");
                const expected = [...ref.values()].filter(r => { const v = displayNumber(text(r)); return Number.isFinite(v) && (higher ? v >= thresholds[i]! - 1e-9 : v <= thresholds[i]! + 1e-9); }).map(r => r.team.teamId).sort();
                assert.deepEqual(byValue.members[i]!.map(m => m.row.team.teamId).sort(), expected, `${season} ${category} ${gameType} ${sel.item} 値で絞る`);
                // 良い側のチームだけが入る: 入らないチームは基準より悪い側
                for (const r of ref.values()) if (!expected.includes(r.team.teamId)) { const v = displayNumber(text(r)); assert.ok(!Number.isFinite(v) || (higher ? v < thresholds[i]! : v > thresholds[i]!), `${season} ${sel.item} 外のチームは基準より悪い側`); }
                valueChecks++;
              });
            }
            // 領域の人数の合計＝チーム数、重なりの判定が円ごとの所属と一致
            assert.equal([...venn.regions.values()].flat().length, rows.length);
            for (const r of rows) {
              const mask = venn.maskOf.get(r.team.teamId)!;
              resolved.forEach((_, i) => assert.equal((mask & (1 << i)) !== 0, venn.members[i]!.some(m => m.row.team.teamId === r.team.teamId)));
            }
            // 実データでの配置（PC幅・スマホ幅）。収まらないものを数えるのではなく、収まる前提を確かめる
            if (category === "premier" && range.kind === "all" && gameType === "regular" && selection === selections[0]) {
              for (const [size, font] of [[760, 11], [340, 9]] as const) {
                const groups = new Map<VennMask, { key: string; label: string }[]>();
                for (const [mask, list] of venn.regions) if (mask !== 0) groups.set(mask, list.map(r => ({ key: r.team.teamId, label: "名古屋D" })));
                assert.ok(layoutVenn(groups, { size, labelFont: font }).fitted, `${season} 上位${n} 幅${size} 配置が収まる`);
              }
            }
          }
        }
        // teams.json（シーズン集計）の ORtg・DRtg と一致（全期間・レギュラー）
        if (range.kind === "all" && gameType === "regular") {
          const items = vennItems(season);
          for (const team of teams) {
            const row = rows.find(r => r.team.teamId === team.teamId);
            if (!row || team.advanced?.offRtg === undefined) continue;
            const o = Number(vennColumn(items.find(i => i.id === "advanced.ortg")!, "own", season)!.sortValue(row)), d = Number(vennColumn(items.find(i => i.id === "advanced.drtg")!, "own", season)!.sortValue(row));
            assert.ok(Math.abs(o - team.advanced.offRtg) < 0.5 && Math.abs(d - team.advanced.defRtg!) < 0.5, `${season} ${category} ${team.teamId} ORtg・DRtg が teams.json と近い（${o}/${team.advanced.offRtg}, ${d}/${team.advanced.defRtg}）`);
          }
        }
      }
      sets++;
    }
  }
  assert.ok(sets > 0 && checks > 0, "突き合わせる導出データが必要");
  console.log(`ベン図: ${sets}（シーズン×リーグ）・${checks}件の順位がランキングと同じ手順の再計算と一致、上位の入れ方（同じ値で上位の数より多くなる場合 ${tied}回を含む）一致、値で絞る ${valueChecks}円 OK`);
}
