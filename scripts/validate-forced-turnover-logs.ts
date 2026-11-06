// 試合ごとの Forced TOV（チームの試合ログの forcedTurnovers・turnoversCommitted。DESIGN.md 333章）の検証。
//
// 確かめること:
//  1. スポーツナビの記録がある試合（data/{season}/yahoo/）の両チームの試合ログに、試合全体の7種類（自チームが強制した／記録した）がある。記録の無い試合には無い
//  2. その値が、画面がこれまで記録を読み直して出していた値（src/lib/opponentSplit.ts の sumForcedTurnovers）と一致する。合わない試合は一覧で出す
//  3. teams.json のシーズン合計（レギュラーシーズン）が、試合ごとの値のレギュラーシーズンの合計と一致する
//  4. 画面の合計（sumForcedTurnoversFromLogs）が、記録を読み直した合計と一致する（条件で絞った例: 直近5試合・ホームだけ・ポストシーズン）
//
// 使い方: npm run validate:forced-turnover-logs（先に npm run build:data）。1つでも食い違いがあれば終了コード1
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamForcedTurnovers, TeamGameLog, TeamSummary, YahooGamePbp } from "../shared/types.ts";
import { sumForcedTurnovers, sumForcedTurnoversFromLogs } from "../src/lib/opponentSplit.ts";

const DATA = path.join(process.cwd(), "data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (ok) console.log(`ok ${label}`);
  else {
    failures += 1;
    console.error(`NG ${label} ${detail}`);
  }
}
const readJson = <T>(file: string): T => JSON.parse(gunzipSync(readFileSync(file)).toString()) as T;
const KEYS = ["gamesWithData", "offensiveFoul", "violation24sec", "backcourtViolation", "violation5sec", "violation8sec", "otherDead", "live"] as const;
const same = (a: TeamForcedTurnovers | undefined, b: TeamForcedTurnovers | undefined) => !!a && !!b && KEYS.every((k) => a[k] === b[k]);
const text = (t: TeamForcedTurnovers | undefined) => (t ? KEYS.map((k) => t[k]).join("/") : "なし");

let seasons = 0;
let games = 0;
for (const season of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d)).sort()) {
  const yahooDir = path.join(DATA, season, "yahoo");
  if (!existsSync(yahooDir)) continue;
  const yahoo = new Map<string, YahooGamePbp>();
  for (const f of readdirSync(yahooDir)) yahoo.set(f.replace(/\.json(\.gz)?$/, ""), readJson<YahooGamePbp>(path.join(yahooDir, f)));
  if (yahoo.size === 0) continue;
  seasons += 1;
  const teams = readJson<TeamSummary[]>(path.join(DATA, season, "teams.json.gz"));
  const presence: string[] = [];
  const mismatch: string[] = [];
  const seasonMismatch: string[] = [];
  const scopedMismatch: string[] = [];
  for (const t of teams) {
    const logs = readJson<TeamGameLog[]>(path.join(DATA, season, "team-games", `${t.teamId}.json.gz`));
    for (const g of logs) {
      const pbp = yahoo.get(g.scheduleKey);
      if (!pbp) {
        if (g.forcedTurnovers || g.turnoversCommitted) presence.push(`${t.teamName} ${g.scheduleKey}（記録が無いのに値がある）`);
        continue;
      }
      games += 1;
      if (!g.forcedTurnovers || !g.turnoversCommitted) {
        presence.push(`${t.teamName} ${g.scheduleKey}（記録があるのに値が無い）`);
        continue;
      }
      const want = sumForcedTurnovers([pbp], t.teamId);
      if (!same(g.forcedTurnovers, want.forced) || !same(g.turnoversCommitted, want.committed)) {
        mismatch.push(`${t.teamName} ${g.scheduleKey} 強制 ${text(g.forcedTurnovers)}→記録 ${text(want.forced)} 記録した ${text(g.turnoversCommitted)}→${text(want.committed)}`);
      }
    }
    const regular = logs.filter((g) => g.gameType === "regular");
    const sum = sumForcedTurnoversFromLogs(regular);
    if (t.forcedTurnovers || sum.forced.gamesWithData > 0) {
      if (!same(t.forcedTurnovers, sum.forced) || !same(t.turnoversCommitted, sum.committed)) {
        seasonMismatch.push(`${t.teamName} teams.json ${text(t.forcedTurnovers)} / 試合ごとの合計 ${text(sum.forced)}`);
      }
    }
    // 4. 条件で絞った合計（画面の Forced TOV の対戦相手別・md と同じ足し方）
    const scopes: [string, TeamGameLog[]][] = [
      ["直近5試合", regular.slice(-5)],
      ["ホーム", regular.filter((g) => g.isHome)],
      ["ポストシーズン", logs.filter((g) => g.gameType !== "regular")],
    ];
    for (const [name, list] of scopes) {
      const fromLogs = sumForcedTurnoversFromLogs(list);
      const fromPbp = sumForcedTurnovers(list.flatMap((g) => (yahoo.has(g.scheduleKey) ? [yahoo.get(g.scheduleKey)!] : [])), t.teamId);
      if (!same(fromLogs.forced, fromPbp.forced) || !same(fromLogs.committed, fromPbp.committed)) scopedMismatch.push(`${t.teamName} ${name}`);
    }
  }
  check(`${season}: 記録がある試合だけ、両チームの試合ログに値がある`, presence.length === 0, presence.slice(0, 5).join("、"));
  check(`${season}: 試合ごとの値が、記録を読み直した値と一致`, mismatch.length === 0, `${mismatch.length}件 ${mismatch.slice(0, 5).join("、")}`);
  check(`${season}: teams.json のシーズン合計＝試合ごとの値のレギュラーシーズンの合計`, seasonMismatch.length === 0, seasonMismatch.slice(0, 5).join("、"));
  check(`${season}: 条件で絞った合計が、記録を読み直した合計と一致（直近5試合・ホーム・ポストシーズン）`, scopedMismatch.length === 0, scopedMismatch.slice(0, 5).join("、"));
}
check("スポーツナビの記録があるシーズンが1つ以上ある", seasons > 0);
console.log(`${seasons} シーズン・チーム×試合 ${games} 件を確認`);

if (failures > 0) {
  console.error(`NG: ${failures} 件の食い違い`);
  process.exit(1);
}
console.log("OK: 試合ごとの Forced TOV");
