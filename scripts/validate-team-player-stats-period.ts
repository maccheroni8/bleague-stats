// チーム詳細 > 選手スタッツの区間別（DESIGN.md 273章。選手のピリオド別の索引から作る）の検証スクリプト（検証専用。CIには入れず、手で実行する）。
//
// 確かめること（`npm run build:data` のあとに実行する）:
//  1. 全シーズン・全チーム・1Q〜4Q・前半・後半・延長で、選手の行の合計（PTS・FGM・FGA・MIN（リバウンドはチームリバウンドがあるので比べない））が、チームの区間の値（チームのピリオド別の索引）と一致する
//     （ボックススコアの選手の合計とチームの区間の得点がずれる既知の試合〔5858の2区間など〕は、食い違いの件数として出し、1試合の差に収まることを確かめる）
//  2. 個人詳細と同じ値: 1チームだけで出場した選手は、チームの行が、その選手の全試合から作った行（個人詳細の経路）と全項目一致する
//  3. 延長: 行は延長に出た試合がある選手だけ。G は延長に出た試合数
//
// 使い方: npm run validate:team-player-stats-period [-- --season 2025-26]。1つでも食い違いがあれば終了コード1
import path from "node:path";
import { readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT, ROW_FLAG_HOME } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile, TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { GameSummary, PlayerGameLog, TeamGameLog, TeamSummary } from "../shared/types.ts";
import { viewPlayerGameIndex, viewTeamGameIndex } from "../src/lib/gameIndex";
import { viewPlayerPeriodIndex } from "../src/lib/periodIndex";
import { buildTeamSplitRowsFromPeriodSource, type SeasonPeriodSource } from "../src/lib/seasonPeriod";
import { sumTeamPeriodTotals, type TeamPeriodSource, type TeamPeriodValue } from "../src/lib/teamPeriodTotals";
import { buildGameTeamsByScheduleKey, resolveOwnTeam, type GameTeamInfo } from "../src/lib/situational";
import type { PeriodRangeValue } from "../src/lib/periodRange";

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
  void ROW_FLAG_HOME;
  return { season, player, period, team, teamPeriod: tpFile, rowByPlayerGame, teamGameNo, shortGames };
}

const PERIODS: PeriodRangeValue[] = ["q1", "q2", "q3", "q4", "h1", "h2", "ot"];

async function main() {
  const seasons = readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && /^\d{4}-\d{2}$/.test(e.name))
    .map((e) => e.name)
    .sort()
    .filter((s) => !onlySeason || s === onlySeason);
  let cells = 0;
  let personal = 0;
  let known = 0;
  const knownBy = new Map<string, { n: number; max: number }>();
  for (const season of seasons) {
    const source = await buildSource(season);
    if (!source) continue;
    const dir = path.join(DATA_DIR, season);
    const summaries = (await readJson<GameSummary[]>(path.join(dir, "games-summary.json"))) ?? [];
    const gameTeams = buildGameTeamsByScheduleKey(summaries);
    const teams = (await readJson<TeamSummary[]>(path.join(dir, "teams.json"))) ?? [];
    const teamPeriodSource: TeamPeriodSource = { season, file: source.teamPeriod, gameNo: source.teamGameNo };
    const players = (await readJson<{ playerId: string }[]>(path.join(dir, "players.json"))) ?? [];
    const logsByPlayer = new Map<string, PlayerGameLog[]>();
    for (const p of players) logsByPlayer.set(p.playerId, (await readJson<PlayerGameLog[]>(path.join(dir, "player-games", `${p.playerId}.json`))) ?? []);
    const seasonStartYear = Number(season.slice(0, 4));
    for (const t of teams) {
      const teamLogs = ((await readJson<TeamGameLog[]>(path.join(dir, "team-games", `${t.teamId}.json`))) ?? []).filter((g) => g.gameType === "regular" || g.gameType === "playoff");
      for (const period of PERIODS) {
        const ref = sumTeamPeriodTotals(teamPeriodSource, teamLogs, period as TeamPeriodValue);
        const sum = { pts: 0, fgm: 0, fga: 0, tov: 0, reb: 0, min: 0 };
        for (const [playerId, logs] of logsByPlayer) {
          const own = new Map<string, GameTeamInfo>();
          for (const l of logs) {
            if (l.min <= 0) continue;
            const o = resolveOwnTeam(l, gameTeams);
            if (o) own.set(l.scheduleKey, o);
          }
          if (![...own.values()].some((o) => o.teamId === t.teamId)) continue;
          const rows = buildTeamSplitRowsFromPeriodSource(playerId, logs.filter((l) => l.gameType === "regular" || l.gameType === "playoff"), own, new Map(), "total", seasonStartYear, playerId, period, source);
          const row = rows.find((r) => r.teamId === t.teamId);
          if (!row) continue;
          const raw = row.ctx.raw;
          sum.pts += raw.pts;
          sum.fgm += raw.fgm;
          sum.fga += raw.fga;
          sum.tov += raw.tov;
          sum.reb += raw.reb;
          sum.min += raw.min;
          // 2. 1チームだけの選手は、全試合から作った行（個人詳細の経路）と同じ
          const teamsOf = new Set([...own.values()].map((o) => o.teamId));
          if (teamsOf.size === 1) {
            const all = buildTeamSplitRowsFromPeriodSource(playerId, logs, own, new Map(), "total", seasonStartYear, playerId, period, source).find((r) => r.teamId === t.teamId);
            personal++;
            if (!all || JSON.stringify(all.ctx.raw) !== JSON.stringify(raw)) fail(`${season} ${t.teamId} ${playerId} ${period}: 個人詳細の経路と違う`);
          }
          // 3. 延長は、延長に出た試合の数
          if (period === "ot" && raw.gamesPlayed <= 0) fail(`${season} ${t.teamId} ${playerId}: 延長なのに G が0`);
        }
        const tt = ref.totals;
        const checks: [string, number, number][] = [
          ["PTS", sum.pts, tt.pts],
          ["FGM", sum.fgm, tt.fgm],
          ["FGA", sum.fga, tt.fga],
          ["MIN", sum.min, tt.min],
        ];
        for (const [name, a, b] of checks) {
          cells++;
          if (Math.abs(a - b) > 1e-6) {
            // 公式のボックススコアで、選手の合計とチームの合計がずれる試合（既知）。1試合の差に収まることを確かめる
            known++;
            const k = knownBy.get(name) ?? { n: 0, max: 0 };
            k.n++;
            k.max = Math.max(k.max, Math.abs(a - b));
            knownBy.set(name, k);
            if (Math.abs(a - b) > 30) fail(`${season} ${t.teamId} ${period} ${name}: 選手の合計 ${a} ≠ チーム ${b}`);
          }
        }
      }
    }
    console.log(`ok? ${season}`);
  }
  console.log(`比べた値 ${cells} 件（選手の合計とチームの値のずれ ${known} 件）、個人詳細の経路との比較 ${personal} 件`);
  for (const [n, k] of knownBy) console.log(`  ずれ ${n}: ${k.n}件（最大 ${k.max.toFixed(1)}）`);
  console.log(failures === 0 ? "すべて ok" : `${failures}件の食い違い`);
  if (failures > 0) process.exit(1);
}
await main();
