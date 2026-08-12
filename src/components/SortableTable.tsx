import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

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
}

export function SortableTable<T>({
  columns,
  rows,
  rowKey,
  defaultSortKey,
  defaultSortDir = "desc",
  linkTo,
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
        {sortedRows.map((row) => (
          <tr key={rowKey(row)}>
            {columns.map((col) => {
              const content: ReactNode = col.render ? col.render(row) : (col.format?.(row) ?? String(col.sortValue(row)));
              return (
                <td key={col.key} className={col.align === "left" ? "align-left" : "align-right"}>
                  {linkTo ? (
                    <Link to={linkTo(row)} className="cell-link">
                      {content}
                    </Link>
                  ) : (
                    content
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
