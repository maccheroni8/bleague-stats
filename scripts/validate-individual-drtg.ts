// 全選手スタッツの個人DRtg（Dean Oliver方式。players.json の advanced.individualDrtg）の検証。
//
// 確かめること:
//  1. 2025-26 仙台の3人（カルバー・渡辺・トゥーレ）が、手で追った検算の値と一致する（NetRtg は丸める前の ORtg − DRtg）
//  2. 全シーズン・両リーグで、合計出場4分未満の選手は DRtg が無く（画面は「-」）、4分以上の選手は有限の値を持つ
//  3. 移籍した選手は、ORtg と同じ「所属期間ごとの各チームの合計」（transferredTeamTotals）で計算されている
//
// 使い方: npm run validate:individual-drtg（先に npm run build:data）。1つでも食い違いがあれば終了コード1

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { individualDefRtg, type OliverBoxStats } from "../shared/formulas.ts";
import { opponentOliverBox, teamOliverBox } from "../shared/teamSeasonTotals.ts";
import type { PlayerSummary, StatTotals } from "../shared/types.ts";
import { formatDecimal, formatSigned } from "../src/lib/format.ts";

const DATA = path.join(import.meta.dirname, "..", "data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok ${label}`);
  else {
    failures += 1;
    console.error(`NG ${label} ${detail}`);
  }
}

function readPlayers(file: string): PlayerSummary[] {
  const j = JSON.parse(gunzipSync(readFileSync(file)).toString()) as PlayerSummary[] | { players: PlayerSummary[] };
  return Array.isArray(j) ? j : j.players;
}

function toBox(t: StatTotals): OliverBoxStats {
  return { min: t.min, fgm: t.fgm, fga: t.fga, fg3m: t.tpm, ftm: t.ftm, fta: t.fta, pts: t.pts, ast: t.ast, oreb: t.oreb, dreb: t.dreb, tov: t.tov, stl: t.stl, blk: t.blk, pf: t.pf };
}

// 1. 仙台の3人（2025-26 レギュラーシーズン）
{
  const players = readPlayers(path.join(DATA, "2025-26", "players.json.gz"));
  const want: { id: string; name: string; drtg: number; drtgText: string; netText: string }[] = [
    { id: "51000531", name: "ジャレット・カルバー", drtg: 106.2096921376, drtgText: "106.21", netText: "+10.46" },
    { id: "30526", name: "渡辺 翔太", drtg: 113.9799477651, drtgText: "113.98", netText: "+8.10" },
    { id: "51000532", name: "ブーバカー・トゥーレ", drtg: 104.1037689378, drtgText: "104.10", netText: "+6.92" },
  ];
  for (const w of want) {
    const p = players.find((x) => x.playerId === w.id);
    const drtg = p?.advanced.individualDrtg;
    const ortg = p?.advanced.ppp !== undefined ? p.advanced.ppp * 100 : undefined;
    check(`${w.name} DRtg ${w.drtgText}`, drtg !== undefined && Math.abs(drtg - w.drtg) < 1e-8 && formatDecimal(drtg) === w.drtgText, String(drtg));
    const net = ortg !== undefined && drtg !== undefined ? formatSigned(ortg - drtg) : "-";
    check(`${w.name} NetRtg ${w.netText}（丸める前の ORtg − DRtg）`, net === w.netText, net);
  }
}

// 2・3. 全シーズン・両リーグ
let seasons = 0;
let rows = 0;
let transferredChecked = 0;
for (const season of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  for (const file of [path.join(DATA, season, "players.json.gz"), path.join(DATA, season, "one", "players.json.gz")]) {
    if (!existsSync(file)) continue;
    seasons += 1;
    const short: string[] = [];
    const missing: string[] = [];
    const transferredMismatch: string[] = [];
    for (const p of readPlayers(file)) {
      if (p.gamesPlayed === 0) continue;
      rows += 1;
      const drtg = p.advanced.individualDrtg;
      if (p.totals.min < 4) {
        if (drtg !== undefined) short.push(p.name);
      } else if (drtg === undefined || !Number.isFinite(drtg)) missing.push(p.name);
      const tt = p.transferredTeamTotals;
      if (tt && p.totals.min >= 4) {
        transferredChecked += 1;
        const expect = individualDefRtg(toBox(p.totals), teamOliverBox(tt), opponentOliverBox(tt), tt.poss);
        if (expect === undefined || drtg === undefined || Math.abs(expect - drtg) > 1e-9) transferredMismatch.push(`${p.name} ${drtg} / ${expect}`);
      }
    }
    const label = path.relative(DATA, file);
    check(`${label}: 4分未満は DRtg なし`, short.length === 0, short.join("、"));
    check(`${label}: 4分以上は DRtg あり`, missing.length === 0, missing.join("、"));
    check(`${label}: 移籍した選手は所属期間ごとの各チームの合計で計算`, transferredMismatch.length === 0, transferredMismatch.join("、"));
  }
}
console.log(`${seasons} ファイル・${rows} 人（うち移籍 ${transferredChecked} 人）を確認`);
check("移籍した選手の確認が1人以上ある", transferredChecked > 0);

if (failures > 0) {
  console.error(`NG: ${failures} 件の食い違い`);
  process.exit(1);
}
console.log("OK: 個人DRtg");
