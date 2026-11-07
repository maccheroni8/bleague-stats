// 図解（選手）の「表示するクラブ」と詳細フィルターの検証。実データで、クラブ・スタッツの条件で絞った人数と選手が独立に出した結果と一致すること、
// 以前の地区の選択（dv）をクラブに読み替えても同じ選手が出ること、トップスコアラーが絞った選手の中から選ばれることを確かめる。元データは読むだけ。
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type { PlayerCareerCounts, PlayerGameLog, PlayerSummary, TeamGameLog, DivisionHistoryFile } from "../shared/types";
import { buildTopScorers, type ScorerData } from "../src/lib/figureTopScorers";
import { buildPlayerFigurePoints } from "../src/lib/figurePlayerPoints";
import { clubsOfDivisions, filterPlayerFigurePoints } from "../src/lib/figurePlayerFilter";
import { DEFAULT_STAT_CONDITIONS } from "../src/lib/statConditions";

const read = <T,>(p: string): T => { const f = existsSync(p) ? p : `${p}.gz`; return JSON.parse((f.endsWith(".gz") ? gunzipSync(readFileSync(f)) : readFileSync(f)).toString()) as T; };
const divisionHistory = read<DivisionHistoryFile>("data/division-history.json");
const careers = read<{ seasons: Record<string, Record<string, PlayerCareerCounts>> }>("data/player-careers.json");
// 年齢の基準日: そのシーズンの6月30日（シーズンが終わる年）と今日（日本時間）の早い方。元の生年月日から別に数える
const jst = new Date(Date.now() + 9 * 3600 * 1000), today = [jst.getUTCFullYear(), jst.getUTCMonth() + 1, jst.getUTCDate()] as const;
const ageOf = (birth: string, season: string) => {
  const end = [Number(season.slice(0, 4)) + 1, 6, 30] as const;
  const base = end[0] !== today[0] ? (end[0] < today[0] ? end : today) : end[1] !== today[1] ? (end[1] < today[1] ? end : today) : end[2] <= today[2] ? end : today;
  const [y, m, d] = birth.split("-").map(Number) as [number, number, number];
  return base[0] - y - (base[1] < m || (base[1] === m && base[2] < d) ? 1 : 0);
};
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
  // プロフィール（年齢・身長・体重）・ポジション・シューティング・キャリア: 選手マスタの元の値から出し直した結果と一致すること
  const ids2 = (r: { eligible: { id: string }[] }) => r.eligible.map(p => p.id);
  const careerOf = (p: PlayerSummary) => careers.seasons[season]?.[p.playerId];
  const ex = { league: category, careerOf };
  const run = (key: string, op: "gte" | "lte", value: string, positions: string[] = []) =>
    filterPlayerFigurePoints(ratioPassed, [], { match: "all", conditions: [{ id: 1, key, op, value }] }, season, { ...ex, positions });
  for (const [thr, op] of [[25, "gte"], [25, "lte"], [30, "gte"], [22, "lte"]] as const) {
    const r = run("age", op, String(thr));
    assert.deepEqual(ids2(r), ratioPassed.filter(p => p.summary.birthDate && (op === "gte" ? ageOf(p.summary.birthDate, season) >= thr : ageOf(p.summary.birthDate, season) <= thr)).map(p => p.id), `${season} ${category} 年齢 ${op} ${thr}`);
    assert.equal(r.active, true); people += r.eligible.length; scenarios++;
  }
  for (const [key, field, thr, op] of [["height", "heightCm", 190, "gte"], ["height", "heightCm", 180, "lte"], ["weight", "weightKg", 90, "gte"], ["weight", "weightKg", 75, "lte"]] as const) {
    const r = run(key, op, String(thr));
    assert.deepEqual(ids2(r), ratioPassed.filter(p => { const v = p.summary[field]; return !!v && (op === "gte" ? v >= thr : v <= thr); }).map(p => p.id), `${season} ${category} ${key} ${op} ${thr}`);
    people += r.eligible.length; scenarios++;
  }
  // 年齢 × 身長 × クラブ（すべて満たす）／どれかを満たす
  const two = [{ id: 1, key: "age", op: "lte" as const, value: "27" }, { id: 2, key: "height", op: "gte" as const, value: "185" }];
  const hasAge = (p: typeof ratioPassed[number]) => !!p.summary.birthDate && ageOf(p.summary.birthDate, season) <= 27, tall = (p: typeof ratioPassed[number]) => !!p.summary.heightCm && p.summary.heightCm >= 185;
  assert.deepEqual(ids2(filterPlayerFigurePoints(ratioPassed, ids.slice(0, 6), { match: "all", conditions: two }, season, ex)), ratioPassed.filter(p => p.teamIds.some(id => ids.slice(0, 6).includes(id)) && hasAge(p) && tall(p)).map(p => p.id), `${season} ${category} 年齢×身長×クラブ`);
  assert.deepEqual(ids2(filterPlayerFigurePoints(ratioPassed, [], { match: "any", conditions: two }, season, ex)), ratioPassed.filter(p => hasAge(p) || tall(p)).map(p => p.id), `${season} ${category} 年齢または身長`);
  scenarios += 2;
  // ポジション: 登録どおり（PF/C は C/PF にまとめる）。複数選択はどれか
  const norm = (pos?: string) => (pos === "PF/C" ? "C/PF" : pos);
  for (const sel of [["PG"], ["C/PF"], ["PG", "SG"], ["SF", "SF/PF", "C"]]) {
    const r = run("min", "gte", "0", sel);
    assert.deepEqual(ids2(r), ratioPassed.filter(p => sel.includes(norm(p.summary.position) ?? "")).map(p => p.id), `${season} ${category} ポジション ${sel.join("・")}`);
    assert.equal(r.active, true); people += r.eligible.length; scenarios++;
  }
  assert.ok(ratioPassed.filter(p => p.summary.position).length > 0, `${season} ${category} ポジションがある`);
  const posAge = ids2(run("age", "lte", "26", ["PG", "SG"]));
  assert.deepEqual(posAge, ratioPassed.filter(p => ["PG", "SG"].includes(norm(p.summary.position) ?? "") && !!p.summary.birthDate && ageOf(p.summary.birthDate, season) <= 26).map(p => p.id), `${season} ${category} ポジション×年齢`);
  scenarios++;
  if (category === "premier") {
    // シューティング（シーズン通算の1試合平均）・キャリア
    const shotKeys = new Set(ratioPassed.flatMap(p => Object.keys(p.summary.shotTypes ?? {})));
    assert.ok(shotKeys.size > 0, `${season} ${category} シュートの種類がある`);
    const shot = [...shotKeys][0]!;
    const per = (p: typeof ratioPassed[number]) => { const c = p.summary.shotTypes?.[shot]?.twoPoint; return c && c.attempted > 0 && p.summary.gamesPlayed > 0 ? Number((c.attempted / p.summary.gamesPlayed).toFixed(2)) : null; };
    const r = run(`${shot}_2pa`, "gte", "1");
    assert.deepEqual(ids2(r), ratioPassed.filter(p => { const v = per(p); return v !== null && v >= 1; }).map(p => p.id), `${season} ${category} シューティング ${shot} 2PA`);
    people += r.eligible.length; scenarios++;
    for (const [key, thr] of [["titles", 1], ["seasons", 5], ["games", 100]] as const) {
      const rc = run(`career_${key}`, "gte", String(thr));
      assert.deepEqual(ids2(rc), ratioPassed.filter(p => (careerOf(p.summary)?.[key] ?? -1) >= thr).map(p => p.id), `${season} ${category} キャリア ${key}`);
      assert.ok(season !== "2025-26" || rc.eligible.length > 0, "キャリアで絞れる");
      people += rc.eligible.length; scenarios++;
    }
  } else {
    // B.ONE: シュートの種類・リーグをまたぐ経歴の記録が無いので、シューティング・キャリアは選べない（年齢・身長・体重は選べる）
    const keys = filterPlayerFigurePoints(ratioPassed, [], DEFAULT_STAT_CONDITIONS, season, ex).items.map(i => i.key);
    assert.ok(keys.includes("age") && keys.includes("height") && keys.includes("weight"));
    assert.ok(!keys.some(k => k.startsWith("career_") || k.endsWith("_2pa") && k.includes("ショット")), `${season} ${category} シューティング・キャリアは選べない`);
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
