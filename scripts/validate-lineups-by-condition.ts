// チーム詳細「よく使われるラインナップ」の条件別の計算（src/lib/lineupsByCondition.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。DESIGN.md 259章
//  1. 合算・試合全体の値が、lineups/{teamId}.json（ラインナップのファイル）と、全シーズン・全クラブで完全に一致する（5人組・出場時間・得点・失点・攻撃回数・試合数・並び）
//  2. 1Q〜4Q＋延長の合計が試合全体と一致し、レギュラーシーズン＋ポストシーズンが合算と一致する（出場時間・得点・失点・攻撃回数）
//  3. 「よく使われる」の時間の基準が、試合全体で今までの180秒、1Q〜4Qで45秒、前半・後半で90秒、延長で22.5秒になる
//
// 使い方: npm run validate:lineups-by-condition（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamLineupsFile, TeamStintsFile } from "../shared/types.ts";
import { substitutionModelForSeason } from "../shared/onCourt.ts";
import { lineupMinAvgSeconds, lineupsByCondition } from "../src/lib/lineupsByCondition.ts";

const DATA_DIR = path.join(process.cwd(), "data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}
const readGz = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as T) : null);

const seasons = readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s) && substitutionModelForSeason(s) === "modern").sort();
let teamsChecked = 0;
const mismatches: string[] = [];
const gamesOffByOne: string[] = [];
const sumMismatches: string[] = [];
for (const season of seasons) {
  const dir = path.join(DATA_DIR, season, "team-stints");
  if (!existsSync(dir)) continue;
  const schedule = readGz<{ games?: unknown }>(path.join(DATA_DIR, season, "schedule.json.gz"));
  void schedule;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json.gz"))) {
    const teamId = f.replace(".json.gz", "");
    const stints = readGz<TeamStintsFile>(path.join(dir, f));
    const lineups = readGz<TeamLineupsFile>(path.join(DATA_DIR, season, "lineups", f));
    if (!stints || !lineups) continue;
    teamsChecked += 1;
    // 試合の区分は games-summary から
    const summaries = readGz<{ scheduleKey: string; gameType: string }[]>(path.join(DATA_DIR, season, "games-summary.json.gz")) ?? [];
    const typeByKey = new Map(summaries.map((g) => [g.scheduleKey, g.gameType]));

    const all = lineupsByCondition(stints, { includeGame: () => true, periods: null });
    // ラインナップのファイルには、時間も得点も無い（出場区間が残っていない）1試合だけの5人組が、ごくまれに入っている。条件別の表には出さない
    const fileLineups = lineups.lineups.filter((l) => !(l.secondsPlayed === 0 && l.ownPoints === 0 && l.oppPoints === 0 && (l.ownPoss ?? 0) === 0 && (l.oppPoss ?? 0) === 0));
    const fileByKey = new Map(fileLineups.map((l) => [l.lineupKey, l]));
    let ok = all.lineups.length === fileLineups.length;
    for (const [i, l] of all.lineups.entries()) {
      const o = fileByKey.get(l.lineupKey);
      if (!o || o.secondsPlayed !== l.secondsPlayed || o.ownPoints !== l.ownPoints || o.oppPoints !== l.oppPoints || o.ownPoss !== l.ownPoss || o.oppPoss !== l.oppPoss) ok = false;
      if (fileLineups[i]?.secondsPlayed !== l.secondsPlayed) ok = false;
      // 試合数は、ラインナップのファイルが「0秒だけコートにいた（出場区間が残っていない）試合」を1試合と数えている5人組がまれにある。条件別は時間か記録のある試合だけを数える
      if (o && o.gamesPlayed !== l.gamesPlayed) {
        if (o.gamesPlayed - l.gamesPlayed === 1) gamesOffByOne.push(`${season} ${teamId}`);
        else ok = false;
      }
    }
    if (lineups.gamesCount !== undefined && lineups.gamesCount !== all.teamGames) ok = false;
    if (!ok) mismatches.push(`${season} ${teamId}`);

    // 区間の合計＝試合全体、試合区分の合計＝合算
    const total = (periods: number[] | null, type: string | null) => {
      const r = lineupsByCondition(stints, { includeGame: (k) => type === null || typeByKey.get(k) === type, periods });
      return r.lineups.reduce((a, l) => ({ s: a.s + l.secondsPlayed, p: a.p + l.ownPoints, o: a.o + l.oppPoints, q: a.q + (l.ownPoss ?? 0) }), { s: 0, p: 0, o: 0, q: 0 });
    };
    const whole = total(null, null);
    const maxPeriod = stints.rows.reduce((m, r) => Math.max(m, r[1]!), 4);
    const parts = { s: 0, p: 0, o: 0, q: 0 };
    for (let q = 1; q <= maxPeriod; q += 1) {
      const t = total([q], null);
      parts.s += t.s;
      parts.p += t.p;
      parts.o += t.o;
      parts.q += t.q;
    }
    const reg = total(null, "regular");
    const po = total(null, "playoff");
    const sameSum = (a: typeof whole, b: typeof whole) => a.s === b.s && a.p === b.p && a.o === b.o && a.q === b.q;
    if (!sameSum(parts, whole) || !sameSum({ s: reg.s + po.s, p: reg.p + po.p, o: reg.o + po.o, q: reg.q + po.q }, whole)) sumMismatches.push(`${season} ${teamId}`);
  }
}
check(`合算・試合全体の値（出場時間・得点・失点・攻撃回数・並び）が、ラインナップのファイルと一致する（${seasons.join("・")}の ${teamsChecked} クラブ・シーズン）`, teamsChecked > 0 && mismatches.length === 0, mismatches.slice(0, 10).join("\n   "));
console.log(`参考: 試合数がファイルより1少ない5人組 ${gamesOffByOne.length} 組（0秒だけ出た試合を数えないため）`);
check("1Q〜4Q＋延長の合計が試合全体と、レギュラー＋ポストが合算と、それぞれ一致する", sumMismatches.length === 0, sumMismatches.slice(0, 10).join("\n   "));
check(
  "時間の基準: 試合全体180秒・1Q〜4Q 45秒・前半後半90秒・延長22.5秒",
  lineupMinAvgSeconds("all") === 180 &&
    (["q1", "q2", "q3", "q4"] as const).every((q) => lineupMinAvgSeconds(q) === 45) &&
    lineupMinAvgSeconds("h1") === 90 &&
    lineupMinAvgSeconds("h2") === 90 &&
    lineupMinAvgSeconds("ot") === 22.5,
);
console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件 NG`);
process.exit(failures === 0 ? 0 : 1);
