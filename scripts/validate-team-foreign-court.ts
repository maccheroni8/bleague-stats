// On-Court Foreign とオンザコート別の合計の、試合区分・区間別（DESIGN.md 256章の段階3。src/lib/teamForeignCourt.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 試合全体・レギュラーシーズン・自チームの人数別の時間と試合数が、teams.json の On-Court Foreign（foreignPlayerCourtSeconds・gamesPlayed）と一致する
//  2. 区間: 1Q〜4Q＋延長の合計 = 試合全体（特別な試合を除く）、前半 = 1Q＋2Q、1Q の試合数 = 特別な試合を除く試合数（自チーム・相手の両方）
//  3. オンザコート別の合計（合算・試合全体）の人数別の時間・得点・失点が、ラインナップのファイルからの値（今までの表）と一致する。
//     2020-21以降は ORtg・DRtg も一致。2019-20以前の推定の ORtg・DRtg は按分の方法を変えたので、変わった行の数と差の大きさを出す
//  4. 1試合平均の分母 = 出場時間のある全試合
//  5. 合計の行の ORtg・DRtg・NetRtg: NetRtg = ORtg − DRtg、攻撃回数のある条件では「-」にならない。
//     チーム全体のレーティング（得点÷チームの攻撃回数）との差（2020-21以降の実際の攻撃回数）の大きさを出す（食い違いは情報として出し、NGにはしない）
//
// 使い方: npm run validate:team-foreign-court。1つでも食い違いがあれば終了コード1
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { sumForeignCourt, sumForeignDetail, FOREIGN_COUNTS } from "../src/lib/teamForeignCourt.ts";
import { seasonOnCourtSummary, seasonOnCourtSummaryFromDetail, lineupSeasonTotals } from "../src/lib/teamLineupOnCourt.ts";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
};
const rules = rj(`${DATA}/season-rules.json`);
const seasons = readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort();
let ng = 0;
const totalDiffs: { season: string; team: string; period: string; kind: string; diff: number }[] = [];
let totalNg = 0;
let totalChecked = 0;
const rtgChanges: string[] = [];
for (const season of seasons) {
  if (!existsSync(`${DATA}/${season}/team-period-index.json.gz`)) continue;
  const file = rj(`${DATA}/${season}/team-period-index.json`);
  const tgi = rj(`${DATA}/${season}/team-game-index.json`);
  const gameNo = new Map<string, number>(tgi.games.key.map((k: string, i: number) => [k, i]));
  const source = { season, file, gameNo } as any;
  const teams = rj(`${DATA}/${season}/teams.json`);
  const players = rj(`${DATA}/${season}/players.json`);
  const cls = new Map(players.map((p: any) => [p.playerId, p.classification]));
  const max = rules.find((r: any) => r.season === season)?.maxForeignOnCourt;
  let teamNg = 0;
  let periodNg = 0;
  let summaryNg = 0;
  for (const t of teams) {
    const logs = rj(`${DATA}/${season}/team-games/${t.teamId}.json`);
    const regular = logs.filter((g: any) => g.gameType === "regular");
    // (b) 試合全体・レギュラー・自チーム = teams.json
    const s = sumForeignCourt(null, regular, "all", "own")!;
    const tj = t.foreignPlayerCourtSeconds ?? [0, 0, 0, 0, 0];
    if (s.games !== t.gamesPlayed || FOREIGN_COUNTS.some((n) => Math.abs(s.seconds[n]! - (tj[n] ?? 0)) > 0)) {
      teamNg++;
      if (teamNg < 4) console.log("teams.json mismatch", season, t.teamId, s, tj, t.gamesPlayed);
    }
    // (c) 区間の合計 = 試合全体（特別な試合を除く）、自チーム・相手
    for (const side of ["own", "opp"] as const) {
      const all = sumForeignCourt(source, logs, "all", side)!;
      const q = (["q1", "q2", "q3", "q4", "ot"] as const).map((p) => sumForeignCourt(source, logs, p, side)!);
      const h1 = sumForeignCourt(source, logs, "h1", side)!;
      // 特別な試合（1Q が無い）を除いた試合全体
      const normal = logs.filter((g: any) => {
        const n = gameNo.get(g.scheduleKey)!;
        return file.rows.counts["q1.pts"][n * 2 + (g.isHome ? 0 : 1)] >= 0;
      });
      const allN = sumForeignCourt(source, normal, "all", side)!;
      for (const n of FOREIGN_COUNTS) {
        const sumQ = q.reduce((a, x) => a + x.seconds[n]!, 0);
        if (sumQ !== allN.seconds[n] || h1.seconds[n] !== q[0]!.seconds[n]! + q[1]!.seconds[n]!) periodNg++;
      }
      if (q[0]!.games !== normal.length) periodNg++;
      void all;
    }
    // (a) オンザコート別の合計: 合算・試合全体 = ラインナップのファイル
    if (max === undefined) continue;
    const lpath = `${DATA}/${season}/lineups/${t.teamId}.json`;
    if (!existsSync(lpath) && !existsSync(lpath + ".gz")) continue;
    const lf = rj(lpath);
    if (!lf.lineups?.length) continue;
    const classify = (id: string) => cls.get(id) as any;
    const legacyTotals = lineupSeasonTotals(logs);
    const legacy = seasonOnCourtSummary(lf.lineups, classify, max, legacyTotals, { teamPoss: t.advanced.poss, teamMin: t.totals.min });
    const detail = sumForeignDetail(source, logs.filter((g: any) => g.min > 0), "all")!;
    const now = seasonOnCourtSummaryFromDetail(detail, max);
    if (now.real !== legacy.real) summaryNg++;
    for (let i = 0; i < now.rows.length; i++) {
      const a = now.rows[i]!;
      const b = legacy.rows[i]!;
      if (a.count !== b.count || a.seconds !== b.seconds || a.ownPoints !== b.ownPoints || a.oppPoints !== b.oppPoints) {
        summaryNg++;
        if (summaryNg < 4) console.log("summary mismatch", season, t.teamId, a, b);
      }
      const close = (x: number | null, y: number | null) => (x === null && y === null) || (x !== null && y !== null && Math.abs(x - y) < 1e-6);
      if (!close(a.ortg, b.ortg) || !close(a.drtg, b.drtg)) {
        if (now.real) summaryNg++;
        else if (a.seconds > 0) rtgChanges.push(`${season}\t${t.teamId}\t${t.teamName}\tOC${a.count}\t${b.ortg?.toFixed(1)}→${a.ortg?.toFixed(1)}\t${b.drtg?.toFixed(1)}→${a.drtg?.toFixed(1)}`);
      }
    }
    // 合計の行の ORtg・DRtg・NetRtg（試合区分: レギュラーシーズン・ポストシーズン・合算 × 区間）
    for (const gt of ["regular", "playoff", "both"] as const) {
      const gl = logs.filter((g: any) => g.min > 0 && (gt === "both" ? g.gameType === "regular" || g.gameType === "playoff" : g.gameType === gt));
      for (const period of ["all", "q1", "q2", "q3", "q4", "h1", "h2", "ot"] as const) {
        const d = sumForeignDetail(source, gl, period);
        if (!d || d.games === 0) continue;
        const sm = seasonOnCourtSummaryFromDetail(d, max);
        totalChecked++;
        const tr = sm.total;
        if ((d.teamPoss > 0 || d.byCount.some((b) => b.ownPoss > 0)) && (tr.ortg === null || tr.drtg === null || tr.netRtg === null)) totalNg++;
        if (tr.ortg !== null && tr.drtg !== null && tr.netRtg !== null && Math.abs(tr.netRtg - (tr.ortg - tr.drtg)) > 1e-9) totalNg++;
        if (sm.real && d.teamPoss > 0 && tr.ortg !== null && tr.drtg !== null) {
          const ref = (100 * d.ownPoints) / d.teamPoss;
          const refD = (100 * d.oppPoints) / d.teamPoss;
          if (Math.abs(tr.ortg - ref) > 1e-6) totalDiffs.push({ season, team: t.teamName, period: `${gt}/${period}`, kind: "ORtg", diff: tr.ortg - ref });
          if (Math.abs(tr.drtg - refD) > 1e-6) totalDiffs.push({ season, team: t.teamName, period: `${gt}/${period}`, kind: "DRtg", diff: tr.drtg - refD });
        }
      }
    }
    // 1試合平均の分母
    if (now.games !== logs.filter((g: any) => g.min > 0).length) summaryNg++;
  }
  console.log(season, "teams.json一致NG", teamNg, "区間NG", periodNg, "合計表NG", summaryNg);
  ng += teamNg + periodNg + summaryNg;
}
console.log("合計の行の確認", totalChecked, "条件・NG", totalNg, "・チーム全体の値と1e-6以上ずれた条件", totalDiffs.length);
if (totalDiffs.length > 0) {
  console.log("最大の差", Math.max(...totalDiffs.map((x) => Math.abs(x.diff))).toFixed(3));
  console.log(totalDiffs.slice(0, 8).map((x) => `${x.season}\t${x.team}\t${x.period}\t${x.kind}\t${x.diff.toFixed(3)}`).join("\n"));
}
ng += totalNg;
console.log("推定のレーティングが変わる行", rtgChanges.length);
const diffs = rtgChanges.map((l) => {
  const m = l.match(/([\d.]+)→([\d.]+)\t([\d.]+)→([\d.]+)/)!;
  return Math.max(Math.abs(+m[1]! - +m[2]!), Math.abs(+m[3]! - +m[4]!));
});
if (diffs.length > 0) console.log("最大の差", Math.max(...diffs).toFixed(1), "平均の差", (diffs.reduce((a, b) => a + b, 0) / diffs.length).toFixed(2));
console.log(rtgChanges.slice(0, 8).join("\n"));
const bySeason = new Map<string, Set<string>>();
for (const l of rtgChanges) { const [s, id] = l.split("\t"); if (!bySeason.has(s!)) bySeason.set(s!, new Set()); bySeason.get(s!)!.add(id!); }
for (const [s, ids] of bySeason) console.log(`${s} 推定のレーティングが変わるチーム ${ids.size}`);
console.log(ng === 0 ? "すべて ok" : `NG ${ng}`);
if (ng > 0) process.exit(1);
