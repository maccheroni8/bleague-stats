import type { ReactNode } from "react";
import { RookieContext, useRookieLookup } from "../lib/rookieFilter";

/** ルーキーの導出データをアプリ全体で1回だけ読み、名前の右の印（RookieBadge）を出す画面に渡す（DESIGN.md 217-3章） */
export function RookieProvider({ children }: { children: ReactNode }) {
  const isRookie = useRookieLookup();
  return <RookieContext.Provider value={isRookie}>{children}</RookieContext.Provider>;
}
