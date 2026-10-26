import { useMemo, type ReactNode } from "react";
import { RookieContext, useRookieLookup, type IsRookie } from "../lib/rookieFilter";
import { useLeague } from "../lib/league";

const NO_ROOKIE: IsRookie = () => false;

/**
 * ルーキーの導出データをアプリ全体で1回だけ読み、名前の右の印（RookieBadge）を出す画面に渡す（DESIGN.md 217-3章）。
 * ルーキーの判定は B.PREMIER の規程に準じたものなので、B.ONE の画面では印を出さない（DESIGN.md 297章）
 */
export function RookieProvider({ children }: { children: ReactNode }) {
  const isRookie = useRookieLookup();
  const league = useLeague();
  const value = useMemo(() => (league === "one" ? NO_ROOKIE : isRookie), [league, isRookie]);
  return <RookieContext.Provider value={value}>{children}</RookieContext.Provider>;
}
