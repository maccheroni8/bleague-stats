// チーム詳細 > チームスタッツ > シチュエーション別成績の区間別（DESIGN.md 273章。src/lib/teamSituationalPeriod.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 全チームスタッツと同じ値: 全シーズン・全チーム・各区間（1Q〜4Q・前半・後半・延長）・平均／合計・自チーム／opp／+/-・4つのカテゴリで、
//     シチュエーション別成績の表の列（teamBoxscoreColumnsFor）のうち、全チームスタッツにも同じ名前の列があるものの表示が、全チームスタッツの表示と一致する
//  2. 数えた試合: 全チームスタッツの区間別と同じ（1Q〜後半は特別な試合を除く全試合、延長は延長のあった試合）
//  3. 索引に無い項目は「-」になる（withIndexUnavailableColumns）。BSR・EFF は索引の合計から出す（274章）
//  4. 感度: 索引を1か所壊すと食い違いとして検出される
//
// 使い方: npm run validate:team-situational-period。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { TeamGameLog, TeamSummary } from "../shared/types.ts";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  type AllTeamsRow,
  type TeamPerspective,
} from "../src/lib/teamStatsColumns";
import { sumTeamPeriodTotals, type TeamPeriodSource, type TeamPeriodValue } from "../src/lib/teamPeriodTotals";
import { INDEX_UNAVAILABLE_COLUMN_KEYS, buildTeamPeriodRowValues, teamPeriodEffTotal, withIndexUnavailableColumns } from "../src/lib/teamSituationalPeriod";
import { teamBoxscoreColumnsFor } from "../src/lib/teamBoxscoreColumns";
import { cleanNumericString, formatColumnDiff } from "../src/lib/compareShared";
import { foulColumnsSplit } from "../src/lib/ruleChange";
import type { BoxscoreTabKey } from "../src/components/BoxscoreTable";
import type { SeasonDisplayMode } from "../src/lib/playerSeasonBoxscore";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const VALUES: TeamPeriodValue[] = ["q1", "q2", "q3", "q4", "h1", "h2", "ot"];
const TABS: BoxscoreTabKey[] = ["traditional", "advanced", "misc", "scoring"];
const MODES: SeasonDisplayMode[] = ["perGame", "total"];
// +/- の視点は、表示の仕方が全チームスタッツと違う（整数への丸め・MIN は自チームの時間）ので、自チームと opp だけ比べる
const PERSPECTIVES: TeamPerspective[] = ["own", "opp"];

function allTeamsColumns(tab: BoxscoreTabKey, mode: SeasonDisplayMode, p: TeamPerspective, foulSplit: boolean) {
  return tab === "traditional"
    ? buildTraditionalColumns(mode, p)
    : tab === "advanced"
      ? buildAdvancedColumns(mode, p)
      : tab === "misc"
        ? buildMiscColumns(mode, p, true, foulSplit)
        : buildScoringColumns(mode, p, true);
}

/**
 * 表示の比較。桁区切りの有無・小数の桁の違い（1桁／2桁／整数）は許して、数値で比べる。
 * +/- の1試合平均・POSS の合計は、シチュエーション別成績では今までも整数（POSS は小数第1位）に丸めて出しているので、0.5 の幅で比べる
 */
function sameDisplay(a: string, b: string, plusMinusAverage: boolean): boolean {
  const clean = (x: string) => x.replace(/,/g, "").replace(/^\+/, "");
  const ca = clean(a);
  const cb = clean(b);
  if (ca === cb) return true;
  if (ca.endsWith("%") !== cb.endsWith("%")) return false;
  const na = Number(ca.replace(/%$/, ""));
  const nb = Number(cb.replace(/%$/, ""));
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
  if (plusMinusAverage) return Math.abs(na - Math.round(nb)) < 1e-9 || Math.abs(na - nb) < 0.5001;
  // 割合は、丸めの境目（ちょうど 0.05 刻みの値）で、1試合平均に直したあとの浮動小数点の誤差により 0.1 だけ違うことがある
  if (ca.endsWith("%") || Number.isInteger(na * 10) !== Number.isInteger(nb * 10)) return Math.abs(na - nb) < 0.1001;
  return Math.abs(na - nb) < 0.1001; // 丸めの境目（元の値は上で厳密に比べている）
}

interface Stats {
  cells: number;
  rawCells: number;
  ng: number;
  first: string[];
  unavailable: Set<string>;
}

function runSeason(season: string, source: TeamPeriodSource, logsByTeam: Map<string, TeamGameLog[]>, stats: Stats, quiet: boolean): void {
  const foulSplit = foulColumnsSplit([season]);
  for (const [teamId, logs] of logsByTeam) {
    for (const value of VALUES) {
      for (const mode of MODES) {
        const values = buildTeamPeriodRowValues(source, logs, value, mode, { shotChartSupported: true, yahooPbpSupported: true });
        const base = sumTeamPeriodTotals(source, logs, value);
        if (!values) {
          if (base.games.length !== 0) {
            stats.ng += 1;
            stats.first.push(`${season} ${teamId} ${value}: 行が作れない（試合 ${base.games.length}）`);
          }
          continue;
        }
        if (values.games.length !== base.games.length) {
          stats.ng += 1;
          stats.first.push(`${season} ${teamId} ${value}: 試合数 ${values.games.length} ≠ ${base.games.length}`);
        }
        const allRow: AllTeamsRow = {
          team: { teamId, teamName: teamId },
          gamesPlayed: base.games.length,
          wins: 0,
          losses: 0,
          totals: base.totals,
        };
        // BSR（相手のBLK）・EFF（シーズン成績と同じ式）は全チームスタッツに列が無いので、索引の合計から直接出した値と比べる（自チーム視点）
        {
          const detail = teamBoxscoreColumnsFor("traditional", foulSplit);
          const bsrCol = detail.find((c) => c.key === "bsr")!;
          const effCol = detail.find((c) => c.key === "eff")!;
          const f = mode === "total" ? 1 : 1 / base.games.length;
          const startYear = Number(season.split("-")[0]);
          const { own, ownCtx } = values.boxTotals;
          const bsrOk = Math.abs((bsrCol.value?.(own, ownCtx) as number) - base.totals.oppBlk * f) < 1e-6;
          const effOk = Math.abs((effCol.value?.(own, ownCtx) as number) - teamPeriodEffTotal(base.totals, false, startYear) * f) < 1e-6;
          stats.rawCells += 2;
          if (!bsrOk || !effOk) {
            stats.ng += 1;
            if (stats.first.length < 12) stats.first.push(`${season} ${teamId} ${value} ${mode}: BSR/EFF が索引の合計と違う`);
          }
        }
        for (const tab of TABS) {
          const detailCols = withIndexUnavailableColumns(teamBoxscoreColumnsFor(tab, foulSplit));
          for (const p of PERSPECTIVES) {
            const refCols = allTeamsColumns(tab, mode, p, foulSplit);
            const refByLabel = new Map(refCols.map((c) => [c.label, c]));
            for (const col of detailCols) {
              if (INDEX_UNAVAILABLE_COLUMN_KEYS.has(col.key)) {
                stats.unavailable.add(col.label);
                if (col.format(values.boxTotals.own, values.boxTotals.ownCtx) !== "-") {
                  stats.ng += 1;
                  stats.first.push(`${season} ${teamId} ${value} ${tab} ${col.label}: 「-」でない`);
                }
                continue;
              }
              const ref = refByLabel.get(col.label);
              if (!ref) continue;
              const { own, opp, ownCtx, oppCtx } = values.boxTotals;
              const shown =
                p === "own"
                  ? cleanNumericString(col.format(own, ownCtx))
                  : p === "opp"
                    ? cleanNumericString(col.format(opp, oppCtx))
                    : formatColumnDiff(col, own, ownCtx, opp, oppCtx);
              // AST/TOV は TOV が0のとき定義が違う（シチュエーション別成績は AST の数、全チームスタッツは0）。この場合は比べない
              if (col.key === "asttov" && (p === "own" ? base.totals.tov : base.totals.oppTov) === 0) continue;
              // 元の値（丸める前）の比較。列によって単位が違う（MIN は秒／分、割合は 0〜1／0〜100）ので、その倍率は許す
              const rawA = col.value?.(p === "own" ? own : opp, p === "own" ? ownCtx : oppCtx);
              const rawB = ref.sortValue(allRow);
              if (typeof rawA === "number" && typeof rawB === "number") {
                stats.rawCells += 1;
                // MIN は秒に丸めた値（1試合平均は scaleCounts が秒に丸める）なので、0.5秒までの違いは許す
                const ok =
                  [1, 60, 100, 1 / 60, 1 / 100].some((k) => Math.abs(rawA * k - rawB) <= 1e-7 * Math.max(1, Math.abs(rawB))) ||
                  (col.key === "min" && Math.abs(rawA / 60 - rawB) <= 0.5 / 60 + 1e-9);
                if (!ok) {
                  stats.ng += 1;
                  if (stats.first.length < 12) stats.first.push(`${season} ${teamId} ${value} ${mode} ${p} ${tab} ${col.label}: 元の値 ${rawA} ≠ ${rawB}`);
                }
              }
              const expected = ref.format?.(allRow) ?? "-";
              stats.cells += 1;
              if (!sameDisplay(shown, expected, (col.key === "plusminus" && mode === "perGame") || (col.key === "poss" && mode === "total"))) {
                stats.ng += 1;
                if (stats.first.length < 12) stats.first.push(`${season} ${teamId} ${value} ${mode} ${p} ${tab} ${col.label}: ${shown} ≠ ${expected}`);
              }
            }
          }
        }
      }
    }
  }
  if (!quiet) check(`${season}: 全チームスタッツの区間別と同じ表示（${logsByTeam.size}チーム）`, stats.ng === 0, `${stats.ng}件\n   ${stats.first.slice(0, 6).join("\n   ")}`);
}

async function main(): Promise<void> {
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const only = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  const total: Stats = { cells: 0, rawCells: 0, ng: 0, first: [], unavailable: new Set() };
  let last: { season: string; source: TeamPeriodSource; logsByTeam: Map<string, TeamGameLog[]> } | null = null;
  for (const season of seasons) {
    if (only.length > 0 && !only.includes(season)) continue;
    const dir = path.join(DATA_DIR, season);
    const file = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
    const index = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    if (!file || !index) continue;
    const source: TeamPeriodSource = { season, file, gameNo: new Map(index.games.key.map((k, i) => [k, i])) };
    const logsByTeam = new Map<string, TeamGameLog[]>();
    for (const t of teams) {
      const logs = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
      logsByTeam.set(t.teamId, logs.filter((g) => g.gameType === "regular" || g.gameType === "playoff"));
    }
    runSeason(season, source, logsByTeam, total, false);
    last = { season, source, logsByTeam };
  }
  console.log(`比べた表示: ${total.cells.toLocaleString()} 件（元の値の比較 ${total.rawCells.toLocaleString()} 件）。索引に無いため「-」の列: ${[...total.unavailable].join("・")}`);
  if (last) {
    // 感度: 最後のシーズンの索引の 2Q の PITP を1か所壊す
    const col = last.source.file.rows.counts["q2.pt2in"]!;
    const at = col.findIndex((v) => v > 0);
    const broken: TeamPeriodSource = {
      ...last.source,
      file: { ...last.source.file, rows: { ...last.source.file.rows, counts: { ...last.source.file.rows.counts, "q2.pt2in": col.map((v, i) => (i === at ? v + 5 : v)) } } },
    };
    // 壊した索引の行は、元の索引から作った全チームスタッツ側の値と食い違う
    const sens: Stats = { cells: 0, rawCells: 0, ng: 0, first: [], unavailable: new Set() };
    const logsByTeam = last.logsByTeam;
    const foulSplit = foulColumnsSplit([last.season]);
    for (const [teamId, logs] of logsByTeam) {
      const brokenValues = buildTeamPeriodRowValues(broken, logs, "q2", "total", { shotChartSupported: true, yahooPbpSupported: true });
      const ref = sumTeamPeriodTotals(last.source, logs, "q2");
      if (!brokenValues) continue;
      const row: AllTeamsRow = { team: { teamId, teamName: teamId }, gamesPlayed: ref.games.length, wins: 0, losses: 0, totals: ref.totals };
      const col2 = teamBoxscoreColumnsFor("misc", foulSplit).find((c) => c.key === "pitp")!;
      const refCol = buildMiscColumns("total", "own", true, foulSplit).find((c) => c.label === "PITP")!;
      if (cleanNumericString(col2.format(brokenValues.boxTotals.own, brokenValues.boxTotals.ownCtx)) !== cleanNumericString(refCol.format?.(row) ?? "")) sens.ng += 1;
    }
    check(`感度: ${last.season} の 2Q の PITP を1か所壊すと検出される（${sens.ng}チーム）`, sens.ng > 0);
  }
  console.log(failures === 0 && total.ng === 0 ? "\nすべて ok" : `\n${failures + total.ng}件の食い違い\n${total.first.join("\n")}`);
  if (failures > 0 || total.ng > 0) process.exit(1);
}

await main();
