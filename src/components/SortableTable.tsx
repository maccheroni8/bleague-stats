import { useMemo, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "./SeasonLink";
import { ExternalLinkIcon } from "./ExternalLinkIcon";

export interface Column<T> {
  key: string;
  label: string;
  /** ソート専用の値。表示は format（デフォルト値をそのまま文字列化）または render で決める */
  sortValue: (row: T) => number | string;
  format?: (row: T) => string;
  render?: (row: T) => ReactNode;
  align?: "left" | "right";
}

interface SortableTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  defaultSortKey: string;
  defaultSortDir?: "asc" | "desc";
  linkTo?: (row: T) => string;
  /** 指定時、先頭セルの名前リンクの直後にBリーグ公式サイトへの外部リンクアイコンを表示する
   * （選手名リンクの行でのみ指定する。チーム名等のテーブルでは渡さない） */
  externalLinkTo?: (row: T) => string | undefined;
  /** 指定時、各行の先頭セルに左端の縦線としてチームカラー等のアクセントを付ける */
  rowAccentColor?: (row: T) => string | undefined;
  /**
   * 指定時、rowsを全件ソートした後、先頭からこの件数だけを描画する（「もっと見る」等の
   * 段階的な表示件数拡大と組み合わせるためのページネーション用。ソート自体は常にrows全体を
   * 対象に行うため、limitを使っても列ヘッダークリックでの並び替えは常に全件に対して正しく
   * 機能する。未指定時は従来通りrows全件を描画する）
   */
  limit?: number;
}

export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  defaultSortKey,
  defaultSortDir = "desc",
  linkTo,
  externalLinkTo,
  rowAccentColor,
  limit,
}: SortableTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);

  const sortedRows = useMemo(() => {
    const column = columns.find((c) => c.key === sortKey);
    if (!column) return rows;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = column.sortValue(a);
      const bv = column.sortValue(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  }, [rows, columns, sortKey, sortDir]);

  const visibleRows = limit !== undefined ? sortedRows.slice(0, limit) : sortedRows;

  const handleHeaderClick = (key: string) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <table className="sortable-table">
      <thead>
        <tr>
          {columns.map((col) => (
            <th
              key={col.key}
              className={col.align === "left" ? "align-left" : "align-right"}
              onClick={() => handleHeaderClick(col.key)}
              aria-sort={sortKey === col.key ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
            >
              {col.label}
              {sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {visibleRows.map((row) => {
          const accent = rowAccentColor?.(row);
          return (
            <tr key={rowKey(row)}>
              {columns.map((col, i) => {
                const content: ReactNode = col.render
                  ? col.render(row)
                  : (col.format?.(row) ?? String(col.sortValue(row)));
                const isFirst = i === 0;
                const external = isFirst ? externalLinkTo?.(row) : undefined;
                return (
                  <td
                    key={col.key}
                    className={`${col.align === "left" ? "align-left" : "align-right"}${isFirst && accent ? " row-accent-cell" : ""}${external ? " has-external-link" : ""}`}
                    style={isFirst && accent ? { borderLeftColor: accent } : undefined}
                  >
                    {linkTo ? (
                      <Link to={linkTo(row)} className="cell-link">
                        {content}
                      </Link>
                    ) : (
                      content
                    )}
                    {external && <ExternalLinkIcon href={external} title="Bリーグ公式サイトで見る（新しいタブで開く）" />}
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
