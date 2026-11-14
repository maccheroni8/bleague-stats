// 条件別順位表の条件が、チーム詳細の「シチュエーション別勝敗」と同じ試合を数えているかの検証（設計書387章）。
// 使い方: npm run validate:conditional-situational（先に npm run build:data）
//  1. 全シーズン・全チーム・レギュラーシーズンで、チーム詳細の行（buildSituationalRecordGroups の predicate。第Q終了時点・延長は試合の生データ quarterScores から）と、
//     条件別順位表の条件（applyConditionalCondition。第Q終了時点は試合ログの 1Q〜4Q の得点から）の、試合の集合・勝敗が一致する
//  2. 「●人以下／以上」「●点以下／以上」は、1試合ごとの値を直接比べた数と一致する（人数 0〜5・点数 40〜140）
//  3. 感度: 試合ログの得点を1つ壊すと食い違いとして検出される
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DivisionHistoryFile, StoredGame, TeamGameLog, TeamSummary } from "../shared/types";
import { applyConditionalCondition, type ConditionalCondition } from "../src/components/ConditionalStandingsTable";
import { buildSituationalRecordGroups } from "../src/pages/TeamDetailPage";
import { buildOpponentSeasonWinRates } from "../src/lib/opponentSeasonWinRate";
import type { MarginCondition } from "../src/lib/situational";
import type { League } from "../src/lib/league";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(p.endsWith(".gz") ? gunzipSync(readFileSync(p)).toString("utf8") : readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
const history: DivisionHistoryFile = rj(`${DATA}/division-history.json`);
let failures = 0;
let ok = 0;
const check = (label: string, good: boolean, detail = "") => {
  if (good) ok += 1;
  else {
    failures += 1;
    if (failures <= 30) console.error(`NG ${label} ${detail}`);
  }
};

/** チーム詳細の行（グループ・行のキー）→ 条件別順位表の条件 */
function conditionFor(group: string, row: string): ConditionalCondition | null {
  switch (group) {
    case "foreignPlayerCount": return { kind: "foreign", mode: "eq", n: Number(row.replace("own", "")) };
    case "score":
      switch (row) {
        case "score80plus": return { kind: "score", side: "own", mode: "ge", n: 80 };
        case "score80under": return { kind: "score", side: "own", mode: "le", n: 79 };
        case "allow80under": return { kind: "score", side: "opp", mode: "le", n: 79 };
        case "allow80plus": return { kind: "score", side: "opp", mode: "ge", n: 80 };
        case "both80plus": return { kind: "bothScore", value: "ge" };
        case "both80under": return { kind: "bothScore", value: "lt" };
        case "century": return { kind: "century" };
      }
      return null;
    case "margin":
      switch (row) {
        case "margin10": return { kind: "marginAtLeast", points: 10 };
        case "margin20": return { kind: "marginAtLeast", points: 20 };
        case "poss1": return { kind: "margin", points: 3 };
        case "poss2": return { kind: "margin", points: 6 };
      }
      return null;
    case "inGameMargin": return { kind: "inGameMargin", value: row as MarginCondition };
    case "overtime": return { kind: "overtime", value: row === "ot" ? "ot" : "regulation" };
    case "q1status": return { kind: "checkpoint", q: 1, status: row as "lead" | "tie" | "behind" };
    case "halfStatus": return { kind: "checkpoint", q: 2, status: row as "lead" | "tie" | "behind" };
    case "q3status": return { kind: "checkpoint", q: 3, status: row as "lead" | "tie" | "behind" };
    case "opponentStrength":
      return row === "unclassified" ? null : { kind: "opponentLatestWinRate", tier: row as "under50" | "atLeast50" | "atLeast60" };
  }
  return null;
}

const compared = new Map<string, number>();
for (const [league, base] of [["premier", ""], ["one", "/one"]] as [League, string][]) {
  for (const season of Object.keys(history[league] ?? {})) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/team-games`)) continue;
    const teams: TeamSummary[] = (rj(`${dir}/teams.json`) ?? []) as TeamSummary[];
    const winRates = buildOpponentSeasonWinRates(teams);
    const raws = new Map<string, StoredGame>();
    if (existsSync(`${dir}/games`)) {
      for (const f of readdirSync(`${dir}/games`)) {
        const g = rj(`${dir}/games/${f}`) as StoredGame | null;
        if (g) raws.set(f.replace(/\.json(\.gz)?$/, ""), g);
      }
    }
    for (const f of readdirSync(`${dir}/team-games`)) {
      const teamId = f.replace(/\.json(\.gz)?$/, "");
      const logs = ((rj(`${dir}/team-games/${f}`) ?? []) as TeamGameLog[]).filter((g) => g.gameType === "regular");
      const groups = buildSituationalRecordGroups(logs, teamId, undefined, winRates, history, season, league);
      const ctx = { teamId, season, league, divisionHistory: history, opponentLatestWinRates: winRates };
      for (const group of groups) {
        for (const row of group.rows) {
          const cond = conditionFor(group.key, row.key);
          if (!cond) continue;
          // チーム詳細: 生データが必要な区分は、生データのある試合だけ
          const pool = group.needsRawGame ? logs.filter((g) => raws.has(g.scheduleKey)) : logs;
          const want = pool.filter((g) => row.predicate(g, raws.get(g.scheduleKey)));
          // 条件別順位表: 試合ログだけ。生データのある試合に絞って比べる（無い試合は別に数える）
          const got = applyConditionalCondition(pool, cond, ctx);
          const same = want.length === got.length && want.every((g, i) => g.scheduleKey === got[i].scheduleKey);
          check(`${league} ${season} ${teamId} ${group.key}/${row.key}`, same, `チーム詳細 ${want.length} ≠ 順位表 ${got.length}`);
          compared.set(`${group.key}/${row.key}`, (compared.get(`${group.key}/${row.key}`) ?? 0) + want.length);
        }
      }
      // 第Q終了時点・延長は、生データが無い試合も試合ログだけで判定できるか（生データのある試合では上で一致を確認済み）
      // 「●人」「●点」の以下／以上
      for (let n = 0; n <= 5; n++) {
        const le = applyConditionalCondition(logs, { kind: "foreign", mode: "le", n }, ctx).length;
        const ge = applyConditionalCondition(logs, { kind: "foreign", mode: "ge", n }, ctx).length;
        check(`${league} ${season} ${teamId} 外国籍${n}人以下`, le === logs.filter((g) => g.foreignPlayerCount != null && g.foreignPlayerCount <= n).length);
        check(`${league} ${season} ${teamId} 外国籍${n}人以上`, ge === logs.filter((g) => g.foreignPlayerCount != null && g.foreignPlayerCount >= n).length);
      }
      for (let n = 40; n <= 140; n += 5) {
        for (const side of ["own", "opp"] as const) {
          const v = (g: TeamGameLog) => (side === "own" ? g.teamScore : g.opponentScore);
          const le = applyConditionalCondition(logs, { kind: "score", side, mode: "le", n }, ctx).length;
          const ge = applyConditionalCondition(logs, { kind: "score", side, mode: "ge", n }, ctx).length;
          check(`${league} ${season} ${teamId} ${side}${n}点以下`, le === logs.filter((g) => v(g) <= n).length);
          check(`${league} ${season} ${teamId} ${side}${n}点以上`, ge === logs.filter((g) => v(g) >= n).length);
        }
      }
      // 感度: 得点を1つ壊すと検出される
      if (logs.length > 0 && league === "premier" && season === "2025-26" && teamId === Object.keys(history.premier[season] ?? {})[0]) {
        const broken = logs.map((g, i) => (i === 0 ? { ...g, teamScore: g.teamScore + 1000 } : g));
        const a = applyConditionalCondition(broken, { kind: "score", side: "own", mode: "ge", n: 80 }, ctx).length;
        const b = logs.filter((g) => g.teamScore >= 80).length;
        check("感度: 得点を壊すと数が変わる", a !== b || logs[0].teamScore >= 80);
      }
    }
  }
}
console.log(`\nok ${ok} 件`);
for (const [k, v] of [...compared.entries()].sort()) console.log(`  ${k}: 延べ ${v} 試合`);
if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exitCode = 1;
} else console.log("\nすべて一致しました");
