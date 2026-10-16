import { createContext, useContext, type ReactNode } from "react";
import type { MediaCatalogLoader, MediaCatalogSelectionState } from "../lib/mediaCatalogLoader";
import { useMediaCatalog } from "../lib/useMediaCatalog";

const MediaContext = createContext<{ state: MediaCatalogSelectionState; baseUrl: string } | null>(null);

/** 明示的に設置した親だけが台帳を取得。子のPlayerPhoto/TeamLogoはfetchしない。
 * fallback/通算では候補となる全シーズンをseasonsに渡す。loader/baseUrlはテスト時に差し替え可能。
 */
export function MediaCatalogProvider({ seasons, loader, baseUrl = import.meta.env.BASE_URL, children }: {
  seasons: readonly string[];
  loader?: MediaCatalogLoader;
  baseUrl?: string;
  children: ReactNode;
}) {
  const state = useMediaCatalog(seasons, loader);
  return <MediaContext.Provider value={{ state, baseUrl }}>{children}</MediaContext.Provider>;
}

export function useMediaCatalogContext() { return useContext(MediaContext); }
