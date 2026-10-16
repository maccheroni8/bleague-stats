import type { FinalAffiliation, MediaRequest, MediaResolution } from "../../shared/mediaCatalog.ts";
import { resolveMedia } from "../../shared/mediaResolver.ts";
import { mediaAssetUrl, mediaBaseUrl } from "./mediaCatalogUrls.ts";
import type { MediaCatalogSelectionState } from "./mediaCatalogLoader.ts";

export type CurrentImageReason =
  | "catalog-idle" | "catalog-loading" | "catalog-not-found" | "catalog-network"
  | "catalog-http" | "invalid-catalog" | "invalid-input" | "season-not-loaded"
  | "unconfirmed-affiliation" | "ambiguous" | "no-eligible-image"
  | "asset-not-found" | "asset-load-error";

type SelectedResolution = Exclude<MediaResolution, { status: "missing" }>;
export type PublicMediaSelection =
  | { source: "catalog"; url: string; currentUrl: string; resolution: SelectedResolution }
  | { source: "current"; url: string; reason: CurrentImageReason;
      /** 現在の固定画像を過去シーズンの確認済み画像とは扱わない。 */
      actualSeason: null; affiliationVerified: false; failedCatalogUrl?: string }
  | { source: "none"; reason: "invalid-input" };

/** 既存の固定URLと同じ形。画像・選手マスタ・所属の推測は行わない。 */
export function currentPublicMediaUrl(baseUrl: string, request: Pick<MediaRequest, "kind" | "playerId" | "teamId">): string {
  const id = request.kind === "player" ? request.playerId : request.teamId;
  if (!["player", "team"].includes(request.kind) || !id || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error("invalid-image-id");
  return `${mediaBaseUrl(baseUrl)}data/${request.kind === "player" ? "player-photos" : "logos"}/${id}.${request.kind === "player" ? "webp" : "png"}`;
}

/** 公開画像の選択だけを担当。PNG保存処理には接続しない。
 * season: 確認済み最終所属を別入力する。team/game: 該当チーム・必要なら試合日を明示する。
 * career: 呼び出し側が候補となる全季を取得する。部分的な取得失敗では代表画像を選ばない。
 * 台帳で解決できなければ現在の固定画像。別季の台帳画像への自動流用はしない。
 */
export function selectPublicMedia(options: {
  baseUrl: string;
  request: MediaRequest;
  state: MediaCatalogSelectionState;
  affiliations?: readonly FinalAffiliation[];
}): PublicMediaSelection {
  const { baseUrl, request, state, affiliations } = options;
  let currentUrl: string;
  try { currentUrl = currentPublicMediaUrl(baseUrl, request); }
  catch { return { source: "none", reason: "invalid-input" }; }
  const current = (reason: CurrentImageReason): PublicMediaSelection => ({
    source: "current", url: currentUrl, reason, actualSeason: null, affiliationVerified: false,
  });
  if (state.status === "idle") return current("catalog-idle");
  if (state.status === "loading") return current("catalog-loading");
  if (state.status === "unresolved") {
    const reason: CurrentImageReason = state.reason === "invalid-catalog" || state.reason === "invalid-input"
      ? state.reason : `catalog-${state.reason}`;
    return current(reason);
  }
  const requiredSeason = request.context === "career" ? request.currentSeason : request.season;
  if (!requiredSeason || !state.seasons.includes(requiredSeason)) return current("season-not-loaded");
  const resolution = resolveMedia({ ...request, allowFallback: false }, state.catalog, affiliations);
  if (resolution.status === "missing") return current(resolution.reason);
  return { source: "catalog", url: mediaAssetUrl(baseUrl, resolution.path), currentUrl, resolution };
}

/** 公開画像部品のimg onError用。登録画像の失敗だけを現在画像へ切替え、再帰的な再試行はしない。
 * 404を確認できた呼び出し元だけnot-foundを渡す。通常のimg errorだけではHTTP原因は分からない。
 * 別URLの古い失敗通知を現在の選択に適用しない。React側では同一URLの別世代も区別すること。
 */
export function fallbackPublicMediaImage(
  selected: PublicMediaSelection,
  failedUrl: string,
  failure: "not-found" | "load-error" = "load-error",
): PublicMediaSelection {
  if (selected.source !== "catalog" || selected.url !== failedUrl) return selected;
  return {
    source: "current", url: selected.currentUrl,
    reason: failure === "not-found" ? "asset-not-found" : "asset-load-error",
    actualSeason: null, affiliationVerified: false, failedCatalogUrl: failedUrl,
  };
}
