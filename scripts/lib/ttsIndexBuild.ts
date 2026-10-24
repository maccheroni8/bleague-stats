// Time to Shot の導出データを作る（形式は shared/ttsIndex.ts。計算は shared/timeToShot.ts）。
// 1試合行の索引（team-game-index.json。先に作っておく）の行に結び付ける。2020-21 より前のシーズンは作らない（null）。
import path from "node:path";
import { DATA_DIR, readAllGames, readJson } from "./storage.ts";
import { calculateTimeToShot } from "../../shared/timeToShot.ts";
import { TTS_ATOMS, TTS_FIRST_SEASON, TTS_INDEX_CATEGORIES, TTS_INDEX_VERSION, ttsExcludedKey, ttsKey, type TtsAtom, type TtsIndexFile } from "../../shared/ttsIndex.ts";
import type { TeamGameIndexFile } from "../../shared/gameIndex.ts";

const atomOf = (period: number): TtsAtom => (period <= 4 ? (TTS_ATOMS[period - 1] as TtsAtom) : "ot");

export async function buildTtsIndex(season: string): Promise<TtsIndexFile | null> {
  if (season < TTS_FIRST_SEASON) return null;
  const teamIndex = await readJson<TeamGameIndexFile>(path.join(DATA_DIR, season, "team-game-index.json"));
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
  }
  const gameNumber = new Map<string, number>(teamIndex.games.key.map((k, i) => [k, i]));
  for (const game of await readAllGames(season)) {
    const g = gameNumber.get(String(game.scheduleKey));
    if (g === undefined) continue;
    // PBP が無い試合は値なし（-1）。ボックスの FGA は復元できない
    if (!game.raw.PlayByPlays?.length) continue;
    // 前後半5分の特別な試合（旧形式）は 2020-21 以降に無いが、Qの区切りが違うので作らない
    if (game.quarterScores.home.length < 4 && game.raw.PlayByPlays.reduce((n, e) => Math.max(n, e.Period), 0) < 4) continue;
    const result = calculateTimeToShot(game);
    const periods = new Set(result.shots.map((s) => s.period));
    const maxPeriod = Math.max(4, ...periods);
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
      }
    }
  }
  return { version: TTS_INDEX_VERSION, generatedAt: new Date().toISOString(), season, indexRows: rowsCount, rows: { counts } };
}
