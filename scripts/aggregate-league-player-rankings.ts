// data/league-player-rankings.json（個人版「歴代記録」タブ、通算成績のみ）を生成する。
//
// data/{season}/player-games/{playerId}.json.gz を全B.PREMIERシーズン・全選手横断で読み込み、
// 通算成績（PLAYER_CAREER_TOTAL_DEFS）について、リーグ全選手中の順位を算出する。playerIdは
// シーズン・チームをまたいで不変なので、移籍・引退後の選手も含めplayerId単位でそのまま
// 合算・比較する。レギュラーシーズンのみ/プレーオフのみ/合算、ホーム/アウェイ/トータルの
// 組み合わせを算出する（scripts/aggregate-league-rankings.ts＝チーム版と同じ構成）。
// クラブレコード相当（1試合単位の最高記録）・シーズン単位の特殊記録は対象外
// （ユーザー指定、2026-09-04。別途Rankingsページの機能として検討予定）。
//
// npm run aggregateの日次サイクルには含めない。シーズン終了後等に手動実行するバッチ処理
// （チーム版と同じ運用方針）。B.PREMIERのみが対象（B.ONEは対象外）。
//
// 使い方:
//   npm run aggregate:league-player-rankings

import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson, writeJson } from "./lib/storage.ts";
import { filterByGameType } from "../shared/gameType.ts";
import { PLAYER_CAREER_TOTAL_DEFS, buildPlayerCareerTotals } from "../shared/playerRecords.ts";
import type {
  LeaguePlayerInfo,
  LeaguePlayerRankEntry,
  LeaguePlayerRankingsFile,
  LeaguePlayerRankingStatTable,
  LeagueRankingGameType,
  PlayerGameLog,
  PlayerSummary,
} from "../shared/types.ts";

const SEASON_DIR_PATTERN = /^\d{4}-\d{2}$/;
const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

function listSeasonDirs(): string[] {
  return readdirSync(DATA_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && SEASON_DIR_PATTERN.test(e.name))
    .map((e) => e.name)
    .sort();
}

interface PlayerSeasonLogs {
  season: string;
  logs: PlayerGameLog[];
}

/**
 * playerId単位で全シーズン分のPlayerGameLogを集める（出場なし＝min<=0の試合は除外。
 * src/lib/playerSeasonBoxscore.tsのsumPlayerGameLogs()と同じ方針）。あわせて、各選手の
 * 表示用情報（name/teamId/teamName）を、その選手が登場する最新シーズンのplayers.json
 * （PlayerSummary）から取得する。シーズンを昇順に走査しながら都度上書きするだけで、
 * 自然に「最新シーズンの値」が残る
 */
async function loadCareerData(): Promise<{
  byPlayer: Map<string, PlayerSeasonLogs[]>;
  info: Map<string, LeaguePlayerInfo>;
}> {
  const byPlayer = new Map<string, PlayerSeasonLogs[]>();
  const info = new Map<string, LeaguePlayerInfo>();

  for (const season of listSeasonDirs()) {
    const dir = path.join(DATA_DIR, season, "player-games");
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".json.gz"));
      for (const file of files) {
        const playerId = file.replace(/\.json\.gz$/, "");
        const logs = await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`));
        if (!logs) continue;
        const real = logs.filter((g) => g.min > 0 && (g.gameType === "regular" || g.gameType === "playoff"));
        if (real.length === 0) continue;
        const arr = byPlayer.get(playerId) ?? [];
        arr.push({ season, logs: real });
        byPlayer.set(playerId, arr);
      }
    }

    const players = await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"));
    if (players) {
      for (const p of players) {
        info.set(p.playerId, { name: p.name, teamId: p.teamId, teamName: p.teamName, latestSeason: season });
      }
    }
  }

  return { byPlayer, info };
}

function buildRankTable(entries: { playerId: string; value: number }[]): Record<string, LeaguePlayerRankEntry> {
  const sorted = [...entries].sort((a, b) => b.value - a.value || Number(a.playerId) - Number(b.playerId));
  const totalPlayers = sorted.length;
  const table: Record<string, LeaguePlayerRankEntry> = {};
  sorted.forEach((e, i) => {
    table[e.playerId] = { value: e.value, rank: i + 1, totalPlayers };
  });
  return table;
}

function computeCareerRankings(byPlayer: Map<string, PlayerSeasonLogs[]>): Record<LeagueRankingGameType, LeaguePlayerRankingStatTable> {
  const career: Record<LeagueRankingGameType, LeaguePlayerRankingStatTable> = { regular: {}, playoff: {}, both: {} };

  for (const gameType of GAME_TYPES) {
    const collected = new Map<string, { playerId: string; value: number }[]>();

    for (const [playerId, seasons] of byPlayer) {
      const flat = seasons.flatMap((s) => s.logs);
      const filtered = filterByGameType(flat, gameType);
      if (filtered.length === 0) continue;

      const totals = buildPlayerCareerTotals(filtered);
      for (const def of PLAYER_CAREER_TOTAL_DEFS) {
        const arr = collected.get(def.key) ?? [];
        arr.push({ playerId, value: def.value(totals) });
        collected.set(def.key, arr);
      }
    }

    for (const [key, entries] of collected) career[gameType][key] = buildRankTable(entries);
  }

  return career;
}

/** byPlayerの各選手の試合ログを、指定venue（ホーム/アウェイ）のみに絞り込む。
 * venue===nullはそのまま（トータル、絞り込みなし） */
function filterByVenue(byPlayer: Map<string, PlayerSeasonLogs[]>, venue: "home" | "away" | null): Map<string, PlayerSeasonLogs[]> {
  if (venue === null) return byPlayer;
  const isHome = venue === "home";
  return new Map(
    [...byPlayer].map(([playerId, seasons]) => [
      playerId,
      seasons.map((s) => ({ season: s.season, logs: s.logs.filter((g) => g.isHome === isHome) })),
    ]),
  );
}

async function main() {
  const { byPlayer, info } = await loadCareerData();
  console.log(`対象選手数（出場記録のある全選手、B.PREMIER）: ${byPlayer.size}`);

  const career = computeCareerRankings(byPlayer);
  const careerHome = computeCareerRankings(filterByVenue(byPlayer, "home"));
  const careerAway = computeCareerRankings(filterByVenue(byPlayer, "away"));

  for (const [label, r] of [
    ["total", career],
    ["home", careerHome],
    ["away", careerAway],
  ] as const) {
    console.log(`[${label}] career対象選手数(games基準/regular)=${Object.keys(r.regular.games ?? {}).length}`);
  }

  const file: LeaguePlayerRankingsFile = {
    generatedAt: new Date().toISOString(),
    players: Object.fromEntries(info),
    career,
    careerHome,
    careerAway,
  };

  await writeJson(path.join(DATA_DIR, "league-player-rankings.json"), file);
  console.log("\ndata/league-player-rankings.jsonに保存しました");
}

main();
