// 図解（散布図・ベン図）の「条件付きの勝率」の検証（設計書389章）。
// 使い方: npm run validate:figure-cond-winpct（先に npm run build:data）
//  1. 実データ（全シーズン・両リーグ・全チーム）で、条件別順位表の行の作り方（コンポーネントと同じ手順を書き写したもの）と、図解の condRecord の勝敗が、
//     条件別順位表で選べる全条件（月別・「●人」「●点」の代表の数を含む）で一致する。「条件なし」は条件別順位表の「シーズン全体」と同じ
//  2. 相手の勝率の「●以上」「●未満」: 試合ごとの直接の比較と一致し、以上＋未満＝相手の勝率がある試合の全部。.500・.600 の以上は既存の「対5割以上・対6割以上（最新勝率）」と同じ
//  3. 期間（直近N試合）・試合区分の絞り込みが先に効く
//  4. 相手の最新勝率の元（teams.json）が順位表の最新の勝敗と同じ
//  5. 感度: 試合ログの勝敗を1つ壊すと検出される
//  6. 部品: 条件の文字列の読み書き・勝率の入力・軸の目盛り・ベン図の円の向き（以上／未満）・円に入らないチーム・同じ条件の円の重なり
//  7. 保存した設定の初期の2つ（散布図・ベン図）: 1回だけ入る・二重に入らない・URL の部品が書く形と同じ（開いても「変更しています」にならない）
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DivisionHistoryFile, GameSummary, StandingsSnapshot, TeamGameLog, TeamSummary } from "../shared/types";
import type { ResultOnlyGameEntry } from "../shared/resultOnlyGames";
import { applyConditionalCondition, type ConditionalCondition } from "../src/lib/conditionalCondition";
import { buildBackToBackStatus, buildBiweekPeriods, buildRecordsBeforeGame } from "../src/lib/situational";
import { buildOpponentSeasonWinRates } from "../src/lib/opponentSeasonWinRate";
import { resultOnlySummaries, withResultOnlyLogs } from "../src/lib/resultOnlyGames";
import {
  buildCondEnv, condCodec, condOptionGroups, condRecord, condRecords, conditionOf, DEFAULT_COND, minGamesCodec, OPP_RATE_KEY, parseCondSpec, parseRateInput, rateText, sameCond, condSpecToText,
  type CondEnv, type CondSpec,
} from "../src/lib/figureCondWinPct";
import { freeAxisDomain, freeTickText, type FreeAxisKind } from "../src/lib/figureTeamFree";
import { rankVennRows, thresholdVennRows } from "../src/lib/figureVenn";
import {
  computeTeamVenn, DEFAULT_VENN_SELECTION, resolveVennSelection, selectionCodec, thresholdCodec, vennWinSpec, VENN_WINPCT_COND_ID, VENN_WINPCT_ID, type VennSelection,
} from "../src/lib/figureVennItems";
import {
  COND_WINPCT_INITIAL_PRESETS, loadPresets, PRESET_SEEDED_COND_WINPCT_KEY, presetQuery, seedCondWinPctPresets, type PresetStorage,
} from "../src/lib/figurePresets";
import type { AllTeamsRow } from "../src/lib/teamStatsColumns";
import type { League } from "../src/lib/league";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(p.endsWith(".gz") ? gunzipSync(readFileSync(p)).toString("utf8") : readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
let ok = 0, failures = 0;
const check = (label: string, good: boolean, detail = "") => {
  if (good) ok += 1;
  else { failures += 1; if (failures <= 40) console.error(`NG ${label} ${detail}`); }
};

// ---------- 6. 部品 ----------
{
  for (const spec of [DEFAULT_COND, { key: "oppRate", oppMode: "lt", oppRate: 0.5 }, { key: "home" }, { key: "foreign-ge", n: 2 }, { key: "score-own-ge", n: 90 }] as CondSpec[]) {
    const back = parseCondSpec(condSpecToText(spec));
    assert.ok(back && sameCond(back, spec), `条件の読み書き ${condSpecToText(spec)}`);
  }
  assert.equal(parseCondSpec(""), null);
  assert.equal(parseCondSpec(null), null);
  assert.deepEqual(parseCondSpec("oppRate~lt~0.5"), { key: "oppRate", oppMode: "lt", oppRate: 0.5 });
  assert.equal(parseRateInput(".6"), 0.6); assert.equal(parseRateInput("0.6"), 0.6); assert.equal(parseRateInput("60"), 0.6); assert.equal(parseRateInput("60%"), 0.6);
  assert.equal(parseRateInput(""), null); assert.equal(parseRateInput("abc"), null); assert.equal(parseRateInput("150"), null); assert.equal(parseRateInput("1"), 1);
  assert.equal(rateText(0.8125), ".813"); assert.equal(rateText(0.5), ".500"); assert.equal(rateText(1), "1.000"); assert.equal(rateText(0), ".000");
  // 軸（勝率は 0〜1 に収め、目盛りは順位表と同じ書き方）
  const kind: FreeAxisKind = { unit: "rate", scale: 1, signed: false, digits: 3 };
  const dom = freeAxisDomain([0.12, 0.93, 0.5], kind, false);
  assert.ok(dom.min >= 0 && dom.max <= 1 && dom.ticks.length >= 3, `勝率の軸 ${JSON.stringify(dom)}`);
  assert.equal(freeTickText(0.5, kind, dom), ".500"); assert.equal(freeTickText(1, kind, dom), "1.000");
  // URL
  const q = (c: ReturnType<typeof condCodec>, v: CondSpec) => { const p = new URLSearchParams(); c.write(p, v); return p.toString(); };
  assert.equal(q(condCodec("fyc"), DEFAULT_COND), "", "初期の条件は書かない");
  assert.equal(q(condCodec("fyc"), { key: "home" }), "fyc=home");
  assert.deepEqual(condCodec("fyc").read(new URLSearchParams("fyc=oppRate~lt~0.55")), { key: "oppRate", oppMode: "lt", oppRate: 0.55 });
  assert.equal(minGamesCodec.read(new URLSearchParams("fmin=5")), 5); assert.equal(minGamesCodec.read(new URLSearchParams("fmin=x")), undefined);
  const mp = new URLSearchParams(); minGamesCodec.write(mp, 0); assert.equal(mp.toString(), ""); minGamesCodec.write(mp, 3); assert.equal(mp.toString(), "fmin=3");
  console.log("条件付きの勝率: 条件の文字列・勝率の入力・軸の目盛り・URL OK");
}

// ---------- ベン図の円 ----------
{
  const rows = [0.9, 0.8, 0.8, 0.6, 0.5, 0.3, Number.NaN].map((value, i) => ({ row: `t${i}`, value, text: Number.isNaN(value) ? "-" : rateText(value) }));
  const ranked = rankVennRows(rows, true);
  assert.equal(ranked.length, 6, "勝率が無い（試合が0）チームは円の並びに入らない");
  const ids = (r: typeof ranked) => r.map(x => x.row).sort().join(",");
  assert.equal(ids(thresholdVennRows(ranked, 0.6, true, "ge")), "t0,t1,t2,t3", "以上: 基準と同じ値も入る");
  assert.equal(ids(thresholdVennRows(ranked, 0.6, true, "lt")), "t4,t5", "未満: 基準と同じ値は入らない");
  assert.equal(ids(thresholdVennRows(ranked, 0.8, true, "ge")), "t0,t1,t2");
  assert.equal(ids(thresholdVennRows(ranked, 0.5, false)), "t4,t5", "指定なしは今までどおり（少ないほうが良い項目は以下）");
  // 同じ条件付きの勝率でも、条件が違えば2つの円で選べる。同じ条件の重ねは直る
  const a: VennSelection = { item: VENN_WINPCT_COND_ID, perspective: "own", cond: { key: "home" } };
  const b: VennSelection = { item: VENN_WINPCT_COND_ID, perspective: "own", cond: { key: "away" } };
  const c: VennSelection = { item: VENN_WINPCT_ID, perspective: "own" };
  const resolved = resolveVennSelection([a, b, c], "2025-26");
  assert.deepEqual(resolved.map(s => s.item), [VENN_WINPCT_COND_ID, VENN_WINPCT_COND_ID, VENN_WINPCT_ID]);
  assert.equal(resolved[0]!.cond?.key, "home"); assert.equal(resolved[1]!.cond?.key, "away");
  const same = resolveVennSelection([a, { ...a }, c], "2025-26");
  assert.notEqual(same[1]!.item === VENN_WINPCT_COND_ID && sameCond(same[1]!.cond!, a.cond!), true, "同じ項目・同じ条件は重ねない");
  assert.equal(resolveVennSelection([c, { ...c }, a], "2025-26")[1]!.item !== VENN_WINPCT_ID, true, "条件なしの勝率は1つだけ");
  // 向き（以上／未満）が円に効く
  const rowOf = (id: string): AllTeamsRow => ({ team: { teamId: id, teamName: id }, gamesPlayed: 1, wins: 0, losses: 0, totals: {} as AllTeamsRow["totals"] });
  const teams = ["a", "b", "c", "d"].map(rowOf);
  const rates = new Map([["a", { games: 5, wins: 4, losses: 1, rate: 0.8 }], ["b", { games: 5, wins: 2, losses: 3, rate: 0.4 }], ["c", { games: 0, wins: 0, losses: 0, rate: null }], ["d", { games: 4, wins: 2, losses: 2, rate: 0.5 }]]);
  const sel: VennSelection[] = [c, c, c].map((x, i) => ({ ...x, item: VENN_WINPCT_ID, mode: i === 1 ? "lt" as const : undefined }));
  const model = computeTeamVenn(teams, sel, "2025-26", { basis: "value", top: 10, thresholds: [0.5, 0.5, 0.8] }, [vennWinSpec(rates, "ge"), vennWinSpec(rates, "lt"), vennWinSpec(rates, "ge")]);
  const members = (i: number) => model.members[i]!.map(m => m.row.team.teamId).sort().join(",");
  assert.equal(members(0), "a,d"); assert.equal(members(1), "b"); assert.equal(members(2), "a");
  assert.equal(model.maskOf.get("c"), 0, "試合が0のチームはどの円にも入らない");
  // URL の読み書き
  const sp = new URLSearchParams();
  selectionCodec.write(sp, [c, { ...a, mode: "lt" }, b]);
  assert.equal(sp.get("vcb"), VENN_WINPCT_COND_ID); assert.equal(sp.get("vkb"), "home"); assert.equal(sp.get("vmb"), "lt"); assert.equal(sp.get("vkc"), "away");
  const read = selectionCodec.read(sp)!;
  assert.equal(read[1]!.cond?.key, "home"); assert.equal(read[1]!.mode, "lt"); assert.equal(read[2]!.cond?.key, "away"); assert.equal(read[0]!.item, VENN_WINPCT_ID);
  // 既存の項目の URL はそのまま読める
  assert.deepEqual(selectionCodec.read(new URLSearchParams("vca=advanced.efg~opp"))![0], { item: "advanced.efg", perspective: "opp" });
  assert.deepEqual(DEFAULT_VENN_SELECTION.map(s => s.item), ["advanced.ortg", "advanced.drtg", "traditional.3ppct"]);
  console.log("条件付きの勝率: ベン図の円（以上／未満・円に入らないチーム・同じ条件の重ね・URL）OK");
}

// ---------- 7. 保存した設定の初期の2つ ----------
{
  const mem = () => { const m = new Map<string, string>(); const st: PresetStorage = { getItem: k => m.get(k) ?? null, setItem: (k, v) => { m.set(k, v); }, removeItem: k => { m.delete(k); } }; return { m, st }; };
  const { m, st } = mem();
  assert.equal(seedCondWinPctPresets(st, 1), true);
  const list = loadPresets(st);
  assert.equal(list.length, 2);
  assert.deepEqual(list.map(p => p.figure).sort(), ["team-shooting", "team-venn"]);
  assert.ok(list.every(p => p.entity === "team" && p.name.length <= 40), "チームの図・名前は40字以内");
  assert.equal(m.get(PRESET_SEEDED_COND_WINPCT_KEY), "1");
  assert.equal(seedCondWinPctPresets(st, 2), false, "もう一度は入れない");
  m.set("bleague-stats:figure-presets", JSON.stringify({ v: 1, items: [] }));
  assert.equal(seedCondWinPctPresets(st, 3), false, "削除しても戻らない");
  // すでに同じ中身があれば二重に入れない
  const m2 = mem();
  m2.st.setItem("bleague-stats:figure-presets", JSON.stringify({ v: 1, items: [{ id: "x", name: "自分の", entity: "team", figure: "team-shooting", query: presetQuery(new URLSearchParams(COND_WINPCT_INITIAL_PRESETS[0]!.params)), savedAt: 0 }] }));
  assert.equal(seedCondWinPctPresets(m2.st, 1), true);
  assert.equal(loadPresets(m2.st).filter(p => p.figure === "team-shooting").length, 1, "同じ中身は二重に入らない");
  assert.equal(loadPresets(m2.st).length, 2);
  // 保存できない環境では何もしない
  assert.equal(seedCondWinPctPresets(null, 1), false);
  assert.equal(seedCondWinPctPresets({ getItem: () => null, setItem: () => { throw new Error("x"); }, removeItem: () => {} }, 1), false);
  // 散布図: 画面の部品が書く形と同じ（URL → 読む → 書く → 保存と同じ文字列）
  const scatter = new URLSearchParams(COND_WINPCT_INITIAL_PRESETS[0]!.params);
  assert.equal(scatter.get("fx"), "winpct.rate"); assert.equal(scatter.get("fy"), "winpct.cond");
  const yCond = condCodec("fyc").read(scatter) ?? DEFAULT_COND;
  assert.ok(sameCond(yCond, { key: OPP_RATE_KEY, oppMode: "ge", oppRate: 0.6 }), "Y は勝率.600以上の相手");
  const out = new URLSearchParams([["fx", scatter.get("fx")!], ["fy", scatter.get("fy")!]]);
  condCodec("fyc").write(out, yCond);
  assert.equal(presetQuery(out), presetQuery(scatter), "散布図の設定は開いても変更扱いにならない");
  // ベン図: 3つの円の条件
  const venn = new URLSearchParams(COND_WINPCT_INITIAL_PRESETS[1]!.params);
  const sel = selectionCodec.read(venn)!;
  assert.equal(sel[0]!.item, VENN_WINPCT_ID);
  assert.ok(sel[1]!.cond && sameCond(sel[1]!.cond, { key: OPP_RATE_KEY, oppMode: "lt", oppRate: 0.5 }), "2つ目は勝率.500未満の相手");
  assert.ok(sel[2]!.cond && sameCond(sel[2]!.cond, { key: OPP_RATE_KEY, oppMode: "ge", oppRate: 0.6 }), "3つ目は勝率.600以上の相手");
  const thr = thresholdCodec.read(venn)!;
  assert.deepEqual(thr, [0.6, 0.8, 0.5], "基準は .600 / .800 / .500（いずれも以上）");
  assert.ok(sel.every(s => s.mode !== "lt"), "値で絞る向きはすべて以上");
  const back = new URLSearchParams([["vbs", venn.get("vbs")!]]);
  selectionCodec.write(back, sel); thresholdCodec.write(back, thr);
  assert.equal(presetQuery(back), presetQuery(venn), "ベン図の設定は開いても変更扱いにならない");
  assert.equal(venn.get("vbs"), "value");
  console.log("条件付きの勝率: 保存した設定の初期の2つ OK");
}

// ---------- 1〜5. 実データ ----------
const history: DivisionHistoryFile = rj(`${DATA}/division-history.json`);
const compared = new Map<string, number>();
let teamsChecked = 0;
for (const [league, base] of [["premier", ""], ["one", "/one"]] as [League, string][]) {
  for (const season of Object.keys(history[league] ?? {})) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/team-games`)) continue;
    const teams: TeamSummary[] = rj(`${dir}/teams.json`) ?? [];
    const summaries: GameSummary[] = rj(`${dir}/games-summary.json`) ?? [];
    const schedule = rj(`${dir}/schedule.json`);
    const resultOnly: ResultOnlyGameEntry[] | undefined = schedule?.resultOnlyGames;
    const standings: StandingsSnapshot[] = rj(`${dir}/standings-history.json`) ?? [];
    const logs = new Map<string, TeamGameLog[]>();
    for (const t of teams) { const l = rj(`${dir}/team-games/${t.teamId}.json`); if (l) logs.set(t.teamId, l); }
    if (!logs.size || !summaries.length) continue;

    // 4. 相手の最新勝率の元＝順位表の最新の勝敗
    const latest = standings[standings.length - 1];
    const rateFromStandings = buildOpponentSeasonWinRates(latest?.teams ?? []);
    const rateFromTeams = buildOpponentSeasonWinRates(teams);
    if (latest) {
      for (const [id, r] of rateFromStandings) check(`${league} ${season} ${id} 相手の最新勝率（順位表＝teams.json）`, rateFromTeams.get(id) === r, `順位表 ${r} / teams.json ${rateFromTeams.get(id)}`);
    }
    const env: CondEnv = buildCondEnv({ season, league, teams, logsByTeam: logs, summaries, resultOnly, divisionHistory: history });

    // 条件別順位表（ConditionalStandingsTable）の行の作り方を、そのまま書き写したもの
    const tableLogs = withResultOnlyLogs(logs, resultOnly)!;
    const tableSummaries = [...summaries, ...resultOnlySummaries(resultOnly, summaries)];
    const tableRecords = resultOnly && resultOnly.length > 0 ? buildRecordsBeforeGame(tableSummaries) : buildRecordsBeforeGame(summaries);
    const tableB2B = buildBackToBackStatus(tableSummaries);
    void buildBiweekPeriods;
    const tableRow = (teamId: string, condition: ConditionalCondition) => {
      const all = (tableLogs.get(teamId) ?? []).filter((g) => g.gameType === "regular");
      const sorted = [...all].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
      const filtered = applyConditionalCondition(sorted, condition, {
        teamId, season, league, opponentRecords: tableRecords, divisionHistory: history, backToBackStatus: tableB2B, opponentLatestWinRates: rateFromStandings.size ? rateFromStandings : rateFromTeams,
      });
      const wins = filtered.filter((g) => g.win).length;
      return { games: filtered.length, wins, losses: filtered.length - wins };
    };
    const specs: CondSpec[] = [];
    for (const g of condOptionGroups(env)) for (const o of g.options) {
      if (o.key === OPP_RATE_KEY) continue;
      specs.push({ key: o.key });
      const nk = env.index.get(o.key)?.condition;
      if (nk && (nk.kind === "foreign" || nk.kind === "score") && "n" in nk && nk.mode !== "eq") specs.push({ key: o.key, n: nk.kind === "foreign" ? 1 : 95 });
    }
    for (const t of teams) {
      if (!logs.has(t.teamId)) continue;
      teamsChecked += 1;
      const scope = { range: { kind: "all" as const }, gameType: "regular" as const };
      // 条件なし
      const allRow = tableRow(t.teamId, { kind: "all" });
      const allRec = condRecord(env, t.teamId, scope, null);
      check(`${league} ${season} ${t.teamId} 条件なし`, allRow.games === allRec.games && allRow.wins === allRec.wins, `順位表 ${allRow.wins}-${allRow.losses} / 図解 ${allRec.wins}-${allRec.losses}`);
      compared.set("条件なし", (compared.get("条件なし") ?? 0) + allRow.games);
      // 選べる全条件
      for (const spec of specs) {
        const cond = conditionOf(env, spec);
        if (!cond) continue;
        const want = tableRow(t.teamId, cond);
        const got = condRecord(env, t.teamId, scope, spec);
        check(`${league} ${season} ${t.teamId} ${condSpecToText(spec)}`, want.games === got.games && want.wins === got.wins && want.losses === got.losses, `順位表 ${want.wins}-${want.losses} / 図解 ${got.wins}-${got.losses}`);
        compared.set(spec.key, (compared.get(spec.key) ?? 0) + want.games);
      }
      // 2. 相手の勝率の以上／未満（試合ごとの直接の比較）
      const base = tableRow(t.teamId, { kind: "all" });
      void base;
      const regular = [...(tableLogs.get(t.teamId) ?? [])].filter((g) => g.gameType === "regular");
      const rateOf = (g: TeamGameLog) => (rateFromStandings.size ? rateFromStandings : rateFromTeams).get(g.opponentTeamId);
      const known = regular.filter((g) => rateOf(g) !== undefined);
      for (const rate of [0.3, 0.45, 0.5, 0.55, 0.6, 0.7, 0.85]) {
        const ge = condRecord(env, t.teamId, scope, { key: OPP_RATE_KEY, oppMode: "ge", oppRate: rate });
        const lt = condRecord(env, t.teamId, scope, { key: OPP_RATE_KEY, oppMode: "lt", oppRate: rate });
        const wantGe = known.filter((g) => rateOf(g)! >= rate), wantLt = known.filter((g) => rateOf(g)! < rate);
        check(`${league} ${season} ${t.teamId} 相手の勝率${rate}以上`, ge.games === wantGe.length && ge.wins === wantGe.filter((g) => g.win).length);
        check(`${league} ${season} ${t.teamId} 相手の勝率${rate}未満`, lt.games === wantLt.length && lt.wins === wantLt.filter((g) => g.win).length);
        check(`${league} ${season} ${t.teamId} 以上＋未満＝全部 ${rate}`, ge.games + lt.games === known.length);
      }
      const ge5 = condRecord(env, t.teamId, scope, { key: OPP_RATE_KEY, oppMode: "ge", oppRate: 0.5 }), tier5 = tableRow(t.teamId, { kind: "opponentLatestWinRate", tier: "atLeast50" });
      const lt5 = condRecord(env, t.teamId, scope, { key: OPP_RATE_KEY, oppMode: "lt", oppRate: 0.5 }), tierU = tableRow(t.teamId, { kind: "opponentLatestWinRate", tier: "under50" });
      const ge6 = condRecord(env, t.teamId, scope, { key: OPP_RATE_KEY, oppMode: "ge", oppRate: 0.6 }), tier6 = tableRow(t.teamId, { kind: "opponentLatestWinRate", tier: "atLeast60" });
      check(`${league} ${season} ${t.teamId} .500以上＝対5割以上（最新勝率）`, ge5.games === tier5.games && ge5.wins === tier5.wins);
      check(`${league} ${season} ${t.teamId} .500未満＝対5割未満（最新勝率）`, lt5.games === tierU.games && lt5.wins === tierU.wins);
      check(`${league} ${season} ${t.teamId} .600以上＝対6割以上（最新勝率）`, ge6.games === tier6.games && ge6.wins === tier6.wins);
      // 3. 期間・試合区分が先に効く
      const recent = (tableLogs.get(t.teamId) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
      const last5 = recent.slice(-5);
      const r5 = condRecord(env, t.teamId, { range: { kind: "recent", n: 5 }, gameType: "both" }, null);
      check(`${league} ${season} ${t.teamId} 直近5試合`, r5.games === last5.length && r5.wins === last5.filter((g) => g.win).length);
      const r5home = condRecord(env, t.teamId, { range: { kind: "recent", n: 5 }, gameType: "both" }, { key: "home" });
      check(`${league} ${season} ${t.teamId} 直近5試合のホーム`, r5home.games === last5.filter((g) => g.isHome).length && r5home.wins === last5.filter((g) => g.isHome && g.win).length);
      const po = condRecord(env, t.teamId, { range: { kind: "all" }, gameType: "playoff" }, null);
      check(`${league} ${season} ${t.teamId} ポストシーズン`, po.games === recent.filter((g) => g.gameType === "playoff").length);
    }
    // 全チームぶんをまとめて出す関数も同じ
    const ids = teams.filter((t) => logs.has(t.teamId)).map((t) => t.teamId);
    const bulk = condRecords(env, ids, { range: { kind: "all" }, gameType: "regular" }, null);
    for (const id of ids) check(`${league} ${season} ${id} まとめて出しても同じ`, bulk.get(id)!.wins === condRecord(env, id, { range: { kind: "all" }, gameType: "regular" }, null).wins);

    // 5. 感度: 試合ログの勝敗を1つ壊すと検出される
    if (league === "premier" && season === "2025-26") {
      const id = ids[0]!;
      const broken = new Map(logs);
      broken.set(id, logs.get(id)!.map((g, i) => (i === 0 ? { ...g, win: !g.win } : g)));
      const envBroken = buildCondEnv({ season, league, teams, logsByTeam: broken, summaries, resultOnly, divisionHistory: history });
      const a = condRecord(env, id, { range: { kind: "all" }, gameType: "regular" }, null), b = condRecord(envBroken, id, { range: { kind: "all" }, gameType: "regular" }, null);
      check("感度: 勝敗を1つ壊すと数が変わる", a.wins !== b.wins);
    }
  }
}
console.log(`\nチーム・シーズン ${teamsChecked} 件 / ok ${ok} 件`);
for (const [k, v] of [...compared.entries()].sort()) console.log(`  ${k}: 延べ ${v} 試合`);
if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exitCode = 1;
} else console.log("\nすべて一致しました");
