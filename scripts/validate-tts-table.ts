// Time to Shot の集計（src/lib/teamTts.ts）の検証。先に npm run build:data で導出データを作っておく。
// 試合の生データから計算し直した値（shared/timeToShot.ts）と、導出データ→集計の値が、チーム・区間・視点（自チーム／opp／+/-）で一致することを確かめる。
import assert from "node:assert/strict";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import { calculateTimeToShot } from "../shared/timeToShot.ts";
import type { TtsIndexFile } from "../shared/ttsIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { TeamGameLog } from "../shared/types.ts";
import { sumTtsTotals, ttsItemValues, ttsPerspectiveValues, ttsSeasonSupported, TTS_ITEMS, type TtsSource } from "../src/lib/teamTts.ts";
import { formatTtsPct, formatTtsSeconds } from "../src/lib/teamTts.ts";

assert.equal(ttsSeasonSupported("2019-20"), false);
assert.equal(ttsSeasonSupported("2020-21"), true);
assert.equal(formatTtsSeconds(-0.04, "diff"), "0.0");
assert.equal(formatTtsSeconds(0.04, "diff"), "0.0");
assert.equal(formatTtsSeconds(1.26, "diff"), "+1.3");
assert.equal(formatTtsPct(-3.44, "diff"), "-3.4");
assert.equal(formatTtsPct(null, "own"), "-");

let checks = 0;
for (const season of ["2021-22", "2025-26"]) {
  const file = (await readJson<TtsIndexFile>(path.join(DATA_DIR, season, "team-tts.json")))!;
  const idx = (await readJson<TeamGameIndexFile>(path.join(DATA_DIR, season, "team-game-index.json")))!;
  const gameNo = new Map(idx.games.key.map((k, i) => [k, i]));
  const source: TtsSource = { season, file, gameNo };
  const games = (await readAllGames(season)).filter((g) => gameNo.has(String(g.scheduleKey)));
  const teamId = games[0]!.homeTeam.id;
  const mine = games.filter((g) => g.homeTeam.id === teamId || g.awayTeam.id === teamId);
  const logs = mine.map((g) => ({ scheduleKey: String(g.scheduleKey), isHome: g.homeTeam.id === teamId }) as unknown as TeamGameLog);
  const calc = mine.map((g) => calculateTimeToShot(g));
  const expected = (period: (p: number) => boolean, own: boolean) => {
    const t = Object.fromEntries(["score", "deadTo", "dreb", "steal", "quarter", "other", "oreb"].map((c) => [c, { n: 0, s: 0 }])) as Record<string, { n: number; s: number }>;
    calc.forEach((r) => {
      for (const s of r.shots) {
        if ((s.team === teamId) !== own || !period(s.period) || s.category === null || s.seconds === null) continue;
        t[s.category]!.n += 1;
        t[s.category]!.s += s.seconds;
      }
    });
    return t;
  };
  for (const [period, fn] of [["all", () => true], ["q1", (p: number) => p === 1], ["h1", (p: number) => p <= 2], ["h2", (p: number) => p === 3 || p === 4], ["ot", (p: number) => p >= 5]] as const) {
    for (const own of [true, false]) {
      const got = sumTtsTotals(source, logs, period, own ? "own" : "opp");
      const exp = expected(fn, own);
      for (const c of Object.keys(exp)) {
        assert.equal(got.byCategory[c as keyof typeof got.byCategory].n, exp[c]!.n, `${season} ${period} ${own} ${c} n`);
        assert.equal(got.byCategory[c as keyof typeof got.byCategory].s, exp[c]!.s, `${season} ${period} ${own} ${c} s`);
        checks++;
      }
      // 初回全体＋OREB後＝全体（本数・割合）
      const first = ttsItemValues(got, "first"), oreb = ttsItemValues(got, "oreb"), all = ttsItemValues(got, "all");
      if (all.n > 0) {
        assert.equal(first.n + oreb.n, all.n);
        assert.ok(Math.abs((first.pct ?? 0) + (oreb.pct ?? 0) - 100) < 1e-9);
        checks++;
      }
    }
    // +/- ＝自チーム−opp
    const own = sumTtsTotals(source, logs, period, "own");
    const opp = sumTtsTotals(source, logs, period, "opp");
    for (const item of TTS_ITEMS) {
      const a = ttsItemValues(own, item), b = ttsItemValues(opp, item), d = ttsPerspectiveValues(own, opp, "diff", item);
      if (a.avg !== null && b.avg !== null) assert.ok(Math.abs(d.avg! - (a.avg - b.avg)) < 1e-9);
      else assert.equal(d.avg, null);
      checks++;
    }
  }
  // 前半＋後半＋延長＝全体
  const sumN = (p: "h1" | "h2" | "ot") => sumTtsTotals(source, logs, p, "own").byCategory.score.s;
  assert.equal(sumN("h1") + sumN("h2") + sumN("ot"), sumTtsTotals(source, logs, "all", "own").byCategory.score.s);
  checks++;
}
console.log(`team-tts 集計: ${checks} 項目 OK`);
