// ランキング（チーム・シーズン成績）に足した列（BSR・EFF・OFF FOUL・CHARGE・LIVETOV 系・登録区分別の得点・Scoring の割合。DESIGN.md 405章）の検証。
// npm run build:data のあとに実行（外のサイトには問い合わせない）。
// 確かめること: ①ランキングの列の値（試合ログの合計＋ピリオド別の索引）が、比較ページの同じ項目の値（試合の生データから数える）と一致する
// （自チーム・opp。レギュラーシーズン・試合全体）。②比較ページのチームの項目すべてに、ランキングの列が対応する（G・MIN・USG% は良し悪しなしで順位なし）。
// ③順位の向きが比較ページの「多いほうが良い」と同じ向き（良し悪しなしを除く）。
// 使い方: npm run validate:team-rank-columns [-- --season 2025-26]（1つでも食い違えば終了コード1）
import fs from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import type { StoredGame, TeamGameLog, YahooGamePbp } from "../shared/types";
import { filterByGameType } from "../shared/gameType";
import { readAllGames, readJson, DATA_DIR } from "./lib/storage";
import { buildTeamMultiGameBoxTotals } from "../src/lib/playerSeasonBoxscore";
import { buildTeamCategoryColumns } from "../src/lib/teamSeasonRanking";
import { sumTeamGameLogs, type AllTeamsRow, type TeamPerspective } from "../src/lib/teamStatsColumns";
import { sumTeamGameFoulTotals } from "../src/lib/teamPeriodTotals";
import { sumSplitClassPoints, teamCompareDefs, type TeamCompareColumnData } from "../src/lib/compareShared";
import { matchRankColumn } from "../src/lib/compareRank";
import { rankDirectionOf } from "../src/lib/rankDirection";
import { foulColumnsSplit } from "../src/lib/ruleChange";
import { splitClassificationSeason } from "../src/lib/classificationFilter";
import type { BoxscoreTabKey } from "../src/components/BoxscoreTable";

const args = process.argv.slice(2);
const only = args.includes("--season") ? args[args.indexOf("--season") + 1] : null;
const SEASONS = only ? [only] : ["2026-27", "2025-26", "2023-24", "2021-22", "2017-18"];
/** 今回足した項目（ランキングの列の値を比較の値と突き合わせる） */
const NEW_KEYS = new Set([
  "bsr", "eff", "offfoul", "charge", "livetov", "livetovpct",
  "japanesePts3", "internationalPts3", "foreignPts3", "naturalizedAsiaPts3",
  "pctforeign3", "pctnaturalizedAsia3", "pct3p", "pctpoutp", "pctft", "pctopa",
]);
/** 比較の表に並ぶが順位を付けない項目（良し悪しなし。値の無い列） */
const NO_RANK_KEYS = new Set(["g", "min", "usg", "paint2games"]);
/** 比較ページには並ぶがランキングには足していない項目（ライブ／デッドを判別できなかったターンオーバーの扱いが違い、同じ値にならない） */
const NOT_ADDED_KEYS = new Set(["deadtov", "deadtovpct"]);
/** 値が少し違うことが分かっている項目と許容（比較は選手の公式 EFF の合計、ランキングはシーズン成績・シチュエーション別成績と同じ式。1試合あたりの差の上限） */
const APPROX_KEYS = new Map<string, number>([["eff", 1.5]]);

const read = (p: string) => JSON.parse(gunzipSync(fs.readFileSync(p)).toString("utf8"));
let failures = 0;
let checked = 0;
const byKey = new Map<string, number>();
function ng(msg: string): void {
  failures += 1;
  const k = /(?:own|opp) (\w+):/.exec(msg)?.[1] ?? "?";
  byKey.set(k, (byKey.get(k) ?? 0) + 1);
  if (failures <= 40) console.error(`NG ${msg}`);
}

async function main(): Promise<void> {
  const seasonsFile: Array<{ season: string; yahooPbp: boolean; coverage?: string }> = read(path.join(DATA_DIR, "seasons.json.gz"));
  for (const season of SEASONS) {
    const dir = path.join(DATA_DIR, season);
    if (!fs.existsSync(path.join(dir, "teams.json.gz"))) continue;
    const entry = seasonsFile.find((s) => s.season === season);
    const yahooPbpSupported = !!entry?.yahooPbp;
    const shotChartSupported = entry?.coverage === "full";
    const rawTeams = read(path.join(dir, "teams.json.gz"));
    const teams: Array<{ teamId: string }> = Array.isArray(rawTeams) ? rawTeams : rawTeams.teams;
    const games = new Map<string, StoredGame>((await readAllGames(season)).map((g) => [g.scheduleKey, g]));
    const yahoo = new Map<string, YahooGamePbp | null>();
    if (yahooPbpSupported) for (const key of games.keys()) yahoo.set(key, await readJson<YahooGamePbp>(path.join(dir, "yahoo", `${key}.json`)));
    const periodFile = read(path.join(dir, "team-period-index.json.gz"));
    const gameIndex = read(path.join(dir, "team-game-index.json.gz"));
    const source = { season, file: periodFile, gameNo: new Map<string, number>((gameIndex.games.key as string[]).map((k, i) => [k, i])) };
    const foulSplit = foulColumnsSplit([season]);
    const context = { seasonStartYear: Number(season.split("-")[0]), classPointsSupported: splitClassificationSeason(season) };
    let seasonChecked = 0;
    for (const t of teams) {
      const f = path.join(dir, "team-games", `${t.teamId}.json.gz`);
      if (!fs.existsSync(f)) continue;
      const logs: TeamGameLog[] = filterByGameType(read(f) as TeamGameLog[], "regular");
      if (logs.length === 0) continue;
      const entries = logs.flatMap((g) => {
        const game = games.get(g.scheduleKey);
        return game ? [{ game, isHome: g.isHome }] : [];
      });
      const yahooTurnovers = new Map(entries.map(({ game }) => [game.scheduleKey, yahoo.get(game.scheduleKey)?.turnovers ?? []]));
      const boxTotals = buildTeamMultiGameBoxTotals(entries, yahooTurnovers, shotChartSupported, yahooPbpSupported);
      if (!boxTotals) continue;
      const foul = sumTeamGameFoulTotals(source, logs);
      const totals = { ...sumTeamGameLogs(logs), ...(foul ?? {}) };
      const row: AllTeamsRow = { team: { teamId: t.teamId, teamName: "" }, gamesPlayed: logs.length, wins: 0, losses: 0, totals };
      const item: TeamCompareColumnData = {
        key: "slot0", label: t.teamId, boxTotals, gamesCount: logs.length,
        logTotals: { totals: sumTeamGameLogs(logs), games: logs.length, classPoints: splitClassificationSeason(season) ? sumSplitClassPoints(logs) : null },
      };
      for (const persp of ["own", "opp"] as TeamPerspective[]) {
        for (const tab of ["traditional", "misc", "scoring", "advanced"] as BoxscoreTabKey[]) {
          const defs = teamCompareDefs(tab, persp, foulSplit);
          const rankTabs: BoxscoreTabKey[] = tab === "scoring" ? ["scoring", "misc", "traditional"] : tab === "traditional" ? ["traditional"] : [tab, "traditional"];
          const cols = rankTabs.flatMap((c) => buildTeamCategoryColumns(c, "perGame", persp, true, true, foulSplit, context));
          for (const def of defs) {
            const col = matchRankColumn(cols, def);
            if (!col) {
              if (!NO_RANK_KEYS.has(def.key) && !NOT_ADDED_KEYS.has(def.key)) ng(`${season} ${tab} ${persp}: 比較の項目 ${def.key}（${def.label}）に対応するランキングの列が無い`);
              continue;
            }
            if (!NEW_KEYS.has(def.key)) continue;
            // 向き: 比較ページの「多いほうが良い」と、ランキングの順位の向きが同じ（良し悪しなしは順位を付けないので除く）
            const dir = rankDirectionOf(col.key, persp);
            if (dir !== "neutral" && (dir === "higher") !== (def.higherIsBetter !== false)) ng(`${tab} ${persp} ${def.key}: 向きが比較（${def.higherIsBetter}）とランキング（${dir}）で違う`);
            const compareFormat = def.format(item);
            const rankFormat = col.format ? col.format(row) : String(col.sortValue(row));
            const rankValue = Number(col.sortValue(row));
            const compareValue = def.value(item);
            checked += 1;
            seasonChecked += 1;
            if (compareFormat === "-" || Number.isNaN(rankValue)) {
              if (compareFormat !== "-" || !Number.isNaN(rankValue)) ng(`${season} ${t.teamId} ${tab} ${persp} ${def.key}: 値の有無が違う（比較 ${compareFormat}／ランキング ${rankFormat}）`);
              continue;
            }
            const tolerance = APPROX_KEYS.get(def.key) ?? 1e-6 * Math.max(1, Math.abs(compareValue));
            if (Math.abs(rankValue - compareValue) > tolerance) {
              ng(`${season} ${t.teamId} ${tab} ${persp} ${def.key}: 比較 ${compareValue}（${compareFormat}）／ランキング ${rankValue}（${rankFormat}）`);
            }
          }
        }
      }
    }
    console.log(`${season}: ${seasonChecked}件を突き合わせ`);
  }
  console.log("項目ごとの不一致:", Object.fromEntries(byKey));
  if (failures > 0) {
    console.error(`validate-team-rank-columns: NG ${failures}件`);
    process.exit(1);
  }
  console.log(`validate-team-rank-columns: OK（${checked}件）`);
}
main();
