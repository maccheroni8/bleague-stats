// Time to Shot の導出データを作る（形式は shared/ttsIndex.ts。計算は shared/timeToShot.ts）。
// 1試合行の索引（team-game-index.json。先に作っておく）の行に結び付ける。TTS_FIRST_SEASON（2016-17）より前のシーズンは作らない（null）。
import path from "node:path";
import { DATA_DIR, readAllGames, readJson, seasonDirName } from "./storage.ts";
import type { Category } from "../../shared/types.ts";
import { calculateTimeToShot } from "../../shared/timeToShot.ts";
import { TTS_ATOMS, TTS_FIRST_SEASON, TTS_FT_EXCLUDED, TTS_FT_KINDS, TTS_INDEX_CATEGORIES, TTS_INDEX_VERSION, TTS_POSS_KINDS, ttsExcludedKey, ttsFtExcludedKey, ttsFtKey, ttsKey, ttsPossExcludedKey, ttsPossKey, ttsPossOrCountKey, type TtsAtom, type TtsIndexFile } from "../../shared/ttsIndex.ts";
import { GAME_FLAG_PLAYOFF } from "../../shared/gameIndex.ts";
import { PLAYER_TTS_VERSION, type PlayerTtsFile } from "../../shared/playerTts.ts";
import type { TeamGameIndexFile } from "../../shared/gameIndex.ts";

let lastPlayerTts: PlayerTtsFile | null = null;
/** 直前の buildTtsIndex と同じ材料から作った選手の合計（同じ試合を2回読まないため） */
export function takePlayerTts(): PlayerTtsFile | null {
  const v = lastPlayerTts;
  lastPlayerTts = null;
  return v;
}

const atomOf = (period: number): TtsAtom => (period <= 4 ? (TTS_ATOMS[period - 1] as TtsAtom) : "ot");

export async function buildTtsIndex(season: string, category: Category = "premier"): Promise<TtsIndexFile | null> {
  lastPlayerTts = null;
  if (season < TTS_FIRST_SEASON) return null;
  const teamIndex = await readJson<TeamGameIndexFile>(path.join(DATA_DIR, seasonDirName(season, category), "team-game-index.json"));
  if (!teamIndex) return null;
  const rowsCount = teamIndex.games.key.length * 2;
  const counts: Record<string, number[]> = {};
  const fill = () => new Array<number>(rowsCount).fill(-1);
  for (const a of TTS_ATOMS) {
    counts[ttsExcludedKey(a)] = fill();
    for (const c of TTS_INDEX_CATEGORIES) {
      counts[ttsKey(a, c, "n")] = fill();
      counts[ttsKey(a, c, "s")] = fill();
    }
    for (const k of TTS_FT_KINDS) {
      counts[ttsFtKey(a, k, "n")] = fill();
      counts[ttsFtKey(a, k, "s")] = fill();
    }
    for (const k of TTS_FT_EXCLUDED) counts[ttsFtExcludedKey(a, k)] = fill();
    for (const k of TTS_POSS_KINDS) {
      counts[ttsPossKey(a, k, "n")] = fill();
      counts[ttsPossKey(a, k, "s")] = fill();
    }
    counts[ttsPossOrCountKey(a)] = fill();
    counts[ttsPossExcludedKey(a)] = fill();
  }
  // 選手×チーム×試合区分の合計（DESIGN.md 480章。player-tts.json）
  const players = new Map<string, { player: string; team: string; playoff: number; fgN: number; fgS: number; ftN: number; ftS: number }>();
  const playerRow = (player: string, team: string, playoff: number) => {
    const k = `${player}|${team}|${playoff}`;
    let r = players.get(k);
    if (!r) players.set(k, (r = { player, team, playoff, fgN: 0, fgS: 0, ftN: 0, ftS: 0 }));
    return r;
  };
  const gameNumber = new Map<string, number>(teamIndex.games.key.map((k, i) => [k, i]));
  for (const game of await readAllGames(season, category)) {
    const g = gameNumber.get(String(game.scheduleKey));
    if (g === undefined) continue;
    // PBP が無い試合は値なし（-1）。ボックスの FGA は復元できない
    if (!game.raw.PlayByPlays?.length) continue;
    // 前後半5分の特別な試合（旧形式の4試合）は、Qの区切りが違うので作らない（-1）
    if (game.quarterScores.home.length < 4 && game.raw.PlayByPlays.reduce((n, e) => Math.max(n, e.Period), 0) < 4) continue;
    const result = calculateTimeToShot(game);
    const periods = new Set(result.shots.map((s) => s.period));
    const maxPeriod = Math.max(4, ...periods, ...result.fts.map((f) => f.period), ...result.possessions.map((p) => p.period));
    const playoff = (teamIndex.games.flags[g]! & GAME_FLAG_PLAYOFF) !== 0 ? 1 : 0;
    for (const side of [0, 1] as const) {
      const teamId = side === 0 ? game.homeTeam.id : game.awayTeam.id;
      const row = g * 2 + side;
      for (const a of TTS_ATOMS) {
        if (a === "ot" && maxPeriod <= 4) continue;
        counts[ttsExcludedKey(a)]![row] = 0;
        for (const c of TTS_INDEX_CATEGORIES) {
          counts[ttsKey(a, c, "n")]![row] = 0;
          counts[ttsKey(a, c, "s")]![row] = 0;
        }
        for (const k of TTS_FT_KINDS) {
          counts[ttsFtKey(a, k, "n")]![row] = 0;
          counts[ttsFtKey(a, k, "s")]![row] = 0;
        }
        for (const k of TTS_FT_EXCLUDED) counts[ttsFtExcludedKey(a, k)]![row] = 0;
        for (const k of TTS_POSS_KINDS) {
          counts[ttsPossKey(a, k, "n")]![row] = 0;
          counts[ttsPossKey(a, k, "s")]![row] = 0;
        }
        counts[ttsPossOrCountKey(a)]![row] = 0;
        counts[ttsPossExcludedKey(a)]![row] = 0;
      }
      // 攻撃時間（481章）
      for (const p of result.possessions) {
        if (p.team !== teamId) continue;
        const a = atomOf(p.period);
        if (p.seconds === null) {
          counts[ttsPossExcludedKey(a)]![row]! += 1;
          continue;
        }
        const add = (k: (typeof TTS_POSS_KINDS)[number]) => {
          counts[ttsPossKey(a, k, "n")]![row]! += 1;
          counts[ttsPossKey(a, k, "s")]![row]! += p.seconds!;
        };
        add("all");
        if (p.orebs > 0) add("or");
        if (p.scored) add("pts");
        counts[ttsPossOrCountKey(a)]![row]! += p.orebs;
      }
      for (const s of result.shots) {
        if (s.team !== teamId) continue;
        const a = atomOf(s.period);
        if (s.category === null || s.seconds === null) {
          counts[ttsExcludedKey(a)]![row]! += 1;
          continue;
        }
        counts[ttsKey(a, s.category, "n")]![row]! += 1;
        counts[ttsKey(a, s.category, "s")]![row]! += s.seconds;
        const pid = s.end.player;
        if (pid) {
          const p = playerRow(pid, teamId, playoff);
          p.fgN += 1;
          p.fgS += s.seconds;
        }
      }
      for (const f of result.fts) {
        if (f.team !== teamId) continue;
        const a = atomOf(f.period);
        if (f.kind === "unclassified") counts[ttsFtExcludedKey(a, "u")]![row]! += 1;
        else if (f.kind === "overlap") counts[ttsFtExcludedKey(a, "o")]![row]! += 1;
        else if (f.kind === "unknown" || f.seconds === null) counts[ttsFtExcludedKey(a, "x")]![row]! += 1;
        else {
          counts[ttsFtKey(a, f.kind, "n")]![row]! += 1;
          counts[ttsFtKey(a, f.kind, "s")]![row]! += f.seconds;
          if (f.andOne && f.kind === "shoot") {
            counts[ttsFtKey(a, "and1", "n")]![row]! += 1;
            counts[ttsFtKey(a, "and1", "s")]![row]! += f.seconds;
          }
          if (f.shooter) {
            const p = playerRow(f.shooter, teamId, playoff);
            p.ftN += 1;
            p.ftS += f.seconds;
          }
        }
      }
    }
  }
  const list = [...players.values()].sort((a, b) => (a.player < b.player ? -1 : a.player > b.player ? 1 : a.team < b.team ? -1 : a.team > b.team ? 1 : a.playoff - b.playoff));
  lastPlayerTts = {
    version: PLAYER_TTS_VERSION,
    generatedAt: new Date().toISOString(),
    season,
    rows: {
      player: list.map((r) => r.player),
      team: list.map((r) => r.team),
      playoff: list.map((r) => r.playoff),
      fgN: list.map((r) => r.fgN),
      fgS: list.map((r) => r.fgS),
      ftN: list.map((r) => r.ftN),
      ftS: list.map((r) => r.ftS),
    },
  };
  return { version: TTS_INDEX_VERSION, generatedAt: new Date().toISOString(), season, indexRows: rowsCount, rows: { counts } };
}
