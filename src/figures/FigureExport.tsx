import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode, type RefObject } from "react";
import { ExportImageButton, type ExportChoice } from "../components/ExportImageButton";
import { baseDateSpecKey, type BaseDateSpec } from "../lib/dataBaseDate";

interface Entry {
  id: string;
  label?: string;
  targetRef: RefObject<HTMLElement | null>;
  filename: string;
  baseDate?: BaseDateSpec;
}

interface Registry {
  set: (entry: Entry) => void;
  remove: (id: string) => void;
}

const FigureExportRegistry = createContext<Registry | null>(null);

/**
 * 図解ページの保存ボタン（見出し「図解」の行の右端に1つだけ）。図の中の `FigureExportButton` が保存の対象を登録し、
 * 1つの図に対象が複数あるとき（地区別・表が3つなど）は、保存の窓の中でどれを保存するか選ぶ
 */
export function FigureExportProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const set = useCallback((entry: Entry) => {
    setEntries((prev) => {
      const i = prev.findIndex((e) => e.id === entry.id);
      if (i < 0) return [...prev, entry];
      const old = prev[i]!;
      if (old.label === entry.label && old.filename === entry.filename && old.targetRef === entry.targetRef && (old.baseDate ? baseDateSpecKey(old.baseDate) : "") === (entry.baseDate ? baseDateSpecKey(entry.baseDate) : "")) return prev;
      const next = prev.slice();
      next[i] = entry;
      return next;
    });
  }, []);
  const remove = useCallback((id: string) => setEntries((prev) => prev.filter((e) => e.id !== id)), []);
  const registry = useMemo(() => ({ set, remove }), [set, remove]);
  const choices: ExportChoice[] = entries.map((e, i) => ({ key: e.id, label: e.label ?? `図${i + 1}`, targetRef: e.targetRef, filename: e.filename, baseDate: e.baseDate }));
  return (
    <FigureExportRegistry.Provider value={registry}>
      {children}
      {choices.length > 0 && <ExportImageButton choices={choices} />}
    </FigureExportRegistry.Provider>
  );
}

/** 図の保存の対象を登録する（画面には何も出さない）。label は対象が複数あるときの選択肢の名前 */
export function FigureExportButton({ label, targetRef, filename, baseDate }: { label?: string; targetRef: RefObject<HTMLElement | null>; filename: string; baseDate?: BaseDateSpec }) {
  const registry = useContext(FigureExportRegistry);
  const id = useId();
  useEffect(() => {
    registry?.set({ id, label, targetRef, filename, baseDate });
  }, [registry, id, label, targetRef, filename, baseDate]);
  useEffect(() => () => registry?.remove(id), [registry, id]);
  return null;
}
