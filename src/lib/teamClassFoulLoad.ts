// 登録区分別のチームのランキングで、TF1・TF2・FLAG・DISR（2026-27以降）を出すための読み込み（設計書435章）。
// この4つは選手の1試合行の索引に無いので、そのシーズンの選手の試合ログを読んで、区分ごとに足す。TF1・TF2・FLAG・DISR のどれかを選んだときだけ読む。
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { useEffect, useState } from "react";
import { fetchPlayerGameLogs, fetchPlayers } from "./data";
import { loadPlayerGameIndex } from "./gameIndexLoad";
import { leagueCacheKey, type League } from "./league";
import { buildClassFoulSplit, type ClassFoulSplit } from "./teamClassSplit";
import type { PlayerGameLog } from "../../shared/types";

const cache = new Map<string, Promise<ClassFoulSplit | null>>();

export function loadClassFoulSplit(season: string, league: League): Promise<ClassFoulSplit | null> {
  const key = leagueCacheKey(season, league);
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const [view, players] = await Promise.all([loadPlayerGameIndex(season, league), fetchPlayers(season, league)]);
      if (!view) return null;
      const logs = new Map<string, PlayerGameLog[]>();
      const ids = players.map((x) => x.playerId);
      for (let i = 0; i < ids.length; i += 16) {
        const part = ids.slice(i, i + 16);
        const got = await Promise.all(part.map((id) => fetchPlayerGameLogs(season, id, league).catch(() => [] as PlayerGameLog[])));
        part.forEach((id, k) => logs.set(id, got[k]!));
      }
      return buildClassFoulSplit(view.file, logs);
    })();
    p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** enabled の間だけ読む。読み込み中は loading、読めなかったら failed */
export function useClassFoulSplit(season: string, enabled: boolean, league: League): { foul: ClassFoulSplit | null; loading: boolean; failed: boolean } {
  const [state, setState] = useState<{ key: string; foul: ClassFoulSplit | null; done: boolean } | null>(null);
  const key = leagueCacheKey(season, league);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadClassFoulSplit(season, league).then(
      (foul) => alive && setState({ key, foul, done: true }),
      () => alive && setState({ key, foul: null, done: true }),
    );
    return () => {
      alive = false;
    };
  }, [enabled, season, league, key]);
  const mine = state?.key === key ? state : null;
  return { foul: mine?.foul ?? null, loading: enabled && !mine?.done, failed: enabled && !!mine?.done && !mine.foul };
}
