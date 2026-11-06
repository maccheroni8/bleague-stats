// 個人詳細の「Q別」タブ（src/lib/playerQuarterSplit.ts の buildPlayerQuarterRows）と、シーズン別成績の「勝敗」「勝率」の検証スクリプト
// （検証専用。CIには入れず、手で実行する。`npm run build:data` のあとに実行する）。
//
// 確かめること（全シーズン・全選手・レギュラー／ポストシーズン／合算）:
//  1. 足し合わせ: 1Q〜4Q＋延長の得点が、その選手の試合全体の得点（試合ログ）と一致する（前後半5分の特別な試合と手入力の試合は区間の値が無いので除く）。
//     前半＝1Q＋2Q、後半＝3Q＋4Q（得点・出場時間・アシスト・リバウンドなど）
//  2. シチュエーション別成績と同じ値: 「勝った試合」「負けた試合」に分けて同じ区間を集計したもの（シチュエーション別成績の経路）を足すと、Q別タブの行（移籍した選手は「複数チーム」の行）と一致する
//  3. G: 1Q〜4Q・前半・後半はその試合に出場した試合の数、延長は延長に出た試合の数（ピリオド別の索引の延長の行がある試合）。平均の分母と同じ
//  4. 生データとの照合（--raw-seasons で指定したシーズン。既定は最新と 2017-18）: 区間の値を生データから出した値（computeGamePeriodTotals）と、タブの行（合算の行）の主な項目が一致する
//  5. 勝敗: 本人が出場した試合のチームの勝敗が、チームの試合ログ（所属チームの TeamGameLog.win）から数えた値と一致する（移籍した選手の合計の行・チームごとの行を含む）。
//     区間を選んだときの勝敗の合計は、その区間の G と一致する。勝率は 勝÷(勝＋敗)
//
// 使い方: npm run validate:player-quarter [-- --raw-seasons 2026-27,2017-18] [--season 2025-26]。1つでも食い違いがあれば終了コード1
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { isManualBoxscoreKey } from "./lib/manualBoxscores.ts";
import { DATA_DIR, readAllGames, readJson } from "./lib/storage.ts";
import type { PlayerGameIndexFile, TeamGameIndexFile } from "../shared/gameIndex.ts";
import { GAME_FLAG_SHORT } from "../shared/gameIndex.ts";
import type { PlayerPeriodIndexFile, TeamPeriodIndexFile } from "../shared/periodIndex.ts";
import type { PlayerGameLog, StoredGame, TeamGameLog } from "../shared/types.ts";
import { viewPlayerGameIndex, viewTeamGameIndex } from "../src/lib/gameIndex";
import { viewPlayerPeriodIndex } from "../src/lib/periodIndex";
import {
  buildPeriodFilteredRawTotals,
  computeGamePeriodTotals,
  filterByGameType,
  type SeasonGameTypeFilter,
} from "../src/lib/playerSeasonBoxscore";
import { SEASON_PERIOD_OPTIONS, buildTeamSplitRowsFromPeriodSource, seasonPeriodTotalsOf, type SeasonPeriodSource } from "../src/lib/seasonPeriod";
import { PLAYER_QUARTER_ROWS, buildPlayerQuarterRows, formatPlayerRecord, formatPlayerWinPct, playerRecordOfLogs } from "../src/lib/playerQuarterSplit";
import { buildGameTeamsByScheduleKey, resolveOwnTeam, type GameTeamInfo } from "../src/lib/situational";
import { sumTeamTotalsForLogs } from "../src/lib/playerSeasonBoxscore";

const args = process.argv.slice(2);
const argOf = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const onlySeason = argOf("--season");

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

const RAW_KEYS = ["pts", "min", "fgm", "fga", "tpm", "tpa", "ftm", "fta", "oreb", "dreb", "reb", "ast", "tov", "stl", "blk", "pf"] as const;
const GAME_TYPES: SeasonGameTypeFilter[] = ["regular", "playoff", "both"];
const rawOf = (c: { raw: unknown }) => c.raw as Record<string, number>;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const stats = { players: 0, transferred: 0, rowsChecked: 0, gameSums: 0, situational: 0, rawGames: 0, records: 0, otPlayers: 0 };
const examples: string[] = [];
let otZeroRows = 0;

async function validateSeason(season: string, rawSeason: boolean) {
  const source = await buildSource(season);
  const summaries = rj(path.join(DATA_DIR, season, "games-summary.json"));
  if (!source || !summaries) {
    console.log(`${season}: 索引が無い（スキップ）`);
    return;
  }
  const gameTeams = buildGameTeamsByScheduleKey(summaries);
  const playersMeta: { playerId: string; name: string }[] = rj(path.join(DATA_DIR, season, "players.json")) ?? [];
  const nameOf = new Map(playersMeta.map((p) => [p.playerId, p.name]));
  const teamLogsCache = new Map<string, TeamGameLog[]>();
  const teamLogsOf = (teamId: string) => {
    if (!teamLogsCache.has(teamId)) teamLogsCache.set(teamId, rj(path.join(DATA_DIR, season, "team-games", `${teamId}.json`)) ?? []);
    return teamLogsCache.get(teamId)!;
  };
  const rawGames: Map<string, StoredGame> | null = rawSeason ? new Map((await readAllGames(season)).map((g) => [g.scheduleKey, g])) : null;
  const dir = path.join(DATA_DIR, season, "player-games");
  const ids = readdirSync(dir)
    .filter((f) => /\.json(\.gz)?$/.test(f))
    .map((f) => f.replace(/\.json(\.gz)?$/, ""));

  for (const playerId of ids) {
    const logs: PlayerGameLog[] = rj(path.join(dir, `${playerId}.json`)) ?? [];
    const played = logs.filter((g) => g.min > 0);
    if (played.length === 0) continue;
    stats.players++;
    const ownTeamByScheduleKey = new Map<string, GameTeamInfo>();
    for (const log of played) {
      const own = resolveOwnTeam(log, gameTeams);
      if (own) ownTeamByScheduleKey.set(log.scheduleKey, own);
    }
    const teamIds = [...new Set([...ownTeamByScheduleKey.values()].map((t) => t.teamId))];
    const teamLogsByTeamId = new Map(teamIds.map((id) => [id, teamLogsOf(id)] as const));
    const isTransferred = teamIds.length > 1;
    if (isTransferred) stats.transferred++;
    const tag = `${season} ${playerId}(${nameOf.get(playerId) ?? ""})`;

    for (const gameType of GAME_TYPES) {
      const scoped: PlayerGameLog[] = filterByGameType(logs, gameType).filter((g: PlayerGameLog) => g.min > 0);
      if (scoped.length === 0) continue;
      const { rows, empty } = buildPlayerQuarterRows({
        playerId,
        season,
        logs,
        gameType,
        displayMode: "total",
        ownTeamByScheduleKey,
        teamLogsByTeamId,
        source,
      });
      stats.rowsChecked += rows.length;
      // 区間ごとの合計の行（複数チームの合計の行があればそれ、なければ1チームの行）
      const totalRow = new Map<string, (typeof rows)[number]>();
      for (const r of rows) if (r.isCombined || !totalRow.has(r.periodValue)) totalRow.set(r.periodValue, r);
      for (const r of rows) if (r.isCombined) totalRow.set(r.periodValue, r);
      const rawOfPeriod = (v: string) => (totalRow.has(v) ? rawOf(totalRow.get(v)!.ctx) : null);

      // 区間の行がある（延長が無いなど）かどうか
      const emptyValues = new Set(empty.map((e) => e.periodValue));
      for (const q of PLAYER_QUARTER_ROWS) {
        if (!totalRow.has(q.value) && !emptyValues.has(q.value)) fail(`${tag} ${gameType} ${q.value}: 行も「-」の区間もない`);
      }

      // 1. 足し合わせ（得点＝試合全体、前半・後半）
      const eligible = scoped.filter((g: PlayerGameLog) => !source.shortGames.has(g.scheduleKey) && !isManualBoxscoreKey(g.scheduleKey));
      const wholePts = eligible.reduce((s, g) => s + g.pts, 0);
      const parts = ["q1", "q2", "q3", "q4", "ot"].map((v) => rawOfPeriod(v)?.pts ?? 0);
      const sumParts = parts.reduce((a, b) => a + b, 0);
      if (sumParts !== wholePts) fail(`${tag} ${gameType}: 1Q〜4Q＋延長の得点 ${sumParts} ≠ 試合全体 ${wholePts}`);
      stats.gameSums++;
      for (const k of RAW_KEYS) {
        const q = (v: string) => rawOfPeriod(v)?.[k] ?? 0;
        if (!near(q("h1"), q("q1") + q("q2"))) fail(`${tag} ${gameType} 前半 ${k}: ${q("h1")} ≠ 1Q+2Q ${q("q1") + q("q2")}`);
        if (!near(q("h2"), q("q3") + q("q4"))) fail(`${tag} ${gameType} 後半 ${k}: ${q("h2")} ≠ 3Q+4Q ${q("q3") + q("q4")}`);
      }

      // 3. G（試合に出場した試合の数。延長は索引の延長の行がある試合）
      for (const q of PLAYER_QUARTER_ROWS) {
        const tr = totalRow.get(q.value);
        const expected = eligible.filter((g) => seasonPeriodTotalsOf(source, playerId, g.scheduleKey, g.isHome, q.value) !== null).length;
        if (q.value !== "ot") {
          if (expected !== eligible.length) fail(`${tag} ${gameType} ${q.value}: 値のある試合 ${expected} ≠ 出場した試合 ${eligible.length}`);
        }
        const got = tr ? tr.ctx.raw.gamesPlayed : 0;
        if (got !== expected) fail(`${tag} ${gameType} ${q.value}: G ${got} ≠ ${expected}`);
        if (q.value === "ot" && expected > 0) stats.otPlayers++;
      }

      // 2. シチュエーション別成績の経路（勝った試合／負けた試合に分けて集計）を足すと、Q別タブの合計の行と一致する
      for (const q of PLAYER_QUARTER_ROWS) {
        const tr = totalRow.get(q.value);
        const sums: Record<string, number> = {};
        let g = 0;
        for (const win of [true, false]) {
          const matched = scoped.filter((l) => l.win === win);
          if (matched.length === 0) continue;
          const split = buildTeamSplitRowsFromPeriodSource(
            `x|${win}`,
            matched,
            ownTeamByScheduleKey,
            sumTeamTotalsForLogs(matched, ownTeamByScheduleKey, teamLogsByTeamId),
            "total",
            Number(season.split("-")[0]),
            playerId,
            q.value,
            source,
          );
          const last = split[split.length - 1];
          if (!last) continue;
          g += last.ctx.raw.gamesPlayed;
          for (const k of RAW_KEYS) sums[k] = (sums[k] ?? 0) + rawOf(last.ctx)[k]!;
        }
        stats.situational++;
        if (!tr) {
          if (g !== 0) fail(`${tag} ${gameType} ${q.value}: シチュエーション経路には値があるがQ別の行が無い`);
          continue;
        }
        if (g !== tr.ctx.raw.gamesPlayed) fail(`${tag} ${gameType} ${q.value}: G ${tr.ctx.raw.gamesPlayed} ≠ シチュエーション経路 ${g}`);
        for (const k of RAW_KEYS) if (!near(sums[k] ?? 0, rawOf(tr.ctx)[k]!)) fail(`${tag} ${gameType} ${q.value} ${k}: Q別 ${rawOf(tr.ctx)[k]} ≠ シチュエーション経路 ${sums[k]}`);
      }

      // 4. 生データとの照合
      if (rawGames) {
        for (const q of PLAYER_QUARTER_ROWS) {
          const option = SEASON_PERIOD_OPTIONS.find((o) => o.value === q.value)!;
          const contributions = eligible.flatMap((l) => {
            const game = rawGames.get(l.scheduleKey);
            const c = game ? computeGamePeriodTotals(game, l.isHome, playerId, option) : null;
            return c ? [c] : [];
          });
          const expected = buildPeriodFilteredRawTotals(contributions).raw as unknown as Record<string, number>;
          const tr = totalRow.get(q.value);
          const got = tr ? rawOf(tr.ctx) : null;
          if (!got) {
            if (contributions.length > 0 && q.value !== "ot") fail(`${tag} ${gameType} ${q.value}: 生データには値があるがQ別の行が無い`);
            continue;
          }
          stats.rawGames++;
          if (q.value === "ot") {
            // 生データの経路は全試合を返す（延長に出ていない試合は0）。延長に出た試合（出場時間が0より大きい）は、索引の延長の行がある試合に含まれる
            const played = contributions.filter((c) => c.player.minSec > 0).length;
            const indexed = got.gamesPlayed ?? 0;
            if (played > indexed) fail(`${tag} ${gameType} 延長: 生データで延長に出た試合 ${played} > 索引の延長の試合 ${indexed}`);
            if (played < indexed) otZeroRows++;
          }
          for (const k of RAW_KEYS) if (!near(expected[k] ?? 0, got[k] ?? 0)) fail(`${tag} ${gameType} ${q.value} ${k}: 生データ ${expected[k]} ≠ Q別 ${got[k]}`);
        }
      }

      // 5. 勝敗（チームの試合ログから数える）
      const teamWin = (g: PlayerGameLog): boolean | null => {
        const teamId = ownTeamByScheduleKey.get(g.scheduleKey)?.teamId;
        const t = teamId ? teamLogsOf(teamId).find((x) => x.scheduleKey === g.scheduleKey) : undefined;
        return t ? t.win : null;
      };
      const fromTeamLogs = { wins: 0, losses: 0 };
      for (const g of scoped) {
        const w = teamWin(g);
        if (w === null) fail(`${tag} ${gameType} ${g.scheduleKey}: チームの試合ログが見つからない`);
        else if (w) fromTeamLogs.wins++;
        else fromTeamLogs.losses++;
      }
      const rec = playerRecordOfLogs(scoped, playerId, "all", source);
      stats.records++;
      if (rec.wins !== fromTeamLogs.wins || rec.losses !== fromTeamLogs.losses) fail(`${tag} ${gameType}: 勝敗 ${formatPlayerRecord(rec)} ≠ チームの試合ログ ${fromTeamLogs.wins}勝${fromTeamLogs.losses}敗`);
      if (rec.wins + rec.losses !== scoped.length) fail(`${tag} ${gameType}: 勝敗の合計 ${rec.wins + rec.losses} ≠ 出場した試合 ${scoped.length}`);
      // チームごとの勝敗の合計＝全体
      let sumW = 0;
      let sumL = 0;
      for (const id of teamIds) {
        const mine = scoped.filter((g: PlayerGameLog) => ownTeamByScheduleKey.get(g.scheduleKey)?.teamId === id);
        const r = playerRecordOfLogs(mine, playerId, "all", source);
        sumW += r.wins;
        sumL += r.losses;
      }
      if (sumW !== rec.wins || sumL !== rec.losses) fail(`${tag} ${gameType}: チームごとの勝敗の合計が全体と違う`);
      // 区間を選んだときの勝敗の合計＝その区間のG
      for (const q of PLAYER_QUARTER_ROWS) {
        const r = playerRecordOfLogs(scoped.filter((g: PlayerGameLog) => !source.shortGames.has(g.scheduleKey)), playerId, q.value, source);
        const g = totalRow.get(q.value)?.ctx.raw.gamesPlayed ?? 0;
        if (r.wins + r.losses !== g) fail(`${tag} ${gameType} ${q.value}: 区間の勝敗の合計 ${r.wins + r.losses} ≠ G ${g}`);
      }
      if (formatPlayerWinPct(rec) !== (rec.wins + rec.losses === 0 ? "-" : (rec.wins / (rec.wins + rec.losses)).toFixed(3).replace(/^0\./, "."))) fail(`${tag}: 勝率の表記`);
    }
    if (examples.length < 6 && season === "2026-27" && isTransferred) examples.push(`${tag} 移籍(${teamIds.join(",")})`);
  }
}

async function main() {
  const seasons = readdirSync(DATA_DIR)
    .filter((d) => /^\d{4}-\d{2}$/.test(d) && (!onlySeason || d === onlySeason))
    .sort();
  const rawSeasons = new Set((argOf("--raw-seasons") ?? `${seasons[seasons.length - 1]},2017-18`).split(","));
  for (const season of seasons) {
    await validateSeason(season, rawSeasons.has(season));
    console.log(`${season}: 完了${rawSeasons.has(season) ? "（生データ照合あり）" : ""}`);
  }
  console.log(
    `\n選手のシーズン ${stats.players}件（うち移籍 ${stats.transferred}件）・行 ${stats.rowsChecked}・足し合わせ ${stats.gameSums}・シチュエーション経路 ${stats.situational}・生データ照合 ${stats.rawGames}・勝敗 ${stats.records}・延長に出た選手のシーズン ${stats.otPlayers}`,
  );
  console.log(`延長の行はあるが出場時間が0の試合を含む選手のシーズン（参考）: ${otZeroRows}`);
  if (examples.length > 0) console.log(`移籍した選手の例（今季）: ${examples.join(" / ")}`);
  if (failures > 0) {
    console.log(`\nNG ${failures}件`);
    process.exit(1);
  }
  console.log("\nすべて一致");
}

main();
