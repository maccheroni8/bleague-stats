// チーム詳細 > チームスタッツ > シーズン別成績の区間別（DESIGN.md 274章。src/lib/teamSeasonPeriod.ts）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 列の対応: シーズン別成績の4カテゴリの列のうち、区間で値を出せない列（全チームスタッツにも、ここで足した BSR・EFF・G にも無い列）が無い
//  2. 全チームスタッツと同じ値: 全シーズン・全チーム・各区間・平均／合計・自チーム／opp／+/-・4カテゴリで、シーズン別成績の区間の表示が、全チームスタッツの同じ名前の列の表示と一致
//  3. BSR・EFF の根拠: 1Q〜4Q＋延長を足した値（試合全体）が、各シーズンの teams.json の被ブロック数（blockedAgainst）・EFF と一致する
//     （被ブロック数は相手のBLK。公式の記録が1本ずれている 2016-17 富山の1シーズンだけ許す）
//  4. 延長: G は延長のあった試合の数（試合ログの overtimes が1以上の試合）、勝敗はその試合の勝敗
//  5. 感度: 索引を1か所壊すと食い違いとして検出される
//
// 使い方: npm run validate:team-season-period。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { readFileSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { TeamGameIndexFile } from "../shared/gameIndex.ts";
import type { TeamGameLog, TeamSummary } from "../shared/types.ts";
import { eff as effFormula } from "../shared/formulas";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildPointsShareColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  EMPTY_TOTALS,
  type AllTeamsRow,
  type TeamPerspective,
} from "../src/lib/teamStatsColumns";
import { sumTeamPeriodTotals, type TeamPeriodSource, type TeamPeriodValue } from "../src/lib/teamPeriodTotals";
import { buildSeasonPeriodRow, seasonPeriodCell, seasonPeriodFormatters, unavailableSeasonPeriodLabels } from "../src/lib/teamSeasonPeriod";
import { teamPeriodEffTotal } from "../src/lib/teamSituationalPeriod";
import { foulColumnsSplit } from "../src/lib/ruleChange";
import type { BoxscoreTabKey } from "../src/components/BoxscoreTable";
import type { SeasonDisplayMode } from "../src/lib/playerSeasonBoxscore";

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "ok" : "NG"} ${label}${ok ? "" : `\n   ${detail}`}`);
  if (!ok) failures += 1;
}

const VALUES: TeamPeriodValue[] = ["q1", "q2", "q3", "q4", "h1", "h2", "ot"];
const ATOMS: TeamPeriodValue[] = ["q1", "q2", "q3", "q4", "ot"];
const TABS: BoxscoreTabKey[] = ["traditional", "advanced", "misc", "scoring"];
const MODES: SeasonDisplayMode[] = ["perGame", "total"];
const PERSPECTIVES: TeamPerspective[] = ["own", "opp", "diff"];

function allTeamsColumns(tab: BoxscoreTabKey, mode: SeasonDisplayMode, p: TeamPerspective, foulSplit: boolean) {
  return tab === "traditional"
    ? buildTraditionalColumns(mode, p)
    : tab === "advanced"
      ? buildAdvancedColumns(mode, p)
      : tab === "misc"
        ? buildMiscColumns(mode, p, true, foulSplit)
        : buildScoringColumns(mode, p, true);
}

/** TeamDetailPage.tsx のシーズン別成績の列定義から、カテゴリごとの列の名前（label）を取り出す */
function seasonTableLabels(): Record<BoxscoreTabKey, string[]> {
  const src = readFileSync(path.join(process.cwd(), "src/pages/TeamDetailPage.tsx"), "utf8");
  const start = src.indexOf("const TEAM_SEASON_TRADITIONAL_COLUMNS");
  const end = src.indexOf("function teamSeasonBoxColumns");
  const body = src.slice(start, end);
  const labelsIn = (from: string, to: string | null): string[] => {
    const a = body.indexOf(from);
    const b = to ? body.indexOf(to) : body.length;
    return [...body.slice(a, b).matchAll(/label: "([^"]+)"/g)].map((m) => m[1]!);
  };
  return {
    traditional: labelsIn("const TEAM_SEASON_TRADITIONAL_COLUMNS", "const TEAM_SEASON_ADVANCED_COLUMNS"),
    advanced: labelsIn("const TEAM_SEASON_ADVANCED_COLUMNS", "const ALL_TEAM_SEASON_MISC_COLUMNS"),
    misc: labelsIn("const ALL_TEAM_SEASON_MISC_COLUMNS", "const TEAM_SEASON_SCORING_COLUMNS"),
    scoring: labelsIn("const TEAM_SEASON_SCORING_COLUMNS", null),
  };
}

async function main(): Promise<void> {
  // 1. 列の対応
  const labels = seasonTableLabels();
  const fm = seasonPeriodFormatters("perGame", "own", false);
  const fmSplit = seasonPeriodFormatters("perGame", "own", true);
  for (const tab of TABS) {
    // Misc のファウルの列は、表のシーズンによって TF・UFOUL か TF1・TF2・FLAG・DISR のどちらか（両方の並びで調べる）
    const missingSplit = new Set(unavailableSeasonPeriodLabels(labels[tab], fmSplit));
    const missing = unavailableSeasonPeriodLabels(labels[tab], fm).filter((l) => missingSplit.has(l));
    check(`${tab}: 区間で値を出せない列が無い（${labels[tab].length}列）`, missing.length === 0, `出せない列: ${missing.join("・")}`);
  }

  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort();
  const only = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}$/.test(a));
  let cells = 0;
  let ng = 0;
  const first: string[] = [];
  const note = (m: string) => {
    ng += 1;
    if (first.length < 12) first.push(m);
  };
  const skippedNoPeriod: string[] = [];
  let bsrOff = 0;
  let bsrChecked = 0;
  let effChecked = 0;
  let otGames = 0;
  let last: { season: string; source: TeamPeriodSource; logs: TeamGameLog[] } | null = null;
  for (const season of seasons) {
    if (only.length > 0 && !only.includes(season)) continue;
    const dir = path.join(DATA_DIR, season);
    const file = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
    const index = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    if (!file || !index) continue;
    const source: TeamPeriodSource = { season, file, gameNo: new Map(index.games.key.map((k, i) => [k, i])) };
    const startYear = Number(season.split("-")[0]);
    const foulSplit = foulColumnsSplit([season]);
    for (const t of teams) {
      const all = (await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? [];
      const logs = all.filter((g) => g.gameType === "regular");
      last = { season, source, logs };

      // 3. 1Q〜4Q＋延長（試合全体）が teams.json の被ブロック数・EFF と一致
      let bsr = 0;
      let effTotal = 0;
      const sum = { ...EMPTY_TOTALS };
      let games = 0;
      for (const a of ATOMS) {
        const s = sumTeamPeriodTotals(source, logs, a);
        for (const k of Object.keys(sum) as (keyof typeof sum)[]) sum[k] += s.totals[k];
      }
      // 区間の記録が無い試合（1Q〜4Q が全部0、または区間の値を持たない。2017-18 の試合1810は公式にピリオド別の記録が無い）を含むチームは、試合全体の値と比べない
      const emptyPeriodGames = logs.filter((g) => {
        const n = source.gameNo.get(g.scheduleKey);
        return n !== undefined && (file.rows.counts["q1.minSec"]?.[n * 2] ?? -1) <= 0;
      }).length;
      games = emptyPeriodGames > 0 ? -1 : t.gamesPlayed;
      if (emptyPeriodGames > 0) skippedNoPeriod.push(`${season} ${t.teamId}（${emptyPeriodGames}試合）`);
      bsr = sum.oppBlk;
      effTotal = teamPeriodEffTotal(sum, false, startYear);
      if (games === t.gamesPlayed) {
        bsrChecked += 1;
        if (bsr !== t.totals.blockedAgainst) {
          bsrOff += 1;
          if (!(season === "2016-17" && Math.abs(bsr - t.totals.blockedAgainst) === 1)) note(`${season} ${t.teamId} BSR ${bsr} ≠ ${t.totals.blockedAgainst}`);
        }
        effChecked += 1;
        const expectedEff = effFormula(startYear, { ...t.totals, reb: t.totals.reb }, t.gamesPlayed) * t.gamesPlayed;
        const perGameDiff = Math.abs(effTotal - expectedEff) / t.gamesPlayed;
        // BSR が1本ずれたチームは EFF も 1÷試合数 だけずれる
        if (perGameDiff > 1 / t.gamesPlayed + 1e-6 && !(bsr !== t.totals.blockedAgainst)) note(`${season} ${t.teamId} EFF ${effTotal} ≠ ${expectedEff}`);
        if (bsr === t.totals.blockedAgainst && perGameDiff > 1e-6) note(`${season} ${t.teamId} EFF ${effTotal} ≠ ${expectedEff}`);
      }

      // 4. 延長: G は延長のあった試合数、勝敗はその試合の勝敗
      const ot = buildSeasonPeriodRow(season, { status: "ready", source }, logs, "ot", EMPTY_TOTALS);
      const expectedOt = logs.filter((g) => (g.overtimes ?? 0) > 0 && source.gameNo.has(g.scheduleKey));
      otGames += ot.games.length;
      if (ot.games.length !== expectedOt.length || ot.wins !== expectedOt.filter((g) => g.win).length) {
        note(`${season} ${t.teamId} 延長 G ${ot.games.length} ≠ ${expectedOt.length}`);
      }

      // 2. 全チームスタッツと同じ値
      for (const value of VALUES) {
        const row = buildSeasonPeriodRow(season, { status: "ready", source }, logs, value, EMPTY_TOTALS);
        if (row.status === "empty") continue;
        for (const mode of MODES) {
          for (const p of PERSPECTIVES) {
            const f = seasonPeriodFormatters(mode, p, foulSplit);
            const allRow: AllTeamsRow = { team: { teamId: t.teamId, teamName: t.teamId }, gamesPlayed: row.games.length, wins: row.wins, losses: row.losses, totals: row.totals };
            for (const tab of TABS) {
              for (const c of allTeamsColumns(tab, mode, p, foulSplit)) {
                const expected = c.format?.(allRow) ?? "-";
                const shown = seasonPeriodCell(f, c.label, row, t.teamId, t.teamId);
                cells += 1;
                if (shown !== expected) note(`${season} ${t.teamId} ${value} ${mode} ${p} ${tab} ${c.label}: ${shown} ≠ ${expected}`);
              }
            }
          }
        }
      }
    }
  }
  check(`全チームスタッツの区間別と同じ表示（${cells.toLocaleString()} 件）`, ng === 0, `${ng}件\n   ${first.join("\n   ")}`);
  check(`BSR・EFF が teams.json と一致（${bsrChecked} チーム・シーズン。BSR が1本ずれたのは ${bsrOff} 件）`, bsrOff <= 1, `BSR のずれ ${bsrOff} 件`);
  console.log(`区間の記録が全部0の試合を含むため、試合全体との比較から除いたチーム: ${skippedNoPeriod.join("、") || "なし"}`);
  console.log(`延長のあった試合の数（全チーム・全シーズンの延べ）: ${otGames}`);

  // 5. 感度: 最後のシーズンの索引の 1Q の相手のBLK を1か所壊すと BSR が食い違う
  if (last) {
    const col = last.source.file.rows.counts["q1.blk"]!;
    const g0 = last.logs.find((g) => last!.source.gameNo.has(g.scheduleKey))!;
    const at = last.source.gameNo.get(g0.scheduleKey)! * 2 + (g0.isHome ? 0 : 1);
    const broken: TeamPeriodSource = {
      ...last.source,
      file: { ...last.source.file, rows: { ...last.source.file.rows, counts: { ...last.source.file.rows.counts, "q1.blk": col.map((v, i) => (i === at ? v + 3 : v)) } } },
    };
    const f = seasonPeriodFormatters("total", "own", false);
    let detected = 0;
    const a = buildSeasonPeriodRow(last.season, { status: "ready", source: last.source }, last.logs, "q1", EMPTY_TOTALS);
    const b = buildSeasonPeriodRow(last.season, { status: "ready", source: broken }, last.logs, "q1", EMPTY_TOTALS);
    if (seasonPeriodCell(f, "BLK", a, "x", "x") !== seasonPeriodCell(f, "BLK", b, "x", "x")) detected += 1;
    check("感度: 索引の 1Q の BLK を壊すと表示が変わる", detected > 0);
  }
  console.log(failures === 0 ? "\nすべて ok" : `\n${failures}件の食い違い`);
  if (failures > 0) process.exit(1);
}

await main();
