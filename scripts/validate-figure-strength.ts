// 図解（散布図）のピタゴラス勝率・相手の強さ・軸の反転・ホーム／アウェイ（DESIGN.md 458〜460章）の検証。
// ①ピタゴラス勝率の式（手計算・両端・桁あふれしない）②軸の反転の向き（rankDirection.ts と同じ）と名前③会場の絞り込み（ホーム＋アウェイ＝全試合）
// ④実データ（今季 B.PREMIER の宇都宮）で、ピタゴラス勝率を独立に計算して照合し、ここまで・残りの相手の強さを順位表の列と同じ材料から別の書き方で計算して照合
// ⑤順位表と散布図が同じ関数（standingsOpponentStrength.ts）を通っていること ⑥保存した設定の3つが選べる項目であること
// 使い方: npm run validate:figure-strength（元データは読むだけ）
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { GameSummary, PlayoffRaceFile, StandingsSnapshot, TeamGameLog, TeamSummary } from "../shared/types";
import type { ScheduleFileExtended } from "../shared/resultOnlyGames";
import { buildFreeRows, freeColumn, freeItems, freeItemId, pythagoreanWinPct, PYTHAG_EXPONENT, resolveFreeItem } from "../src/lib/figureTeamFree";
import { computeStandingsOpponentStrengths } from "../src/lib/standingsOpponentStrength";
import { resultOnlySummaries } from "../src/lib/resultOnlyGames";
import { pendingUpcomingGames } from "../shared/pendingUpcoming";
import { defaultInvert, invertedName } from "../src/lib/figureInvert";
import { filterByVenue, venueConditionLabel, venueFilter } from "../src/lib/figureVenue";
import { STRENGTH_INITIAL_PRESETS, presetQuery } from "../src/lib/figurePresets";
import { filterGameLogs } from "../src/lib/situational";
import { formatWinPct } from "../src/lib/format";

const dataDir = process.argv[2] ?? "data";
const read = <T,>(file: string): T => JSON.parse(gunzipSync(readFileSync(file)).toString());

// --- ①ピタゴラス勝率 ---
{
  assert.equal(PYTHAG_EXPONENT, 13.91);
  const hand = (a: number, b: number) => Math.pow(a, 13.91) / (Math.pow(a, 13.91) + Math.pow(b, 13.91));
  for (const [a, b] of [[80, 70], [70, 80], [85.5, 79.25], [100, 100], [3000, 2800]] as const) {
    assert.ok(Math.abs(pythagoreanWinPct(a, b)! - hand(a, b)) < 1e-9, `手計算と一致 ${a}-${b}`);
  }
  assert.equal(pythagoreanWinPct(80, 80), 0.5);
  assert.equal(pythagoreanWinPct(0, 0), null, "試合が無ければ値なし");
  assert.equal(pythagoreanWinPct(0, 50), 0);
  assert.equal(pythagoreanWinPct(50, 0), 1);
  assert.ok(Number.isFinite(pythagoreanWinPct(6000, 5900)!), "シーズン合計の大きな数でも桁あふれしない");
  console.log("ピタゴラス勝率: 式・両端・大きな数 OK");
}

// --- ②反転 ---
{
  assert.equal(defaultInvert("tov"), true, "TOV は少ないほど良い");
  assert.equal(defaultInvert("drtg"), true);
  assert.equal(defaultInvert("opppts"), true);
  assert.equal(defaultInvert("pts"), false);
  assert.equal(defaultInvert("ortg"), false);
  assert.equal(defaultInvert("tov", "opp"), false, "相手の TOV は多いほうが良い（奪った数）");
  assert.equal(defaultInvert("fgpct", "opp"), true, "相手の FG% は少ないほうが良い");
  assert.equal(defaultInvert("pace"), false, "良し悪しなしは自動では反転しない");
  assert.equal(invertedName("TOV", true), "TOV（反転）");
  assert.equal(invertedName("TOV", false), "TOV");
  console.log("軸の反転: 向き・名前 OK");
}

// --- ⑥保存した設定 ---
{
  const ids = new Set(freeItems("2026-27").map(i => i.id));
  assert.equal(STRENGTH_INITIAL_PRESETS.length, 3);
  for (const p of STRENGTH_INITIAL_PRESETS) {
    for (const key of ["fx", "fy"]) assert.ok(ids.has(p.params[key]!), `${p.name}: ${p.params[key]} は選べる項目`);
    assert.equal(p.figure, "team-shooting");
    assert.ok(presetQuery(new URLSearchParams(p.params)).length > 0);
  }
  assert.deepEqual(STRENGTH_INITIAL_PRESETS.map(p => p.name), ["勝率×ピタゴラス勝率", "NetRtg×ここまでの相手の強さ", "勝率×残りの相手の強さ"]);
  assert.equal(resolveFreeItem(freeItemId("strength", "pythag"), "2026-27", "x").label, "ピタゴラス勝率");
  console.log("保存した設定の3つ: 選べる項目 OK");
}

// --- ⑤順位表と散布図が同じ関数を通る ---
{
  const standings = readFileSync("src/pages/StandingsPage.tsx", "utf8");
  assert.ok(standings.includes("computeStandingsOpponentStrengths"), "順位表は共通の関数を使う");
  assert.ok(!/computeOpponentStrength\(|computeRemainingOpponentStrength\(/.test(standings), "順位表が別の書き方で計算していない");
  assert.ok(readFileSync("src/figures/useOpponentStrengths.ts", "utf8").includes("computeStandingsOpponentStrengths"), "散布図も同じ関数を使う");
  console.log("順位表と散布図は同じ関数: OK");
}

// --- ③④実データ（今季 B.PREMIER） ---
const season = "2026-27", base = path.join(dataDir, season);
if (!existsSync(path.join(base, "teams.json.gz"))) {
  console.log(`${season} の導出データが無いので実データの確認は省略（npm run build:data のあとに流す）`);
} else {
  const teams = read<TeamSummary[]>(path.join(base, "teams.json.gz"));
  const logs = new Map<string, TeamGameLog[]>();
  for (const t of teams) { const f = path.join(base, "team-games", t.teamId + ".json.gz"); if (existsSync(f)) logs.set(t.teamId, read<TeamGameLog[]>(f)); }
  const history = read<StandingsSnapshot[]>(path.join(base, "standings-history.json.gz"));
  const latest = history[history.length - 1]!;
  const gameSummaries = read<GameSummary[]>(path.join(base, "games-summary.json.gz"));
  const schedule = read<ScheduleFileExtended>(path.join(base, "schedule.json.gz"));
  const race = existsSync(path.join(base, "playoff-race.json.gz")) ? read<PlayoffRaceFile>(path.join(base, "playoff-race.json.gz")) : null;
  const strengths = computeStandingsOpponentStrengths({ teams: latest.teams, gameSummaries, schedule, playoffRace: race });
  const q = { season, category: "premier" as const, range: { kind: "all" as const }, gameType: "regular" as const, seasonTotals: false };
  const built = buildFreeRows(teams, logs, null, { ...q, strength: { sofar: strengths.sofar, remaining: strengths.remaining } });
  const utsunomiya = teams.find(t => t.teamName.includes("宇都宮"))!;
  assert.ok(utsunomiya, "宇都宮がいる");
  const row = built.rows.find(r => r.teamId === utsunomiya.teamId)!;

  // ④-1 ピタゴラス勝率: 試合ログから別に合計して手で計算
  const regular = (logs.get(utsunomiya.teamId) ?? []).filter(g => g.gameType === "regular" && g.min > 0);
  const pts = regular.reduce((s, g) => s + g.teamScore, 0), opp = regular.reduce((s, g) => s + g.opponentScore, 0);
  const handPy = Math.pow(pts, 13.91) / (Math.pow(pts, 13.91) + Math.pow(opp, 13.91));
  const col = freeColumn(freeItems(season).find(i => i.id === freeItemId("strength", "pythag"))!, "own", "perGame", season)!;
  assert.ok(Math.abs(col.value(row)! - handPy) < 1e-9, "宇都宮のピタゴラス勝率が手計算と一致");
  console.log(`宇都宮 ${regular.length}試合 得点${pts} 失点${opp} → ピタゴラス勝率 ${formatWinPct(handPy)}（散布図 ${col.text(row)}）`);

  // ④-2 ここまで・残りの相手の強さ: 順位表の最新の勝敗から相手の勝率を作り、別の書き方で平均
  const rate = new Map(latest.teams.map(t => [t.teamId, t.wins + t.losses > 0 ? t.wins / (t.wins + t.losses) : undefined] as const));
  const games = [...gameSummaries, ...resultOnlySummaries(schedule.resultOnlyGames, gameSummaries)].filter(g => g.gameType === "regular" && g.gameEndedFlg && (g.homeTeamId === utsunomiya.teamId || g.awayTeamId === utsunomiya.teamId));
  const oppRates = games.map(g => rate.get(g.homeTeamId === utsunomiya.teamId ? g.awayTeamId : g.homeTeamId)).filter((v): v is number => v !== undefined);
  const handSofar = oppRates.reduce((a, b) => a + b, 0) / oppRates.length;
  assert.ok(Math.abs(row.strength!.sofar! - handSofar) < 1e-9, "宇都宮のここまでの相手の強さが別の書き方の計算と一致");
  assert.ok(Math.abs(strengths.sofar.get(utsunomiya.teamId)!.value - row.strength!.sofar!) < 1e-12, "順位表の関数の値と散布図の行の値が同じ");
  const nameToId = new Map(latest.teams.map(t => [t.teamName, t.teamId]));
  for (const t of race?.teams ?? []) if (t.teamName) nameToId.set(t.teamName, t.teamId);
  const skip = new Set((schedule.resultOnlyGames ?? []).map(g => g.scheduleKey));
  const remainRates: number[] = [];
  for (const g of pendingUpcomingGames(schedule.upcomingGames, gameSummaries)) {
    if (skip.has(g.scheduleKey)) continue;
    const h = nameToId.get(g.homeTeamName), a = nameToId.get(g.awayTeamName);
    if (!h || !a) continue;
    const opponent = h === utsunomiya.teamId ? a : a === utsunomiya.teamId ? h : null;
    const r = opponent ? rate.get(opponent) : undefined;
    if (r !== undefined) remainRates.push(r);
  }
  const handRemain = remainRates.reduce((a, b) => a + b, 0) / remainRates.length;
  assert.ok(Math.abs(row.strength!.remaining! - handRemain) < 1e-9, "宇都宮の残りの相手の強さが別の書き方の計算と一致");
  console.log(`宇都宮 ここまで ${formatWinPct(handSofar)}（${oppRates.length}試合）・残り ${formatWinPct(handRemain)}（${remainRates.length}試合）— 順位表の列と同じ関数・別の書き方の計算とも一致。リーグ内順位 ここまで${strengths.sofar.get(utsunomiya.teamId)!.rank}位・残り${strengths.remaining!.get(utsunomiya.teamId)!.rank}位`);

  // ③ 会場: ホーム＋アウェイ＝全試合（試合数・得点・失点）。全チーム
  const home = buildFreeRows(teams, logs, null, { ...q, venue: "home" }), away = buildFreeRows(teams, logs, null, { ...q, venue: "away" }), all = buildFreeRows(teams, logs, null, q);
  for (const r of all.rows) {
    const h = home.rows.find(x => x.teamId === r.teamId), a = away.rows.find(x => x.teamId === r.teamId);
    assert.equal((h?.games ?? 0) + (a?.games ?? 0), r.games, `${r.teamName}: ホーム＋アウェイの試合数＝全試合`);
    assert.equal((h?.row.totals.pts ?? 0) + (a?.row.totals.pts ?? 0), r.row.totals.pts, `${r.teamName}: 得点の合計が一致`);
    assert.equal((h?.row.totals.oppPts ?? 0) + (a?.row.totals.oppPts ?? 0), r.row.totals.oppPts, `${r.teamName}: 失点の合計が一致`);
  }
  const hRow = home.rows.find(r => r.teamId === utsunomiya.teamId)!;
  const handHome = (logs.get(utsunomiya.teamId) ?? []).filter(g => g.gameType === "regular" && g.min > 0 && g.isHome);
  assert.equal(hRow.games, handHome.length, "宇都宮のホームの試合数");
  assert.equal(filterGameLogs(logs.get(utsunomiya.teamId)!, { range: { kind: "all" }, includePlayoffs: true, ...venueFilter("away") }, undefined, undefined, undefined, undefined, "premier").every(g => !g.isHome), true);
  assert.equal(filterByVenue([{ isHome: true }, { isHome: false }], "home").length, 1);
  assert.deepEqual(venueConditionLabel("all"), []);
  assert.deepEqual(venueConditionLabel("away"), ["アウェイの試合だけ"]);
  // 相手の強さは会場を絞っても変わらない（シーズン全体の値）
  assert.equal(home.rows.find(r => r.teamId === utsunomiya.teamId)!.strength, undefined, "strength を渡さなければ値なし");
  const homeWith = buildFreeRows(teams, logs, null, { ...q, venue: "home", strength: { sofar: strengths.sofar, remaining: strengths.remaining } });
  assert.equal(homeWith.rows.find(r => r.teamId === utsunomiya.teamId)!.strength!.sofar, row.strength!.sofar, "ホームだけにしても相手の強さは同じ");
  console.log(`ホーム＋アウェイ＝全試合（${all.rows.length}チーム）・宇都宮のホーム ${hRow.games}試合 OK`);
}
console.log("validate:figure-strength OK");
