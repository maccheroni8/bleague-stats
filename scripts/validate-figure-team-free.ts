// 図解「チームの自由な散布図」と「図の設定の保存」の検証。
// 人工データで軸（目盛りと単位）・保存の読み書き（保存できない環境を含む）を確かめ、実データでは、
// ①以前の「シュート% × 試投数」と同じ組み合わせで同じ点が出ること ②全チームスタッツの値（合計から独立に計算）と点の値が一致すること
// ③表の文字と点の値が食い違わないこと（%・時間・小数の桁）④Shooting・Forced TOV の値がシーズン通算と一致することを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog, TeamSummary } from "../shared/types";
import {
  buildFreeRows, DEFAULT_FREE_X, DEFAULT_FREE_Y, freeAxisDomain, freeColumn, freeItemId, freeItemName, freeItems, freeTickText, inferFreeAxis, resolveFreeItem,
  freeCategoryBlock, FREE_CATEGORIES,
} from "../src/lib/figureTeamFree";
import { buildShootTeams, SHOOT_X, SHOOT_Y, SHOOT_X_COLUMN, SHOOT_Y_COLUMN } from "../src/lib/figureShooting";
import { sumTeamGameLogs, type TeamPerspective } from "../src/lib/teamStatsColumns";
import { filterByGameType } from "../shared/gameType";
import { filterGameLogs } from "../src/lib/situational";
import { FIGURES } from "../src/figures/catalog";
import { normalizeFigureParams } from "../src/lib/figureRoute";
import {
  applyPresetParams, deletePreset, loadPresets, parsePresets, presetMatches, presetQuery, presetStorageAvailable, presetUrl, renamePreset, savePresets, upsertPreset,
  PRESET_STORAGE_KEY, type FigurePreset, type PresetStorage,
} from "../src/lib/figurePresets";

// --- 軸（目盛りと単位） ---
{
  const pct = { unit: "percent", scale: 100, signed: false, digits: 2 } as const;
  const d = freeAxisDomain([0.331, 0.372], { ...pct, scale: 1 }, false);
  assert.ok(d.min <= 0.331 && d.max >= 0.372 && d.ticks.length >= 3 && d.ticks.length <= 12, `率の軸 ${JSON.stringify(d)}`);
  const d2 = freeAxisDomain([31.2, 39.8, null], { unit: "percent", scale: 1, signed: false, digits: 2 }, false);
  assert.ok(d2.min >= 0 && d2.max <= 100 && d2.min <= 31.2 && d2.max >= 39.8);
  assert.equal(freeTickText(35, { unit: "percent", scale: 1, signed: false, digits: 2 }, { min: 30, max: 40, step: 5, ticks: [30, 35, 40] }), "35%");
  assert.equal(freeTickText(2.5, { unit: "percent", scale: 1, signed: true, digits: 2 }, { min: -5, max: 5, step: 2.5, ticks: [] }), "+2.5%");
  const diff = freeAxisDomain([-3.2, 4.1], { unit: "number", scale: 1, signed: true, digits: 2 }, true);
  assert.ok(diff.min <= -3.2 && diff.max >= 4.1 && diff.ticks.includes(0), "差の軸は0を含む");
  const count = freeAxisDomain([20, 38], { unit: "number", scale: 1, signed: false, digits: 2 }, false);
  assert.ok(count.min >= 0 && count.min <= 20 && count.max >= 38);
  const flat = freeAxisDomain([5, 5], { unit: "number", scale: 1, signed: false, digits: 2 }, false);
  assert.ok(flat.max > flat.min, "同じ値だけでも幅を持つ");
  const time = freeAxisDomain([199 * 60 + 30, 201 * 60 + 10], { unit: "time", scale: 60, signed: false, digits: 0 }, false);
  assert.ok(time.step % 5 === 0 && time.step <= 60, `時間の刻み ${time.step}`);
  assert.equal(freeTickText(200 * 60, { unit: "time", scale: 60, signed: false, digits: 0 }, time), "200:00");
  assert.equal(freeTickText(-75, { unit: "time", scale: 60, signed: true, digits: 0 }, time), "-1:15");
  assert.deepEqual(freeAxisDomain([], { unit: "number", scale: 1, signed: false, digits: 0 }, false).ticks.length > 1, true, "点が無くても軸を作れる");
  assert.ok(FIGURES.some(f => f.id === "team-shooting" && f.entity === "team"), "図のIDは変えない");
  // 古い URL（shx・shy・v）が新しい図に読み替えられる（コーデックは画面側。ここでは図の登録とルートのみ）
  assert.equal(normalizeFigureParams(new URLSearchParams("entity=team&figure=team-shooting&shy=3p&shx=3pa")).get("figure"), "team-shooting");
  console.log("自由な散布図: 軸（目盛り・単位・0を含む・時間）OK");
}

// --- 項目 ---
{
  const items = freeItems("2026-27");
  assert.equal(new Set(items.map(i => i.id)).size, items.length, "項目のIDは重ならない");
  for (const c of FREE_CATEGORIES) assert.ok(items.some(i => i.category === c.key), `${c.label} に項目がある`);
  assert.ok(items.some(i => i.id === "traditional.3ppct") && items.some(i => i.id === "advanced.ortg") && items.some(i => i.id === "forcedTurnovers.total"));
  assert.ok(!items.some(i => i.id === "traditional.opppts"), "opp PTS は視点 opp の PTS と同じなので出さない");
  assert.equal(resolveFreeItem("ない.項目", "2026-27", DEFAULT_FREE_Y).id, DEFAULT_FREE_Y, "読めない項目は初期の項目");
  const by = (id: string) => items.find(i => i.id === id)!;
  assert.equal(freeItemName(by("advanced.ortg"), "opp"), "opp ORtg");
  assert.equal(freeItemName(by("advanced.ortg"), "diff"), "ORtg +/-");
  assert.equal(freeItemName(by("forcedTurnovers.total"), "own"), "Forced TOV 合計");
  const reasons = { shooting: "S", forcedTurnovers: "F", none: "N" };
  assert.equal(freeCategoryBlock("shooting", null, "one", reasons), "S");
  assert.equal(freeCategoryBlock("forcedTurnovers", null, "one", reasons), "F");
  assert.equal(freeCategoryBlock("traditional", null, "one", reasons), undefined);
  assert.equal(freeCategoryBlock("shooting", [{ teamId: "1" } as TeamSummary], "premier", reasons), "N", "データの無いシーズンは選べない");
  assert.equal(freeCategoryBlock("shooting", [{ teamId: "1", shotTypes: {} } as TeamSummary], "premier", reasons), undefined);
  console.log("自由な散布図: 項目・名前・選べない理由 OK");
}

// --- 設定の保存 ---
{
  const memory = (): PresetStorage & { data: Map<string, string> } => { const data = new Map<string, string>(); return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, removeItem: k => { data.delete(k); } }; };
  const broken: PresetStorage = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("quota"); }, removeItem() { throw new Error("denied"); } };
  assert.equal(presetStorageAvailable(memory()), true);
  assert.equal(presetStorageAvailable(broken), false, "書けない環境は保存できない扱い");
  assert.equal(presetStorageAvailable(null), false);
  assert.deepEqual(loadPresets(broken), [], "読めなくても空で動く");
  assert.equal(savePresets([], broken), false, "書けなくても例外を出さない");
  assert.equal(savePresets([], null), false);
  const q = presetQuery(new URLSearchParams("entity=team&figure=x&season=2026-27&league=one&fy=b&fx=a&fx2=%E3%81%82"));
  assert.equal(q, "fx=a&fx2=%E3%81%82&fy=b", "season・league・entity・figure は含めず、キー順");
  const s = memory();
  let list: FigurePreset[] = [];
  const first = upsertPreset(list, { name: " 3Pの形 ", entity: "team", figure: "team-shooting", query: "fx=a" }, 1, "id1");
  list = first.list;
  assert.equal(first.saved.name, "3Pの形");
  list = upsertPreset(list, { name: "3Pの形", entity: "team", figure: "team-shooting", query: "fx=b" }, 2, "id2").list;
  assert.equal(list.length, 1, "同じ図・同じ名前は上書き"); assert.equal(list[0]!.query, "fx=b"); assert.equal(list[0]!.id, "id1");
  list = upsertPreset(list, { name: "3Pの形", entity: "player", figure: "pts-ast", query: "" }, 3, "id3").list;
  assert.equal(list.length, 2, "図が違えば同じ名前も別");
  assert.equal(savePresets(list, s), true);
  const back = loadPresets(s);
  assert.deepEqual(back, list, "保存して読み戻せる");
  list = renamePreset(list, "id1", "  新しい名前 ");
  assert.equal(list[0]!.name, "新しい名前");
  list = deletePreset(list, "id1");
  assert.deepEqual(list.map(p => p.id), ["id3"]);
  // 壊れた・古い・知らない項目が混ざっていても開ける
  assert.deepEqual(parsePresets("{oops"), []); assert.deepEqual(parsePresets('{"v":9}'), []); assert.deepEqual(parsePresets(null), []);
  const messy = JSON.stringify({ v: 7, extra: 1, items: [null, 3, { id: "a" }, { id: "ok", name: "良い", entity: "team", figure: "f", query: "z=1&a=2&season=2020-21", savedAt: 5, future: true }, { id: "ok", name: "重複", entity: "team", figure: "f", query: "" }, { id: "e", name: " ", entity: "team", figure: "f", query: "" }, { id: "bad", name: "x", entity: "coach", figure: "f", query: "" }] });
  const parsed = parsePresets(messy);
  assert.equal(parsed.length, 1); assert.equal(parsed[0]!.query, "a=2&z=1", "読み込み時に条件を整える（season は外す）");
  const preset = parsed[0]!;
  const now = new URLSearchParams("entity=player&figure=other&season=2026-27&league=one&zz=1");
  const applied = applyPresetParams(now, preset);
  assert.equal(applied.get("season"), "2026-27"); assert.equal(applied.get("league"), "one"); assert.equal(applied.get("figure"), "f"); assert.equal(applied.get("a"), "2"); assert.equal(applied.get("zz"), null, "前の図の条件は残さない");
  const url = presetUrl("https://example.com/bleague-stats/#/figures?x=1", preset, now);
  assert.ok(url.startsWith("https://example.com/bleague-stats/#/figures?") && url.includes("season=2026-27") && url.includes("figure=f"), url);
  assert.equal(presetMatches(preset, "team", "f", new URLSearchParams("z=1&a=2&entity=team&figure=f&season=2025-26")), true);
  assert.equal(presetMatches(preset, "team", "f", new URLSearchParams("a=2")), false);
  assert.ok(PRESET_STORAGE_KEY.length > 0);
  console.log("図の設定の保存: 保存・読み戻し・上書き・名前の変更・削除・壊れた保存・保存できない環境・URL OK");
}

// --- 実データ ---
const source = process.argv[2];
if (source) {
  const read = (file: string) => JSON.parse(gunzipSync(readFileSync(file)).toString());
  const near = (a: number, b: number, label: string, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} と ${b}`);
  const perspectives: TeamPerspective[] = ["own", "opp", "diff"];
  let combos = 0, textChecks = 0, shootChecks = 0, tovChecks = 0, independent = 0;
  const seasons = readdirSync(source).filter(s => /^\d{4}-\d{2}$/.test(s)).sort();
  for (const season of seasons) {
    for (const [category, base] of [["premier", path.join(source, season)], ["one", path.join(source, season, "one")]] as const) {
      const teamFile = path.join(base, "teams.json.gz");
      if (!existsSync(teamFile)) continue;
      const teams = read(teamFile) as TeamSummary[];
      const logs = new Map<string, TeamGameLog[]>();
      for (const t of teams) { const f = path.join(base, "team-games", t.teamId + ".json.gz"); if (existsSync(f)) logs.set(t.teamId, read(f)); }
      if (!logs.size) continue;
      const q = { season, category, range: { kind: "all" as const }, gameType: "regular" as const, seasonTotals: false };
      const { rows, league } = buildFreeRows(teams, logs, null, q);
      if (!rows.length || !league) continue;
      // ① 以前の図と同じ組み合わせで同じ点
      for (const mode of ["perGame", "total"] as const) for (const perspective of perspectives) {
        const old = buildShootTeams(teams, logs, null, { season, category, range: q.range, gameType: "regular", mode, perspective });
        for (const x of SHOOT_X) for (const y of SHOOT_Y) {
          const xi = resolveFreeItem(`traditional.${SHOOT_X_COLUMN[x]}`, season, DEFAULT_FREE_X), yi = resolveFreeItem(`${y === "efg" || y === "ts" ? "advanced" : "traditional"}.${SHOOT_Y_COLUMN[y]}`, season, DEFAULT_FREE_Y);
          const xc = freeColumn(xi, perspective, mode, season)!, yc = freeColumn(yi, perspective, mode, season)!;
          const xk = inferFreeAxis(xc, rows), yk = inferFreeAxis(yc, rows);
          for (const p of old.points) {
            const r = rows.find(r => r.teamId === p.teamId)!;
            near(xc.value(r)! * xk.scale, p.x[x]!, `${season} ${category} ${p.teamId} x ${x} ${mode} ${perspective}`);
            near(yc.value(r)! * yk.scale, p.y[y]!, `${season} ${category} ${p.teamId} y ${y} ${mode} ${perspective}`);
            combos++;
          }
        }
      }
      // ② 合計から独立に計算（PTS・AST・TOV・STL の1試合平均と +/-）
      for (const r of rows) {
        const o = sumTeamGameLogs(filterByGameType(filterGameLogs(logs.get(r.teamId)!, { range: q.range, includePlayoffs: true }, undefined, undefined, undefined, undefined, category), "regular")) as unknown as Record<string, number>;
        for (const [key, own, opp] of [["pts", o.pts!, o.oppPts!], ["ast", o.ast!, o.oppAst!], ["tov", o.tov!, o.oppTov!], ["stl", o.stl!, o.oppStl!]] as const) {
          const item = resolveFreeItem(`traditional.${key}`, season, DEFAULT_FREE_Y);
          near(freeColumn(item, "own", "perGame", season)!.value(r)!, own / r.games, `${season} ${category} ${r.teamId} ${key}`);
          near(freeColumn(item, "opp", "perGame", season)!.value(r)!, opp / r.games, `${season} ${category} ${r.teamId} opp ${key}`);
          near(freeColumn(item, "diff", "total", season)!.value(r)!, own - opp, `${season} ${category} ${r.teamId} diff ${key}`);
          independent++;
        }
      }
      // ③ 表の文字と点の値が食い違わない（最新のシーズンだけ全項目×視点×平均／合計）
      if (season === seasons[seasons.length - 1] || season === "2024-25") {
        for (const mode of ["perGame", "total"] as const) for (const perspective of perspectives) for (const item of freeItems(season)) {
          if (item.category === "shooting" || item.category === "forcedTurnovers") continue;
          const col = freeColumn(item, perspective, mode, season);
          if (!col) continue;
          const kind = inferFreeAxis(col, rows);
          for (const r of rows) {
            const v = col.value(r), text = col.text(r).trim();
            if (v === null) { assert.ok(text === "-" || !Number.isFinite(Number(v)), `${item.id} ${text}`); continue; }
            if (kind.unit === "time") {
              const m = /^([+-]?)([\d,]+):(\d{2})$/.exec(text)!;
              assert.ok(m, `${item.id} 時間の書式 ${text}`);
              near((m[1] === "-" ? -1 : 1) * (Number(m[2]!.replace(/,/g, "")) * 60 + Number(m[3])), v * kind.scale, `${season} ${item.id} ${mode} ${perspective} 時間`, 0.51);
            } else {
              const shown = Number(text.replace(/[,%+]/g, ""));
              const tol = 0.5 * Math.pow(10, -kind.digits) + 1e-9;
              assert.ok(Math.abs(shown - v * kind.scale) <= tol, `${season} ${category} ${item.id} ${mode} ${perspective}: 表 ${text} と点 ${v * kind.scale}`);
            }
            textChecks++;
          }
        }
      }
      // ④ Shooting・Forced TOV（シーズン通算と一致）
      const withShots = rows.filter(r => r.summary);
      if (withShots.length) {
        const sq = buildFreeRows(teams, logs, null, { ...q, seasonTotals: true });
        for (const r of sq.rows.filter(r => r.summary)) {
          const types = Object.entries(r.summary!.shotTypes ?? {});
          for (const [key, split] of types.slice(0, 3)) {
            const item = freeItems(season).find(i => i.id === `shooting.${key}_3pa`);
            if (!item) continue;
            const games = r.shotGames;
            near(freeColumn(item, "own", "perGame", season)!.value(r)!, (split.threePoint?.attempted ?? 0) / games, `${season} ${r.teamId} ${key} 3PA`);
            near(freeColumn(item, "own", "total", season)!.value(r)!, split.threePoint?.attempted ?? 0, `${season} ${r.teamId} ${key} 3PA合計`);
            shootChecks++;
          }
        }
        assert.ok(sq.league?.summary, "Shooting のリーグ平均がある");
      }
      for (const r of rows.filter(r => r.tov)) {
        const total = freeItems(season).find(i => i.id === "forcedTurnovers.total")!;
        const f = r.tov!.forced, c = r.tov!.committed;
        const sum = (d: typeof f) => d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live;
        near(freeColumn(total, "own", "total", season)!.value(r)!, sum(f), `${season} ${r.teamId} Forced TOV`);
        near(freeColumn(total, "opp", "total", season)!.value(r)!, sum(c), `${season} ${r.teamId} Forced TOV opp`);
        near(freeColumn(total, "diff", "perGame", season)!.value(r)!, (sum(f) - sum(c)) / r.games, `${season} ${r.teamId} Forced TOV diff`);
        const t = teams.find(t => t.teamId === r.teamId)!;
        if (t.forcedTurnovers && season !== "2026-27") near(sum(f), sum(t.forcedTurnovers), `${season} ${r.teamId} Forced TOV と teams.json`, 0.5);
        tovChecks++;
      }
    }
  }
  assert.ok(combos > 0 && textChecks > 0 && independent > 0 && shootChecks > 0 && tovChecks > 0, `実データの確認が行われていない ${combos} ${textChecks} ${independent} ${shootChecks} ${tovChecks}`);
  console.log(`自由な散布図（実データ）: 以前の図と同じ点 ${combos}・合計から独立に計算 ${independent}・表の文字と点 ${textChecks}・Shooting ${shootChecks}・Forced TOV ${tovChecks} OK`);
}
console.log("validate-figure-team-free: すべて OK");
void freeItemId;
