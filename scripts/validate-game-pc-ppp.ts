// 試合詳細のボックススコアと個人詳細の試合ログに足した PC・PPP の検証（DESIGN.md 339章）。使い方: npm run validate:game-pc-ppp（先に npm run build:data）
//  1. 列の並び: Advanced の PPP は FTR と PPS の間（試合ログは FTR が無いので TS% と PPS の間）、Scoring の PC は %PTS ASTED の右。Advanced・Scoring 以外には出ない
//  2. 値: 試合の生データから出した行（buildPlayerGameBoxscoreRow。試合詳細と同じ部品）の PC・PPP が、集計済みの選手の試合ログ（player-games）の
//     pts・assistPoints・fga・fta・tov から、共通の式（PC＝PTS＋アシストから生まれた得点、PPP＝PTS÷(FGA＋0.44×FTA＋TOV)）で手計算した値と一致する
//  3. 試合の流れ（プレーバイプレーの記録）が無い試合の PC は「-」、分母が0の PPP は「-」（B.PREMIER・B.ONE の両方）
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { PlayerGameLog, StoredGame } from "../shared/types";
import { gameDetailColumnsFor, gameLogBoxColumnsFor } from "../src/components/BoxscoreTable";
import { buildPlayerGameBoxscoreRow } from "../src/lib/playerGameBoxscore";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(p.endsWith(".gz") ? gunzipSync(readFileSync(p)).toString("utf8") : readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
let failures = 0;
const fail = (m: string) => { failures += 1; if (failures <= 30) console.error(`NG ${m}`); };

// 1. 並び
for (const fs of [false, true]) {
  for (const [name, fn] of [["試合詳細", gameDetailColumnsFor], ["試合ログ", gameLogBoxColumnsFor]] as const) {
    const adv = fn("advanced", fs).map((c) => c.key);
    const i = adv.indexOf("ppp");
    const prev = name === "試合詳細" ? "ftr" : "ts";
    if (i < 0 || adv.filter((k) => k === "ppp").length !== 1 || adv[i + 1] !== "pps" || adv[i - 1] !== prev) fail(`${name} Advanced の PPP の位置 (${adv.join(",")})`);
    const sc = fn("scoring", fs).map((c) => c.key);
    const j = sc.indexOf("pc");
    if (j < 0 || sc.filter((k) => k === "pc").length !== 1 || sc[j - 1] !== "pctptsasted") fail(`${name} Scoring の PC の位置 (${sc.join(",")})`);
    for (const tab of ["traditional", "misc"] as const) if (fn(tab, fs).some((c) => c.key === "pc" || c.key === "ppp")) fail(`${name} ${tab} に PC・PPP が出ている`);
    if (sc.includes("ppp") || adv.includes("pc")) fail(`${name} 違うタブに出ている`);
  }
}

// 2・3. 値
const pppOf = (g: PlayerGameLog) => { const d = g.fga + 0.44 * g.fta + g.tov; return d > 0 ? (g.pts / d).toFixed(2) : "-"; };
const examples: string[] = [];
let checked = 0, noPbp = 0, noDenominator = 0;
for (const [label, base, seasons] of [["B.PREMIER", "", ["2025-26", "2026-27", "2017-18"]], ["B.ONE", "/one", ["2025-26", "2026-27"]]] as const) {
  for (const season of seasons) {
    const dir = `${DATA}/${season}${base}`;
    if (!existsSync(`${dir}/player-games`)) continue;
    const files = readdirSync(`${dir}/player-games`).sort();
    const picks = season === "2017-18" ? files : files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 12)) === 0).slice(0, 12);
    const advCols = gameLogBoxColumnsFor("advanced", false), scCols = gameLogBoxColumnsFor("scoring", false);
    const detailAdv = gameDetailColumnsFor("advanced", false), detailSc = gameDetailColumnsFor("scoring", false);
    const gameCache = new Map<string, StoredGame | null>();
    for (const f of picks) {
      const playerId = f.replace(/\.json(\.gz)?$/, "");
      const logs: PlayerGameLog[] = rj(`${dir}/player-games/${f}`) ?? [];
      const subset = season === "2017-18" ? logs.filter((g) => g.scheduleKey === "1810") : logs.slice(0, 8);
      for (const log of subset) {
        if (!gameCache.has(log.scheduleKey)) gameCache.set(log.scheduleKey, rj(`${dir}/games/${log.scheduleKey}.json`));
        const game = gameCache.get(log.scheduleKey);
        if (!game) continue;
        const row = buildPlayerGameBoxscoreRow(game, log, playerId, null, true);
        if (!row) continue;
        // 出場なし（DNP）の行は表に値を出さない
        if (!(log.min > 0)) continue;
        const hasPbp = game.raw.PlayByPlays.length > 0;
        const wantPc = !hasPbp || log.assistPoints === undefined ? "-" : String(log.pts + log.assistPoints);
        const wantPpp = pppOf(log);
        const gotPc = scCols.find((c) => c.key === "pc")!.format(row.counts, row.ctx);
        const gotPpp = advCols.find((c) => c.key === "ppp")!.format(row.counts, row.ctx);
        if (gotPc !== wantPc) fail(`${label} ${season} ${log.scheduleKey} ${playerId}: PC ${gotPc} / ${wantPc}`);
        if (gotPpp !== wantPpp) fail(`${label} ${season} ${log.scheduleKey} ${playerId}: PPP ${gotPpp} / ${wantPpp}`);
        // 試合詳細の列も同じ式（選手の行）
        if (detailSc.find((c) => c.key === "pc")!.format(row.counts, row.ctx) !== wantPc) fail(`${label} ${season} ${log.scheduleKey}: 試合詳細の PC`);
        if (detailAdv.find((c) => c.key === "ppp")!.format(row.counts, row.ctx) !== wantPpp) fail(`${label} ${season} ${log.scheduleKey}: 試合詳細の PPP`);
        // チームの行・内訳集計の行は PC が「-」
        if (detailSc.find((c) => c.key === "pc")!.format(row.counts, { ...row.ctx, isPlayerRow: false, isTeamTotalRow: true }) !== "-") fail("チームの行の PC が「-」でない");
        checked++;
        if (!hasPbp) { noPbp++; if (gotPc !== "-") fail(`${label} ${season} ${log.scheduleKey}: 流れの記録が無いのに PC が出る`); }
        if (wantPpp === "-") noDenominator++;
        if (examples.length < 3 && hasPbp && wantPc !== "-" && wantPpp !== "-") examples.push(`${label} ${season} 試合${log.scheduleKey} 選手${playerId}: PTS ${log.pts}＋アシストから ${log.assistPoints} → PC ${gotPc}／PTS ${log.pts}÷(FGA ${log.fga}＋0.44×FTA ${log.fta}＋TOV ${log.tov}) → PPP ${gotPpp}`);
      }
    }
  }
}
console.log(`PC・PPP（試合）: ${checked}行を確認（流れの記録が無い試合 ${noPbp}行、分母0のPPP ${noDenominator}行）`);
for (const e of examples) console.log(`  例 ${e}`);
if (failures > 0) { console.error(`${failures} 件の食い違い`); process.exit(1); }
console.log("PC・PPP（試合）: PASS");
