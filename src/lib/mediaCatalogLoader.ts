import type { MediaAsset, MediaBinding, MediaCatalog } from "../../shared/mediaCatalog.ts";
import { parseMediaCatalogText } from "../../shared/mediaCatalogJson.ts";
import { validateMediaCatalog, type MediaIssue } from "../../shared/mediaCatalogValidation.ts";
import { mediaBaseUrl, mediaCatalogUrl } from "./mediaCatalogUrls.ts";

export type MediaCatalogLoadResult =
  | { status: "ready"; seasons: readonly string[]; catalog: MediaCatalog }
  | { status: "unresolved"; seasons: readonly string[]; reason: "invalid-input" | "network" | "not-found" | "http" | "invalid-catalog"; issues: readonly MediaIssue[] };

export type MediaCatalogFetch = (url: string, init: { cache: "no-cache" }) => Promise<{
  ok: boolean; status: number; text(): Promise<string>;
}>;

function failure(seasons: readonly string[], reason: Extract<MediaCatalogLoadResult, { status: "unresolved" }>["reason"], issues: readonly MediaIssue[] = []): MediaCatalogLoadResult {
  return { status: "unresolved", seasons, reason, issues };
}
/** 共有リクエストの結果を呼び出し側が書き換えても、別の表示へ影響させない。 */
function freeze(value: unknown): void {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
}

export function createMediaCatalogLoader(options: { baseUrl: string; fetcher: MediaCatalogFetch }) {
  const baseUrl = mediaBaseUrl(options.baseUrl);
  const pending = new Map<string, Promise<MediaCatalogLoadResult>>();

  async function fetchSeason(season: string, url: string): Promise<MediaCatalogLoadResult> {
    try {
      const response = await options.fetcher(url, { cache: "no-cache" });
      if (!response.ok) return failure([season], response.status === 404 ? "not-found" : "http", [{ code: "http-error", location: url, message: `HTTP ${response.status}` }]);
      const parsed = parseMediaCatalogText(await response.text());
      if (!parsed.ok) return failure([season], "invalid-catalog", parsed.issues);
      if (parsed.catalog.bindings.some(b => b.season !== season)) {
        return failure([season], "invalid-catalog", [{ code: "season-mismatch", location: url, message: "要求したシーズン以外の対応が含まれています" }]);
      }
      return { status: "ready", seasons: [season], catalog: parsed.catalog };
    } catch {
      return failure([season], "network", [{ code: "fetch-failed", location: url, message: "台帳の取得または応答の読み取りに失敗しました" }]);
    }
  }

  function load(season: string): Promise<MediaCatalogLoadResult> {
    let url: string;
    try { url = mediaCatalogUrl(baseUrl, season); }
    catch { return Promise.resolve(failure([season], "invalid-input")); }
    const active = pending.get(url);
    if (active) return active;
    const task = fetchSeason(season, url).then(result => { freeze(result); return result; });
    pending.set(url, task);
    void task.finally(() => { if (pending.get(url) === task) pending.delete(url); });
    return task;
  }

  /** fallback・通算のため必要なシーズン集合を明示して読み込む。失敗時に部分台帳を返さない。 */
  async function loadMany(input: readonly string[]): Promise<MediaCatalogLoadResult> {
    const seasons = [...new Set(input)].sort();
    if (!seasons.length) return failure(seasons, "invalid-input");
    try { for (const season of seasons) mediaCatalogUrl(baseUrl, season); }
    catch { return failure(seasons, "invalid-input"); }
    const results = await Promise.all(seasons.map(load));
    const assets = new Map<string, MediaAsset>();
    const bindings: MediaBinding[] = [];
    for (const result of results) {
      if (result.status !== "ready") return failure(seasons, result.reason, result.issues);
      for (const asset of result.catalog.assets) {
        const previous = assets.get(asset.assetId);
        if (previous && JSON.stringify(previous) !== JSON.stringify(asset)) {
          return failure(seasons, "invalid-catalog", [{ code: "conflicting-asset", location: asset.assetId, message: "シーズン間で同じassetIdの内容・権利情報が異なります" }]);
        }
        assets.set(asset.assetId, asset);
      }
      bindings.push(...result.catalog.bindings);
    }
    const catalog: MediaCatalog = { schemaVersion: 1, assets: [...assets.values()], bindings };
    const issues = validateMediaCatalog(catalog);
    const result: MediaCatalogLoadResult = issues.length ? failure(seasons, "invalid-catalog", issues) : { status: "ready", seasons, catalog };
    freeze(result);
    return result;
  }
  // 成功・失敗とも永続キャッシュに残さない。次の読み込みは再検証し、古い許諾を固定しない。
  return { load, loadMany };
}

export type MediaCatalogLoader = ReturnType<typeof createMediaCatalogLoader>;
export type MediaCatalogSelectionState = MediaCatalogLoadResult | { status: "idle" } | { status: "loading"; seasons: readonly string[] };
export type MediaCatalogSelectionResult = MediaCatalogLoadResult | { status: "superseded" };

/** 表示領域ごとに作成する。loaderは共有しても世代番号は共有しない。 */
export function createMediaCatalogSelection(loader: MediaCatalogLoader) {
  let generation = 0;
  let state: MediaCatalogSelectionState = { status: "idle" };
  return {
    async select(input: readonly string[]): Promise<MediaCatalogSelectionResult> {
      const own = ++generation;
      const seasons = [...input];
      state = { status: "loading", seasons };
      freeze(state); // 切替直後から以前のreadyを表示させない。
      const result = await loader.loadMany(seasons);
      if (own !== generation) return { status: "superseded" };
      state = result;
      return result;
    },
    reset() { generation++; state = { status: "idle" }; },
    getState(): MediaCatalogSelectionState { return state; },
  };
}
