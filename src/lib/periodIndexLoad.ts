// 選手のピリオド別の索引（data/{season}/player-period-index.json.gz。DESIGN.md 225章）をブラウザで読み込む。
// 同じシーズンはページを開いている間メモリに持つ。ファイルが無い・版が合わないときは null。失敗（null・通信の失敗）は持たず、次の呼び出しでやり直す。
import { fetchPlayerPeriodIndex } from "./data";
import type { PlayerGameIndexView } from "./gameIndex";
import { isSupportedPeriodIndex, viewPlayerPeriodIndex, type PlayerPeriodView } from "./periodIndex";

const cache = new Map<string, Promise<PlayerPeriodView | null>>();

/** 結び付け先の1試合行の索引（読み込み済み）を渡す。同じシーズンの1試合行の索引と行数が合うものだけを返す */
export function loadPlayerPeriodIndex(main: PlayerGameIndexView): Promise<PlayerPeriodView | null> {
  const key = `${main.season}:${main.size}`;
  let p = cache.get(key);
  if (!p) {
    p = fetchPlayerPeriodIndex(main.season).then((f) => (f && isSupportedPeriodIndex(f) ? viewPlayerPeriodIndex(f, main) : null));
    p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}
