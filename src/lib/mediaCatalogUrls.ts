import { validMediaPath, validMediaSeason } from "../../shared/mediaCatalogValidation.ts";

/** Pagesのサブパス用。外部ホスト・クエリ・パス遡及は許可しない。 */
export function mediaBaseUrl(baseUrl: string): string {
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]*$/.test(baseUrl)) throw new Error("invalid-base-url");
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}
/** public/media/catalog/ 配信用。既存の圧縮JSON取得経路とは独立させる。 */
export function mediaCatalogUrl(baseUrl: string, season: string): string {
  if (!validMediaSeason(season)) throw new Error("invalid-season");
  return `${mediaBaseUrl(baseUrl)}media/catalog/${season}.json`;
}
export function mediaAssetUrl(baseUrl: string, assetPath: string): string {
  if (!validMediaPath(assetPath)) throw new Error("invalid-asset-path");
  return `${mediaBaseUrl(baseUrl)}${assetPath}`;
}
