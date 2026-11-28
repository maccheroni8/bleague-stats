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

// 372章で 2016-17 から
assert.equal(ttsSeasonSupported("2016-17"), true);
assert.equal(ttsSeasonSupported("2019-20"), true);
assert.equal(ttsSeasonSupported("2020-21"), true);
assert.equal(formatTtsSeconds(-0.004, "diff"), "0.00");
assert.equal(formatTtsSeconds(0.004, "diff"), "0.00");
assert.equal(formatTtsSeconds(1.267, "diff"), "+1.27");
assert.equal(formatTtsPct(-3.444, "diff"), "-3.44");
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
      if (all.n! > 0) {
        assert.equal(first.n! + oreb.n!, all.n);
        assert.ok(Math.abs((first.pct ?? 0) + (oreb.pct ?? 0) - 100) < 1e-9);
        checks++;
      }
      // フリースローをもらうまでの時間（DESIGN.md 480章）: 計算し直した件数・秒数と一致、Shooting Foul%＋Bonus%＝100%
      const ftExp = { shoot: { n: 0, s: 0 }, bonus: { n: 0, s: 0 }, and1: { n: 0, s: 0 } };
      calc.forEach((r) => {
        for (const f of r.fts) {
          if ((f.team === teamId) !== own || !fn(f.period) || f.seconds === null || (f.kind !== "shoot" && f.kind !== "bonus")) continue;
          ftExp[f.kind].n += 1;
          ftExp[f.kind].s += f.seconds;
          if (f.andOne && f.kind === "shoot") {
            ftExp.and1.n += 1;
            ftExp.and1.s += f.seconds;
          }
        }
      });
      for (const k of ["shoot", "bonus", "and1"] as const) {
        assert.equal(got.ft[k].n, ftExp[k].n, `${season} ${period} ${own} FT ${k} n`);
        assert.equal(got.ft[k].s, ftExp[k].s, `${season} ${period} ${own} FT ${k} s`);
      }
      // 攻撃時間（481章）: 計算し直した回数・秒数と一致、With OR%＋No OR%＝100%、OR/Poss＝ORの合計÷回数
      const posOk = calc.flatMap((r) => r.possessions.filter((p) => (p.team === teamId) === own && fn(p.period) && p.seconds !== null));
      assert.equal(got.poss.all.n, posOk.length, `${season} ${period} ${own} 攻撃 回数`);
      assert.equal(got.poss.all.s, posOk.reduce((n, p) => n + p.seconds!, 0), `${season} ${period} ${own} 攻撃 秒数`);
      assert.equal(got.poss.or.n, posOk.filter((p) => p.orebs > 0).length);
      assert.equal(got.poss.pts.n, posOk.filter((p) => p.scored).length);
      if (posOk.length > 0) {
        assert.ok(Math.abs((ttsItemValues(got, "possOr").pct ?? 0) + (ttsItemValues(got, "possNoOr").pct ?? 0) - 100) < 1e-9);
        assert.ok(Math.abs(ttsItemValues(got, "orPerPoss").avg! - posOk.reduce((n, p) => n + p.orebs, 0) / posOk.length) < 1e-9);
      }
      const ft = ttsItemValues(got, "ft");
      if (ft.n! > 0) {
        assert.ok(Math.abs((ttsItemValues(got, "ftShoot").pct ?? 0) + (ttsItemValues(got, "ftBonus").pct ?? 0) - 100) < 1e-9);
        assert.ok((ttsItemValues(got, "ftAnd1").pct ?? 0) <= (ttsItemValues(got, "ftShoot").pct ?? 0));
      }
      checks++;
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
  // フリースローの列が無い古いファイル（デプロイ直後のキャッシュなど）では、フリースローの項目は「-」（0件にしない）
  const oldFile: TtsIndexFile = { ...file, rows: { counts: Object.fromEntries(Object.entries(file.rows.counts).filter(([k]) => !k.includes(".ft.") && !k.includes(".pos."))) } };
  const oldTotals = sumTtsTotals({ season, file: oldFile, gameNo }, logs, "all", "own");
  assert.equal(oldTotals.ftGames, 0);
  assert.deepEqual(ttsItemValues(oldTotals, "ft"), { avg: null, pct: null, n: null });
  assert.equal(oldTotals.possGames, 0);
  assert.deepEqual(ttsItemValues(oldTotals, "poss"), { avg: null, pct: null, n: null });
  assert.equal(ttsItemValues(oldTotals, "all").n, ttsItemValues(sumTtsTotals(source, logs, "all", "own"), "all").n);
  checks++;
}
console.log(`team-tts 集計: ${checks} 項目 OK`);
