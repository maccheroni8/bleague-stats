// 順位表の「対戦相手の強さ」（src/lib/opponentStrength.ts。DESIGN.md 251章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること: ①手計算できる小さな例（加重平均・順位・同率・未対戦・プレーオフと未終了の除外）②全シーズンの実データで、
// games-summary＋結果だけの試合から数えた勝敗が順位表（standings-history の最新）の勝敗と一致すること、
// 対戦試合数の合計がクラブの試合数と一致すること、値が別の書き方（相手ごとに数えてから加重平均）の計算と一致すること。
// ③残りの相手の強さ（443章）の小さな例（同じ相手の複数回・名寄せできない試合・結果だけの試合・勝率の無い相手・残りなし）
// ④全シーズン・両リーグの実データで、最新勝率の元の2つ（teams.json と順位表の最新日）の勝敗が一致すること（チーム詳細と順位表で同じ最新勝率になる）、
// 残りの相手の強さが別の書き方の計算と一致し、数えた試合数＝開催予定の試合数であること。今季は数えた残り＋消化試合が規定の試合数に届かないクラブ（日程が決まっていない試合）を出す
//
// ⑤最新勝率と試合時点の勝率（450章）: 小さな例（同じ相手でも時期で区分が変わる・5試合未満は対象外）・選択肢の並びと名前・絞り込みの部品・URL（opw は前のまま、opl が新しい値）・
// 条件別順位表のグループのまとめ（キーは前のまま・ほかの並びは変えない）
//
// 使い方: npm run validate:opponent-strength（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import {
  buildOpponentRecords,
  buildOpponentSeasonWinRates,
  computeOpponentStrength,
  computeRemainingOpponentStrength,
  isOpponentStrengthUnclassified,
  matchesOpponentAtGameRate,
  matchesOpponentSeasonWinRate,
  matchesOpponentStrength,
  matchesOpponentWinRateTier,
  opponentStrengthChoices,
  OPPONENT_STRENGTH_TIERS,
  type OpponentSeasonTier,
} from "../src/lib/opponentStrength";
import { applyConditionalCondition, buildConditionGroups, describeCondition, type ConditionalCondition } from "../src/lib/conditionalCondition";
import { matchesSituationalAndFilters } from "../src/lib/situational";
import { situationalParam } from "../src/lib/urlState";
import { withResultOnlyLogs } from "../src/lib/resultOnlyGames";
import { pendingUpcomingGames } from "../shared/pendingUpcoming";
import { resultOnlySummaries } from "../src/lib/resultOnlyGames";
import type { GameSummary, StandingsSnapshot, TeamGameLog, TeamSummary, UpcomingGameEntry } from "../shared/types";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${a}\n   期待: ${e}`);
  } else {
    console.log(`ok ${label}`);
  }
}
const close = (a: number, b: number) => Math.abs(a - b) < 1e-9;

// --- ①小さな例 ---
{
  const g = (key: string, home: string, away: string, gameType: "regular" | "playoff" = "regular", ended = true): GameSummary =>
    ({ scheduleKey: key, date: "2026-10-01", homeTeamId: home, homeTeamName: home, awayTeamId: away, awayTeamName: away, homeScore: 80, awayScore: 70, gameEndedFlg: ended, gameType }) as GameSummary;
  // A は B（勝率.700）と2試合、C（勝率.400）と1試合。D は未試合
  const teams = [
    { teamId: "A", wins: 5, losses: 5 },
    { teamId: "B", wins: 7, losses: 3 },
    { teamId: "C", wins: 4, losses: 6 },
    { teamId: "D", wins: 0, losses: 0 },
  ];
  const games = [g("1", "A", "B"), g("2", "B", "A"), g("3", "A", "C"), g("4", "A", "B", "playoff"), g("5", "A", "C", "regular", false)];
  const r = computeOpponentStrength(teams, games);
  eq("A: (.7×2＋.4×1)÷3 ＝ .6（試合数3。プレーオフ・未終了は数えない）", [r.get("A")!.value.toFixed(6), r.get("A")!.games], ["0.600000", 3]);
  eq("B: A（.5）と2試合 ＝ .5", [r.get("B")!.value.toFixed(6), r.get("B")!.games], ["0.500000", 2]);
  eq("C: A（.5）と1試合 ＝ .5", [r.get("C")!.value.toFixed(6), r.get("C")!.games], ["0.500000", 1]);
  eq("まだ試合をしていないクラブは値を持たない", r.has("D"), false);
  eq("順位: 高い順。同じ表示値（.500）は同じ順位で、次は飛ばす", [r.get("A")!.rank, r.get("B")!.rank, r.get("C")!.rank], [1, 2, 2]);
  // 勝率: A .5・B 1.0・C 0・D .5・E .5。値: A＝(B 1.0＋C 0)÷2＝.5、B＝(A .5＋D .5)÷2＝.5、C＝(A .5＋E .5)÷2＝.5、D＝B 1.0、E＝C 0
  const r2 = computeOpponentStrength(
    [{ teamId: "A", wins: 1, losses: 1 }, { teamId: "B", wins: 2, losses: 0 }, { teamId: "C", wins: 0, losses: 2 }, { teamId: "D", wins: 1, losses: 1 }, { teamId: "E", wins: 1, losses: 1 }],
    [g("1", "A", "B"), g("2", "A", "C"), g("3", "B", "D"), g("4", "E", "C")],
  );
  eq("順位: 同率（.500）の次は飛ばす（D が1位、A・B・C が2位タイ、E は5位）", ["A", "B", "C", "D", "E"].map((id) => r2.get(id)!.rank), [2, 2, 2, 1, 5]);
}

// --- ②全シーズンの実データ ---
const dataDir = path.join(process.cwd(), "data");
const readGz = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(gunzipSync(readFileSync(file)).toString("utf8")) as T) : null);
const seasons = readdirSync(dataDir).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
for (const season of seasons) {
  const dir = path.join(dataDir, season);
  const summaries = readGz<GameSummary[]>(path.join(dir, "games-summary.json.gz"));
  const history = readGz<StandingsSnapshot[]>(path.join(dir, "standings-history.json.gz"));
  const schedule = readGz<{ resultOnlyGames?: Parameters<typeof resultOnlySummaries>[0] }>(path.join(dir, "schedule.json.gz"));
  if (!summaries || !history || history.length === 0) continue;
  const latest = history[history.length - 1]!;
  const games = [...summaries, ...resultOnlySummaries(schedule?.resultOnlyGames, summaries)];
  const result = computeOpponentStrength(latest.teams, games);

  // 順位表と同じ勝敗か（結果だけの試合を含めた数え方）
  const record = new Map<string, { w: number; l: number }>();
  for (const g of games) {
    if (g.gameType !== "regular" || !g.gameEndedFlg) continue;
    const homeWon = g.homeScore > g.awayScore;
    for (const [id, won] of [[g.homeTeamId, homeWon], [g.awayTeamId, !homeWon]] as const) {
      const r = record.get(id) ?? { w: 0, l: 0 };
      if (won) r.w += 1;
      else r.l += 1;
      record.set(id, r);
    }
  }
  const mismatch = latest.teams.filter((t) => { const r = record.get(t.teamId); return !r || r.w !== t.wins || r.l !== t.losses; }).map((t) => t.teamId);
  eq(`${season}: 試合から数えた勝敗が順位表と一致（${latest.teams.length}クラブ）`, mismatch, []);

  // 別の書き方（相手ごとに数えてから加重平均）と一致するか・対戦試合数の合計がクラブの試合数と一致するか
  const winPct = new Map(latest.teams.map((t) => [t.teamId, t.wins / (t.wins + t.losses)]));
  const bad: string[] = [];
  for (const t of latest.teams) {
    const vs = new Map<string, number>();
    for (const g of games) {
      if (g.gameType !== "regular" || !g.gameEndedFlg) continue;
      if (g.homeTeamId === t.teamId) vs.set(g.awayTeamId, (vs.get(g.awayTeamId) ?? 0) + 1);
      else if (g.awayTeamId === t.teamId) vs.set(g.homeTeamId, (vs.get(g.homeTeamId) ?? 0) + 1);
    }
    let n = 0;
    let sum = 0;
    for (const [opp, c] of vs) {
      const p = winPct.get(opp);
      if (p === undefined) continue;
      n += c;
      sum += p * c;
    }
    const got = result.get(t.teamId);
    if (!got || got.games !== n || got.games !== t.wins + t.losses || !close(got.value, sum / n)) bad.push(t.teamId);
  }
  eq(`${season}: 加重平均の値・対戦試合数（＝勝＋敗）が別の計算と一致`, bad, []);
}

// --- ③残りの相手の強さの小さな例 ---
{
  const u = (key: string, home: string, away: string): UpcomingGameEntry => ({ scheduleKey: key, date: "2026-12-01", homeTeamName: home, awayTeamName: away });
  const teams = [
    { teamId: "A", wins: 5, losses: 5 },
    { teamId: "B", wins: 7, losses: 3 },
    { teamId: "C", wins: 4, losses: 6 },
    { teamId: "D", wins: 0, losses: 0 },
    { teamId: "E", wins: 3, losses: 3 },
  ];
  const byName = new Map([["a", "A"], ["b", "B"], ["c", "C"], ["d", "D"], ["e", "E"]]);
  // A は B（.700）と2試合・C（.400）と1試合・D（勝率なし）と1試合・名寄せできない相手と1試合・結果だけの試合（x）が1試合残る
  const r = computeRemainingOpponentStrength(teams, [u("1", "a", "b"), u("2", "b", "a"), u("3", "c", "a"), u("4", "a", "d"), u("5", "a", "?"), u("x", "a", "c")], byName, new Set(["x"]));
  eq("A: (.7×2＋.4×1)÷3 ＝ .6（勝率の無い相手・名寄せできない試合・結果だけの試合は数えない）", [r.get("A")!.value.toFixed(6), r.get("A")!.games], ["0.600000", 3]);
  eq("D: まだ試合をしていないクラブでも、相手（A .5）に勝率があれば残りの値を持つ", [r.get("D")!.value.toFixed(6), r.get("D")!.games], ["0.500000", 1]);
  eq("E: 残り試合が無いクラブは値を持たない", r.has("E"), false);
  eq("1試合ごとの区分: .600（F）は対6割以上・対5割以上、.500 は対5割以上、.400 は対5割未満、勝率なしはどれにも入らない",
    ([["F", "atLeast60"], ["F", "atLeast50"], ["A", "atLeast50"], ["C", "under50"], ["D", "under50"], ["D", "atLeast50"]] as const).map(([id, tier]) =>
      matchesOpponentSeasonWinRate(id, tier, buildOpponentSeasonWinRates([...teams, { teamId: "F", wins: 6, losses: 4 }]))),
    [true, true, true, true, false, false]);
}

// --- ④全シーズン・両リーグの実データ（最新勝率の元の一致・残りの相手の強さ） ---
const readAny = <T>(file: string): T | null => readGz<T>(file + ".gz") ?? (existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as T) : null);
for (const season of seasons) {
  for (const dir of [path.join(dataDir, season), path.join(dataDir, season, "one")]) {
    const label = path.relative(dataDir, dir);
    const teams = readAny<TeamSummary[]>(path.join(dir, "teams.json"));
    const history = readAny<StandingsSnapshot[]>(path.join(dir, "standings-history.json"));
    const summaries = readAny<GameSummary[]>(path.join(dir, "games-summary.json"));
    const schedule = readAny<{ upcomingGames?: UpcomingGameEntry[]; resultOnlyGames?: { scheduleKey: string }[] }>(path.join(dir, "schedule.json"));
    if (!teams || !history || history.length === 0 || !summaries) continue;
    const latest = history[history.length - 1]!;
    const a = buildOpponentSeasonWinRates(teams);
    const b = buildOpponentSeasonWinRates(latest.teams);
    const diff = [...new Set([...a.keys(), ...b.keys()])].filter((id) => a.get(id) !== b.get(id));
    eq(`${label}: 最新勝率が teams.json（チーム詳細）と順位表の最新日（条件別順位表）で同じ（${a.size}クラブ）`, diff, []);

    const pending = pendingUpcomingGames(schedule?.upcomingGames, summaries);
    const roKeys = new Set((schedule?.resultOnlyGames ?? []).map((g) => g.scheduleKey));
    const byName = new Map(teams.map((t) => [t.teamName, t.teamId]));
    const remaining = computeRemainingOpponentStrength(teams, pending, byName, roKeys);
    const bad: string[] = [];
    for (const t of teams) {
      let n = 0;
      let sum = 0;
      for (const g of pending) {
        if (roKeys.has(g.scheduleKey)) continue;
        const opp = g.homeTeamName === t.teamName ? g.awayTeamName : g.awayTeamName === t.teamName ? g.homeTeamName : null;
        if (!opp) continue;
        const p = a.get(byName.get(opp) ?? "");
        if (p === undefined) continue;
        n += 1;
        sum += p;
      }
      const got = remaining.get(t.teamId);
      if (n === 0 ? got !== undefined : !got || got.games !== n || !close(got.value, sum / n)) bad.push(t.teamId);
    }
    eq(`${label}: 残りの相手の強さが別の計算（相手ごとに1試合ずつ足す）と一致・残りなしは値なし`, bad, []);
    const unmapped = pending.filter((g) => !byName.has(g.homeTeamName) || !byName.has(g.awayTeamName)).length;
    eq(`${label}: 開催予定の試合はすべて名寄せできる（${pending.length}試合）`, unmapped, 0);
    if (season === seasons[seasons.length - 1]) {
      const short = teams
        .map((t) => ({ name: t.teamName, n: t.wins + t.losses + (remaining.get(t.teamId)?.games ?? 0) }))
        .filter((x) => x.n < 60)
        .map((x) => `${x.name} ${60 - x.n}`);
      console.log(`   ${label}: 消化試合＋数えた残りが60試合に届かないクラブ（日程が決まっていない・中止の試合）: ${short.length === 0 ? "なし" : short.join("・")}`);
    }
  }
}

// --- ⑤最新勝率と試合時点の勝率（450章）: 小さな例・並び・名前・URL・条件別順位表のまとめ ---
{
  const g = (key: string, date: string, home: string, away: string, homeWin: boolean): GameSummary =>
    ({ scheduleKey: key, date, homeTeamId: home, homeTeamName: home, awayTeamId: away, awayTeamName: away, homeScore: homeWin ? 80 : 70, awayScore: homeWin ? 70 : 80, gameEndedFlg: true, gameType: "regular" }) as GameSummary;
  // B は最初の5試合で 4勝1敗（.800）、そのあと A と戦う（k6）。B の最新は 4勝6敗（.400）
  const games = [
    g("k1", "2026-10-01", "B", "C", true), g("k2", "2026-10-02", "B", "C", true), g("k3", "2026-10-03", "B", "C", true),
    g("k4", "2026-10-04", "B", "C", true), g("k5", "2026-10-05", "B", "C", false), g("k6", "2026-10-06", "A", "B", true),
    g("k7", "2026-10-07", "B", "C", false), g("k8", "2026-10-08", "B", "C", false), g("k9", "2026-10-09", "B", "C", false), g("k10", "2026-10-10", "B", "C", false),
    g("k0", "2026-10-01", "A", "D", true),
  ];
  const teams = [{ teamId: "A", wins: 2, losses: 0 }, { teamId: "B", wins: 4, losses: 7 }, { teamId: "C", wins: 6, losses: 4 }, { teamId: "D", wins: 0, losses: 1 }];
  const rec = buildOpponentRecords(games, teams);
  const k6 = { scheduleKey: "k6", opponentTeamId: "B" };
  const k0 = { scheduleKey: "k0", opponentTeamId: "D" };
  eq("試合時点: k6 の B は 4勝1敗（.800）で対6割以上・対5割以上", (["atLeast60", "atLeast50", "under50"] as const).map((t) => matchesOpponentStrength(k6, t, "atGame", { atGame: rec })), [true, true, false]);
  eq("最新: 同じ k6 の B は 4勝7敗（.364）で対5割未満", (["atLeast60", "atLeast50", "under50"] as const).map((t) => matchesOpponentStrength(k6, t, "latest", { atGame: rec })), [false, false, true]);
  eq("試合時点: 相手が5試合未満（k0 の D は0試合）はどの区分にも入らず対象外。最新では D（0勝1敗）は対5割未満",
    [OPPONENT_STRENGTH_TIERS.some((t) => matchesOpponentStrength(k0, t, "atGame", { atGame: rec })), isOpponentStrengthUnclassified(k0, "atGame", { atGame: rec }), matchesOpponentStrength(k0, "under50", "latest", { atGame: rec }), isOpponentStrengthUnclassified(k0, "latest", { atGame: rec })],
    [false, true, true, false]);
  eq("試合時点の判定は前からの matchesOpponentWinRateTier と同じ", OPPONENT_STRENGTH_TIERS.map((t) => matchesOpponentWinRateTier(k6, t, rec)), [false, true, true]);
  eq("数字で選ぶ試合時点の勝率: k6 の B（.800）は .8以上・.81未満、5試合未満の k0 は入らない",
    [matchesOpponentAtGameRate(k6, "ge", 0.8, rec), matchesOpponentAtGameRate(k6, "lt", 0.81, rec), matchesOpponentAtGameRate(k0, "lt", 1, rec)], [true, true, false]);
  eq("teams.json が無ければ最新勝率は持たない（最新勝率の条件はどの試合も入らない）", [buildOpponentRecords(games, null).latestWinRates === undefined, matchesOpponentStrength(k6, "under50", "latest", { atGame: buildOpponentRecords(games, null) })], [true, false]);
  eq("選択肢の並び: 同じ区切りの最新勝率と試合時点の勝率が隣り合わせ", opponentStrengthChoices().map((c) => c.label), [
    "対5割未満（最新勝率）", "対5割未満（試合時点の勝率）", "対5割以上（最新勝率）", "対5割以上（試合時点の勝率）", "対6割以上（最新勝率）", "対6割以上（試合時点の勝率）",
  ]);
  // 絞り込みの部品: 試合時点（opponentWinRate）と最新（opponentLatestWinRate）
  const log = { ...k6, date: "2026-10-06", win: true, isHome: true } as unknown as TeamGameLog;
  eq("絞り込み: 試合時点の対6割以上に入り、最新の対6割以上には入らない", [matchesSituationalAndFilters(log, { opponentWinRate: "atLeast60" }, rec), matchesSituationalAndFilters(log, { opponentLatestWinRate: "atLeast60" }, rec), matchesSituationalAndFilters(log, { opponentLatestWinRate: "under50" }, rec)], [true, false, true]);
  // URL: 前からの opw はそのまま、新しい opl は最新勝率
  const readUrl = (q: string) => situationalParam.read(new URLSearchParams(q));
  const write = (f: Parameters<typeof situationalParam.write>[1]) => { const p = new URLSearchParams(); situationalParam.write(p, f); return p.toString(); };
  eq("URL: opw（試合時点）は前のまま読める・opl（最新）は新しい値", [readUrl("opw=atLeast60")?.opponentWinRate, readUrl("opl=under50")?.opponentLatestWinRate, readUrl("opl=under50")?.opponentWinRate], ["atLeast60", "under50", undefined]);
  eq("URL: 書き出しは opw／opl", [write({ range: { kind: "all" }, opponentWinRate: "atLeast50" }), write({ range: { kind: "all" }, opponentLatestWinRate: "atLeast50" })], ["opw=atLeast50", "opl=atLeast50"]);
  // 条件別順位表: 相手の強さは1つのグループに6つ。キーは前のまま。ほかのグループの並びは変えない
  const groups = buildConditionGroups({ presentDivisions: ["east", "west"], backToBackStatus: undefined, regularScheduleKeys: new Set(), biweekPeriods: [], numbers: { count: 2, score: 80 } });
  const opp = groups.filter((gr) => gr.options.some((o) => o.condition.kind === "opponentWinRate" || o.condition.kind === "opponentLatestWinRate"));
  eq("条件別順位表: 相手の強さは1つのグループ（対戦相手の強さ）にまとまり、キーと名前が並ぶ", opp.map((gr) => [gr.label, gr.options.map((o) => `${o.key}=${o.label}`)]), [["対戦相手の強さ", [
    "oppLatest-under50=対5割未満（最新勝率）", "oppwin-under50=対5割未満（試合時点の勝率）", "oppLatest-atLeast50=対5割以上（最新勝率）", "oppwin-50=対5割以上（試合時点の勝率）",
    "oppLatest-atLeast60=対6割以上（最新勝率）", "oppwin-60=対6割以上（試合時点の勝率）",
  ]]]);
  eq("条件別順位表: グループの並び（相手の強さは前の「その時点までの勝率」の場所。最新勝率のグループは無くなる。ほかは前と同じ順）", groups.filter((gr) => gr.options.length > 0).map((gr) => gr.label), [
    "年明け前後", "会場", "対戦相手の地区", "曜日", "対戦相手の強さ", "連戦（同じ相手と中1日以内の連戦）", "直近の試合数", "シーズンの時期", "点差決着",
    "外国籍の出場人数", "外国籍・帰化・アジアの出場人数", "外国籍・帰化・アジアの出場人数（相手との比較）", "最長のオンザコート人数", "得点・失点", "延長", "Q1終了時点", "前半終了時点", "3Q終了時点", "試合中の点差（延長戦を含む）", "クラッチ",
  ]);
  eq("条件の名前（見出し）", ([{ kind: "opponentWinRate", tier: "atLeast50" }, { kind: "opponentLatestWinRate", tier: "atLeast50" }, { kind: "opponentLatestRate", mode: "ge", rate: 0.6 }, { kind: "opponentAtGameRate", mode: "lt", rate: 0.5 }] as ConditionalCondition[]).map(describeCondition),
    ["対5割以上（試合時点の勝率）", "対5割以上（最新勝率）", "対勝率.600以上（最新勝率）", "対勝率.500未満（試合時点の勝率）"]);
  const logs = [{ ...log }, { ...k0, date: "2026-10-01", win: true, isHome: true } as unknown as TeamGameLog];
  eq("条件別順位表: 数字で選ぶ試合時点の勝率（.6以上は k6 だけ）", applyConditionalCondition(logs, { kind: "opponentAtGameRate", mode: "ge", rate: 0.6 }, { teamId: "A", season: "2026-27", league: "premier", opponentRecords: rec }).map((x) => x.scheduleKey), ["k6"]);
  void withResultOnlyLogs;
  void (null as unknown as OpponentSeasonTier);
}

if (failures > 0) {
  console.error(`\n${failures} 件の食い違いがあります`);
  process.exitCode = 1;
} else {
  console.log("\nすべて一致しました");
}
