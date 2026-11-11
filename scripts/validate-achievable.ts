// 出場率の掲載基準の「◯%以上達成可能」（ランキング・図解・全選手スタッツ・チーム内リーダー。DESIGN.md 365章）の検証。
//  1. 判定の式（isAchievable）が、ランキングの filterAchievablePlayers・チーム内リーダーの filterEligiblePlayers と同じ
//  2. 図解の判定（passesRatio・remainingForScope）・年齢分布と全選手スタッツの範囲の判定（matchesGamesPlayedRatioRange）の書き方
//  3. 実データ（進行中のシーズン・終わったシーズン・B.ONE）で、図解・全選手スタッツ・年齢分布の対象が、ランキングで同じ条件にしたときの対象と一致する
//     （終わったシーズンは、チェックを入れても入れなくても同じ）。トップスコアラーの対象も同じ判定を通る
//  4. 条件の書き方（ランキングと同じ「出場率85%以上達成可能」）
// 元データは読むだけ。使い方: npm run validate:achievable
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary, PlayoffRaceFile, TeamGameLog } from "../shared/types";
import { filterAchievablePlayers, filterEligiblePlayers, isAchievable } from "../src/lib/playerRankingEligibility";
import { isAchievable as isAchievableShared, remainingForScope } from "../src/lib/achievableGames";
import { buildPlayerFigurePoints, passesRatio } from "../src/lib/figurePlayerPoints";
import { buildTopScorers, type ScorerData } from "../src/lib/figureTopScorers";
import { matchesGamesPlayedRatioRange } from "../src/lib/gamesPlayedRatio";
import { eligibilityLabels, gamesPlayedRatioRangeLabels } from "../src/lib/conditionLabels";
import { MIN_GAMES_PLAYED_RATIO_FOR_RANKING } from "../src/lib/statDefs";

const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };

// ---- 1. 式 ----
{
  assert.equal(isAchievable, isAchievableShared, "式は1か所（playerRankingEligibility.ts）");
  // 60試合のシーズンで30試合消化・残り30試合: 20試合出場でも（20+30）/60 = 83.3% → 85%には届かない。26試合なら 56/60 = 93.3% → 届く
  assert.equal(isAchievable(20, 30, 30, 0.85), false);
  assert.equal(isAchievable(26, 30, 30, 0.85), true);
  assert.equal(isAchievable(25, 30, 30, 0.85), true, "（25+30）/60 = 91.7%");
  assert.equal(isAchievable(5, 30, 30, 0.85), false, "（5+30）/60 = 58.3%");
  // 残りが0（終わったシーズン・残りが分からないチーム）は今の掲載基準と同じ
  assert.equal(isAchievable(51, 60, 0, 0.85), true); assert.equal(isAchievable(50, 60, 0, 0.85), false);
  assert.equal(isAchievable(0, 0, 10, 0.85), false, "チームの試合数が0なら対象外");
  // ランキングの関数と同じ結果
  const players = [{ teamId: "a", gamesPlayed: 20 }, { teamId: "a", gamesPlayed: 26 }, { teamId: "b", gamesPlayed: 50 }, { teamId: "z", gamesPlayed: 9 }];
  const teams = [{ teamId: "a", gamesPlayed: 30 }, { teamId: "b", gamesPlayed: 60 }];
  const remaining = new Map([["a", 30], ["b", 0]]);
  assert.deepEqual(filterAchievablePlayers(players, teams, remaining, 0.85).map(p => p.gamesPlayed), [26], "a: 20試合は（20+30）/60=83.3%で届かない・26試合は届く。b: 50/60 は届かない");
  const asPlayers = players.map(p => ({ ...p, totals: { tpm: 0, ftm: 0, fgm: 0 } })) as unknown as PlayerSummary[];
  assert.deepEqual(filterEligiblePlayers(asPlayers, teams as never, 0.85, "pts", 0, remaining).map(p => p.gamesPlayed), [26], "チーム内リーダーの判定もランキングと同じ関数");
  assert.deepEqual(filterEligiblePlayers(asPlayers, teams as never, 0.85, "pts", 0).map(p => p.gamesPlayed), [26], "チェックなしは今の出場率（26/30 = 86.7% だけ。20/30・50/60 は85%未満）");
  console.log("達成可能: 判定の式・ランキングとチーム内リーダーの判定 OK");
}

// ---- 2. 図解・範囲の判定の書き方 ----
{
  const point = { ratio: (100 * 20) / 30, games: 20, teamGames: 30, teamId: "a" };
  const remaining = new Map([["a", 30]]);
  assert.equal(passesRatio(point, 85), false); assert.equal(passesRatio(point, 85, new Map([["a", 30]])), false, "20試合は届かない");
  assert.equal(passesRatio({ ...point, games: 26, ratio: (100 * 26) / 30 }, 85, remaining), true);
  assert.equal(passesRatio({ ...point, games: 26, ratio: (100 * 26) / 30 }, 85), true, "26/30 = 86.7% は今の基準でも通る");
  assert.equal(passesRatio({ ...point, games: 25, ratio: (100 * 25) / 30 }, 85), false); assert.equal(passesRatio({ ...point, games: 25, ratio: (100 * 25) / 30 }, 85, remaining), true, "25/30 は今は届かないが達成可能");
  assert.equal(passesRatio(point, 85, new Map()), false, "残りが分からないチームは0として扱う（今の出場率と同じ）");
  // 残りを使ってよい場面: 全期間のレギュラーシーズン（とレギュラー＋ポストシーズン）だけ
  assert.equal(remainingForScope(remaining, { kind: "all" }, "regular"), remaining);
  assert.equal(remainingForScope(remaining, { kind: "all" }, "both"), remaining);
  assert.equal(remainingForScope(remaining, { kind: "all" }, "playoff"), undefined, "ポストシーズンだけのときは残りを足さない");
  assert.equal(remainingForScope(remaining, { kind: "recent", n: 5 }, "regular"), undefined, "直近5試合のときは残りを足さない");
  assert.equal(remainingForScope(undefined, { kind: "all" }, "regular"), undefined);
  // 範囲（全選手スタッツ・年齢分布）: 下限だけ達成可能、上限は今の出場試合率
  assert.equal(matchesGamesPlayedRatioRange(25, 30, 85, 100), false); assert.equal(matchesGamesPlayedRatioRange(25, 30, 85, 100, 30), true);
  assert.equal(matchesGamesPlayedRatioRange(30, 30, 0, 90, 30), false, "上限は今の出場試合率（100% > 90%）");
  assert.equal(matchesGamesPlayedRatioRange(20, 30, 60, 100), true); assert.equal(matchesGamesPlayedRatioRange(20, 30, 60, 100, 0), true);
  assert.equal(matchesGamesPlayedRatioRange(5, undefined, 0, 100, 10), false);
  console.log("達成可能: 図解・範囲の判定 OK");
}

// ---- 4. 条件の書き方 ----
{
  assert.deepEqual(eligibilityLabels({ gamesRatio: 0.85, achievable: true }), ["出場率85%以上達成可能"], "ランキングと同じ書き方");
  assert.deepEqual(eligibilityLabels({ gamesRatio: 0.85 }), ["出場率85%以上"]);
  assert.deepEqual(gamesPlayedRatioRangeLabels(60, 100, true), ["出場率60%以上達成可能"]);
  assert.deepEqual(gamesPlayedRatioRangeLabels(60, 90, true), ["出場率60%以上達成可能", "出場試合率90%以下"]);
  assert.deepEqual(gamesPlayedRatioRangeLabels(60, 100), ["出場試合率60%〜100%"], "チェックなしは今までの書き方");
  console.log("達成可能: 条件の書き方 OK");
}

// ---- 3. 実データ ----
const SETS: [string, "premier" | "one"][] = [["2025-26", "premier"], ["2026-27", "premier"], ["2026-27", "one"]];
let ran = 0, played = 0, widened = 0;
for (const [season, category] of SETS) {
  const dir = `data/${season}${category === "one" ? "/one" : ""}`;
  if (!existsSync(`${dir}/players.json.gz`) || !existsSync(`${dir}/teams.json.gz`) || !existsSync(`${dir}/playoff-race.json.gz`)) { console.log(`  ${season} ${category}: データなし（スキップ）`); continue; }
  const players = read<PlayerSummary[]>(`${dir}/players.json`), teams = read<ScorerData["teams"]>(`${dir}/teams.json`), race = read<PlayoffRaceFile>(`${dir}/playoff-race.json`);
  const playerLogs = new Map<string, PlayerGameLog[]>(), teamLogs = new Map<string, TeamGameLog[]>();
  for (const p of players) { const f = `${dir}/player-games/${p.playerId}.json`; if (existsSync(f) || existsSync(`${f}.gz`)) playerLogs.set(p.playerId, read(f)); }
  for (const t of teams) { const f = `${dir}/team-games/${t.teamId}.json`; if (existsSync(f) || existsSync(`${f}.gz`)) teamLogs.set(t.teamId, read(f)); }
  if (!teamLogs.size) continue;
  ran++;
  const label = `${season} ${category}`;
  const remaining = new Map(race.teams.map(t => [t.teamId, t.remaining]));
  const totalRemaining = [...remaining.values()].reduce((a, b) => a + b, 0);
  const data: ScorerData = { players, teams, playerLogs, teamLogs, divisions: null, registrations: null };
  const points = buildPlayerFigurePoints(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" });
  const scoped = remainingForScope(remaining, { kind: "all" }, "regular");

  for (const ratio of [0.85, 0.7, 0.5]) {
    // ランキングで同じ条件（達成可能）にしたときの対象
    const rankingIds = new Set(filterEligiblePlayers(players, teams, ratio, "pts", 0, remaining).map(p => p.playerId));
    const rankingNow = new Set(filterEligiblePlayers(players, teams, ratio, "pts", 0).map(p => p.playerId));
    // 図解（シュート成功率・散布図・ベン図・トップスコアラーの掲載基準）: 1チームだけの選手で比べる（移籍した選手は分母が合算なのでランキングとは別）
    const figureIds = new Set(points.filter(p => p.teamIds.length === 1 && passesRatio(p, ratio * 100, scoped)).map(p => p.playerId));
    const figureNow = new Set(points.filter(p => p.teamIds.length === 1 && passesRatio(p, ratio * 100)).map(p => p.playerId));
    const single = new Set(points.filter(p => p.teamIds.length === 1).map(p => p.playerId));
    for (const id of single) {
      assert.equal(figureIds.has(id), rankingIds.has(id), `${label} ${ratio}: 図解の達成可能の対象とランキングが違う選手 ${id}`);
      assert.equal(figureNow.has(id), rankingNow.has(id), `${label} ${ratio}: 図解の今の出場率の対象とランキングが違う選手 ${id}`);
    }
    // 年齢分布・全選手スタッツ（範囲の下限）
    const teamGames = new Map(teams.map(t => [t.teamId, t.gamesPlayed]));
    const rangeIds = new Set(players.filter(p => matchesGamesPlayedRatioRange(p.gamesPlayed, teamGames.get(p.teamId), ratio * 100, 100, remaining.get(p.teamId) ?? 0)).map(p => p.playerId));
    assert.deepEqual([...rangeIds].sort(), [...rankingIds].sort(), `${label} ${ratio}: 範囲の判定の対象とランキングが違う`);
    // チェックを入れると、今の対象を含み、残りがあれば増えることがある。残りが無ければ同じ
    for (const id of rankingNow) assert.ok(rankingIds.has(id), `${label} ${ratio}: 達成可能は今の基準を満たす選手を外さない`);
    if (totalRemaining === 0) assert.deepEqual([...rankingIds].sort(), [...rankingNow].sort(), `${label} ${ratio}: 終わったシーズンはチェックを入れても同じ`);
    else widened += rankingIds.size - rankingNow.size;
    played += single.size;
  }
  // トップスコアラー: 掲載基準の判定が図解の判定と同じ（達成可能の対象は、チェックなしの対象を含む）
  for (const ratio of [85, 60]) {
    const base = buildTopScorers(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all", minRatio: ratio });
    const ach = buildTopScorers(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all", minRatio: ratio, remainingByTeam: scoped });
    const idsOf = (xs: { playerId: string }[]) => new Set(xs.map(p => p.playerId));
    for (const x of ach) {
      const point = points.find(p => p.playerId === x.playerId)!;
      assert.ok(passesRatio(point, ratio, scoped), `${label} トップスコアラー ${x.name}: 達成可能の対象に入っていない選手が出ている`);
    }
    const without = idsOf(base), withAch = idsOf(ach);
    if (totalRemaining === 0) assert.deepEqual([...withAch].sort(), [...without].sort(), `${label} トップスコアラー ${ratio}: 終わったシーズンは同じ`);
  }
}
assert.ok(ran > 0, "実データがある");
console.log(`達成可能: 実データ ${ran}セット（図解の判定 ${played}件をランキングと突き合わせ。進行中の残りで対象が増えた延べ ${widened}人）OK`);
void MIN_GAMES_PLAYED_RATIO_FOR_RANKING;
