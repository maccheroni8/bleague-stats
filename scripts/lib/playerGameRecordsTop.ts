// 選手の1試合の記録の上位を作る共通部分（シーズンごとの scripts/aggregate-player-game-records.ts と、
// 全シーズンの scripts/aggregate-league-player-game-records.ts で使う。DESIGN.md 159・188章）。
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { DATA_DIR, readJson } from "./storage.ts";
import { filterByGameType } from "../../shared/gameType.ts";
import { PLAYER_GAME_RECORD_STATS, PLAYER_GAME_RECORD_TOP_N, type PlayerRecordGame } from "../../shared/playerGameRecords.ts";
import { CLASS_KEYS, classKeyOf, type ClassKey } from "../../shared/classificationKey.ts";
import type {
  GameSummary,
  LeagueRankingGameType,
  PlayerGameLog,
  PlayerGameRecordEntry,
  PlayerGameRecordTables,
  PlayerMasterEntry,
  PlayerSummary,
} from "../../shared/types.ts";

export interface RecordGame extends PlayerRecordGame {
  playerId: string;
  playerName: string;
  /** 記録した試合の所属チーム（その試合のチーム名。試合一覧のホーム/アウェイから決めるので、シーズン途中の移籍にも合う） */
  teamId: string;
  teamName: string;
  /** 登録区分（jp＝日本人、intl＝外国籍・帰化・アジア）。選手マスタの区分（選手ごとの1つの値。DESIGN.md 197章）。マスタに無い選手は undefined */
  classKey?: ClassKey;
}

/**
 * そのシーズンの、出場した試合（min>0）で、試合一覧（games-summary.json）にある試合（オールスター等は含めない）。
 * 選手名はそのシーズンの players.json、無ければ playerId
 */
export async function loadSeasonRecordGames(season: string): Promise<RecordGame[]> {
  const summaries = (await readJson<GameSummary[]>(path.join(DATA_DIR, season, "games-summary.json"))) ?? [];
  const summaryByKey = new Map(summaries.map((s) => [s.scheduleKey, s]));
  const players = (await readJson<PlayerSummary[]>(path.join(DATA_DIR, season, "players.json"))) ?? [];
  const nameById = new Map(players.map((p) => [p.playerId, p.name]));
  const master = (await readJson<PlayerMasterEntry[]>(path.join(DATA_DIR, "players-master.json"))) ?? [];
  const classKeyById = new Map(master.map((p) => [p.playerId, classKeyOf(p.classification)]));
  const dir = path.join(DATA_DIR, season, "player-games");
  if (!existsSync(dir)) return [];
  const games: RecordGame[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json.gz"))) {
    const playerId = file.replace(/\.json\.gz$/, "");
    const logs = await readJson<PlayerGameLog[]>(path.join(dir, `${playerId}.json`));
    for (const g of logs ?? []) {
      const s = summaryByKey.get(g.scheduleKey);
      if (g.min <= 0 || !s) continue;
      if (g.gameType !== "regular" && g.gameType !== "playoff") continue;
      games.push({
        ...g,
        season,
        playerId,
        playerName: nameById.get(playerId) ?? playerId,
        classKey: classKeyById.get(playerId),
        teamId: g.isHome ? s.homeTeamId : s.awayTeamId,
        teamName: g.isHome ? s.homeTeamName : s.awayTeamName,
      });
    }
  }
  return games;
}

/**
 * 上位N位（N位と同じ記録はすべて）。同じ記録の中は、成功率の項目は試投数の多い試合から、その後は新しい試合から
 * （チームのクラブレコードと同じ。2026-09-27）。withSeason を付けると、全シーズンの記録用にシーズンも書く
 */
export function topRecordEntries(
  games: RecordGame[],
  value: (g: RecordGame) => number,
  fraction: ((g: RecordGame) => readonly [number, number]) | undefined,
  withSeason = false,
): PlayerGameRecordEntry[] {
  const attempts = (g: RecordGame) => (fraction ? fraction(g)[1] : 0);
  const sorted = games
    .map((g) => ({ g, v: value(g) }))
    .sort(
      (a, b) =>
        b.v - a.v || attempts(b.g) - attempts(a.g) || b.g.date.localeCompare(a.g.date) || a.g.playerId.localeCompare(b.g.playerId),
    );
  const out: PlayerGameRecordEntry[] = [];
  let rank = 0;
  for (let i = 0; i < sorted.length; i++) {
    const { g, v } = sorted[i]!;
    if (i === 0 || v !== sorted[i - 1]!.v) rank = i + 1;
    if (rank > PLAYER_GAME_RECORD_TOP_N) break;
    out.push({
      rank,
      value: v,
      playerId: g.playerId,
      playerName: g.playerName,
      teamId: g.teamId,
      teamName: g.teamName,
      opponentTeamId: g.opponentTeamId,
      opponentTeamName: g.opponentTeamName,
      isHome: g.isHome,
      date: g.date,
      scheduleKey: g.scheduleKey,
      ...(withSeason ? { season: g.season } : {}),
      ...(fraction ? { made: fraction(g)[0], attempted: fraction(g)[1] } : {}),
    });
  }
  return out;
}

const GAME_TYPES: LeagueRankingGameType[] = ["regular", "playoff", "both"];

function buildTables(games: RecordGame[], withSeason: boolean): PlayerGameRecordTables {
  const tables = { regular: {}, playoff: {}, both: {} } as PlayerGameRecordTables;
  for (const gameType of GAME_TYPES) {
    const scoped = filterByGameType(games, gameType);
    for (const def of PLAYER_GAME_RECORD_STATS) {
      const pool = def.filter ? scoped.filter(def.filter) : scoped;
      const entries = topRecordEntries(pool, def.value, def.fraction, withSeason);
      if (entries.length > 0) tables[gameType][def.key] = entries;
    }
  }
  return tables;
}

/**
 * 全選手の上位と、登録区分ごと（日本人・外国籍/帰化/アジア）の、その区分の選手だけの中での上位（DESIGN.md 197章）。
 * 区分の順位は区分の中でつけ直す（日本人の1位は、日本人の中での1位）
 */
export function buildRecordTables(
  games: RecordGame[],
  withSeason: boolean,
): { byGameType: PlayerGameRecordTables; byClassification: Record<ClassKey, PlayerGameRecordTables> } {
  const byClassification = {} as Record<ClassKey, PlayerGameRecordTables>;
  for (const key of CLASS_KEYS) byClassification[key] = buildTables(games.filter((g) => g.classKey === key), withSeason);
  return { byGameType: buildTables(games, withSeason), byClassification };
}
