// 個人の PPP（players.json の advanced.ppp）の検証（DESIGN.md 334章）。
//  1. 全シーズン・両リーグの全選手で、PPP ＝ PTS ÷ (FGA + 0.44×FTA + TOV)（分母が0なら値なし）
//  2. 個人ORtg（advanced.individualOrtg）は PPP とは別に残り、出場時間4分未満は値なし
//  3. 画面の列（ランキング・ベン図の PPP の列）が同じ値を出す
//  4. 個人詳細・Q別・md（seasonBoxColumnsWithFtrPpp）・比較・対戦相手別の Advanced に PPP が FTR と PPS の間（全選手スタッツと同じ並び）にあり、値が一致する。Advanced 以外には出ない
// 使い方: npm run validate:player-ppp（先に npm run build:data）
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PlayerSummary } from "../shared/types";
import { PPP_COLUMN, seasonBoxColumnsWithFtrPpp, seasonBoxColumnsWithPpp, withPppColumn } from "../src/lib/pppColumn";
import { SEASON_ADVANCED_COLUMNS_WITH_FTR } from "../src/lib/ftrColumn";
import { seasonBoxCompareDefs } from "../src/lib/compareShared";
import { buildSeasonBoxscoreCtx } from "../src/lib/playerSeasonBoxscore";
import { formatDecimal } from "../src/lib/format";

const DATA = path.join(process.cwd(), "data");
const labelsOf = (cols: { key: string }[]) => cols.map((c) => c.key);
// 339章: PPP は FTR と PPS の間（FTR が無い表は TS% と PPS の間）。1列だけ
const afterOrtg = (name: string, keys: string[]) => {
  const i = keys.indexOf("ppp");
  const prev = keys.includes("ftr") ? "ftr" : "ts";
  if (i < 0 || keys[i + 1] !== "pps" || keys[i - 1] !== prev || keys.filter((k) => k === "ppp").length !== 1) {
    console.error(`NG ${name}: PPP が ${prev} と pps の間にない (${keys.join(",")})`);
    process.exit(1);
  }
};
const rankingKeys = labelsOf(withPppColumn(SEASON_ADVANCED_COLUMNS_WITH_FTR));
for (const fs of [false, true]) {
  const a = labelsOf(seasonBoxColumnsWithFtrPpp("advanced", fs)); afterOrtg("個人詳細・Q別・md", a);
  if (a.join() !== rankingKeys.join()) { console.error("NG 個人詳細の Advanced の並びが全選手スタッツと違う"); process.exit(1); }
  afterOrtg("対戦相手別", labelsOf(seasonBoxColumnsWithPpp("advanced", fs)));
  afterOrtg("比較", seasonBoxCompareDefs("advanced", fs).map((d) => d.key));
  for (const tab of ["traditional", "misc", "scoring"] as const) {
    if (seasonBoxColumnsWithFtrPpp(tab, fs).some((c) => c.key === "ppp") || seasonBoxColumnsWithPpp(tab, fs).some((c) => c.key === "ppp") || seasonBoxCompareDefs(tab, fs).some((d) => d.key === "ppp")) { console.error(`NG ${tab} に PPP が出ている`); process.exit(1); }
  }
}
const detailPpp = seasonBoxColumnsWithFtrPpp("advanced", false).find((c) => c.key === "ppp")!;
const opponentPpp = seasonBoxColumnsWithPpp("advanced", false).find((c) => c.key === "ppp")!;
const comparePpp = seasonBoxCompareDefs("advanced", false).find((d) => d.key === "ppp")!;
let failures = 0, checked = 0, noDenominator = 0, ortgKept = 0;
const fail = (m: string) => { failures += 1; if (failures <= 20) console.error(`NG ${m}`); };

const files: string[] = [];
for (const s of readdirSync(DATA)) for (const f of [path.join(DATA, s, "players.json.gz"), path.join(DATA, s, "one", "players.json.gz")]) if (/^\d{4}-\d{2}$/.test(s) && existsSync(f)) files.push(f);
for (const file of files) {
  const j = JSON.parse(gunzipSync(readFileSync(file)).toString()) as PlayerSummary[] | { players: PlayerSummary[] };
  const players = Array.isArray(j) ? j : j.players;
  const season = path.basename(path.dirname(file)) === "one" ? path.basename(path.dirname(path.dirname(file))) : path.basename(path.dirname(file));
  for (const p of players) {
    const t = p.totals, d = t.fga + 0.44 * t.fta + t.tov;
    checked += 1;
    if (d > 0) {
      if (p.advanced.ppp === undefined || Math.abs(p.advanced.ppp - t.pts / d) > 1e-9) fail(`${file} ${p.name} PPP ${p.advanced.ppp} / ${t.pts / d}`);
    } else {
      noDenominator += 1;
      if (p.advanced.ppp !== undefined) fail(`${file} ${p.name} 分母0なのに PPP ${p.advanced.ppp}`);
    }
    if (t.min < 4 && p.advanced.individualOrtg !== undefined) fail(`${file} ${p.name} 4分未満なのに個人ORtg`);
    if (t.min >= 4 && p.advanced.individualOrtg !== undefined) ortgKept += 1;
    // 画面の列
    if (p.gamesPlayed > 0) {
      const ctx = buildSeasonBoxscoreCtx({ ...(p.totals as never), gamesPlayed: p.gamesPlayed } as never, {} as never, "perGame", Number(season.slice(0, 4)));
      const shown = PPP_COLUMN.format(ctx, "perGame"), want = d > 0 ? formatDecimal(t.pts / d, 2) : "-";
      if (shown !== want) fail(`${file} ${p.name} 画面の列 ${shown} / ${want}`);
      for (const [n, v] of [["個人詳細・md", detailPpp.format(ctx, "perGame")], ["対戦相手別", opponentPpp.format(ctx, "perGame")], ["比較", comparePpp.format({ ctx } as never)]] as const) if (v !== want) fail(`${file} ${p.name} ${n} ${v} / ${want}`);
    }
  }
}
if (ortgKept === 0) fail("個人ORtg が1人も残っていない");
console.log(`PPP: ${files.length}ファイル・${checked}人を確認（分母0で値なし ${noDenominator}人、個人ORtg を持つ ${ortgKept}人）`);
if (failures) { console.error(`NG ${failures}件`); process.exit(1); }
console.log("個人PPP: PASS");
