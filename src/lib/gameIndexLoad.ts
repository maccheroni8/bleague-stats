// 1試合行の索引（data/{season}/player-game-index.json.gz・team-game-index.json.gz。DESIGN.md 219章）をブラウザで読み込む。
// 同じシーズンはページを開いている間メモリに持つ。ファイルが無い・版が合わないときは null（呼び出し側は「データがありません」にする）。
// 失敗（null・通信の失敗）は持たず、次の呼び出しでやり直す。行の読み方は gameIndex.ts。

import type { AssistPairsFile } from "../../shared/assistPairs";
import { fetchAssistPairs, fetchPlayerGameIndex, fetchTeamGameIndex } from "./data";
import { isSupportedAssistPairs } from "./clutchQuery";
import { isSupportedGameIndex, viewPlayerGameIndex, viewTeamGameIndex, type PlayerGameIndexView, type TeamGameIndexView } from "./gameIndex";

const playerCache = new Map<string, Promise<PlayerGameIndexView | null>>();
const teamCache = new Map<string, Promise<TeamGameIndexView | null>>();
const pairCache = new Map<string, Promise<AssistPairsFile | null>>();

/** アシストペアの試合ごとの行（data/{season}/assist-pairs.json。DESIGN.md 221章） */
export function loadAssistPairs(season: string): Promise<AssistPairsFile | null> {
  let p = pairCache.get(season);
  if (!p) {
    p = fetchAssistPairs(season).then((f) => (isSupportedAssistPairs(f) ? f : null));
    p.then((v) => v ?? pairCache.delete(season), () => pairCache.delete(season));
    pairCache.set(season, p);
  }
  return p;
}

export function loadPlayerGameIndex(season: string): Promise<PlayerGameIndexView | null> {
  let p = playerCache.get(season);
  if (!p) {
    p = fetchPlayerGameIndex(season).then((f) => (isSupportedGameIndex(f) ? viewPlayerGameIndex(f!) : null));
    p.then((v) => v ?? playerCache.delete(season), () => playerCache.delete(season));
    playerCache.set(season, p);
  }
  return p;
}

export function loadTeamGameIndex(season: string): Promise<TeamGameIndexView | null> {
  let p = teamCache.get(season);
  if (!p) {
    p = fetchTeamGameIndex(season).then((f) => (isSupportedGameIndex(f) ? viewTeamGameIndex(f!) : null));
    p.then((v) => v ?? teamCache.delete(season), () => teamCache.delete(season));
    teamCache.set(season, p);
  }
  return p;
}
