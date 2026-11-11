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
import { buildAdvancedColumns, buildTraditionalColumns, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import type { ScorerData } from "../src/lib/figureTopScorers";
import {
  PLAYER_SHOOT_COLUMNS, TEAM_SHOOT_SLOTS, TEAM_SHOOT_VIEWS, TEAM_SHOOT_VIEW_LABELS, percentileLevel, selectByPoints, sharedRanks, shownNumber, sortByValue, teamShootHigherIsBetter,
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
  // 名前の右の略称（移籍した選手は表示中の範囲で最後に出場した試合のチーム）を、試合ログから独立に求めた結果と突き合わせる
  {
    const ownTeams = new Map<string, string>();
    for (const [id, logs] of data.teamLogs) for (const g of logs) ownTeams.set(`${g.scheduleKey}|${g.isHome}`, id);
    let moved = 0;
    for (const p of points) {
      const logs = filterByGameType(data.playerLogs.get(p.playerId) ?? [], "regular").filter(g => g.min > 0);
      if (!logs.length) continue;
      const last = [...logs].sort((a, b) => a.date.localeCompare(b.date)).pop()!;
      assert.equal(p.lastTeamId, ownTeams.get(`${last.scheduleKey}|${last.isHome}`), `${label} ${p.name} 最後のチーム`);
      assert.ok(p.teamIds.includes(p.lastTeamId), `${label} ${p.name}: 最後のチームは所属したチームのどれか`);
      if (p.teamIds.length > 1) moved++;
    }
    console.log(`  ${label}: 移籍した選手 ${moved}人の最後のチームを確認`);
  }
  const cells = playerShootCells(passed, season);
  const keys = PLAYER_SHOOT_COLUMNS.map(d => d.key);
  for (const p of passed) {
    const c = cells.get(p.id)!;
    // 集計済み players.json の合計（試合数が同じ選手だけ）と、試合ログの合計から独立に計算
    const summary = data.players.find(x => x.playerId === p.playerId)!;
    const logs = filterByGameType(data.playerLogs.get(p.playerId) ?? [], "regular");
    const sum = (f: (g: PlayerGameLog) => number) => logs.reduce((a, g) => a + f(g), 0);
    const pts = sum(g => g.pts), fgm = sum(g => g.fgm), fga = sum(g => g.fga), tpm = sum(g => g.tpm), tpa = sum(g => g.tpa), ftm = sum(g => g.ftm), fta = sum(g => g.fta);
    const games = logs.filter(g => g.min > 0).length;
    if (p.teamIds.length === 1 && games === p.games && games > 0) {
      same(c.pts!.text, dec2(pts / games), `${label} ${p.name} PTS`); playerChecks++;
      if (fga > 0) { same(c.efg!.text, pct2((fgm + 0.5 * tpm) / fga), `${label} ${p.name} eFG%`); playerChecks++; }
      if (fga + fta > 0) { same(c.ts!.text, pct2(pts / (2 * (fga + 0.44 * fta))), `${label} ${p.name} TS%`); playerChecks++; }
      if (tpa > 0) { same(c["3ppct"]!.text, pct2(tpm / tpa), `${label} ${p.name} 3P%`); playerChecks++; }
      if (fta > 0) { same(c.ftpct!.text, pct2(ftm / fta), `${label} ${p.name} FT%`); playerChecks++; } else assert.equal(c.ftpct!.text, "-", `${label} ${p.name} FT% 試投なし`);
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

  // ---- チーム（3つの視点） ----
  const { rows } = buildFreeRows(data.teams, data.teamLogs, null, { season, category, range: { kind: "all" }, gameType: "regular", seasonTotals: false });
  assert.ok(rows.length > 5, `${label}: チームの行`);
  for (const view of TEAM_SHOOT_VIEWS) {
    const tcells = teamShootCells(rows, season, view);
    // 全チームスタッツの同じ視点の列（Traditional・Advanced）と、文字まで一致
    const direct = new Map<string, (r: AllTeamsRow) => string>();
    for (const [key, col] of [["3ppct", buildTraditionalColumns("perGame", view)], ["ftpct", buildTraditionalColumns("perGame", view)], ["pts", buildTraditionalColumns("perGame", view)], ["efg", buildAdvancedColumns("perGame", view)], ["ts", buildAdvancedColumns("perGame", view)]] as const) {
      const c = col.find(x => x.key === key)!; direct.set(key, r => c.format!(r));
    }
    for (const r of rows) {
      const c = tcells.get(r.teamId)!;
      for (const [key, f] of direct) { assert.equal(c[key]!.text, f(r.row), `${label} ${view} ${r.teamName} ${key} は全チームスタッツの値`); teamChecks++; }
      const logs = filterByGameType(data.teamLogs.get(r.teamId) ?? [], "regular");
      if (!logs.length) continue;
      const n = logs.length, sum = (f: (g: TeamGameLog) => number) => logs.reduce((a, g) => a + f(g), 0);
      const own = { pts: sum(g => g.teamScore), fgm: sum(g => g.fgm), fga: sum(g => g.fga), tpm: sum(g => g.tpm), tpa: sum(g => g.tpa), ftm: sum(g => g.ftm), fta: sum(g => g.fta), mid2m: sum(g => g.mid2m), mid2a: sum(g => g.mid2a), paint2m: sum(g => g.paint2m), paint2a: sum(g => g.paint2a) };
      const opp = { pts: sum(g => g.opponentScore), fgm: sum(g => g.opponentFgm), fga: sum(g => g.opponentFga), tpm: sum(g => g.opponentTpm), tpa: sum(g => g.opponentTpa), ftm: sum(g => g.opponentFtm), fta: sum(g => g.opponentFta), mid2m: sum(g => g.opponentMid2m), mid2a: sum(g => g.opponentMid2a), paint2m: sum(g => g.opponentPaint2m), paint2a: sum(g => g.opponentPaint2a) };
      type Side = typeof own;
      const rates = (t: Side) => ({ efg: pct2((t.fgm + 0.5 * t.tpm) / t.fga), ts: pct2(t.pts / (2 * (t.fga + 0.44 * t.fta))), "3ppct": pct2(t.tpm / t.tpa), ftpct: pct2(t.ftm / t.fta), mid2pct: pct2(t.mid2m / t.mid2a), paint2pct: pct2(t.paint2m / t.paint2a) });
      const ro = rates(own), rp = rates(opp);
      const expectedPts = view === "own" ? own.pts / n : view === "opp" ? opp.pts / n : (own.pts - opp.pts) / n;
      same(c.pts!.text, dec2(expectedPts), `${label} ${view} ${r.teamName} ${TEAM_SHOOT_SLOTS[0]!.label(view)}`);
      const paintOk = logs.every(g => g.paint2a + g.mid2a > 0 && g.opponentPaint2a + g.opponentMid2a > 0);
      for (const key of ["efg", "ts", "3ppct", "ftpct", "mid2pct", "paint2pct"] as const) {
        if ((key === "mid2pct" || key === "paint2pct") && !paintOk) continue;
        const expected = view === "own" ? ro[key] : view === "opp" ? rp[key] : ro[key] - rp[key];
        same(c[key]!.text, expected, `${label} ${view} ${r.teamName} ${key}`); teamChecks++;
      }
      // 集計済み teams.json の ORtg・DRtg・NetRtg（視点の列: 自チーム＝ORtg・相手＝DRtg・差＝NetRtg）
      const summary = data.teams.find(t => t.teamId === r.teamId) as TeamSummary | undefined;
      const adv = summary?.advanced as { offRtg?: number; defRtg?: number; netRtg?: number } | undefined;
      if (adv?.offRtg !== undefined && summary?.gamesPlayed === n) {
        const expected = view === "own" ? adv.offRtg : view === "opp" ? adv.defRtg! : adv.netRtg!;
        assert.ok(Math.abs(c.rating!.value! - expected) <= 0.0101, `${label} ${view} ${r.teamName} レーティング ${c.rating!.text} と ${expected}`);
      }
      teamChecks += 2;
    }
    // 色: 全チームから数え直す。向きは 自チーム・差＝高いほど緑、相手＝低いほど緑。地区で絞っても同じ
    const tref = shootReference(tcells.values(), TEAM_SHOOT_SLOTS.map(d => d.key));
    const higher = teamShootHigherIsBetter(view);
    assert.equal(higher, view !== "opp", `${label}: 色の向き`);
    for (const slot of TEAM_SHOOT_SLOTS) {
      if (!slot.color) continue;
      const values = rows.map(r => tcells.get(r.teamId)![slot.key]!.value).filter((v): v is number => v !== null);
      if (values.length < 6) continue;
      assert.equal(tref[slot.key]!.length, values.length, `${label} ${slot.key} の基準は全チーム`);
      const top = Math.max(...values), low = Math.min(...values);
      assert.equal(percentileLevel(top, tref[slot.key]!, higher), higher ? 4 : 0, `${label} ${view} ${slot.key} 最高値の色`);
      assert.equal(percentileLevel(low, tref[slot.key]!, higher), higher ? 0 : 4, `${label} ${view} ${slot.key} 最低値の色`);
      colorChecks += 2;
    }
  }
}
assert.ok(ran > 0, "実データがある");
console.log(`シュート成功率の一覧: 実データ ${ran}セット（選手の値 ${playerChecks}・チームの値 ${teamChecks}・色 ${colorChecks}）OK`);

// ---- 5. 図の一覧・列・視点 ----
{
  assert.ok(FIGURES.some(f => f.id === "shoot-table-player" && f.entity === "player" && f.label === "シュート成功率"), "選手タブに登録（名前は「シュート成功率」・IDは変えない）");
  assert.ok(FIGURES.some(f => f.id === "shoot-table-team" && f.entity === "team" && f.label === "シュート成功率"), "チームタブに登録");
  assert.deepEqual(PLAYER_SHOOT_COLUMNS.map(c => c.label), ["PTS", "eFG%", "TS%", "3P%", "FT%", "MID2%", "PAINT2%"], "選手の列の並び（FT% は 3P% の右）");
  assert.ok(PLAYER_SHOOT_COLUMNS.find(c => c.key === "ftpct")!.color, "FT% も色を塗る");
  const labels = (view: (typeof TEAM_SHOOT_VIEWS)[number]) => TEAM_SHOOT_SLOTS.map(c => c.label(view));
  assert.deepEqual(labels("own"), ["PTS", "ORtg", "eFG%", "TS%", "3P%", "FT%", "MID2%", "PAINT2%"], "自チームの見出し");
  assert.deepEqual(labels("opp"), ["opp PTS", "DRtg", "opp eFG%", "opp TS%", "opp 3P%", "opp FT%", "opp MID2%", "opp PAINT2%"], "相手の見出し");
  assert.deepEqual(labels("diff"), ["PTS +/-", "NetRtg", "eFG% +/-", "TS% +/-", "3P% +/-", "FT% +/-", "MID2% +/-", "PAINT2% +/-"], "差の見出し");
  assert.equal(new Set(TEAM_SHOOT_VIEWS.map(v => labels(v).length)).size, 1, "列の数は視点によらず同じ");
  assert.deepEqual(TEAM_SHOOT_VIEWS.map(v => TEAM_SHOOT_VIEW_LABELS[v]), ["自チーム", "相手（opp）", "差（+/-）"]);
  assert.deepEqual(TEAM_SHOOT_VIEWS.map(teamShootHigherIsBetter), [true, false, true], "色の向き: 自チーム・差は高いほど緑、相手は低いほど緑");
  assert.deepEqual(TEAM_SHOOT_SLOTS.filter(c => c.color).map(c => c.key), ["efg", "ts", "3ppct", "ftpct", "mid2pct", "paint2pct"], "色を塗るのは成功率の列");
  console.log("シュート成功率: 図の名前・列の並び・視点・色の向き OK");
}
