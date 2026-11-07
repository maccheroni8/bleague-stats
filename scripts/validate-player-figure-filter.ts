// 図解（選手）の「表示するクラブ」と詳細フィルターの検証。実データで、クラブ・スタッツの条件で絞った人数と選手が独立に出した結果と一致すること、
// 以前の地区の選択（dv）をクラブに読み替えても同じ選手が出ること、トップスコアラーが絞った選手の中から選ばれることを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, PlayerSummary, TeamGameLog, DivisionHistoryFile } from "../shared/types";
import { buildTopScorers, type ScorerData } from "../src/lib/figureTopScorers";
import { buildPlayerFigurePoints } from "../src/lib/figurePlayerPoints";
import { clubsOfDivisions, filterPlayerFigurePoints } from "../src/lib/figurePlayerFilter";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions";

const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };
const divisionHistory = read<DivisionHistoryFile>("data/division-history.json");
let scenarios = 0, people = 0;
for (const [season, category] of [["2026-27", "premier"], ["2026-27", "one"], ["2025-26", "premier"]] as const) {
  const dir = `data/${season}${category === "one" ? "/one" : ""}`;
  if (!existsSync(`${dir}/players.json.gz`) && !existsSync(`${dir}/players.json`)) continue;
  const players = read<PlayerSummary[]>(`${dir}/players.json`), teams = read<ScorerData["teams"]>(`${dir}/teams.json`);
  const data: ScorerData = { players, teams, playerLogs: new Map(players.map(p => [p.playerId, read<PlayerGameLog[]>(`${dir}/player-games/${p.playerId}.json`)])), teamLogs: new Map(teams.map(t => [t.teamId, read<TeamGameLog[]>(`${dir}/team-games/${t.teamId}.json`)])), divisions: divisionHistory, registrations: existsSync(`${dir}/registrations.json`) ? read(`${dir}/registrations.json`) : null };
  const divisionOf = (id: string) => divisionHistory?.[category]?.[season]?.[id];
  const points = buildPlayerFigurePoints(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all" });
  assert.ok(points.length > 0, `${season} ${category} に選手がいる`);
  const ratioPassed = points.filter(p => p.ratio >= 50);
  // 条件なしは全員（絞っていない扱い）
  const none = filterPlayerFigurePoints(ratioPassed, [], DEFAULT_STAT_CONDITIONS, season);
  assert.equal(none.eligible.length, ratioPassed.length); assert.equal(none.active, false);
  // クラブ: 1クラブずつ・複数クラブ。移籍した選手は所属したクラブのどれかで残る
  const ids = teams.map(t => t.teamId);
  for (const clubs of [...ids.map(i => [i]), ids.slice(0, 3), ids.slice(-2)]) {
    const r = filterPlayerFigurePoints(ratioPassed, clubs, DEFAULT_STAT_CONDITIONS, season);
    assert.deepEqual(r.eligible.map(p => p.id), ratioPassed.filter(p => p.teamIds.some(id => clubs.includes(id))).map(p => p.id), `${season} ${category} クラブ ${clubs.join("・")}`);
    assert.equal(r.active, true);
    people += r.eligible.length; scenarios++;
  }
  // クラブ × スタッツの条件（出場時間・出場試合数）
  const cond = { match: "all" as const, conditions: [{ id: 1, key: "min", op: "gte" as const, value: "15" }, { id: 2, key: "g", op: "gte" as const, value: "5" }] };
  const clubs = ids.slice(0, 4);
  const both = filterPlayerFigurePoints(ratioPassed, clubs, cond, season);
  assert.deepEqual(both.eligible.map(p => p.id), ratioPassed.filter(p => p.teamIds.some(id => clubs.includes(id)) && Math.round(p.raw.min / p.raw.gamesPlayed * 60) >= 900 && p.raw.gamesPlayed >= 5).map(p => p.id), `${season} ${category} クラブ×条件`);
  scenarios++; people += both.eligible.length;
  // 以前の地区の選択: その地区のクラブを選んだ状態に読み替えて、同じ選手が出る（移籍した選手は所属のどれかが当てはまれば出る）
  const divisions = [...new Set(teams.map(t => divisionOf(t.teamId)).filter((d): d is NonNullable<typeof d> => !!d))];
  for (const d of divisions) {
    const oldSet = new Set(ratioPassed.filter(p => p.division === d).map(p => p.id));
    const asClubs = clubsOfDivisions(teams, divisionOf, [d]);
    assert.ok(asClubs.length > 0, `${d} のクラブ`);
    const r = filterPlayerFigurePoints(ratioPassed, asClubs, DEFAULT_STAT_CONDITIONS, season);
    const got = new Set(r.eligible.map(p => p.id));
    for (const id of oldSet) assert.ok(got.has(id), `${season} ${category} 以前の地区 ${d} の選手 ${id} が残る`);
    const extra = r.eligible.filter(p => !oldSet.has(p.id));
    for (const p of extra) assert.ok(p.teamIds.length > 1 || p.division !== d, `${season} ${category} 地区 ${d} の増えた選手は移籍した選手だけ`);
    console.log(`  ${season} ${category} ${d}: 以前 ${oldSet.size}人 → クラブ ${got.size}人（移籍で増えた ${extra.length}人）`);
    scenarios++;
  }
  // トップスコアラー: 絞った選手の中から各チーム上位3人
  const allowed = new Set(filterPlayerFigurePoints(ratioPassed, ids.slice(0, 5), cond, season).eligible.map(p => p.id));
  const top = buildTopScorers(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all", minRatio: 50, allowed });
  for (const t of top) assert.ok(allowed.has(t.playerId), `${t.name} は絞った選手`);
  const perTeam = new Map<string, number>(); for (const t of top) perTeam.set(t.teamId, (perTeam.get(t.teamId) ?? 0) + 1);
  for (const n of perTeam.values()) assert.ok(n <= 3, "各チーム3人まで");
  const all = buildTopScorers(data, { season, category, range: { kind: "all" }, gameType: "regular", classification: "all", minRatio: 50 });
  assert.ok(top.length <= all.length, "絞ると増えない");
  scenarios++; people += top.length;
}
console.log(`選手の図解: 表示するクラブ・詳細フィルター・地区の読み替え・トップスコアラーの絞り込み ${scenarios} 通り・延べ ${people} 人が独立計算と一致 OK`);
