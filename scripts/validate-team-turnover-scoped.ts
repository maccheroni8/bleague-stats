// Forced TOV を条件（期間・相手・ホーム／アウェー・試合区分）で絞れることの検証（DESIGN.md 339章）。使い方: npm run validate:team-turnover-scoped（先に npm run build:data）
//  1. 条件なし（レギュラーシーズン全試合）の値が、teams.json の forcedTurnovers／turnoversCommitted・gamesPlayed、league-average.json のリーグ平均と全シーズン・両リーグで一致する
//     （画面は条件なしのとき、これまでと同じ数字を出す）。teams.json に値が無いチーム（記録の無いシーズン）は出ない
//  2. 条件で絞った値が、試合ごとの値の手計算の足し算と一致する（ホームだけ＋アウェイだけ＝全体、前半の試合＋後半の試合＝全体、1試合だけの条件＝その試合の値）
//  3. 試合ごとの値が無い古いデータ（記録はあるのに forcedTurnovers が無い）は null（画面は teams.json の値に戻る）
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamForcedTurnovers, TeamGameLog, TeamSummary } from "../shared/types";
import { scopedTurnovers } from "../src/lib/teamTurnoverScoped";

const DATA = path.resolve("data");
const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};
let failures = 0;
const fail = (m: string) => { failures += 1; if (failures <= 30) console.error(`NG ${m}`); };
const KEYS: (keyof TeamForcedTurnovers)[] = ["gamesWithData", "offensiveFoul", "violation24sec", "backcourtViolation", "violation5sec", "violation8sec", "otherDead", "live"];
const same = (a: TeamForcedTurnovers, b: TeamForcedTurnovers) => KEYS.every((k) => Math.abs(a[k] - b[k]) < 1e-9);
const regular = (logs: TeamGameLog[]) => logs.filter((g) => g.gameType === "regular");
const sum = (list: TeamForcedTurnovers[]) => Object.fromEntries(KEYS.map((k) => [k, list.reduce((a, d) => a + d[k], 0)])) as unknown as TeamForcedTurnovers;

let teamsChecked = 0, withData = 0, leagues = 0, splitChecked = 0, singleChecked = 0;
for (const dir of readdirSync(DATA).filter((d) => /^\d{4}-\d{2}$/.test(d))) {
  for (const sub of [dir, `${dir}/one`]) {
    const base = path.join(DATA, sub);
    const teams: TeamSummary[] | null = rj(`${base}/teams.json`);
    if (!teams) continue;
    const logsBy = new Map<string, TeamGameLog[]>();
    for (const t of teams) logsBy.set(t.teamId, regular(rj(`${base}/team-games/${t.teamId}.json`) ?? []));
    const r = scopedTurnovers(logsBy);
    const needs = [...logsBy.values()].some((logs) => logs.some((g) => !!g.shotTypes && !g.forcedTurnovers));
    if (needs) { if (r !== null) fail(`${sub}: 試合ごとの値が無いのに null でない`); continue; }
    if (!r) { fail(`${sub}: null`); continue; }
    for (const t of teams) {
      teamsChecked++;
      const s = r.teams.get(t.teamId);
      if (!t.forcedTurnovers || !t.turnoversCommitted) { if (s) fail(`${sub} ${t.teamId}: teams.json に値が無いのに出る`); continue; }
      withData++;
      if (!s) { fail(`${sub} ${t.teamId}: 出ない`); continue; }
      if (s.games !== t.gamesPlayed) fail(`${sub} ${t.teamId}: 試合数 ${s.games} / ${t.gamesPlayed}`);
      if (!same(s.forced, t.forcedTurnovers)) fail(`${sub} ${t.teamId}: forced が teams.json と違う`);
      if (!same(s.committed, t.turnoversCommitted)) fail(`${sub} ${t.teamId}: committed が teams.json と違う`);
      // 絞り込み: ホーム／アウェー、前半／後半の試合、1試合だけ
      const logs = logsBy.get(t.teamId)!;
      const part = (f: (g: TeamGameLog, i: number) => boolean) => scopedTurnovers(new Map([[t.teamId, logs.filter(f)]]))?.teams.get(t.teamId);
      const home = part((g) => g.isHome), away = part((g) => !g.isHome);
      const first = part((_, i) => i < logs.length / 2), second = part((_, i) => i >= logs.length / 2);
      for (const [name, a, b] of [["ホーム＋アウェー", home, away], ["前半＋後半", first, second]] as const) {
        const parts = [a, b].filter((x) => !!x);
        if (!same(sum(parts.map((x) => x!.forced)), t.forcedTurnovers) || !same(sum(parts.map((x) => x!.committed)), t.turnoversCommitted)) fail(`${sub} ${t.teamId}: ${name} が全体と合わない`);
        if (parts.reduce((x, p) => x + p!.games, 0) !== logs.length) fail(`${sub} ${t.teamId}: ${name} の試合数`);
      }
      splitChecked++;
      const one = logs.findIndex((g) => !!g.forcedTurnovers);
      if (one >= 0) {
        const o = part((_, i) => i === one)!;
        if (o.games !== 1 || !same(o.forced, logs[one]!.forcedTurnovers!) || !same(o.committed, logs[one]!.turnoversCommitted!)) fail(`${sub} ${t.teamId}: 1試合の条件が試合の値と違う`);
        singleChecked++;
      }
    }
    // リーグ平均
    const lg = rj(`${base}/league-average.json`);
    if (lg?.team?.forcedTurnovers && r.league) {
      leagues++;
      if (Math.abs(r.league.games - lg.team.gamesPlayed) > 1e-9) fail(`${sub}: リーグ平均の試合数 ${r.league.games} / ${lg.team.gamesPlayed}`);
      if (!same(r.league.forced, lg.team.forcedTurnovers) || !same(r.league.committed, lg.team.turnoversCommitted)) fail(`${sub}: リーグ平均の値が league-average.json と違う`);
    } else if (lg?.team?.forcedTurnovers) fail(`${sub}: リーグ平均が出ない`);
  }
}
console.log(`Forced TOV（条件別）: チーム ${teamsChecked}（値あり ${withData}）、リーグ平均 ${leagues} シーズン、足し算の合致 ${splitChecked}、1試合の条件 ${singleChecked}`);
if (failures > 0) { console.error(`${failures} 件の食い違い`); process.exit(1); }
console.log("Forced TOV（条件別）: PASS");
