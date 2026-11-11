// 図解「シュート成功率の一覧」（選手・チーム）の検証。
//  1. 人工データ: 色の段階（パーセンタイル）は「掲載基準を満たした全員」の中での位置で決まり、表示する人を絞っても変わらない／向き・同値・1人
//  2. 人工データ: 対象の選び方（得点以上・上位◯人〔同値は全員〕）・並べ替え（値なしは最後）・順位
//  3. 実データ: 選手・チームの各列の値を、集計済み players.json／teams.json と試合ログの合計から独立に計算し直して、図の文字と突き合わせる
//  4. 実データ: 色の段階を、基準（全員）から数え直した位置と突き合わせる／絞った後の色が絞る前と同じ
//  5. 図の一覧への登録
// 元データは読むだけ。使い方: npm run validate:shoot-table
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary, TeamGameLog, TeamSummary } from "../shared/types";
import { filterByGameType } from "../shared/gameType";
import { buildPlayerFigurePoints } from "../src/lib/figurePlayerPoints";
import { buildFreeRows } from "../src/lib/figureTeamFree";
import type { ScorerData } from "../src/lib/figureTopScorers";
import {
  PLAYER_SHOOT_COLUMNS, TEAM_SHOOT_COLUMNS, percentileLevel, selectByPoints, sharedRanks, shownNumber, sortByValue,
} from "../src/lib/figureShootTable";
import { playerShootCells, shootReference, teamShootCells } from "../src/lib/figureShootTableData";
import { FIGURES } from "../src/figures/catalog";

const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };
/** 表の文字（小数第2位）を、独立に計算した値と比べる。表の値は足し算の順序の違いで、ちょうど .5 の境目だけ最後の桁が1違うことがある */
const pct2 = (v: number) => v * 100;
const dec2 = (v: number) => v;
const same = (text: string, expected: number, label: string) => {
  const shown = shownNumber(text);
  assert.ok(shown !== null && Math.abs(shown - expected) <= 0.0100001, `${label}: 表 ${text} と計算 ${expected.toFixed(4)}`);
};

// ---- 1. 色の段階 ----
{
  const ref = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.deepEqual(ref.map(v => percentileLevel(v, ref)), [0, 0, 1, 1, 2, 2, 3, 3, 4, 4], "大きいほど緑（4）");
  assert.deepEqual(ref.map(v => percentileLevel(v, ref, false)), [4, 4, 3, 3, 2, 2, 1, 1, 0, 0], "少ないほうが良い列は逆");
  assert.equal(percentileLevel(5, [5]), 2, "1人だけなら真ん中");
  assert.equal(percentileLevel(5, []), 2);
  assert.deepEqual([1, 9].map(v => percentileLevel(v, [1, 9])), [0, 4], "2人は両端");
  const tied = [3, 3, 3, 3].map(v => percentileLevel(v, [3, 3, 3, 3]));
  assert.ok(tied.every(l => l === 2), "全員同値は真ん中");
  assert.equal(percentileLevel(5, [1, 5, 5, 9]), percentileLevel(5, [1, 5, 5, 9]));
  // 表示する人を絞っても、基準が同じなら色は同じ（基準＝掲載基準を満たした全員）
  const all = Array.from({ length: 40 }, (_, i) => 30 + i * 0.7);
  const shown = all.filter((_, i) => i >= 26);
  const colorsAll = shown.map(v => percentileLevel(v, all)), colorsAfterFilter = shown.map(v => percentileLevel(v, all));
  assert.deepEqual(colorsAfterFilter, colorsAll, "絞っても色は変わらない");
  // 逆に、絞った人だけを基準にすると色が変わる（図は後者の作りにしない）
  assert.notDeepEqual(shown.map(v => percentileLevel(v, shown)), colorsAll, "絞った中での順位にすると色が変わってしまう");
  for (let level = 0; level < 5; level++) assert.ok(all.some(v => percentileLevel(v, all) === level), "40人なら5段階すべて使う");
  const lv = all.map(v => percentileLevel(v, all));
  assert.ok(lv.every((l, i) => i === 0 || l >= lv[i - 1]!), "大きい値ほど段階が下がらない");
  assert.equal(shownNumber("51.23%"), 51.23); assert.equal(shownNumber("-"), null); assert.equal(shownNumber("+15.92"), 15.92); assert.equal(shownNumber("-3.50"), -3.5);
  console.log("シュート成功率の一覧: 色の段階（全員の中での位置・絞っても不変・向き・同値）OK");
}

// ---- 2. 選び方・並べ替え・順位 ----
{
  const rows = [{ id: "a", pts: 25.1 }, { id: "b", pts: 18 }, { id: "c", pts: 18 }, { id: "d", pts: 12.5 }, { id: "e", pts: null as number | null }, { id: "f", pts: 30 }];
  const ids = (xs: { id: string }[]) => xs.map(x => x.id).sort().join("");
  assert.equal(ids(selectByPoints(rows, r => r.pts, { kind: "min", value: 18 })), "abcf", "以上は同じ値も入る");
  assert.equal(ids(selectByPoints(rows, r => r.pts, { kind: "min", value: 40 })), "");
  assert.equal(ids(selectByPoints(rows, r => r.pts, { kind: "top", n: 2 })), "af");
  assert.equal(ids(selectByPoints(rows, r => r.pts, { kind: "top", n: 3 })), "abcf", "3番目と同じ得点の人は全員入れる");
  assert.equal(ids(selectByPoints(rows, r => r.pts, { kind: "top", n: 99 })), "abcdf", "値の無い人は入らない");
  assert.equal(ids(selectByPoints(rows, r => r.pts, { kind: "top", n: 0 })), "");
  const desc = sortByValue(rows, r => r.pts, true), asc = sortByValue(rows, r => r.pts, false);
  assert.deepEqual(desc.map(r => r.id), ["f", "a", "b", "c", "d", "e"], "多い順・値なしは最後・同値は元の並び");
  assert.deepEqual(asc.map(r => r.id), ["d", "b", "c", "a", "f", "e"], "少ない順でも値なしは最後");
  assert.deepEqual(sharedRanks(desc, r => r.pts, true), [1, 2, 3, 3, 5, null], "同値は同順位・次は飛ばす・値なしは空");
  console.log("シュート成功率の一覧: 対象の選び方・並べ替え・順位 OK");
}

// ---- 3〜4. 実データ ----
const loadPlayers = (season: string, category: "premier" | "one"): { data: ScorerData; dir: string } | null => {
  const dir = `data/${season}${category === "one" ? "/one" : ""}`;
  if (!existsSync(`${dir}/players.json.gz`) || !existsSync(`${dir}/teams.json.gz`)) return null;
  const players = read<PlayerSummary[]>(`${dir}/players.json`), teams = read<ScorerData["teams"]>(`${dir}/teams.json`);
  const playerLogs = new Map<string, PlayerGameLog[]>(), teamLogs = new Map<string, TeamGameLog[]>();
  for (const p of players) { const f = `${dir}/player-games/${p.playerId}.json`; if (existsSync(f) || existsSync(`${f}.gz`)) playerLogs.set(p.playerId, read(f)); }
  for (const t of teams) { const f = `${dir}/team-games/${t.teamId}.json`; if (existsSync(f) || existsSync(`${f}.gz`)) teamLogs.set(t.teamId, read(f)); }
  if (!teamLogs.size) return null;
  return { data: { players, teams, playerLogs, teamLogs, divisions: null, registrations: null }, dir };
};
const SETS: [string, "premier" | "one"][] = [["2019-20", "premier"], ["2022-23", "premier"], ["2025-26", "premier"], ["2026-27", "premier"], ["2026-27", "one"]];
let ran = 0, playerChecks = 0, teamChecks = 0, colorChecks = 0;
for (const [season, category] of SETS) {
  const loaded = loadPlayers(season, category);
  if (!loaded) { console.log(`  ${season} ${category}: データなし（スキップ）`); continue; }
  const { data } = loaded;
  ran++;
  const label = `${season} ${category}`;

  // ---- 選手 ----
  const points = buildPlayerFigurePoints(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" });
  const passed = points.filter(p => p.ratio >= 85);
  assert.ok(passed.length > 5, `${label}: 掲載基準を満たした選手がいる`);
  const cells = playerShootCells(passed, season);
  const keys = PLAYER_SHOOT_COLUMNS.map(d => d.key);
  for (const p of passed) {
    const c = cells.get(p.id)!;
    // 集計済み players.json の合計（試合数が同じ選手だけ）と、試合ログの合計から独立に計算
    const summary = data.players.find(x => x.playerId === p.playerId)!;
    const logs = filterByGameType(data.playerLogs.get(p.playerId) ?? [], "regular");
    const sum = (f: (g: PlayerGameLog) => number) => logs.reduce((a, g) => a + f(g), 0);
    const pts = sum(g => g.pts), fgm = sum(g => g.fgm), fga = sum(g => g.fga), tpm = sum(g => g.tpm), tpa = sum(g => g.tpa), fta = sum(g => g.fta);
    const games = logs.filter(g => g.min > 0).length;
    if (p.teamIds.length === 1 && games === p.games && games > 0) {
      same(c.pts!.text, dec2(pts / games), `${label} ${p.name} PTS`); playerChecks++;
      if (fga > 0) { same(c.efg!.text, pct2((fgm + 0.5 * tpm) / fga), `${label} ${p.name} eFG%`); playerChecks++; }
      if (fga + fta > 0) { same(c.ts!.text, pct2(pts / (2 * (fga + 0.44 * fta))), `${label} ${p.name} TS%`); playerChecks++; }
      if (tpa > 0) { same(c["3ppct"]!.text, pct2(tpm / tpa), `${label} ${p.name} 3P%`); playerChecks++; }
      const mid2m = sum(g => g.mid2m), mid2a = sum(g => g.mid2a), paint2m = sum(g => g.paint2m), paint2a = sum(g => g.paint2a);
      if (mid2a > 0) same(c.mid2pct!.text, pct2(mid2m / mid2a), `${label} ${p.name} MID2%`); else assert.equal(c.mid2pct!.text, "-", `${label} ${p.name} MID2% 記録なし`);
      if (paint2a > 0) same(c.paint2pct!.text, pct2(paint2m / paint2a), `${label} ${p.name} PAINT2%`); else assert.equal(c.paint2pct!.text, "-", `${label} ${p.name} PAINT2% 記録なし`);
      playerChecks += 2;
      // 集計済みの値とも一致
      if (summary.totals?.gamesPlayed === games) { same(c.pts!.text, dec2(summary.totals.pts / summary.totals.gamesPlayed), `${label} ${p.name} players.json PTS`); playerChecks++; }
    }
  }
  // 色の段階: 基準（掲載基準を満たした全員）から数え直した位置と一致する。絞っても変わらない
  const ref = shootReference(cells.values(), keys);
  for (const def of PLAYER_SHOOT_COLUMNS) {
    if (!def.color) continue;
    const values = passed.map(p => cells.get(p.id)![def.key]!.value).filter((v): v is number => v !== null);
    for (const p of passed) {
      const v = cells.get(p.id)![def.key]!.value;
      if (v === null) continue;
      const worse = values.filter(o => o < v).length, same = values.filter(o => o === v).length;
      const expected = values.length < 2 ? 2 : Math.min(4, Math.floor((worse + (same - 1) / 2) / (values.length - 1) * 5));
      assert.equal(percentileLevel(v, ref[def.key]!), expected, `${label} ${p.name} ${def.label} の色`); colorChecks++;
    }
    // 得点上位だけに絞った表でも、各選手の色は絞る前と同じ（基準を全員にしているため）
    const top = selectByPoints(passed, p => cells.get(p.id)!.pts!.value, { kind: "top", n: 10 });
    const refAfter = shootReference(top.map(p => cells.get(p.id)!), keys);
    assert.notEqual(refAfter[def.key]!.length, ref[def.key]!.length, `${label}: 絞った人数と基準の人数は別`);
    for (const p of top) { const v = cells.get(p.id)![def.key]!.value; if (v !== null) { assert.equal(percentileLevel(v, ref[def.key]!), percentileLevel(v, shootReference(passed.map(q => cells.get(q.id)!), keys)[def.key]!), `${label} 絞っても色は同じ`); colorChecks++; } }
  }
  // 得点順に並べると、先頭は得点が最大
  const bySort = sortByValue(passed, p => cells.get(p.id)!.pts!.value, true);
  assert.equal(cells.get(bySort[0]!.id)!.pts!.value, Math.max(...passed.map(p => cells.get(p.id)!.pts!.value!)), `${label}: 得点の多い順の先頭`);

  // ---- チーム ----
  const { rows } = buildFreeRows(data.teams, data.teamLogs, null, { season, category, range: { kind: "all" }, gameType: "regular", seasonTotals: false });
  assert.ok(rows.length > 5, `${label}: チームの行`);
  const tcells = teamShootCells(rows, season);
  for (const r of rows) {
    const c = tcells.get(r.teamId)!;
    const logs = filterByGameType(data.teamLogs.get(r.teamId) ?? [], "regular");
    if (!logs.length) continue;
    const n = logs.length, sum = (f: (g: TeamGameLog) => number) => logs.reduce((a, g) => a + f(g), 0);
    const pts = sum(g => g.teamScore), opp = sum(g => g.opponentScore), fgm = sum(g => g.fgm), fga = sum(g => g.fga), tpm = sum(g => g.tpm), tpa = sum(g => g.tpa), fta = sum(g => g.fta);
    same(c.pts!.text, dec2(pts / n), `${label} ${r.teamName} PTS`);
    same(c.opppts!.text, dec2(opp / n), `${label} ${r.teamName} 失点`);
    same(c.diffpts!.text, dec2((pts - opp) / n), `${label} ${r.teamName} 得失点差`);
    same(c.efg!.text, pct2((fgm + 0.5 * tpm) / fga), `${label} ${r.teamName} eFG%`);
    same(c.ts!.text, pct2(pts / (2 * (fga + 0.44 * fta))), `${label} ${r.teamName} TS%`);
    same(c["3ppct"]!.text, pct2(tpm / tpa), `${label} ${r.teamName} 3P%`);
    const mid2m = sum(g => g.mid2m), mid2a = sum(g => g.mid2a), paint2m = sum(g => g.paint2m), paint2a = sum(g => g.paint2a);
    if (logs.every(g => g.paint2a + g.mid2a > 0)) {
      same(c.mid2pct!.text, pct2(mid2m / mid2a), `${label} ${r.teamName} MID2%`);
      same(c.paint2pct!.text, pct2(paint2m / paint2a), `${label} ${r.teamName} PAINT2%`);
    }
    // 集計済み teams.json の ORtg・DRtg・NetRtg と同じ（表示は小数第2位）
    const summary = data.teams.find(t => t.teamId === r.teamId) as TeamSummary | undefined;
    const adv = summary?.advanced as { offRtg?: number; defRtg?: number; netRtg?: number } | undefined;
    if (adv?.offRtg !== undefined && summary?.gamesPlayed === n) {
      assert.ok(Math.abs(c.ortg!.value! - adv.offRtg) <= 0.0051, `${label} ${r.teamName} ORtg ${c.ortg!.text} と ${adv.offRtg}`);
      assert.ok(Math.abs(c.drtg!.value! - adv.defRtg!) <= 0.0051, `${label} ${r.teamName} DRtg`);
      assert.ok(Math.abs(c.netrtg!.value! - adv.netRtg!) <= 0.0101, `${label} ${r.teamName} NetRtg`);
    }
    teamChecks += 9;
  }
  // 色: 全チームから数え直す。地区などで絞っても同じ
  const tref = shootReference(tcells.values(), TEAM_SHOOT_COLUMNS.map(d => d.key));
  for (const def of TEAM_SHOOT_COLUMNS) {
    if (!def.color) continue;
    const values = rows.map(r => tcells.get(r.teamId)![def.key]!.value).filter((v): v is number => v !== null);
    assert.equal(tref[def.key]!.length, values.length, `${label} ${def.label} の基準は全チーム`);
    const best = rows.reduce((b, r) => (tcells.get(r.teamId)![def.key]!.value ?? -Infinity) > (tcells.get(b.teamId)![def.key]!.value ?? -Infinity) ? r : b);
    if (values.length > 5) assert.equal(percentileLevel(tcells.get(best.teamId)![def.key]!.value!, tref[def.key]!), 4, `${label} ${def.label} 最高のチームは緑`);
    colorChecks++;
  }
}
assert.ok(ran > 0, "実データがある");
console.log(`シュート成功率の一覧: 実データ ${ran}セット（選手の値 ${playerChecks}・チームの値 ${teamChecks}・色 ${colorChecks}）OK`);

// ---- 5. 図の一覧 ----
{
  assert.ok(FIGURES.some(f => f.id === "shoot-table-player" && f.entity === "player" && f.label === "シュート成功率の一覧"), "選手タブに登録");
  assert.ok(FIGURES.some(f => f.id === "shoot-table-team" && f.entity === "team" && f.label === "シュート成功率の一覧"), "チームタブに登録");
  assert.deepEqual(PLAYER_SHOOT_COLUMNS.map(c => c.label), ["PTS", "eFG%", "TS%", "3P%", "MID2%", "PAINT2%"], "選手の列の並び");
  assert.deepEqual(TEAM_SHOOT_COLUMNS.map(c => c.label), ["PTS", "opp PTS", "PTS +/-", "ORtg", "DRtg", "NetRtg", "eFG%", "TS%", "3P%", "MID2%", "PAINT2%"], "チームの列の並び");
  assert.ok(TEAM_SHOOT_COLUMNS.filter(c => c.color).every(c => c.higherIsBetter), "色を塗る成功率の列は高いほど緑");
  console.log("シュート成功率の一覧: 図の一覧・列の並び OK");
}
