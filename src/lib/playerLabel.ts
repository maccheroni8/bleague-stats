// スマホ幅（560px以下）では選手名を名字だけにする（CLAUDE.md のルール。2026-09-26）。
// ページのタイトル・見出し（h1〜h4）以外の選手名はすべてこれを通す。同じ一覧の中で名字が重なる選手はフルネームのまま
import { createContext, useContext, useMemo } from "react";
import { surnameOf } from "./playerSurname";
import { useNarrow } from "./teamLabel";

/** 名前の一覧のうち、名字が重なる（名字が同じで名前が違う）ものの名字 */
export function duplicatedSurnames(names: readonly string[]): Set<string> {
  const bySurname = new Map<string, Set<string>>();
  for (const n of names) {
    const s = surnameOf(n);
    if (!bySurname.has(s)) bySurname.set(s, new Set());
    bySurname.get(s)!.add(n);
  }
  return new Set([...bySurname].filter(([, v]) => v.size > 1).map(([s]) => s));
}

/** 表の列定義のように一覧を直接渡しにくい箇所用に、同じ一覧の「名字が重なる名字」を配る（PlayerNamePool） */
export const PlayerNamePoolContext = createContext<Set<string> | null>(null);

/**
 * 画面幅に応じた選手名を返す関数。names に同じ一覧に並ぶ選手の名前をすべて渡すと、名字が重なる選手はフルネームにする
 * （省略時は PlayerNamePool の一覧、それも無ければ重なりを見ない）
 */
export function usePlayerLabel(names?: readonly string[]): (name: string) => string {
  const narrow = useNarrow();
  const pool = useContext(PlayerNamePoolContext);
  const key = names ? names.join("\n") : null;
  const own = useMemo(() => (key === null ? null : duplicatedSurnames(key ? key.split("\n") : [])), [key]);
  const duplicated = own ?? pool;
  return (name) => {
    if (!narrow) return name;
    const s = surnameOf(name);
    return duplicated?.has(s) ? name : s;
  };
}
