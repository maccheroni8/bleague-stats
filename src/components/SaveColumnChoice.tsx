import { useState } from "react";

/**
 * 表の画像保存で「載せる列」を選ぶ部品（順位表・条件別順位表で共通）。選んだ列だけが保存画像に載る（画面の表は変わらない）。
 * 列は SortableTable が付ける data-col（列のキー）で指す。チームの列は常に載せる（選択肢に入れない）
 */
export function useSaveHiddenColumns() {
  return useState<string[]>([]);
}

export function SaveColumnChoice({
  choices,
  hidden,
  onChange,
}: {
  choices: { key: string; label: string }[];
  hidden: string[];
  onChange: (hidden: string[]) => void;
}) {
  return (
    <span className="export-option-group" role="group" aria-label="載せる列">
      <span className="export-option-label">載せる列</span>
      <button type="button" className={hidden.length === 0 ? "active" : ""} onClick={() => onChange([])}>
        すべて
      </button>
      {choices.map((c) => {
        const on = !hidden.includes(c.key);
        return (
          <button
            key={c.key}
            type="button"
            className={on ? "active" : ""}
            aria-pressed={on}
            onClick={() => onChange(hidden.includes(c.key) ? hidden.filter((k) => k !== c.key) : [...hidden, c.key])}
          >
            {c.label}
          </button>
        );
      })}
    </span>
  );
}

/** 保存画像の中でだけ、選ばなかった列を隠す（複製側に付く .export-rendering の中だけで効く）。alias は同じ選択に従う別のキー（WC順位は全体順位に従う） */
export function SaveColumnHide({ hidden, alias = {} }: { hidden: string[]; alias?: Record<string, string[]> }) {
  if (hidden.length === 0) return null;
  const keys = hidden.flatMap((k) => [k, ...(alias[k] ?? [])]);
  const css = keys.map((k) => `.export-rendering [data-col="${k}"]{display:none}`).join("\n");
  return <style>{css}</style>;
}
