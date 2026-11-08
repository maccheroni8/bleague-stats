// 「on4 が可能だった試合」（src/lib/on4Core.ts）と、個人の On-Court Foreign の足し合わせ（src/lib/playerForeignCourt.ts）の検証（DESIGN.md 352章。手で実行）。
//  1. 2026-27 の B.PREMIER の全試合で、ベンチ入りの選手（試合全体の行）を別の書き方で数え直した人数と on4Core の判定が一致する
//  2. on4 が不可能と判定した試合では、そのチームの On-Court Foreign の4人の時間（試合ログ）が 0（可能と判定した試合の数・不可能な試合の数も出す）
//  3. 個人: 全選手・全試合で、sumPlayerForeign（1試合ずつ）の合計と、player-foreign.json を直接足した値が一致する。
//     人数ごとの時間の合計が出場時間（試合ログの min）とどれだけ違うか（除外した5人組の分）を出す
//  使い方: npm run validate:on4-games（先に npm run build:data）。1つでも食い違いがあれば終了コード1
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { benchForeignCounts, on4Feasible } from "../src/lib/on4Core.ts";
import { sumPlayerForeign } from "../src/lib/playerForeignCourt.ts";
import { makeClassifier } from "../shared/registration.ts";

const DATA = path.resolve("data");
const rj = (p: string) => (p.endsWith(".gz") ? JSON.parse(gunzipSync(readFileSync(p)).toString("utf8")) : existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8")));
let ng = 0;
const fail = (m: string) => {
  ng++;
  if (ng <= 30) console.log(`NG: ${m}`);
};

const season = "2026-27";
const master = rj(`${DATA}/players-master.json`);
const masterById = new Map<string, any>(master.map((m: any) => [m.playerId, m]));
const regs = rj(`${DATA}/${season}/registrations.json`);
const classify = makeClassifier(season, regs, masterById);

// 1. ベンチ入りの数え直し（確認用に、登録区分の記録と選手マスタを直接引く）
const dir = `${DATA}/${season}/games`;
const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
let games = 0;
let feasibleN = 0;
let infeasibleN = 0;
let unknownRows = 0;
const feasibleByKey = new Map<string, boolean>();
const samples: string[] = [];
for (const f of files) {
  const g = rj(path.join(dir, f));
  games++;
  const counts = benchForeignCounts(g, classify);
  for (const [side, rows] of [["home", g.raw.HomeBoxscores], ["away", g.raw.AwayBoxscores]] as const) {
    const teamId = side === "home" ? g.homeTeam.id : g.awayTeam.id;
    // 数え直し: 試合全体（PeriodCategory 18）の選手行、Category 1、選手IDあり
    const seen = new Set<string>();
    let foreign = 0;
    let natAsia = 0;
    for (const r of rows) {
      if (r.PeriodCategory !== 18 || r.Category !== 1 || !r.PlayerID || seen.has(String(r.PlayerID))) continue;
      seen.add(String(r.PlayerID));
      const entry = regs.players?.[String(r.PlayerID)];
      let cls: string | undefined;
      if (entry) {
        cls = entry.classification;
        for (const c of entry.changes ?? []) if (c.date <= g.date) cls = c.classification ?? cls;
      } else cls = masterById.get(String(r.PlayerID))?.classification;
      if (cls === undefined) unknownRows++;
      if (cls === "外国籍") foreign++;
      if (cls === "帰化選手" || cls === "アジア特別枠") natAsia++;
    }
    const mine = counts.get(teamId);
    if (!mine) {
      fail(`${g.scheduleKey} ${teamId}: 数えられていない`);
      continue;
    }
    if (mine.foreign !== foreign || mine.natAsia !== natAsia) fail(`${g.scheduleKey} ${teamId}: 判定 ${mine.foreign}/${mine.natAsia} と数え直し ${foreign}/${natAsia}`);
    const ok = on4Feasible(mine);
    if (ok === (foreign >= 3 && natAsia >= 1)) {
      /* 一致 */
    } else fail(`${g.scheduleKey} ${teamId}: on4 の判定が食い違う`);
    feasibleByKey.set(`${teamId}|${g.scheduleKey}`, ok);
    if (ok) feasibleN++;
    else infeasibleN++;
    if (samples.length < 6 && games % 17 === 0) samples.push(`${g.date} ${g.scheduleKey} ${side === "home" ? g.homeTeam.name : g.awayTeam.name}: ベンチ入り${seen.size}人 外国籍${foreign} 帰化・アジア${natAsia} → ${ok ? "可能" : "不可能"}`);
  }
}
console.log(`1. ${season} ${games}試合・${games * 2}チーム分: 可能 ${feasibleN}・不可能 ${infeasibleN}・区分不明の行 ${unknownRows}`);
for (const s of samples) console.log(`   例: ${s}`);

// 2. 不可能な試合では OC4 の時間が 0
let oc4Violations = 0;
let oc4InFeasible = 0;
for (const f of readdirSync(`${DATA}/${season}/team-games`).filter((x) => x.endsWith(".json.gz"))) {
  const teamId = f.replace(".json.gz", "");
  for (const g of rj(path.join(`${DATA}/${season}/team-games`, f))) {
    const ok = feasibleByKey.get(`${teamId}|${g.scheduleKey}`);
    if (ok === undefined) continue;
    const oc4 = g.foreignCourtSeconds?.[4] ?? 0;
    if (!ok && oc4 > 0) {
      oc4Violations++;
      if (oc4Violations <= 5) console.log(`   不可能なのに OC4 が ${oc4}秒: ${teamId} ${g.scheduleKey}`);
    }
    if (ok && oc4 > 0) oc4InFeasible++;
  }
}
console.log(`2. 不可能と判定した試合で OC4 の時間がある: ${oc4Violations}件（可能な試合で OC4 がある: ${oc4InFeasible}試合）`);
if (oc4Violations > 0) ng += oc4Violations;

// 3. 個人
const pf = rj(`${DATA}/${season}/player-foreign.json`);
const pgDir = `${DATA}/${season}/player-games`;
let checkedPlayers = 0;
let diffGames = 0;
let totalGames = 0;
let maxDiffSec = 0;
for (const f of readdirSync(pgDir).filter((x) => x.endsWith(".json.gz"))) {
  const pid = f.replace(".json.gz", "");
  if (!pf.players[pid]) continue;
  const logs = rj(path.join(pgDir, f));
  const gs = logs.map((l: any) => ({ scheduleKey: l.scheduleKey, teamId: undefined, gameType: l.gameType }));
  for (const side of ["own", "opp"] as const) {
    const t = sumPlayerForeign(pf, pid, gs, side, () => true);
    // 直接足す
    const direct = [0, 0, 0, 0, 0];
    const directPts = [0, 0, 0, 0, 0];
    const pi = pf.eventKeys.indexOf("pts");
    for (const l of logs) {
      const e = pf.players[pid][l.scheduleKey]?.[side];
      for (const [b, v] of Object.entries(e ?? {}) as [string, number[]][]) {
        direct[Number(b)]! += v[0]!;
        directPts[Number(b)]! += v[1 + pi]!;
      }
    }
    for (let n = 0; n < 5; n++) {
      if (t.buckets[n]!.seconds !== direct[n] || t.buckets[n]!.events.pts !== directPts[n]) fail(`${pid} ${side} OC${n}: 足し合わせが食い違う`);
    }
  }
  checkedPlayers++;
  for (const l of logs) {
    const e = pf.players[pid][l.scheduleKey]?.own;
    if (!e || l.min <= 0) continue;
    totalGames++;
    const sum = Object.values(e).reduce((a: number, v: any) => a + v[0], 0);
    const d = Math.abs(sum - l.min * 60);
    if (d > 1) diffGames++;
    maxDiffSec = Math.max(maxDiffSec, d);
  }
}
console.log(`3. 選手 ${checkedPlayers}人: 足し合わせは一致。人数別の時間の合計が出場時間と1秒より違う試合 ${diffGames} / ${totalGames}（最大 ${Math.round(maxDiffSec)}秒。区分が不明などで外した5人組の分）`);
if (ng > 0) {
  console.log(`NG ${ng}件`);
  process.exit(1);
}
console.log("OK");
