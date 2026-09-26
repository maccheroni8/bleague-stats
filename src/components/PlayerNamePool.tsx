import { useMemo, type ReactNode } from "react";
import { duplicatedSurnames, PlayerNamePoolContext } from "../lib/playerLabel";

/** 中の ResponsivePlayerName に、同じ一覧に並ぶ選手の名前を渡す（名字が重なる選手をフルネームのままにするため） */
export function PlayerNamePool({ names, children }: { names: readonly string[]; children: ReactNode }) {
  const key = names.join("\n");
  const value = useMemo(() => duplicatedSurnames(key ? key.split("\n") : []), [key]);
  return <PlayerNamePoolContext.Provider value={value}>{children}</PlayerNamePoolContext.Provider>;
}
