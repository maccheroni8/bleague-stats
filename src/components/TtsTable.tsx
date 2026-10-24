import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { statDescription } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
import { formatTtsPct, formatTtsSeconds, TTS_TABLE_ITEMS, type TtsPerspective, type TtsRowValues } from "../lib/teamTts";

/** 先頭側の列（チーム・シーズン・G など）。見出しは2行分の高さ（rowSpan=2）。sortValue は並べ替え用 */
export interface TtsLeadingColumn<T> {
  key: string;
  label: string;
  align?: "left" | "right";
  sortValue: (row: T) => number | string;
  render: (row: T) => ReactNode;
}

interface TtsTableProps<T> {
  leading: TtsLeadingColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** 行の値。null は「-」（対象外のシーズンなど） */
  valuesOf: (row: T) => TtsRowValues | null;
  perspective: TtsPerspective;
  linkTo?: (row: T) => string | undefined;
  defaultSortKey: string;
  defaultSortDir?: "asc" | "desc";
  /** 並べ替えの対象にせず、末尾に固定で出す行（リーグ平均） */
  pinnedRows?: T[];
  /** 先頭に「#」の列を足し、今の並びで上から 1, 2, 3… の通し番号を出す（リーグ平均の行は空欄） */
  rowNumbers?: boolean;
}

/**
 * Time to Shot の表（DESIGN.md 290章）。項目名の見出しの下に「秒」と「%」の2列を並べる2段の見出し（TTS は「秒」だけ）。
 * 見出しにカーソルを当てると日本語名（statJa）の説明が出る。クリックで並べ替え（項目名の見出しは「秒」の列で並べ替える）
 */
export function TtsTable<T>({ leading, rows, rowKey, valuesOf, perspective, linkTo, defaultSortKey, defaultSortDir = "desc", pinnedRows, rowNumbers }: TtsTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const valueColumn = (key: string): { item: (typeof TTS_TABLE_ITEMS)[number]["item"]; kind: "avg" | "pct" } | null => {
    const [kind, item] = key.split(":");
    return (kind === "avg" || kind === "pct") && item ? { item: item as never, kind } : null;
  };
  const sortedRows = useMemo(() => {
    const lead = leading.find((c) => c.key === sortKey);
    const vc = valueColumn(sortKey);
    const factor = sortDir === "asc" ? 1 : -1;
    // 値が無い行（対象外・延長の無いチームなど）は、並べ替えの向きによらず最後に置く
    const sortValue = (r: T): number | string | null => {
      if (lead) return lead.sortValue(r);
      return vc ? (valuesOf(r)?.[vc.item]?.[vc.kind] ?? null) : null;
    };
    return [...rows].sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av === null || bv === null) return av === bv ? 0 : av === null ? 1 : -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, leading, sortKey, sortDir, valuesOf]);

  const click = (key: string) => {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const mark = (key: string) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const aria = (key: string) => (sortKey === key ? (sortDir === "asc" ? ("ascending" as const) : ("descending" as const)) : undefined);

  const cells = (row: T, isLink: boolean, index?: number) => {
    const v = valuesOf(row);
    const to = isLink ? linkTo?.(row) : undefined;
    return (
      <>
        {rowNumbers && <td className="align-right row-number-cell">{index !== undefined ? index + 1 : ""}</td>}
        {leading.map((c) => (
          <td key={c.key} className={c.align === "left" ? "align-left" : "align-right"}>
            {to ? (
              <Link to={to} className="cell-link">
                {c.render(row)}
              </Link>
            ) : (
              c.render(row)
            )}
          </td>
        ))}
        {TTS_TABLE_ITEMS.flatMap(({ item, hasPct }) => [
          <td key={`avg:${item}`} className="align-right">
            {to ? <Link to={to} className="cell-link">{formatTtsSeconds(v?.[item].avg ?? null, perspective)}</Link> : formatTtsSeconds(v?.[item].avg ?? null, perspective)}
          </td>,
          ...(hasPct
            ? [
                <td key={`pct:${item}`} className="align-right">
                  {to ? <Link to={to} className="cell-link">{formatTtsPct(v?.[item].pct ?? null, perspective)}</Link> : formatTtsPct(v?.[item].pct ?? null, perspective)}
                </td>,
              ]
            : []),
        ])}
      </>
    );
  };

  return (
    <table className={rowNumbers ? "sortable-table tts-table has-row-number" : "sortable-table tts-table"}>
      <thead>
        <tr>
          {rowNumbers && (
            <th rowSpan={2} className="align-right row-number-cell" title="今の並びでの上からの番号">
              #
            </th>
          )}
          {leading.map((c) => (
            <th key={c.key} rowSpan={2} className={c.align === "left" ? "align-left" : "align-right"} onClick={() => click(c.key)} aria-sort={aria(c.key)} title={statDescription(c.label, "team")}>
              {c.label}
              {mark(c.key)}
            </th>
          ))}
          {TTS_TABLE_ITEMS.map(({ item, abbr, hasPct }) => (
            <th key={item} colSpan={hasPct ? 2 : 1} className="align-center tts-group-head" title={statDescription(abbr, "team")}>
              {abbr}
            </th>
          ))}
        </tr>
        <tr>
          {TTS_TABLE_ITEMS.flatMap(({ item, abbr, hasPct }) => [
            <th key={`avg:${item}`} className="align-right tts-sub-head" onClick={() => click(`avg:${item}`)} aria-sort={aria(`avg:${item}`)} title={`${statJa(abbr, "team")}（${abbr}）`}>
              秒{mark(`avg:${item}`)}
            </th>,
            ...(hasPct
              ? [
                  <th key={`pct:${item}`} className="align-right tts-sub-head" onClick={() => click(`pct:${item}`)} aria-sort={aria(`pct:${item}`)} title={`${statJa(`${abbr}%`, "team")}（${abbr}%）`}>
                    %{mark(`pct:${item}`)}
                  </th>,
                ]
              : []),
          ])}
        </tr>
      </thead>
      <tbody>
        {sortedRows.map((row, i) => (
          <tr key={rowKey(row)}>{cells(row, true, i)}</tr>
        ))}
        {pinnedRows?.map((row) => (
          <tr key={`pinned-${rowKey(row)}`} className="pinned-row">
            {cells(row, false)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** 表の下の「項目の名前」（日本語名の一覧）。カーソルを当てられないスマホ幅でも日本語名が見られるよう、開いて読める形で出す */
export function TtsNameLegend() {
  return (
    <details className="tts-name-legend">
      <summary>項目の名前（日本語）</summary>
      <dl>
        {TTS_TABLE_ITEMS.map(({ abbr, hasPct }) => (
          <div key={abbr}>
            <dt>{abbr}</dt>
            <dd>
              {statJa(abbr, "team")}
              {hasPct ? `／${statJa(`${abbr}%`, "team")}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
