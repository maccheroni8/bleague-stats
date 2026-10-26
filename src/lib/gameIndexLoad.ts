// 1試合行の索引（data/{season}/player-game-index.json.gz・team-game-index.json.gz。DESIGN.md 219章）をブラウザで読み込む。
// 同じシーズンはページを開いている間メモリに持つ。ファイルが無い・版が合わないときは null（呼び出し側は「データがありません」にする）。
// 失敗（null・通信の失敗）は持たず、次の呼び出しでやり直す。行の読み方は gameIndex.ts。

import { leagueCacheKey, type League } from "./league";
import type { AssistPairsFile } from "../../shared/assistPairs";
import { fetchAssistPairs, fetchPlayerGameIndex, fetchTeamGameIndex } from "./data";
import { isSupportedAssistPairs } from "./clutchQuery";
import { isSupportedGameIndex, viewPlayerGameIndex, viewTeamGameIndex, type PlayerGameIndexView, type TeamGameIndexView } from "./gameIndex";

const playerCache = new Map<string, Promise<PlayerGameIndexView | null>>();
const teamCache = new Map<string, Promise<TeamGameIndexView | null>>();
const pairCache = new Map<string, Promise<AssistPairsFile | null>>();

/** アシストペアの試合ごとの行（data/{season}/assist-pairs.json。DESIGN.md 221章） */
export function loadAssistPairs(season: string, league: League = "premier"): Promise<AssistPairsFile | null> {
  const key = leagueCacheKey(season, league);
  let p = pairCache.get(key);
  if (!p) {
    p = fetchAssistPairs(season, league).then((f) => (isSupportedAssistPairs(f) ? f : null));
    p.then((v) => v ?? pairCache.delete(key), () => pairCache.delete(key));
    pairCache.set(key, p);
  }
  return p;
}

export function loadPlayerGameIndex(season: string, league: League = "premier"): Promise<PlayerGameIndexView | null> {
  const key = leagueCacheKey(season, league);
  let p = playerCache.get(key);
  if (!p) {
    p = fetchPlayerGameIndex(season, league).then((f) => (isSupportedGameIndex(f) ? viewPlayerGameIndex(f!) : null));
    p.then((v) => v ?? playerCache.delete(key), () => playerCache.delete(key));
    playerCache.set(key, p);
  }
  return p;
}

export function loadTeamGameIndex(season: string, league: League = "premier"): Promise<TeamGameIndexView | null> {
  const key = leagueCacheKey(season, league);
  let p = teamCache.get(key);
  if (!p) {
    p = fetchTeamGameIndex(season, league).then((f) => (isSupportedGameIndex(f) ? viewTeamGameIndex(f!) : null));
    p.then((v) => v ?? teamCache.delete(key), () => teamCache.delete(key));
    teamCache.set(key, p);
  }
  return p;
}
