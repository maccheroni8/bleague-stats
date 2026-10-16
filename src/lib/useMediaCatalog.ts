import { useEffect, useMemo, useState } from "react";
import { getBrowserMediaCatalogLoader } from "./browserMediaCatalogLoader";
import { createMediaCatalogSelection, type MediaCatalogLoader, type MediaCatalogSelectionState } from "./mediaCatalogLoader";

/** 親の表示領域で一度だけ使用する。変更された季の古い結果はrender時点から返さない。 */
export function useMediaCatalog(seasons: readonly string[], suppliedLoader?: MediaCatalogLoader): MediaCatalogSelectionState {
  const loader = useMemo(() => suppliedLoader ?? getBrowserMediaCatalogLoader(), [suppliedLoader]);
  const key = JSON.stringify([...new Set(seasons)].sort());
  // A→B→Aでも以前のAのreadyを再利用せず、新しい読み込み単位として扱う。
  const selection = useMemo(() => createMediaCatalogSelection(loader), [loader, key]);
  const [result, setResult] = useState<{ selection: typeof selection; key: string; state: MediaCatalogSelectionState } | null>(null);
  useEffect(() => {
    let active = true;
    const selected: string[] = JSON.parse(key);
    if (selected.length === 0) return; // 対象外チームではHTTP取得も結果の更新も行わない。
    void selection.select(selected).then(state => {
      if (active && state.status !== "superseded") setResult({ selection, key, state });
    });
    return () => { active = false; selection.reset(); };
  }, [selection, key]);
  if (seasons.length === 0) return { status: "idle" };
  if (result?.selection !== selection || result.key !== key) return { status: "loading", seasons };
  return result.state;
}
