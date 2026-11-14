// 順位の向きの共通の定義（src/lib/rankDirection.ts）・成功率の最低試投数・1試合記録の同じ成功率の決め方の検証（設計書391章）。
// 使い方: npm run validate:rank-direction。1つでも食い違えば終了コード1
import { rankDirectionOf, ownRankDirection, RANK_DIRECTION_TEXT } from "../src/lib/rankDirection";
import { shotPctMinAttempts, filterShotPctMinAttempts } from "../src/lib/playerRankingEligibility";
import { rerankByMade, tieKeyWithMade } from "../src/lib/recordTieBreak";
import { seasonBoxColumnsByTab, withPppColumn } from "../src/lib/playerSeasonRanking";
import { buildTraditionalColumns, buildAdvancedColumns, buildMiscColumns, buildScoringColumns } from "../src/lib/teamStatsColumns";
import type { PlayerSummary } from "../shared/types";

let failures = 0;
function eq(label: string, actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures += 1;
    console.error(`NG ${label}\n   実際: ${JSON.stringify(actual)}\n   期待: ${JSON.stringify(expected)}`);
  } else console.log(`ok ${label}`);
}

// ① 向き
for (const k of ["pts", "reb", "tr", "ast", "stl", "blk", "stocks", "fgpct", "2ppct", "3ppct", "ftpct", "efg", "ts", "ortg", "netrtg", "fd", "eff", "plusminus", "astpct", "ftr", "ppp", "pps"]) eq(`多いほど良い ${k}`, ownRankDirection(k), "higher");
for (const k of ["tov", "tovpct", "f", "bsr", "drtg", "opppts", "tf", "tf1", "tf2", "ufoul", "flag", "disr", "dqfoul", "offfoul"]) eq(`少ないほど良い ${k}`, ownRankDirection(k), "lower");
for (const k of ["pace", "poss", "min", "g", "gs"]) eq(`良し悪しなし ${k}`, ownRankDirection(k), "neutral");
eq("opp の FG% は少ないほど良い", rankDirectionOf("fgpct", "opp"), "lower");
eq("opp の TOV は多いほど良い（奪った数）", rankDirectionOf("tov", "opp"), "higher");
eq("opp の PACE は良し悪しなし", rankDirectionOf("pace", "opp"), "neutral");
eq("+/- 視点は自チームの向き", rankDirectionOf("tov", "diff"), "lower");
eq("md の文字", RANK_DIRECTION_TEXT.neutral, "多い順（良し悪しなし）");

// 全列に向きが付く（取りこぼしを一覧で見る）
const keys = new Set<string>();
for (const fs of [true, false]) {
  const c = seasonBoxColumnsByTab(fs);
  for (const t of ["traditional", "advanced", "misc", "scoring"] as const) for (const x of t === "advanced" ? withPppColumn(c[t]) : c[t]) keys.add(x.key);
}
for (const p of ["own", "opp", "diff"] as const) {
  for (const x of [...buildTraditionalColumns("perGame", p), ...buildAdvancedColumns("perGame", p), ...(buildMiscColumns as any)("perGame", p, true), ...(buildScoringColumns as any)("perGame", p)]) keys.add(x.key);
}
const byDir: Record<string, string[]> = { higher: [], lower: [], neutral: [] };
for (const k of [...keys].sort()) byDir[ownRankDirection(k)]!.push(k);
console.log(`少ないほど良い: ${byDir.lower!.join(" ")}\n良し悪しなし: ${byDir.neutral!.join(" ")}\n多いほど良い: ${byDir.higher!.length}項目`);
// 既存の列が「少ないほど良い」と宣言しているものは、共通の定義でも lower
for (const fs of [true, false]) {
  const c = seasonBoxColumnsByTab(fs);
  for (const t of ["traditional", "advanced", "misc", "scoring"] as const) for (const x of c[t]) if (x.higherIsBetter === false) eq(`既存の少ない順 ${x.key}`, ownRankDirection(x.key), "lower");
}

// ② 最低試投数
eq("60試合→30本", shotPctMinAttempts(60), 30);
eq("5試合→3本", shotPctMinAttempts(5), 3);
eq("59試合→30本（切り上げ）", shotPctMinAttempts(59), 30);
const mk = (id: string, att: number) => ({ playerId: id, teamId: "t", shotTypes: { jump: { twoPoint: { made: 1, attempted: att }, threePoint: { made: 0, attempted: att } } } }) as unknown as PlayerSummary;
const teams = [{ teamId: "t", gamesPlayed: 60 }];
eq("29本は外れ・30本は残る", filterShotPctMinAttempts([mk("a", 29), mk("b", 30), mk("c", 45)], teams, "jump_2ppct").map((p) => p.playerId), ["b", "c"]);
eq("成功率でない項目は絞らない", filterShotPctMinAttempts([mk("a", 1)], teams, "jump_2pa").length, 1);

// ③ 同じ成功率は成功数の多いほうが上
const r = (value: number, made: number, rank: number) => ({ value, made, rank });
eq("成功数の多い順・同じ成功数は同順位", rerankByMade([r(1, 5, 1), r(1, 7, 1), r(1, 7, 1), r(0.9, 9, 4)]).map((x) => [x.made, x.rank]), [[7, 1], [7, 1], [5, 3], [9, 4]]);
eq("成功数の無い行は変えない", rerankByMade([{ value: 5, rank: 1 }, { value: 5, rank: 1 }]).map((x) => x.rank), [1, 1]);
eq("tieKey", [tieKeyWithMade({ value: 1, made: 7 }), tieKeyWithMade({ value: 1 })], ["1|7", "1"]);

if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exit(1);
}
console.log("\nすべて一致");
