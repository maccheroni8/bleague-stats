// チームの成績の登録区分別（teamClassSplit.ts。DESIGN.md 288章）に使う索引のブラウザでの読み込み。
// 選手の1試合行の索引（gameIndexLoad.ts の記憶を使い回す）と、ペイント内外・DQFOUL 用のピリオド別の索引から、シーズンごとの合計（ClassSplitSource）を作って持つ。
// 区分を選んだときだけ・シーズンの行を開いたときだけ読む（初期表示では読まない）。同じシーズンは、ページを開いている間メモリに持つ。
// 試合全体の索引が読めなければ null（呼び出し側は区分別を出せないことを示す）。ピリオド別の索引だけが読めないときは、ペイント内外・DQFOUL を「記録なし」にして続ける。
// 失敗（null・通信の失敗）は持たず、次の呼び出しでやり直す。集計のコードから読まれない場所（保存キーの対象外）に置く。
import { leagueCacheKey, type League } from "./league";
import { useEffect, useMemo, useState } from "react";
import { fetchPlayerPeriodIndex } from "./data";
import { loadPlayerGameIndex } from "./gameIndexLoad";
import { isSupportedPeriodIndex } from "./periodIndex";
import { buildClassSplitSource, type ClassSplitSource } from "./teamClassSplit";

const cache = new Map<string, Promise<ClassSplitSource | null>>();

export function loadClassSplitSource(season: string, league: League = "premier"): Promise<ClassSplitSource | null> {
  const key = leagueCacheKey(season, league);
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const main = await loadPlayerGameIndex(season, league);
      if (!main) return null;
      const period = await fetchPlayerPeriodIndex(season, league).catch(() => null);
      return buildClassSplitSource(main.file, period && isSupportedPeriodIndex(period) ? period : null);
    })();
    p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** 1シーズンの読み込みの状態 */
export type ClassSplitSourceState = { status: "loading" } | { status: "ready"; source: ClassSplitSource } | { status: "unreadable" };

/**
 * enabled の間だけ、指定したシーズンの索引を読む。読み込みが終わったシーズンから順に state に入る（全部を待たずに行を出せる）。
 * 読めなかった（ファイルが無い・古い形式・通信の失敗）シーズンは unreadable。読み直すときは retry()。
 * チーム詳細は、開いたシーズンだけを seasons に渡す（開くたびに増やす）
 */
export function useClassSplitSources(
  seasons: readonly string[],
  enabled: boolean,
): { states: Map<string, ClassSplitSourceState>; retry: () => void } {
  const seasonsKey = seasons.join(",");
  const [loaded, setLoaded] = useState<Map<string, ClassSplitSourceState>>(new Map());
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    for (const season of seasonsKey ? seasonsKey.split(",") : []) {
      if (loaded.get(season)?.status === "ready") continue;
      loadClassSplitSource(season).then(
        (source) => alive && setLoaded((prev) => new Map(prev).set(season, source ? { status: "ready", source } : { status: "unreadable" })),
        () => alive && setLoaded((prev) => new Map(prev).set(season, { status: "unreadable" })),
      );
    }
    return () => {
      alive = false;
    };
    // loaded は読み込み済みを飛ばす判定にだけ使う（deps に入れると、読み込みのたびにやり直す）
  }, [seasonsKey, enabled, nonce]);
  const states = useMemo(() => {
    const m = new Map<string, ClassSplitSourceState>();
    for (const s of seasonsKey ? seasonsKey.split(",") : []) m.set(s, loaded.get(s) ?? { status: "loading" });
    return m;
  }, [seasonsKey, loaded]);
  return {
    states,
    retry: () => {
      setLoaded((prev) => {
        const next = new Map(prev);
        for (const [k, v] of prev) if (v.status === "unreadable") next.delete(k);
        return next;
      });
      setNonce((n) => n + 1);
    },
  };
}

/** 全チームスタッツ用: 1シーズンだけ読む */
export function useClassSplitSource(season: string, enabled: boolean): { state: ClassSplitSourceState; retry: () => void } {
  const seasons = useMemo(() => [season], [season]);
  const { states, retry } = useClassSplitSources(seasons, enabled);
  return { state: states.get(season) ?? { status: "loading" }, retry };
}
