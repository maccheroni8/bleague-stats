// チームの2P内訳（PAINT2／MID2・6項目）の検証。npm run build:data のあとに実行（外のサイトには問い合わせない）。
// 不正値の除外・合計÷合計・自他の対象数・参考行・全シーズンの試合区分／期間選択・比較（リーグ平均）を確かめる。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { TeamGameLog } from "../shared/types";
import {
  PAINT2_KEYS,
  paintCoverage,
  paintFormat,
  paintOf,
  paintRankable,
  paintValue,
  summarizePaint,
  validPaint,
  verifyLeaguePaint,
  type PaintInput,
} from "../src/lib/teamPaint2";
import { buildMiscColumns, sumTeamGameLogs, type AllTeamsRow } from "../src/lib/teamStatsColumns";
import { sumTeamPeriodTotals, type TeamPeriodSource } from "../src/lib/teamPeriodTotals";
import { teamCompareDefs, teamTotalsFromBoxTotals, type TeamCompareColumnData } from "../src/lib/compareShared";
import { RankedList } from "../src/components/RankedList";

const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p)).toString("utf8"));
const PERSPECTIVES = ["own", "opp", "diff"] as const;
const GAME_TYPES = ["regular", "playoff", "both"] as const;

// --- 境界の事例（実データと独立） ---
const good: PaintInput = { pm: 1, pa: 1, mm: 0, ma: 0, tm: 1, ta: 1 };
assert(validPaint(good));
for (const x of [NaN, Infinity, -1, 0.5, undefined, "1"]) {
  assert(!validPaint({ ...good, pa: x } as PaintInput));
}
for (const x of [{ ...good, pm: 2 }, { ...good, tm: 0 }, { ...good, ta: 2 }]) {
  assert(!validPaint(x));
}
const weighted = summarizePaint([
  { own: good, opp: good },
  { own: { ...good, pm: 0, pa: 9, tm: 0, ta: 9 }, opp: good },
]);
assert.equal(paintValue(weighted, "paint2pct", "perGame", "own"), 0.1);
assert.equal(paintValue(weighted, "paint2m", "perGame", "own"), 0.5);
const empty = summarizePaint([{ own: { pm: 0, pa: 0, mm: 0, ma: 0, tm: 0, ta: 0 }, opp: good }]);
assert.equal(paintFormat(empty, "paint2pct", "total", "own"), "-");
assert(!paintRankable(empty, "paint2pct", "own"));
const partial = summarizePaint([
  { own: good, opp: good },
  { own: { ...good, ta: 2 }, opp: good },
]);
assert.equal(paintCoverage(partial, "own"), "1/2");
assert.equal(paintCoverage(partial, "opp"), "2/2");
assert.equal(paintCoverage(partial, "diff"), "1/2");
assert(!paintRankable(partial, "paint2m", "own"));
const fixtureRows = [
  { key: "a", s: weighted },
  { key: "b", s: partial },
];
type Fixture = (typeof fixtureRows)[number];
const markup = renderToStaticMarkup(
  h(
    MemoryRouter,
    null,
    h(RankedList<Fixture>, {
      rows: fixtureRows,
      def: {
        key: "paint2m",
        label: "PAINT2M",
        value: (r) => paintValue(r.s, "paint2m", "perGame", "own") ?? 0,
        format: (r) => paintFormat(r.s, "paint2m", "perGame", "own"),
      },
      unranked: (r) => !paintRankable(r.s, "paint2m", "own"),
      rowKey: (r) => r.key,
      name: (r) => h("span", null, r.key),
      linkTo: () => undefined,
    }),
  ),
);
assert(markup.includes("参考"));
console.log("ok 不正値・合計÷合計・試投0・自他の対象数・参考行の順位非表示");

// --- 全シーズン ---
let teamScopes = 0;
let periodScopes = 0;
let invalid = 0;
for (const season of fs.readdirSync("data").filter((s) => /^20\d\d-\d\d$/.test(s)).sort()) {
  const teamGamesDir = path.join("data", season, "team-games");
  const teamFiles = fs.readdirSync(teamGamesDir).filter((f) => f.endsWith(".gz"));
  const file = read(path.join("data", season, "team-period-index.json.gz"));
  const index = read(path.join("data", season, "team-game-index.json.gz"));
  const source: TeamPeriodSource = { season, file, gameNo: new Map(index.games.key.map((k: string, i: number) => [k, i])) };
  for (const f of teamFiles) {
    const logs: TeamGameLog[] = read(path.join(teamGamesDir, f));
    for (const gt of GAME_TYPES) {
      const scoped = logs.filter((g) => gt === "both" || g.gameType === gt);
      const totals = sumTeamGameLogs(scoped);
      const s = paintOf(totals)!;
      assert.equal(s.total, scoped.length);
      for (const p of PERSPECTIVES) {
        for (const key of PAINT2_KEYS) {
          // チームスタッツの表の表示と一致する
          const col = buildMiscColumns("perGame", p).find((c) => c.key === key)!;
          const row: AllTeamsRow = { team: { teamId: "", teamName: "" }, totals, gamesPlayed: scoped.length, wins: 0, losses: 0 };
          assert.equal(col.format!(row), paintFormat(s, key, "perGame", p));
          // 全試合の記録が揃うなら、既存の合計（TeamTotals）÷試合数／合計÷合計と一致する
          if (s.own.games === s.total && s.opp.games === s.total && s.total > 0 && p !== "diff") {
            const t =
              p === "opp"
                ? [totals.oppPaint2m, totals.oppPaint2a, totals.oppMid2m, totals.oppMid2a]
                : [totals.paint2m, totals.paint2a, totals.mid2m, totals.mid2a];
            const i = ["paint2m", "paint2a", "mid2m", "mid2a"].indexOf(key);
            if (i >= 0) {
              assert.equal(paintValue(s, key, "perGame", p), t[i]! / s.total);
            } else {
              const made = key === "paint2pct" ? t[0]! : t[2]!;
              const attempted = key === "paint2pct" ? t[1]! : t[3]!;
              assert.equal(paintValue(s, key, "total", p), attempted ? made / attempted : undefined);
            }
          }
        }
      }
      if (gt === "regular") invalid += s.total - s.own.games;
      // 2017-18 の1810（手入力のボックススコア）は2P内訳が無い。内訳対象は59/60で、ランキングの順位は付けない
      if (season === "2017-18" && gt === "regular" && ["704.json.gz", "706.json.gz"].includes(f)) {
        assert.equal(paintCoverage(s, "own"), "59/60");
        assert(!paintRankable(s, "paint2m", "own"));
        assert(scoped.some((g) => g.scheduleKey === "1810"));
        if (f === "704.json.gz") {
          assert.equal(paintValue(s, "paint2m", "perGame", "own"), 1212 / 59);
          assert.equal(paintFormat(s, "paint2m", "perGame", "own"), "20.54");
        }
      }
      // 比較ページの表の表示と一致し、項目が重複しない
      const compareRow: TeamCompareColumnData = {
        key: "",
        label: "",
        boxTotals: {} as TeamCompareColumnData["boxTotals"],
        gamesCount: scoped.length,
        logTotals: { totals, games: scoped.length },
      };
      for (const p of PERSPECTIVES) {
        for (const key of PAINT2_KEYS) {
          const defs = teamCompareDefs("scoring", p);
          assert.equal(defs.filter((d) => d.key === key).length, 1);
          assert.equal(defs.find((d) => d.key === key)!.format(compareRow), paintFormat(s, key, "perGame", p));
        }
      }
      teamScopes++;
    }
    // 期間選択（1Q〜4Q・前半・後半・延長）
    for (const period of ["q1", "q2", "q3", "q4", "h1", "h2", "ot"] as const) {
      const { games, totals } = sumTeamPeriodTotals(source, logs, period);
      const s = paintOf(totals)!;
      assert.equal(s.total, games.length);
      if (s.own.games === s.total && s.total) {
        assert.equal(paintValue(s, "paint2m", "perGame", "own"), totals.paint2m / s.total);
      }
      periodScopes++;
    }
  }
  // リーグ平均（比較ページ）。内訳が揃わないシーズンは「-」、揃うシーズンは値を出す
  const league = read(path.join("data", season, "league-compare.json.gz"));
  for (const gt of GAME_TYPES) {
    const box = league.totals[gt];
    if (!box) continue;
    const totals = teamTotalsFromBoxTotals(box);
    const complete = await verifyLeaguePaint(totals, async () =>
      teamFiles.map((f) => (read(path.join(teamGamesDir, f)) as TeamGameLog[]).filter((g) => gt === "both" || g.gameType === gt)),
    );
    if (gt === "regular") assert.equal(complete, season !== "2017-18");
    const row: TeamCompareColumnData = {
      key: "",
      label: "",
      boxTotals: box,
      gamesCount: league.games[gt],
      isLeague: true,
      paintLeagueComplete: complete,
      logTotals: { totals, games: 1 },
    };
    for (const key of PAINT2_KEYS) {
      const def = teamCompareDefs("scoring", "own").find((d) => d.key === key)!;
      if (complete) assert.notEqual(def.format(row), "-");
      else assert.equal(def.format(row), "-");
    }
  }
}
assert.equal(invalid, 2);
assert.equal(teamScopes, 714);
assert.equal(periodScopes, 1666);
console.log("ok 全11シーズン・714チーム試合区分・1666期間選択：6項目・比較重複なし・有効分母・リーグ平均");
