/** ビルドのときに `public/media/catalog/` にある対応表のシーズン（vite.config.ts の define）。 */
declare const __MEDIA_CATALOG_SEASONS__: readonly string[] | undefined;

/** null＝分からない（vite を通さないテストの束ね）。そのときは今までどおり取りに行く。 */
const MEDIA_CATALOG_SEASONS: readonly string[] | null =
  typeof __MEDIA_CATALOG_SEASONS__ === "undefined" ? null : __MEDIA_CATALOG_SEASONS__;

/** 対応表を置いたシーズンか。置いていないシーズンは取りに行かず、読み込み待ちの空枠も出さない（設計書257章）。 */
export function hasMediaCatalog(season: string): boolean {
  return MEDIA_CATALOG_SEASONS === null || MEDIA_CATALOG_SEASONS.includes(season);
}
