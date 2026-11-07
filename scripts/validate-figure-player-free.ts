// 図解「散布図」（選手）の検証。
//  1. 点の値が全選手スタッツの値（playerColumnValue・players.json の合計）と一致する（いくつかの項目の組み合わせ・平均／合計）
//  2. 用意された3つの設定と古い URL が、以前の3つの図（ptsAstPoints・buildUsgPpp・shootPlayerPoints）と同じ選手・同じ点・同じ人数を出す
//  3. 詳細フィルターの DD2・TD3・PTS10 で絞った人数が、試合ログから数え直した結果と一致する（独立に数える）
//  4. 古い URL・保存した設定の読み替え、図の一覧、選べない項目
// 元データは読むだけ。使い方: npm run validate:figure-player-free
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from "../shared/types";
import { buildPlayerFigurePoints, playerColumnValue, type PlayerFigurePoint } from "../src/lib/figurePlayerPoints";
import { filterPlayerFigurePoints } from "../src/lib/figurePlayerFilter";
import { buildUsgPpp, type UsgPppPoint } from "../src/lib/figureUsgPpp";
import { ptsAstPoints, shootPlayerPoints, SHOOT_MIN_ATTEMPTS, SHOOT_X, SHOOT_Y, type ShootX, type ShootY } from "../src/lib/figureShooting";
import {
  DEFAULT_PLAYER_FREE_X, DEFAULT_PLAYER_FREE_Y, isPlayerFreeSeasonTotal, PLAYER_FREE_ON_COURT_REASON, PLAYER_FREE_ON_COURT_SHARE_KEYS, playerFreeColumn, playerFreeItemBlock,
  playerFreeItems, resolvePlayerFreeItem,
} from "../src/lib/figurePlayerFree";
import { inferFreeAxis } from "../src/lib/figureTeamFree";
import { ON_COURT_SHARE_STAT_KEYS, ON_COURT_SHARE_LEGACY_REASON } from "../src/lib/playerSeasonRanking";
import { playerCountLines } from "../src/lib/figurePlayerCounts";
import { builtinPresetParams, legacyPlayerScatterParams, PLAYER_SCATTER_BUILTIN_PRESETS, PLAYER_SCATTER_ID } from "../src/lib/figurePlayerLegacy";
import { migrateLegacyPreset, presetQuery, type FigurePreset } from "../src/lib/figurePresets";
import { normalizeFigureParams } from "../src/lib/figureRoute";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions";
import { statConditionsParam } from "../src/lib/urlState";
import { FIGURES } from "../src/figures/catalog";
import { filterByGameType } from "../shared/gameType";
import type { ScorerData } from "../src/lib/figureTopScorers";

const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };
const near = (a: number, b: number, label: string, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${label}: ${a} と ${b}`);

// ---- 図の一覧 ----
{
  const ids = FIGURES.map(f => f.id);
  for (const gone of ["pts-ast", "usg-ppp", "player-shooting"]) assert.ok(!ids.includes(gone), `${gone} は図の一覧から消す`);
  assert.ok(FIGURES.some(f => f.id === PLAYER_SCATTER_ID && f.entity === "player" && f.label === "散布図"), "選手の散布図");
  assert.ok(FIGURES.some(f => f.id === "team-shooting" && f.entity === "team" && f.label === "散布図"), "チームの散布図（IDは変えない）");
  assert.ok(FIGURES.some(f => f.id === "top-scorers") && FIGURES.some(f => f.id === "player-venn"), "トップスコアラーとベン図は残す");
  assert.equal(FIGURES.filter(f => f.label.includes("自由")).length, 0);
}

// ---- 古い URL・保存した設定の読み替え ----
{
  const q = (s: string) => new URLSearchParams(s);
  const conds = (p: URLSearchParams) => p.get("sc");
  let r = legacyPlayerScatterParams("pts-ast", q("entity=player&figure=pts-ast&pam=tot&pag=70&pcl=a,b&pmp=10&pma=3&season=2025-26"))!;
  assert.equal(r.get("figure"), PLAYER_SCATTER_ID); assert.equal(r.get("pam"), "tot"); assert.equal(r.get("pag"), "70"); assert.equal(r.get("pcl"), "a,b");
  assert.equal(conds(r), "pts.ge.10,ast.ge.3"); assert.equal(r.get("pmp"), null); assert.equal(r.get("px"), null); assert.equal(r.get("py"), null); assert.equal(r.get("season"), "2025-26");
  r = legacyPlayerScatterParams("pts-ast", q("entity=player&figure=pts-ast"))!;
  assert.equal(conds(r), null, "下限0は条件にしない");
  r = legacyPlayerScatterParams("usg-ppp", q("entity=player&figure=usg-ppp&ugp=60&ucl=x"))!;
  assert.equal(r.get("px"), "advanced.usg"); assert.equal(r.get("py"), "advanced.ppp"); assert.equal(conds(r), "pts.ge.15", "平均得点の初期値15");
  assert.equal(r.get("pag"), "60"); assert.equal(r.get("pcl"), "x"); assert.equal(r.get("ugp"), null);
  r = legacyPlayerScatterParams("usg-ppp", q("figure=usg-ppp&upts=0"))!;
  assert.equal(conds(r), null, "平均得点0は条件にしない");
  r = legacyPlayerScatterParams("usg-ppp", q("figure=usg-ppp&upts=20.5&sc=min.ge.20"))!;
  assert.equal(conds(r), "min.ge.20,pts.ge.20.5", "既存の条件に足す");
  r = legacyPlayerScatterParams("player-shooting", q("figure=player-shooting"))!;
  assert.equal(r.get("py"), "traditional.3ppct"); assert.equal(r.get("px"), "traditional.3pa"); assert.equal(conds(r), "3pa.ge.1.5");
  r = legacyPlayerScatterParams("player-shooting", q("figure=player-shooting&shy=ts&shx=fga&shm=tot&shr=50&shl=z&dv=east&shn=6"))!;
  assert.equal(r.get("py"), "advanced.ts"); assert.equal(r.get("px"), "traditional.fga"); assert.equal(r.get("pam"), "tot"); assert.equal(r.get("pag"), "50"); assert.equal(r.get("pcl"), "z");
  assert.equal(r.get("dv"), "east", "以前の地区の選択はそのまま"); assert.equal(conds(r), "fga.ge.6"); assert.equal(r.get("shy"), null);
  r = legacyPlayerScatterParams("player-shooting", q("figure=player-shooting&shx=fta&shn=0"))!;
  assert.equal(conds(r), null);
  r = legacyPlayerScatterParams("player-shooting", q("figure=player-shooting&shx=2pa&shy=2p"))!;
  assert.equal(conds(r), `2pa.ge.${SHOOT_MIN_ATTEMPTS["2pa"].default}`); assert.equal(r.get("py"), "traditional.2ppct");
  assert.equal(legacyPlayerScatterParams("ratings", q("figure=ratings")), null);
  const n = normalizeFigureParams(q("entity=player&figure=usg-ppp&season=2025-26"));
  assert.equal(n.get("figure"), PLAYER_SCATTER_ID); assert.equal(n.get("entity"), "player"); assert.equal(n.get("sc"), "pts.ge.15");
  assert.equal(normalizeFigureParams(q("entity=team&figure=team-shooting")).get("figure"), "team-shooting", "チームの散布図のIDは変えない");
  // 保存した設定
  const saved = (figure: string, query: string): FigurePreset => ({ id: "s1", name: "mine", entity: "player", figure, query: presetQuery(q(query)), savedAt: 1 });
  const m = migrateLegacyPreset(saved("usg-ppp", "upts=18&rng=recent:5"));
  assert.equal(m.figure, PLAYER_SCATTER_ID); assert.equal(m.name, "mine"); assert.equal(m.id, "s1");
  assert.equal(new URLSearchParams(m.query).get("sc"), "pts.ge.18"); assert.equal(new URLSearchParams(m.query).get("rng"), "recent:5"); assert.equal(new URLSearchParams(m.query).get("entity"), null);
  assert.equal(migrateLegacyPreset({ ...saved("age", "x=1"), entity: "team" }).figure, "age");
  assert.equal(migrateLegacyPreset({ ...saved("top-scorers", ""), entity: "player" }).figure, "top-scorers");
  // 用意された設定
  assert.equal(PLAYER_SCATTER_BUILTIN_PRESETS.length, 3);
  for (const b of PLAYER_SCATTER_BUILTIN_PRESETS) { const p = builtinPresetParams(b.id)!; assert.equal(p.get("figure"), PLAYER_SCATTER_ID); assert.ok(p.get("entity") === "player"); }
  assert.equal(builtinPresetParams("builtin:usg-ppp")!.get("sc"), "pts.ge.15");
  assert.equal(builtinPresetParams("nothing"), null);
  console.log("選手の散布図: 古い URL・保存した設定・用意された設定の読み替え OK");
}

// ---- 項目 ----
{
  assert.deepEqual([...PLAYER_FREE_ON_COURT_SHARE_KEYS].sort(), [...ON_COURT_SHARE_STAT_KEYS].sort(), "出場中の割合の項目はランキングと同じ");
  assert.equal(PLAYER_FREE_ON_COURT_REASON("X"), ON_COURT_SHARE_LEGACY_REASON("X"), "選べない理由の文はランキングと同じ");
  const items = playerFreeItems("2025-26"), ids = new Set(items.map(i => i.id));
  assert.equal(ids.size, items.length, "項目のIDは重複しない");
  for (const id of ["traditional.pts", "traditional.dd2", "traditional.td3", "traditional.pts10", "advanced.usg", "advanced.ppp", "advanced.per", "traditional.3ppct", "profile.age"]) assert.ok(ids.has(id), `項目 ${id}`);
  assert.ok(items.some(i => i.category === "misc") && items.some(i => i.category === "scoring") && items.some(i => i.category === "shooting"), "Misc・Scoring・Shooting");
  assert.equal(resolvePlayerFreeItem("nothing", "2025-26", DEFAULT_PLAYER_FREE_Y).id, DEFAULT_PLAYER_FREE_Y, "読めない項目は初期の項目");
  const reasons = { shooting: "S", onCourt: (l: string) => `O:${l}`, none: "N" };
  const shooting = items.find(i => i.category === "shooting")!, share = items.find(i => i.key === "pctpts")!;
  assert.equal(playerFreeItemBlock(shooting, null, "one", reasons, "2026-27"), "S", "B.ONE では Shooting を選べない");
  assert.equal(playerFreeItemBlock(shooting, null, "premier", reasons, "2025-26"), undefined);
  assert.equal(playerFreeItemBlock(shooting, [{ shotTypes: undefined } as PlayerSummary], "premier", reasons, "2025-26"), "N", "記録のないシーズン");
  assert.ok(playerFreeItemBlock(share, null, "premier", reasons, "2019-20")?.startsWith("O:"), "2019-20 は出場中の割合を選べない");
  assert.equal(playerFreeItemBlock(share, null, "premier", reasons, "2025-26"), undefined);
  assert.ok(isPlayerFreeSeasonTotal(shooting) && isPlayerFreeSeasonTotal(items.find(i => i.key === "per")!) && !isPlayerFreeSeasonTotal(items.find(i => i.key === "pts")!));
  console.log("選手の散布図: 項目・選べない理由 OK");
}

// ---- 実データ ----
const loadData = (season: string, category: "premier" | "one"): ScorerData | null => {
  const dir = `data/${season}${category === "one" ? "/one" : ""}`;
  if (!existsSync(`${dir}/players.json.gz`) || !existsSync(`${dir}/teams.json.gz`)) return null;
  const players = read<PlayerSummary[]>(`${dir}/players.json`), teams = read<ScorerData["teams"]>(`${dir}/teams.json`);
  const playerLogs = new Map<string, PlayerGameLog[]>(), teamLogs = new Map<string, TeamGameLog[]>();
  for (const p of players) { const f = `${dir}/player-games/${p.playerId}.json`; if (existsSync(f) || existsSync(`${f}.gz`)) playerLogs.set(p.playerId, read(f)); }
  for (const t of teams) { const f = `${dir}/team-games/${t.teamId}.json`; if (existsSync(f) || existsSync(`${f}.gz`)) teamLogs.set(t.teamId, read(f)); }
  if (!teamLogs.size) return null;
  return { players, teams, playerLogs, teamLogs, divisions: null, registrations: null };
};
const SETS: [string, "premier" | "one"][] = [["2019-20", "premier"], ["2023-24", "premier"], ["2025-26", "premier"], ["2026-27", "premier"], ["2026-27", "one"]];

/** 選手の散布図が、URL の条件から点を作る手順（部品の PlayerFreeScatterFigure と同じ） */
interface ScatterRow { id: string; x: number; y: number; p: PlayerFigurePoint }
function newScatter(points: PlayerFigurePoint[], params: URLSearchParams, season: string, category: "premier" | "one"): { rows: ScatterRow[] } {
  const mode = params.get("pam") === "tot" ? "total" : "perGame";
  const ratio = Number(params.get("pag") ?? 85);
  const x = resolvePlayerFreeItem(params.get("px") ?? undefined, season, DEFAULT_PLAYER_FREE_X), y = resolvePlayerFreeItem(params.get("py") ?? undefined, season, DEFAULT_PLAYER_FREE_Y);
  const sc = statConditionsParam.read(params) ?? DEFAULT_STAT_CONDITIONS;
  const eligible = filterPlayerFigurePoints(points.filter(p => p.ratio >= ratio), [], sc, season, { league: category }).eligible;
  const xc = playerFreeColumn(x, mode, season)!, yc = playerFreeColumn(y, mode, season)!;
  return { rows: eligible.flatMap((p): ScatterRow[] => { const xv = xc.value(p), yv = yc.value(p); return xv === null || yv === null ? [] : [{ id: p.id, x: xv, y: yv, p }]; }) };
}
const sameIds = (a: string[], b: string[], label: string) => {
  const sa = new Set(a), sb = new Set(b);
  assert.deepEqual([...sa].filter(i => !sb.has(i)).slice(0, 5), [], `${label}: 新しい図だけにいる選手`);
  assert.deepEqual([...sb].filter(i => !sa.has(i)).slice(0, 5), [], `${label}: 以前の図だけにいる選手`);
  assert.equal(a.length, b.length, `${label}: 人数`);
};

let ran = 0, valueChecks = 0, presetChecks = 0, doubleChecks = 0, presetPeople = 0;
for (const [season, category] of SETS) {
  const data = loadData(season, category);
  if (!data) { console.log(`  ${season} ${category}: データなし（スキップ）`); continue; }
  ran++;
  const label = `${season} ${category}`;
  const points = buildPlayerFigurePoints(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" });
  assert.ok(points.length > 0, `${label}: 点がある`);

  // 1. 値が全選手スタッツの値と一致
  const combos: [string, string][] = [["traditional.pts", "traditional.ast"], ["traditional.3ppct", "traditional.3pa"], ["advanced.efg", "traditional.fga"], ["advanced.usg", "advanced.ts"], ["traditional.ftpct", "traditional.fta"], ["traditional.reb", "traditional.stl"]];
  for (const mode of ["perGame", "total"] as const) for (const [yid, xid] of combos) {
    const y = playerFreeItems(season).find(i => i.id === yid), x = playerFreeItems(season).find(i => i.id === xid);
    if (!x || !y) continue;
    const yc = playerFreeColumn(y, mode, season)!, xc = playerFreeColumn(x, mode, season)!;
    for (const p of points) {
      for (const [col, item] of [[yc, y], [xc, x]] as const) {
        const v = col.value(p);
        if (v === null) continue;
        near(v, playerColumnValue(p, item.key, mode, season)!, `${label} ${p.name} ${item.id} ${mode}`);
        valueChecks++;
      }
    }
  }
  // 集計済み players.json の合計と一致（試合数が同じ選手）
  for (const p of data.players) {
    const point = points.find(x => x.playerId === p.playerId);
    if (!point || !p.totals?.gamesPlayed || point.games !== p.totals.gamesPlayed) continue;
    const pts = playerFreeColumn(resolvePlayerFreeItem("traditional.pts", season, "traditional.pts"), "total", season)!.value(point);
    near(pts!, p.totals.pts, `${label} ${p.name} 合計PTS`);
    valueChecks++;
  }
  // 単位の推定
  const fg = inferFreeAxis(playerFreeColumn(resolvePlayerFreeItem("traditional.3ppct", season, ""), "perGame", season)!, points);
  assert.deepEqual([fg.unit, fg.scale], ["percent", 100], `${label} 3P% は %（0〜1 を 100 倍）`);
  assert.equal(inferFreeAxis(playerFreeColumn(resolvePlayerFreeItem("traditional.dd2", season, ""), "perGame", season)!, points).unit, "percent");
  assert.equal(inferFreeAxis(playerFreeColumn(resolvePlayerFreeItem("traditional.dd2", season, ""), "total", season)!, points).unit, "number");
  assert.equal(inferFreeAxis(playerFreeColumn(resolvePlayerFreeItem("traditional.min", season, ""), "perGame", season)!, points).unit, "time");

  // 2. 用意された設定・古い URL が以前の図と同じ選手・同じ点
  const ratioPassed = (r: number) => points.filter(p => p.ratio >= r);
  // 得点 × アシスト
  for (const [qs, mode, minPts, minAst, ratio] of [["", "perGame", 0, 0, 85], ["pam=tot&pmp=10&pma=3&pag=70", "total", 10, 3, 70], ["pmp=15", "perGame", 15, 0, 85]] as const) {
    const params = legacyPlayerScatterParams("pts-ast", new URLSearchParams(`figure=pts-ast&${qs}`))!;
    const oldPts = ptsAstPoints(ratioPassed(ratio), season, mode, minPts, minAst);
    const now = newScatter(points, params, season, category);
    sameIds(now.rows.map(r => r.id), oldPts.map(r => r.p.id), `${label} 得点×アシスト ${qs}`);
    for (const o of oldPts) { const n = now.rows.find(r => r.id === o.p.id)!; near(n.x, o.x, `${label} ${o.p.name} AST`); near(n.y, o.y, `${label} ${o.p.name} PTS`); }
    presetChecks++; presetPeople += oldPts.length;
  }
  // USG% × PPP
  for (const [qs, ratio, minPts] of [["", 85, 15], ["ugp=60&upts=10", 60, 10], ["upts=0", 85, 0]] as const) {
    const params = legacyPlayerScatterParams("usg-ppp", new URLSearchParams(`figure=usg-ppp&${qs}`))!;
    const old: UsgPppPoint[] = buildUsgPpp(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" })
      .filter(p => p.ratio >= ratio && p.pts >= minPts && p.usg !== null && p.ppp !== null);
    const now = newScatter(points, params, season, category);
    const oldIds: string[] = old.map(o => o.id), newIds: string[] = now.rows.map(r => r.id);
    const onlyNew: string[] = newIds.filter(i => !oldIds.includes(i)), onlyOld: string[] = oldIds.filter(i => !newIds.includes(i));
    assert.deepEqual([onlyNew, onlyOld], [[], []], `${label} USG×PPP ${qs}: 人数の差（新のみ / 旧のみ）`);
    for (const o of old) { const n = now.rows.find(r => r.id === o.id)!; near(n.x, o.usg!, `${label} ${o.name} USG%`, 1e-6); near(n.y, o.ppp!, `${label} ${o.name} PPP`, 1e-6); }
    presetChecks++; presetPeople += old.length;
  }
  // シュート% × 試投数
  for (const x of SHOOT_X) for (const y of SHOOT_Y) for (const [mode, shn] of [["perGame", -1], ["total", -1], ["perGame", 2]] as const) {
    const qs = `shx=${x}&shy=${y}&shm=${mode === "total" ? "tot" : "perGame"}${shn >= 0 ? `&shn=${shn}` : ""}`;
    const params = legacyPlayerScatterParams("player-shooting", new URLSearchParams(`figure=player-shooting&${qs}`))!;
    const min = shn < 0 ? SHOOT_MIN_ATTEMPTS[x as ShootX].default : shn;
    const old = shootPlayerPoints(ratioPassed(85), season, mode, x as ShootX, y as ShootY, min);
    const now = newScatter(points, params, season, category);
    sameIds(now.rows.map(r => r.id), old.map(r => r.p.id), `${label} シュート ${qs}`);
    for (const o of old) { const n = now.rows.find(r => r.id === o.p.id)!; near(n.x, o.x, `${label} ${o.p.name} ${x}`); near(n.y * 100, o.y, `${label} ${o.p.name} ${y}`); }
    presetChecks++; presetPeople += old.length;
  }
  // 人数の行（登録区分ごと）も同じ
  {
    const params = builtinPresetParams("builtin:usg-ppp")!;
    const now = newScatter(points, params, season, category);
    const old = buildUsgPpp(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" }).filter(p => p.ratio >= 85 && p.pts >= 15 && p.usg !== null && p.ppp !== null);
    assert.deepEqual(playerCountLines(now.rows.map(r => r.p.playerId), data.players, null, "all"), playerCountLines(old.map(o => o.playerId), data.players, null, "all"), `${label} 人数の行`);
  }

  // 3. DD2・TD3・PTS10 の絞り込みが、試合ログからの数え直しと一致
  const independent = (all: PlayerGameLog[]) => {
    const played = filterByGameType(all, "regular").filter(g => g.min > 0);
    let dd = 0, td = 0, p10 = 0;
    for (const g of played) { const n = [g.pts, g.reb, g.ast, g.stl, g.blk].filter(v => v >= 10).length; if (n >= 2) dd++; if (n >= 3) td++; if (g.pts >= 10) p10++; }
    return { dd, td, p10, games: played.length };
  };
  for (const [key, field, thr] of [["dd2", "dd", 10], ["dd2", "dd", 30], ["td3", "td", 1], ["pts10", "p10", 80], ["pts10", "p10", 95]] as const) {
    const sc = { match: "all" as const, conditions: [{ id: 1, key, op: "gte" as const, value: String(thr) }] };
    const got = filterPlayerFigurePoints(points, [], sc, season, { league: category }).eligible.map(p => p.id);
    // 独立: 絞り込み前の選手の試合ログ（期間・区分の絞り込みなし）から数える
    const expected = points.filter(p => { const c = independent(p.playerId ? (data.playerLogs.get(p.playerId) ?? []) : []); return c.games > 0 && Number((100 * c[field] / c.games).toFixed(2)) >= thr - 1e-9; }).map(p => p.id);
    sameIds(got, expected, `${label} ${key}≥${thr}%`);
    const le = filterPlayerFigurePoints(points, [], { match: "all", conditions: [{ id: 1, key, op: "lte", value: String(thr) }] }, season, { league: category }).eligible.length;
    assert.ok(le > 0 || points.length === 0, `${label} ${key}≤${thr}`);
    doubleChecks++;
  }
  // 合計は回数。保存済みの集計（players.json）とも一致する
  for (const p of points) {
    const c = independent(data.playerLogs.get(p.playerId) ?? []);
    assert.deepEqual(p.doubles, c, `${label} ${p.name} DD2/TD3/PTS10 の回数`);
    const src: PlayerSummary = data.players.find(s => s.playerId === p.playerId)!;
    if (src.totals?.gamesPlayed === p.games && src.totals.doubleDoubles !== undefined) { assert.equal(p.doubles.dd, src.totals.doubleDoubles, `${label} ${p.name} DD2 保存済み`); assert.equal(p.doubles.td, src.totals.tripleDoubles, `${label} ${p.name} TD3 保存済み`); }
    if (src.totals?.gamesPlayed === p.games && src.totals.points10Games !== undefined) assert.equal(p.doubles.p10, src.totals.points10Games, `${label} ${p.name} PTS10 保存済み`);
  }
}
assert.ok(ran >= 3, "実データのシーズンが足りない（先に npm run build:data）");
console.log(`選手の散布図: 実データ ${ran} 組。値の突き合わせ ${valueChecks} 件・用意された設定／古い URL ${presetChecks} 通り（延べ ${presetPeople} 人）が以前の図と一致・DD2/TD3/PTS10 ${doubleChecks} 通り OK`);
