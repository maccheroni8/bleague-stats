// シーズン成績のQ別・前後半・延長（src/lib/seasonPeriod.ts。DESIGN.md 256章）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 1Q〜4Q・前半・後半: ピリオド別の索引から組み立てた1試合の値（seasonPeriodTotalsOf）が、以前の生データからの値（computeGamePeriodTotals）と、
//     buildPeriodFilteredRawTotals に通した結果（選手・自チーム・相手・ポゼッション・スタメン）で全選手・全試合一致する。前後半5分の特別な試合は、索引では数えない（null）
//  2. 延長: 延長に出た選手は、生データの延長（ピリオド5以降）の値と一致する。延長の無い試合・延長に出なかった選手は null（数えない）
//  3. 1Q〜4Q・前半・後半で、その試合に出場していればその区間に出ていなくても数える（生データと同じ）こと
//  4. 参考の出力: ランキングで、以前の経路（DNP の試合も数えていた）と試合数が変わる選手の数、延長の掲載基準（3試合以上）を満たす選手の数
//
// 使い方: npm run validate:season-period [-- --season 2025-26]。1つでも食い違いがあれば終了コード1

import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT, ROW_FLAG_HOME } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile, TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { PlayerGameLog, StoredGame } from "../shared/types.ts";
import { viewPlayerGameIndex, viewTeamGameIndex } from "../src/lib/gameIndex";
import { viewPlayerPeriodIndex } from "../src/lib/periodIndex";
import { buildPeriodFilteredRawTotals, computeGamePeriodTotals } from "../src/lib/playerSeasonBoxscore";
import { OVERTIME_MIN_GAMES, SEASON_PERIOD_OPTIONS, overtimeCandidates, seasonPeriodTotalsOf, type SeasonPeriodSource } from "../src/lib/seasonPeriod";
import { readFileSync, readdirSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const args = process.argv.slice(2);
const onlySeason = args.includes("--season") ? args[args.indexOf("--season") + 1] : null;

let failures = 0;
function fail(msg: string) {
  failures++;
  if (failures <= 30) console.log(`  NG ${msg}`);
}

async function buildSource(season: string): Promise<SeasonPeriodSource | null> {
  const dir = path.join(DATA_DIR, season);
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

function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) < 1e-9;
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return a === b;
}

function diffKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !same(a[k], b[k]));
}

/** 選手の試合ログ（DNP の試合を含む。ランキングの以前の経路が数えていた試合） */
function readPlayerLogs(season: string): Map<string, PlayerGameLog[]> {
  const dir = path.join(DATA_DIR, season, "player-games");
  const map = new Map<string, PlayerGameLog[]>();
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json.gz")) continue;
    map.set(f.replace(".json.gz", ""), JSON.parse(gunzipSync(readFileSync(path.join(dir, f))).toString()) as PlayerGameLog[]);
  }
  return map;
}

async function validateSeason(season: string) {
  const source = await buildSource(season);
  if (!source) {
    console.log(`${season}: 索引が無い（スキップ）`);
    return;
  }
  const games: StoredGame[] = await readAllGames(season);
  const byKey = new Map(games.map((g) => [g.scheduleKey, g]));
  const ranges = SEASON_PERIOD_OPTIONS.filter((o) => o.periods !== null);
  let compared = 0;
  let zeroPeriod = 0;
  let otCompared = 0;
  const { file } = source.player;
  for (let i = 0; i < file.rows.player.length; i++) {
    const playerId = file.players[file.rows.player[i]!]![0];
    const key = file.games.key[file.rows.game[i]!]!;
    const game = byKey.get(key);
    if (!game) continue;
    const isHome = (file.rows.flags[i]! & ROW_FLAG_HOME) !== 0;
    for (const option of ranges) {
      const next = seasonPeriodTotalsOf(source, playerId, key, isHome, option.value);
      if (isManualBoxscoreKey(key)) {
        // ピリオド別の選手行が無い手入力の試合（275章）は、どの区間でも値が無い
        if (next !== null) fail(`${season} ${key} ${playerId} ${option.value}: 手入力の試合なのに値がある`);
        continue;
      }
      if (source.shortGames.has(key)) {
        if (next !== null) fail(`${season} ${key} ${playerId} ${option.value}: 特別な試合なのに値がある`);
        continue;
      }
      const prev = computeGamePeriodTotals(game, isHome, playerId, option);
      if (option.value === "ot") {
        const played = !!prev && (prev.player.minSec > 0 || Object.values(prev.player).some((v) => typeof v === "number" && v !== 0));
        if (!next) {
          if (played && prev!.player.minSec > 2) fail(`${season} ${key} ${playerId} 延長: 生データでは出場しているのに索引に行が無い`);
          continue;
        }
        if (!prev) {
          fail(`${season} ${key} ${playerId} 延長: 生データに選手がいない`);
          continue;
        }
        otCompared++;
      } else {
        if (!prev || !next) {
          if (!!prev !== !!next) fail(`${season} ${key} ${playerId} ${option.value}: 片方だけ値がある（生データ ${!!prev}・索引 ${!!next}）`);
          continue;
        }
        if (next.player.minSec === 0) zeroPeriod++;
      }
      compared++;
      const a = buildPeriodFilteredRawTotals([prev]);
      const b = buildPeriodFilteredRawTotals([next]);
      const dRaw = diffKeys(a.raw as unknown as Record<string, unknown>, b.raw as unknown as Record<string, unknown>);
      const dTeam = diffKeys(a.team as unknown as Record<string, unknown>, b.team as unknown as Record<string, unknown>);
      if (dRaw.length > 0 || dTeam.length > 0) {
        fail(`${season} ${key} ${playerId} ${option.value}: 食い違い raw[${dRaw.join(",")}] team[${dTeam.join(",")}] 例: min ${a.raw.min}/${b.raw.min} pts ${a.raw.pts}/${b.raw.pts} 自チームpts ${a.team.pts}/${b.team.pts}`);
      }
    }
  }
  // 参考: ランキングの以前の経路（DNP の試合も、選手がボックススコアにいれば数えていた）と試合数が変わる選手
  const logs = readPlayerLogs(season);
  let changedG = 0;
  for (const [playerId, list] of logs) {
    const dnp = list.filter((l) => !(l.min > 0) && byKey.has(l.scheduleKey) && !source.shortGames.has(l.scheduleKey)).length;
    if (dnp > 0 && playerId) changedG++;
  }
  const otIds = overtimeCandidates(source, OVERTIME_MIN_GAMES);
  console.log(
    `${season}: 比較 ${compared}件（延長 ${otCompared}件・区間に出ていない0の行 ${zeroPeriod}件）。参考: ランキングのQ別で試合数が変わる（DNP の試合を数えなくなる）選手 ${changedG}人、延長に出た試合が${OVERTIME_MIN_GAMES}試合以上の選手 ${otIds.size}人`,
  );
}

const seasons = readdirSync(DATA_DIR).filter((d) => /^\d{4}-\d{2}$/.test(d) && (!onlySeason || d === onlySeason)).sort();
for (const s of seasons) await validateSeason(s);
console.log(failures === 0 ? "OK: 食い違いなし" : `NG: ${failures}件`);
process.exitCode = failures === 0 ? 0 : 1;
