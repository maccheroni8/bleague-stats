// 全チームスタッツの区間別（DESIGN.md 256章の段階2。src/lib/teamPeriodTotals.ts の sumTeamPeriodTotals）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 区間の合計 = 試合全体: 全シーズン・全チームで、1Q〜4Q＋延長の値を足すと、試合ログの合計（sumTeamGameLogs。全チームスタッツの試合全体の値）と全項目一致する
//     （前後半5分の特別な試合は区間の値が無いので、試合全体の側からも除く。ポゼッションは足し算にならないので比べない）
//  2. 前半 = 1Q＋2Q、後半 = 3Q＋4Q（ポゼッションを除く全項目）。数えた試合も同じ
//  3. 数えた試合: 1Q〜後半は特別な試合を除く全試合、延長は延長のあった試合（試合ログの overtimes > 0）だけ
//  4. 感度: 索引を1か所壊すと食い違いとして検出される
//
// 使い方: npm run validate:team-period-table（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT } from "../shared/gameIndex.ts";
import type { TeamGameLog, TeamSummary } from "../shared/types.ts";
import { sumTeamGameLogs, EMPTY_TOTALS, type TeamTotals } from "../src/lib/teamStatsColumns";
import { sumTeamPeriodTotals, type TeamPeriodSource, type TeamPeriodValue } from "../src/lib/teamPeriodTotals";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const KEYS = Object.keys(EMPTY_TOTALS).filter((k) => k !== "poss") as (keyof TeamTotals)[];
function add(a: TeamTotals, b: TeamTotals): TeamTotals {
  const out = { ...a };
  for (const k of Object.keys(out) as (keyof TeamTotals)[]) out[k] = a[k] + b[k];
  return out;
}
function diff(a: TeamTotals, b: TeamTotals): string | null {
  for (const k of KEYS) if (Math.abs(a[k] - b[k]) > 1e-6) return `${k}: ${a[k]} ≠ ${b[k]}`;
  return null;
}

async function runSeason(season: string, source: TeamPeriodSource, logsByTeam: Map<string, TeamGameLog[]>, shortKeys: Set<string>, quiet: boolean): Promise<number> {
  let ng = 0;
  let firstNg = "";
  let teams = 0;
  const note = (msg: string) => {
    ng += 1;
    if (!firstNg) firstNg = msg;
  };
  for (const [teamId, logs] of logsByTeam) {
    teams += 1;
    const normal = logs.filter((g) => !shortKeys.has(g.scheduleKey) && !isManualBoxscoreKey(g.scheduleKey)); // 手入力の試合（区間の値が無い。275章）は区間の合計に入らない
    const at = (v: TeamPeriodValue) => sumTeamPeriodTotals(source, logs, v);
    const q = (["q1", "q2", "q3", "q4"] as const).map(at);
    const ot = at("ot");
    const h1 = at("h1");
    const h2 = at("h2");
    const whole = sumTeamGameLogs(normal);
    const sum = [...q, ot].reduce((acc, r) => add(acc, r.totals), { ...EMPTY_TOTALS });
    const d1 = diff(sum, whole);
    if (d1) note(`${season} ${teamId} 区間の合計 ≠ 試合全体: ${d1}`);
    const d2 = diff(h1.totals, add(q[0]!.totals, q[1]!.totals));
    if (d2) note(`${season} ${teamId} 前半 ≠ 1Q+2Q: ${d2}`);
    const d3 = diff(h2.totals, add(q[2]!.totals, q[3]!.totals));
    if (d3) note(`${season} ${teamId} 後半 ≠ 3Q+4Q: ${d3}`);
    for (const r of [...q, h1, h2]) if (r.games.length !== normal.length) note(`${season} ${teamId} 1Q〜後半の試合数 ${r.games.length} ≠ ${normal.length}`);
    const otGames = logs.filter((g) => (g.overtimes ?? 0) > 0 && !shortKeys.has(g.scheduleKey)).length;
    if (ot.games.length !== otGames) note(`${season} ${teamId} 延長の試合数 ${ot.games.length} ≠ ${otGames}`);
  }
  if (!quiet) check(`${season}: 区間の合計＝試合全体・前半／後半・試合数（${teams}チーム）`, ng === 0, `${ng}件 ${firstNg}`);
  return ng;
}

async function main(): Promise<void> {
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  let last: { season: string; source: TeamPeriodSource; logsByTeam: Map<string, TeamGameLog[]>; shortKeys: Set<string> } | null = null;
  for (const season of seasons) {
    const dir = path.join(DATA_DIR, season);
    const file = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
    const index = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    if (!file || !index) continue;
    const source: TeamPeriodSource = { season, file, gameNo: new Map(index.games.key.map((k, i) => [k, i])) };
    const shortKeys = new Set(index.games.key.filter((_, i) => (index.games.flags[i]! & GAME_FLAG_SHORT) !== 0));
    const logsByTeam = new Map<string, TeamGameLog[]>();
    for (const t of teams) {
      const logs = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
      logsByTeam.set(t.teamId, logs.filter((g) => g.gameType === "regular" || g.gameType === "playoff"));
    }
    await runSeason(season, source, logsByTeam, shortKeys, false);
    last = { season, source, logsByTeam, shortKeys };
  }
  // 感度: 最後のシーズンの索引の 2Q の PITP を1か所壊す
  if (last) {
    const col = last.source.file.rows.counts["q2.pt2in"]!;
    const at = col.findIndex((v) => v > 0);
    const broken: TeamPeriodSource = {
      ...last.source,
      file: { ...last.source.file, rows: { ...last.source.file.rows, counts: { ...last.source.file.rows.counts, "q2.pt2in": col.map((v, i) => (i === at ? v + 1 : v)) } } },
    };
    const ng = await runSeason(last.season, broken, last.logsByTeam, last.shortKeys, true);
    check(`感度: ${last.season} の 2Q の PITP を1か所壊すと検出される（${ng}件）`, ng > 0);
  }
  console.log(failures === 0 ? "\nすべて ok" : `\n${failures}件の食い違い`);
  if (failures > 0) process.exit(1);
}

await main();
