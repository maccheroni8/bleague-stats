import { createMediaCatalogLoader, type MediaCatalogLoader } from "./mediaCatalogLoader.ts";

let sharedLoader: MediaCatalogLoader | undefined;
/** ViteのBASE_URLを使う接続入口。呼ぶだけではHTTP取得しない。明示的に配置したProviderから使用する。 */
export function getBrowserMediaCatalogLoader(): MediaCatalogLoader {
  sharedLoader ??= createMediaCatalogLoader({
    baseUrl: import.meta.env.BASE_URL,
    fetcher: (url, init) => fetch(url, init),
  });
  return sharedLoader;
}
