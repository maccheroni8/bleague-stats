// 条件別順位表の「対同地区」「対他地区」の検証（DESIGN.md 362章）。使い方: npm run validate:conditional-division（先に npm run build:data）
//  1. 地区の構成はシーズンごとの決まり（division-history）に従う: 各クラブ・各試合について、自クラブと相手の地区を履歴から引き直した数と、
//     表の条件（applyConditionalCondition）で絞った試合の数が一致する（B.PREMIER の3地区制・2地区制、B.ONE の5地区）
//  2. 同地区＋他地区＝地区が分かる試合のすべて。各地区（対東地区など）の合計＝地区が分かる試合のすべて
//  3. 勝敗: 同地区の勝ち数＋他地区の勝ち数＝地区が分かる試合の勝ち数
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { DivisionHistoryFile, TeamGameLog } from "../shared/types";
import { applyConditionalCondition } from "../src/components/ConditionalStandingsTable";
import { divisionOrder } from "../src/lib/divisionGroups";
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
const examples: string[] = [];

for (const [league, base] of [["premier", ""], ["one", "/one"]] as [League, string][]) {
  for (const season of Object.keys(history[league] ?? {})) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/team-games`)) continue;
    const divs = history[league]![season]!;
    const present = divisionOrder(league).filter((d) => Object.values(divs).includes(d));
    let sameTotal = 0, otherTotal = 0, known = 0;
    for (const f of readdirSync(`${dir}/team-games`)) {
      const teamId = f.replace(/\.json(\.gz)?$/, "");
      const logs = ((rj(`${dir}/team-games/${f}`) ?? []) as TeamGameLog[]).filter((g) => g.gameType === "regular");
      const own = divs[teamId];
      const ctx = { teamId, season, league, divisionHistory: history };
      const same = applyConditionalCondition(logs, { kind: "division", value: "same" }, ctx);
      const other = applyConditionalCondition(logs, { kind: "division", value: "other" }, ctx);
      const wantSame = logs.filter((g) => own && divs[g.opponentTeamId] && divs[g.opponentTeamId] === own);
      const wantOther = logs.filter((g) => own && divs[g.opponentTeamId] && divs[g.opponentTeamId] !== own);
      check(`${league} ${season} ${teamId}: 対同地区の試合数`, same.length === wantSame.length, `${same.length} ≠ ${wantSame.length}`);
      check(`${league} ${season} ${teamId}: 対他地区の試合数`, other.length === wantOther.length, `${other.length} ≠ ${wantOther.length}`);
      const perDivision = present.reduce((n, d) => n + applyConditionalCondition(logs, { kind: "division", value: d }, ctx).length, 0);
      const knownGames = logs.filter((g) => divs[g.opponentTeamId]).length;
      check(`${league} ${season} ${teamId}: 各地区の合計＝地区が分かる試合`, perDivision === knownGames, `${perDivision} ≠ ${knownGames}`);
      if (own) check(`${league} ${season} ${teamId}: 同地区＋他地区＝地区が分かる試合`, same.length + other.length === knownGames, `${same.length}+${other.length} ≠ ${knownGames}`);
      check(`${league} ${season} ${teamId}: 勝ち数の合計`, same.filter((g) => g.win).length + other.filter((g) => g.win).length === logs.filter((g) => own && divs[g.opponentTeamId] && g.win).length);
      sameTotal += same.length;
      otherTotal += other.length;
      known += knownGames;
    }
    examples.push(`${league} ${season}（${present.length}地区）: 同地区 ${sameTotal}・他地区 ${otherTotal}（延べ ${known}）`);
  }
}
console.log(`\nok ${ok} 件`);
for (const e of examples) console.log(`  ${e}`);
if (failures > 0) {
  console.error(`\n${failures} 件の食い違い`);
  process.exitCode = 1;
} else console.log("\nすべて一致しました");
