// 順位表の「対戦相手の強さ」（src/lib/opponentStrength.ts。DESIGN.md 251章）の検証スクリプト（検証専用。CIには入れず、必要なときに手で実行する）。
//
// 確かめること: ①手計算できる小さな例（加重平均・順位・同率・未対戦・プレーオフと未終了の除外）②全シーズンの実データで、
// games-summary＋結果だけの試合から数えた勝敗が順位表（standings-history の最新）の勝敗と一致すること、
// 対戦試合数の合計がクラブの試合数と一致すること、値が別の書き方（相手ごとに数えてから加重平均）の計算と一致すること。
//
// 使い方: npm run validate:opponent-strength（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { computeOpponentStrength } from "../src/lib/opponentStrength";
import { resultOnlySummaries } from "../src/lib/resultOnlyGames";
import type { GameSummary, StandingsSnapshot } from "../shared/types";

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

if (failures > 0) {
  console.error(`\n${failures} 件の食い違いがあります`);
  process.exitCode = 1;
} else {
  console.log("\nすべて一致しました");
}
