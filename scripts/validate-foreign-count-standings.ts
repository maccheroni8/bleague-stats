// 順位表「外国籍人数別」タブの集計が、条件別順位表の「外国籍の人数」の条件と同じ勝敗になっているかの検証（設計書434章）。
// 使い方: npm run validate:foreign-count-standings（先に npm run build:data）
//  1. 全シーズン・両リーグ・全チームで、7つのまとまりの試合数・勝敗が、条件別順位表の数え方（applyConditionalCondition の結果の勝ち数・試合数−勝ち数）と一致する
//  2. まとまり同士の整合: 外国籍 0〜3人の合計＝外国籍の人数がある試合の数／「2人以下」＝0人＋1人＋2人／外・帰・ア「3人以下」＋4人以上＝人数がある試合の数
//  3. 感度: 試合ログの人数を1つ壊すと食い違いとして検出される
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DivisionHistoryFile, TeamGameLog } from "../shared/types";
import { applyConditionalCondition, type ConditionalCondition } from "../src/lib/conditionalCondition";
import { FOREIGN_COUNT_GROUPS, foreignGroupRecord, type ForeignCountRecord } from "../src/lib/foreignCountStandings";
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

const ctx = {} as Parameters<typeof applyConditionalCondition>[2];
let teamsChecked = 0;
let sample = null as TeamGameLog[] | null;
for (const [league, base] of [["premier", ""], ["one", "/one"]] as [League, string][]) {
  for (const season of Object.keys(history[league] ?? {})) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/team-games`)) continue;
    for (const f of readdirSync(`${dir}/team-games`)) {
      const logs = ((rj(`${dir}/team-games/${f}`) ?? []) as TeamGameLog[]).filter((g) => g.gameType === "regular");
      const tag = `${league} ${season} ${f}`;
      teamsChecked += 1;
      if (!sample && logs.some((g) => g.foreignPlayedCount != null && g.win)) sample = logs;
      const rec = new Map<string, ForeignCountRecord>(FOREIGN_COUNT_GROUPS.map((g) => [g.key, foreignGroupRecord(logs, g)] as [string, ForeignCountRecord]));
      for (const g of FOREIGN_COUNT_GROUPS) {
        const cond: ConditionalCondition = { kind: "foreign", mode: g.mode, n: g.n, measure: g.measure };
        const filtered = applyConditionalCondition(logs, cond, ctx);
        const wins = filtered.filter((x) => x.win).length;
        const r = rec.get(g.key)!;
        check(`${tag} ${g.key}`, r.games === filtered.length && r.wins === wins && r.losses === filtered.length - wins, `${JSON.stringify(r)} vs ${filtered.length}/${wins}`);
      }
      const withF = logs.filter((x) => x.foreignPlayedCount != null).length;
      const withI = logs.filter((x) => x.intlPlayedCount != null).length;
      const sumF = ["f0", "f1", "f2", "f3"].reduce((s, k) => s + rec.get(k)!.games, 0);
      const over3 = logs.filter((x) => (x.foreignPlayedCount ?? 0) > 3).length;
      check(`${tag} 外国籍の合計`, sumF + over3 === withF, `${sumF}+${over3} vs ${withF}`);
      check(`${tag} 2人以下`, rec.get("fle2")!.games === rec.get("f0")!.games + rec.get("f1")!.games + rec.get("f2")!.games);
      const i4plus = logs.filter((x) => (x.intlPlayedCount ?? -1) >= 4).length;
      check(`${tag} 外・帰・ア`, rec.get("ile3")!.games + i4plus === withI, `${rec.get("ile3")!.games}+${i4plus} vs ${withI}`);
    }
  }
}

// 感度: 人数を壊す
if (sample) {
  const broken = sample.map((g) => ({ ...g }));
  const i = broken.findIndex((g) => g.foreignPlayedCount != null && g.win);
  broken[i]!.foreignPlayedCount = (broken[i]!.foreignPlayedCount ?? 0) === 3 ? 0 : 3;
  const g3 = FOREIGN_COUNT_GROUPS.find((g) => g.key === "f3")!;
  const before = foreignGroupRecord(sample, g3);
  const after = foreignGroupRecord(broken, g3);
  check("感度", before.games !== after.games || before.wins !== after.wins);
} else check("感度（材料なし）", false);

console.log(`外国籍人数別成績: ${teamsChecked}チームのシーズン・${ok}件OK・NG${failures}件`);
if (failures > 0) process.exit(1);
