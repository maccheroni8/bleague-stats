// 全選手スタッツの Q別・前後半・延長・クラッチ（src/lib/playersListPeriod.ts。設計書376章）の検証スクリプト
// （検証専用。CIには入れず、`npm run build:data` のあとに手で実行する。validate:all には自動で入る）。
//
// 確かめること（B.PREMIER 全シーズン・B.ONE 2026-27、全選手、レギュラー／ポストシーズン／合算）:
//  1. ランキング（個人・シーズン成績。usePlayerSeasonRanking）と同じ値: 試合ごとに seasonPeriodTotalsOf を足す経路と、全選手スタッツの行（playersListPeriodCtx）が、
//     すべてのタブの列（Traditional・Advanced・Misc・Scoring。平均・合計とも）で一致する
//  2. 個人詳細の Q別タブ（出場時間のある試合だけを足す経路）と同じ試合数・同じ値（G と主な項目）
//  3. 足し合わせ: 1Q〜4Q＋延長の得点＝試合全体の得点（前後半5分の特別な試合・手入力の試合は除く）、前半＝1Q＋2Q、後半＝3Q＋4Q
//  4. G: 1Q〜4Q・前半・後半は出場した試合の数、延長・クラッチは区間の値がある試合の数。掲載基準（延長・クラッチ3試合、それ以外1試合）の判定が行の G と一致する
//  5. クラッチの被ファウル（FD）は「-」、DD2・TD3・PTS10 は区間では出さない
// 使い方: npm run validate:players-period [-- --season 2025-26]。1つでも食い違いがあれば終了コード1
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile, TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { PlayerGameLog } from "../shared/types.ts";
import { viewPlayerGameIndex, viewTeamGameIndex } from "../src/lib/gameIndex";
import { viewPlayerPeriodIndex } from "../src/lib/periodIndex";
import {
  SEASON_BOX_TABS,
  buildPeriodFilteredRawTotals,
  buildSeasonBoxscoreCtx,
  filterByGameType,
  seasonBoxColumnsFor,
  type GamePeriodTotals,
  type SeasonGameTypeFilter,
} from "../src/lib/playerSeasonBoxscore";
import { SEASON_PERIOD_OPTIONS, OVERTIME_MIN_GAMES, seasonPeriodTotalsOf, buildPeriodCtxForLogs, type SeasonPeriodSource } from "../src/lib/seasonPeriod";
import { isPeriodSelected, periodRowMeetsMinimum, periodRowMinGames, playersListPeriodCtx } from "../src/lib/playersListPeriod";
import type { PeriodRangeValue } from "../src/lib/periodRange";

const args = process.argv.slice(2);
const onlySeason = args.includes("--season") ? args[args.indexOf("--season") + 1] : null;

let failures = 0;
function fail(msg: string) {
  failures++;
  if (failures <= 40) console.log(`  NG ${msg}`);
}

const rj = (p: string) => {
  if (existsSync(p)) return JSON.parse(readFileSync(p, "utf8"));
  if (existsSync(p + ".gz")) return JSON.parse(gunzipSync(readFileSync(p + ".gz")).toString("utf8"));
  return null;
};

async function buildSource(season: string, dir: string): Promise<SeasonPeriodSource | null> {
  const pFile = await readJson<PlayerGameIndexFile>(path.join(dir, "player-game-index.json"));
  const tFile = await readJson<TeamGameIndexFile>(path.join(dir, "team-game-index.json"));
  const ppFile = await readJson<PlayerPeriodIndexFile>(path.join(dir, "player-period-index.json"));
  const tpFile = await readJson<TeamPeriodIndexFile>(path.join(dir, "team-period-index.json"));
  if (!pFile || !tFile || !ppFile || !tpFile) return null;
  const player = viewPlayerGameIndex(pFile);
  const team = viewTeamGameIndex(tFile);
  const period = viewPlayerPeriodIndex(ppFile, player);
  if (!period || tpFile.indexRows !== team.size) return null;
  const rowByPlayerGame = new Map<string, number>();
  for (let i = 0; i < pFile.rows.player.length; i++) rowByPlayerGame.set(`${pFile.players[pFile.rows.player[i]!]![0]}|${pFile.games.key[pFile.rows.game[i]!]}`, i);
  const teamGameNo = new Map<string, number>();
  const shortGames = new Set<string>();
  tFile.games.key.forEach((k, i) => {
    teamGameNo.set(k, i);
    if ((tFile.games.flags[i]! & GAME_FLAG_SHORT) !== 0) shortGames.add(k);
  });
  return { season, player, period, team, teamPeriod: tpFile, rowByPlayerGame, teamGameNo, shortGames };
}

const GAME_TYPES: SeasonGameTypeFilter[] = ["regular", "playoff", "both"];
const PERIODS: PeriodRangeValue[] = SEASON_PERIOD_OPTIONS.map((o) => o.value).filter((v) => v !== "all");
const same = (a: number, b: number) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) < 1e-9;
const stats = { files: 0, rows: 0, columnChecks: 0, detail: 0, sums: 0, minimum: 0 };

async function validateDir(label: string, season: string, dir: string, league: "premier" | "one") {
  const source = await buildSource(season, dir);
  if (!source) {
    console.log(`${label}: 索引が無い（スキップ）`);
    return;
  }
  const year = Number(season.split("-")[0]);
  const foulSplit = year >= 2026;
  const columns = SEASON_BOX_TABS.flatMap((t) => seasonBoxColumnsFor(t.key, foulSplit));
  const pgDir = path.join(dir, "player-games");
  const ids = readdirSync(pgDir)
    .filter((f) => /\.json(\.gz)?$/.test(f))
    .map((f) => f.replace(/\.json(\.gz)?$/, ""));
  for (const playerId of ids) {
    const logs: PlayerGameLog[] = rj(path.join(pgDir, `${playerId}.json`)) ?? [];
    if (logs.length === 0) continue;
    stats.files++;
    const tag = `${label} ${playerId}`;
    for (const gameType of GAME_TYPES) {
      const scoped = filterByGameType(logs, gameType);
      if (scoped.length === 0) continue;
      const pts: Record<string, number> = {};
      for (const period of PERIODS) {
        // 1. ランキングと同じ経路（試合ごとに seasonPeriodTotalsOf を足す）
        const contributions: GamePeriodTotals[] = [];
        for (const log of scoped) {
          const c = seasonPeriodTotalsOf(source, playerId, log.scheduleKey, log.isHome, period);
          if (c) contributions.push(c);
        }
        const rank = contributions.length > 0 ? (() => { const { raw, team } = buildPeriodFilteredRawTotals(contributions); return buildSeasonBoxscoreCtx(raw, team, "perGame", year); })() : null;
        const list = playersListPeriodCtx(playerId, scoped, period, source, "perGame", year);
        const listTotal = playersListPeriodCtx(playerId, scoped, period, source, "total", year);
        stats.rows++;
        if (!!rank !== !!list) {
          fail(`${tag} ${gameType} ${period}: 行の有無がランキングと違う`);
          continue;
        }
        if (!list || !rank || !listTotal) {
          // 4. 値のある試合が無い → 掲載基準に届かない
          if (periodRowMeetsMinimum(list, period)) fail(`${tag} ${gameType} ${period}: 値が無いのに掲載基準に届く`);
          continue;
        }
        for (const col of columns) {
          stats.columnChecks++;
          const a = col.value(rank, "perGame");
          const b = col.value(list, "perGame");
          if (!same(a, b)) fail(`${tag} ${gameType} ${period} ${col.key}: ランキング ${a} ≠ 全選手 ${b}`);
          const c = col.value(buildSeasonBoxscoreCtx(buildPeriodFilteredRawTotals(contributions).raw, buildPeriodFilteredRawTotals(contributions).team, "total", year), "total");
          const d = col.value(listTotal, "total");
          if (!same(c, d)) fail(`${tag} ${gameType} ${period} ${col.key}(合計): ランキング ${c} ≠ 全選手 ${d}`);
        }
        // 2. 個人詳細の Q別タブと同じ（出場時間のある試合だけを足す）
        const detail = buildPeriodCtxForLogs(scoped.filter((g) => g.min > 0), playerId, period, source, "perGame", year);
        stats.detail++;
        if (!detail) fail(`${tag} ${gameType} ${period}: 個人詳細の経路では行が無い（全選手には ${list.raw.gamesPlayed} 試合）`);
        else {
          if (detail.raw.gamesPlayed !== list.raw.gamesPlayed) fail(`${tag} ${gameType} ${period}: G 個人詳細 ${detail.raw.gamesPlayed} ≠ 全選手 ${list.raw.gamesPlayed}`);
          for (const k of ["pts", "min", "fgm", "fga", "ast", "tov"] as const) {
            const x = (detail.raw as unknown as Record<string, number>)[k]!;
            const y = (list.raw as unknown as Record<string, number>)[k]!;
            if (!same(x, y)) fail(`${tag} ${gameType} ${period} ${k}: 個人詳細 ${x} ≠ 全選手 ${y}`);
          }
        }
        // 5. クラッチの被ファウルは「-」
        if (period === "clutch") {
          const fd = columns.find((c) => c.key === "fd");
          if (fd && !Number.isNaN(fd.value(list, "perGame"))) fail(`${tag} ${gameType} クラッチの FD が「-」でない`);
        }
        // 4. 掲載基準
        stats.minimum++;
        if (periodRowMeetsMinimum(list, period) !== list.raw.gamesPlayed >= periodRowMinGames(period)) fail(`${tag} ${gameType} ${period}: 掲載基準の判定が G と合わない`);
        if ((period === "ot" || period === "clutch") && periodRowMinGames(period) !== OVERTIME_MIN_GAMES) fail(`${period}: 掲載基準が3試合でない`);
        pts[period] = (list.raw as unknown as Record<string, number>).pts!;
        if (!isPeriodSelected(period)) fail(`${period}: 区間として扱われない`);
      }
      // 3. 足し合わせ
      const eligible = scoped.filter((g) => g.min > 0 && !source.shortGames.has(g.scheduleKey) && !isManualBoxscoreKey(g.scheduleKey));
      const whole = eligible.reduce((s, g) => s + g.pts, 0);
      const parts = ["q1", "q2", "q3", "q4", "ot"].reduce((s, v) => s + (pts[v] ?? 0), 0);
      stats.sums++;
      if (parts !== whole) fail(`${tag} ${gameType}: 1Q〜4Q＋延長 ${parts} ≠ 試合全体 ${whole}`);
      if ((pts.h1 ?? 0) !== (pts.q1 ?? 0) + (pts.q2 ?? 0)) fail(`${tag} ${gameType}: 前半 ≠ 1Q+2Q`);
      if ((pts.h2 ?? 0) !== (pts.q3 ?? 0) + (pts.q4 ?? 0)) fail(`${tag} ${gameType}: 後半 ≠ 3Q+4Q`);
    }
  }
  console.log(`${label}: 選手 ${ids.length} 人 確認済み`);
}

const seasons = readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d) && (!onlySeason || d === onlySeason)).sort();
for (const season of seasons) {
  await validateDir(`${season}`, season, path.join(DATA_DIR, season), "premier");
  if (existsSync(path.join(DATA_DIR, season, "one", "player-games"))) await validateDir(`${season} B.ONE`, season, path.join(DATA_DIR, season, "one"), "one");
}
console.log(`確認: 選手ファイル ${stats.files}・区間の行 ${stats.rows}・列の比較 ${stats.columnChecks}・個人詳細との比較 ${stats.detail}・足し合わせ ${stats.sums}・掲載基準 ${stats.minimum}`);
if (failures > 0) {
  console.log(`NG ${failures} 件`);
  process.exit(1);
}
console.log("OK");
