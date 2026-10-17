// チーム詳細「クラブレコード」の最多連勝・最多連敗のトップ10（src/lib/streakRecords.ts。DESIGN.md 260章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//  1. 全クラブ・全シーズンで、一番長い連勝・連敗の長さが、既存の longestWinStreak と全試合から数えた値（連敗）と一致する（長さが2以上のとき）
//  2. 連続の長さの合計＝連勝（連敗）した試合数 − 1連の数（1連は数えないため）
//  3. 順位が「同じ値は同じ順位、次は飛ばす」で、トップ10の境目の同じ長さは全部入る。長さごとに1行・回数は新しい順
//  4. 小さな例で、継続中・長さ1を数えない・同じ長さのまとめ・順位の飛びを確かめる
//
// 使い方: npm run validate:streak-records（src/ のコードを使うため esbuild でまとめて実行する）。1つでも食い違いがあれば終了コード1
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { TeamGameLog } from "../shared/types.ts";
import { longestWinStreak } from "../shared/teamRecords.ts";
import { rankStreakRuns, streakRunsOfSeason, STREAK_TOP_N, type StreakRun } from "../src/lib/streakRecords.ts";

const DATA_DIR = path.join(process.cwd(), "data");
let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}
const readGz = <T>(file: string): T | null => (existsSync(file) ? (JSON.parse(gunzipSync(readFileSync(file)).toString("utf-8")) as T) : null);

const bad1: string[] = [];
const bad2: string[] = [];
const bad3: string[] = [];
let units = 0;
for (const season of readdirSync(DATA_DIR).filter((s) => /^\d{4}-\d{2}$/.test(s)).sort()) {
  const dir = path.join(DATA_DIR, season, "team-games");
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json.gz"))) {
    const all = readGz<TeamGameLog[]>(path.join(dir, f));
    if (!all) continue;
    for (const type of ["regular", "playoff", "both"] as const) {
      const logs = type === "both" ? all : all.filter((g) => g.gameType === type);
      if (logs.length === 0) continue;
      units += 1;
      const key = `${season} ${f.replace(".json.gz", "")} ${type}`;
      for (const kind of ["win", "loss"] as const) {
        const runs = streakRunsOfSeason(season, logs, kind, false);
        const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
        // 1. 最長
        const longest = kind === "win" ? longestWinStreak(logs) : longestWinStreak(logs.map((g) => ({ ...g, win: !g.win })));
        const max = runs.reduce((m, r) => Math.max(m, r.length), 0);
        if ((longest >= 2 ? longest : 0) !== max) bad1.push(`${key} ${kind} ${longest}/${max}`);
        // 2. 合計
        const games = sorted.filter((g) => g.win === (kind === "win")).length;
        let ones = 0;
        let cur = 0;
        for (const g of sorted) {
          if (g.win === (kind === "win")) cur += 1;
          else {
            if (cur === 1) ones += 1;
            cur = 0;
          }
        }
        if (cur === 1) ones += 1;
        if (runs.reduce((a, r) => a + r.length, 0) !== games - ones) bad2.push(`${key} ${kind}`);
        // 3. トップ10
        const rows = rankStreakRuns(runs);
        const lengths = rows.map((r) => r.length);
        const distinct = new Set(lengths).size === lengths.length && lengths.every((v, i) => i === 0 || v < lengths[i - 1]!);
        const countAbove = (len: number) => runs.filter((r) => r.length > len).length;
        const rankOk = rows.every((r) => r.rank === countAbove(r.length) + 1);
        const lastRow = rows.at(-1);
        const boundaryOk = !lastRow || lastRow.runs.length === runs.filter((r) => r.length === lastRow.length).length;
        const cutoffOk = rows.length === 0 || rows.reduce((a, r) => a + r.runs.length, 0) >= Math.min(STREAK_TOP_N, runs.length);
        const newestFirst = rows.every((r) => r.runs.every((x, i) => i === 0 || x.last.date <= r.runs[i - 1]!.last.date));
        if (!distinct || !rankOk || !boundaryOk || !cutoffOk || !newestFirst) bad3.push(`${key} ${kind}`);
      }
    }
  }
}
check(`一番長い連勝・連敗が、既存の最長の数え方と一致する（${units} 組のクラブ・シーズン・試合区分）`, bad1.length === 0, bad1.slice(0, 10).join("\n   "));
check("連続の長さの合計＝連勝（連敗）した試合数−1連の数", bad2.length === 0, bad2.slice(0, 10).join("\n   "));
check("トップ10: 長さごとに1行・順位は同じ値は同じ順位で次は飛ぶ・境目の同じ長さは全部入る・回数は新しい順", bad3.length === 0, bad3.slice(0, 10).join("\n   "));

// 4. 小さな例
const game = (day: number, win: boolean) => ({
  date: `2026-10-${String(day).padStart(2, "0")}`,
  scheduleKey: String(day),
  win,
  isHome: true,
  opponentTeamId: "1",
  opponentTeamName: "相手",
});
// 勝 勝 負 勝 負 負 負 勝 勝 勝 勝 負 勝 勝（最後の2連勝は続いている）。連勝: 2連（日1〜2）・1連（日4）・4連（日8〜11）・2連（日13〜14）
const pattern = [true, true, false, true, false, false, false, true, true, true, true, false, true, true];
const logs = pattern.map((w, i) => game(i + 1, w));
const wins = streakRunsOfSeason("2026-27", logs, "win", true);
check("1連は数えない・連勝は 2連・4連・2連 の3つ", wins.map((r) => r.length).join(",") === "2,4,2", wins.map((r) => r.length).join(","));
check("最後まで続いている連勝だけが継続中（シーズンが進行中のとき）", wins.map((r) => r.ongoing).join(",") === "false,false,true");
check("シーズンが終わっていれば継続中にしない", streakRunsOfSeason("2026-27", logs, "win", false).every((r) => !r.ongoing));
const losses = streakRunsOfSeason("2026-27", logs, "loss", true);
check("連敗は 3連 の1つ（1連の負けは数えない）", losses.map((r) => r.length).join(",") === "3");
const dup: StreakRun[] = [2, 2, 2, 3, 4].map((length, i) => ({ season: "2026-27", length, first: game(i + 1, true), last: game(i + 2, true), ongoing: false }));
const ranked = rankStreakRuns(dup, 3);
check("順位: 4連が1位・3連が2位・2連が3位（3回。トップ3の境目の同じ長さは全部入る）", ranked.map((r) => `${r.rank}:${r.length}:${r.runs.length}`).join(" ") === "1:4:1 2:3:1 3:2:3", ranked.map((r) => `${r.rank}:${r.length}:${r.runs.length}`).join(" "));
const tieRanked = rankStreakRuns([2, 2, 3, 3, 3, 5].map((length, i) => ({ season: "2026-27", length, first: game(i + 1, true), last: game(i + 2, true), ongoing: false })), 10);
check("順位が飛ぶ: 5連1位・3連2位（3回）・2連5位（2回）", tieRanked.map((r) => `${r.rank}:${r.length}:${r.runs.length}`).join(" ") === "1:5:1 2:3:3 5:2:2", tieRanked.map((r) => `${r.rank}:${r.length}:${r.runs.length}`).join(" "));
console.log(failures === 0 ? "\nすべて ok" : `\n${failures} 件 NG`);
process.exit(failures === 0 ? 0 : 1);
