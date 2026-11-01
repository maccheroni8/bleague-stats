// チーム詳細の「Q別」タブ（src/lib/teamQuarterSplit.ts）の検証スクリプト（検証専用。`npm run build:data` のあとに実行する）。
//
// 確かめること:
//  1. 全チームスタッツと同じ値: 全シーズン・全チーム・7つの区間・平均／合計で、上の表の得点・失点・得失点・ORtg・DRtg・NetRtg が、
//     全チームスタッツの同じ区間の列（PTS の自チーム／opp／+/-、ORtg、DRtg、NetRtg）の表示と一致する
//  2. 足し合わせ: 区間の記録がある試合について、1Q〜4Q＋延長の得点の合計が試合の得点と一致し、前半＝1Q＋2Q、後半＝3Q＋4Q（得点・失点・攻撃回数）
//  3. 延長: 試合数は延長のあった試合（試合ログの overtimes が1以上）の数。延長が無ければ全部「-」
//  4. レーティング: 合計の得点と攻撃回数を足してから割った値（試合ごとの率の平均ではない）。NetRtg は丸める前の ORtg−DRtg
//
// 使い方: npm run validate:team-quarter。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { TeamGameLog, TeamSummary } from "../shared/types.ts";
import { offensiveRating } from "../shared/formulas";
import { formatDecimal, formatSigned } from "../src/lib/format";
import { buildAdvancedColumns, buildTraditionalColumns, type AllTeamsRow, type TeamPerspective } from "../src/lib/teamStatsColumns";
import type { TeamPeriodSource } from "../src/lib/teamPeriodTotals";
import { buildQuarterRows, quarterScoreCells, QUARTER_ROWS } from "../src/lib/teamQuarterSplit";
import type { SeasonDisplayMode } from "../src/lib/playerSeasonBoxscore";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const MODES: SeasonDisplayMode[] = ["perGame", "total"];

async function main(): Promise<void> {
  const only = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name) && (only.length === 0 || only.includes(e.name)))
    .map((e) => e.name)
    .sort();
  let cells = 0;
  let ng = 0;
  const first: string[] = [];
  const note = (m: string) => {
    ng += 1;
    if (first.length < 12) first.push(m);
  };
  let ngSum = 0;
  const firstSum: string[] = [];
  const noteSum = (m: string) => {
    ngSum += 1;
    if (firstSum.length < 12) firstSum.push(m);
  };
  let sumChecked = 0;
  let otChecked = 0;
  let ratingChecked = 0;
  let utsunomiya: string[] = [];
  const otRanking: { season: string; team: string; games: number }[] = [];
  for (const season of seasons) {
    const dir = path.join(DATA_DIR, season);
    const file = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
    const index = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    if (!file || !index) continue;
    const source: TeamPeriodSource = { season, file, gameNo: new Map(index.games.key.map((k, i) => [k, i])) };
    for (const t of teams) {
      const all = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
      for (const gameType of ["regular", "all"] as const) {
        const logs = gameType === "regular" ? all.filter((g) => g.gameType === "regular") : all;
        const rows = buildQuarterRows(season, source, false, logs);
        const byValue = new Map(rows.map((r) => [r.value, r]));

        // 1. 全チームスタッツと同じ値、4. レーティング
        for (const r of rows) {
          for (const mode of MODES) {
            const cellsOf = quarterScoreCells(r, mode);
            if (r.status !== "ready") {
              if (Object.values(cellsOf).some((v) => v !== "-")) note(`${season} ${t.teamId} ${r.value}: 値が無い行が「-」でない`);
              continue;
            }
            const allRow: AllTeamsRow = { team: { teamId: t.teamId, teamName: t.teamId }, gamesPlayed: r.games.length, wins: r.wins, losses: r.losses, totals: r.totals };
            const fmt = (cols: ReturnType<typeof buildTraditionalColumns>, label: string) => cols.find((c) => c.label === label)?.format?.(allRow) ?? "?";
            const trad = (p: TeamPerspective) => buildTraditionalColumns(mode, p);
            const adv = buildAdvancedColumns(mode, "own");
            const expected = {
              pts: fmt(trad("own"), "PTS"),
              oppPts: fmt(trad("opp"), "PTS"),
              diff: fmt(trad("diff"), "PTS"),
              ortg: fmt(adv, "ORtg"),
              drtg: fmt(adv, "DRtg"),
              netRtg: fmt(adv, "NetRtg"),
            };
            for (const k of Object.keys(expected) as (keyof typeof expected)[]) {
              cells += 1;
              if (cellsOf[k] !== expected[k]) note(`${season} ${t.teamId} ${gameType} ${r.value} ${mode} ${k}: ${cellsOf[k]} ≠ ${expected[k]}`);
            }
            // 合計の得点・失点・攻撃回数から直接出した値と一致（試合ごとの率の平均ではない）
            const { pts, oppPts, poss } = r.totals;
            if (poss > 0) {
              ratingChecked += 1;
              const o = offensiveRating(pts, poss);
              const d = offensiveRating(oppPts, poss);
              if (cellsOf.ortg !== formatDecimal(o) || cellsOf.drtg !== formatDecimal(d) || cellsOf.netRtg !== formatSigned(o - d)) {
                note(`${season} ${t.teamId} ${gameType} ${r.value}: レーティングが合計から割った値と違う`);
              }
            }
          }
        }

        // 2. 足し合わせ（1Q の行に入る試合＝区間の記録がある試合で比べる）
        const q1 = byValue.get("q1")!;
        if (q1.status === "ready") {
          const counted = new Set(q1.games.map((g) => g.scheduleKey));
          const gameScore = q1.games.reduce((s, g) => s + g.teamScore, 0);
          const gameOpp = q1.games.reduce((s, g) => s + g.opponentScore, 0);
          const tot = (v: string, k: "pts" | "oppPts" | "poss") => {
            const r = byValue.get(v as never)!;
            return r.status === "ready" ? r.totals[k] : 0;
          };
          sumChecked += 1;
          const regPts = ["q1", "q2", "q3", "q4", "ot"].reduce((s, v) => s + tot(v, "pts"), 0);
          const regOpp = ["q1", "q2", "q3", "q4", "ot"].reduce((s, v) => s + tot(v, "oppPts"), 0);
          if (regPts !== gameScore || regOpp !== gameOpp) noteSum(`${season} ${t.teamId} ${gameType}: 1Q〜4Q＋延長 ${regPts}-${regOpp} ≠ 試合 ${gameScore}-${gameOpp}`);
          for (const k of ["pts", "oppPts"] as const) {
            if (tot("h1", k) !== tot("q1", k) + tot("q2", k) || tot("h2", k) !== tot("q3", k) + tot("q4", k)) noteSum(`${season} ${t.teamId} ${gameType}: 前半・後半 ${k} が 1Q+2Q／3Q+4Q と違う`);
          }
          // 3. 延長
          const ot = byValue.get("ot")!;
          const expectedOt = logs.filter((g) => counted.has(g.scheduleKey) && (g.overtimes ?? 0) > 0);
          otChecked += 1;
          if (ot.status === "ready" ? ot.games.length !== expectedOt.length : expectedOt.length !== 0) {
            noteSum(`${season} ${t.teamId} ${gameType}: 延長の試合数 ${ot.games.length} ≠ ${expectedOt.length}`);
          }
          if (ot.status !== "ready" && Object.values(quarterScoreCells(ot, "perGame")).some((v) => v !== "-")) noteSum(`${season} ${t.teamId}: 延長なしが「-」でない`);
          if (gameType === "regular" && ot.status === "ready") otRanking.push({ season, team: t.teamId, games: ot.games.length });
        }
        if (season === "2026-27" && gameType === "regular" && /宇都宮|utsunomiya/i.test(t.teamName ?? "")) {
          utsunomiya = rows.map((r) => `${r.label} ${r.status === "ready" ? `${r.games.length}試合 ${Object.values(quarterScoreCells(r, "perGame")).join(" / ")}` : r.status}`);
        }
      }
    }
  }
  check(`上の表が全チームスタッツの同じ区間の列と一致（${cells.toLocaleString()} 件）／レーティングは合計から割った値（${ratingChecked} 行）`, ng === 0, `${ng}件\n   ${first.join("\n   ")}`);
  check(`1Q〜4Q＋延長＝試合の得点、前半＝1Q＋2Q、後半＝3Q＋4Q、延長の試合数（${sumChecked}・${otChecked} チーム・条件）`, ngSum === 0, `${ngSum}件\n   ${firstSum.join("\n   ")}`);
  console.log("宇都宮 2026-27 レギュラー（平均）:\n  " + (utsunomiya.join("\n  ") || "見つからない"));
  otRanking.sort((a, b) => b.games - a.games);
  console.log("延長のあった試合が多いチーム・シーズン: " + otRanking.slice(0, 5).map((o) => `${o.season} ${o.team}（${o.games}試合）`).join("、"));
  console.log(`行: ${QUARTER_ROWS.map((q) => q.label).join("・")}`);
  if (failures > 0) {
    console.log(`\n${failures} 件の検証が失敗しました`);
    process.exit(1);
  }
  console.log("\nすべて通りました");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
