/**
 * 並べ替えの向きの印（ランキング・SortableTable と同じ形。DESIGN.md 381章）。
 * 並べている列にだけ付ける（ほかの列には何も出さない）。asc（小さい順・少ない順）＝▲、desc（大きい順・多い順）＝▼。
 * 色は見出しの文字色のまま。保存画像には写さない（`.sort-mark`＝ランキングと同じ指定で隠す）
 */
export function SortMark({ active, descending }: { active: boolean; descending: boolean }) {
  if (!active) return null;
  return <span className="sort-mark export-hide">{descending ? " ▼" : " ▲"}</span>;
}

/** 副題・ファイル名に書く並び順（「合計▼」＝多い順、「コーチ▲」＝少ない順。画面の印と同じ記号） */
export const sortOrderLabel = (label: string, descending: boolean) => `${label}${descending ? "▼" : "▲"}`;
