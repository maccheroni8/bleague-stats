import { useMemo, useState, type ReactNode } from "react";
import { SeasonLink } from "./SeasonLink";
import { statDescription } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
import { tierClassesFromValues } from "../lib/teamTierColors";
import { formatTtsCount, formatTtsPct, formatTtsSeconds, TTS_TABLE_ITEMS, type TtsPerspective, type TtsRowValues } from "../lib/teamTts";
import { DEFAULT_TTS_VIEW, type TtsView } from "../lib/ttsView";

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
  /** 並べ替えの対象にせず、末尾に固定で出す行（リーグ平均。本数・件数の列は「-」） */
  pinnedRows?: T[];
  /** 先頭に「#」の列を足し、今の並びで上から 1, 2, 3… の通し番号を出す（リーグ平均の行は空欄） */
  rowNumbers?: boolean;
  /** 秒の列に、シュートまでが速い3チームを緑・遅い3チームを赤で塗る（本数・割合の列は塗らない。設計書449章）。opp は逆（相手が遅いほうが良い）、+/- は自チーム−相手なので小さい（負）ほど緑 */
  tierColors?: boolean;
  /** 秒／%の切り替えと内訳の開閉（480章）。省略時は秒・起点の内訳だけ開く */
  view?: TtsView;
  onViewChange?: (view: TtsView) => void;
}

/**
 * Time to Shot の表（DESIGN.md 290章・480章）。項目名の見出しの下に「秒」か「%」（切り替え。TTS・To FT は割合が無いので常に秒）と、
 * TTS・To FT は計測した本数（件数）の列を並べる2段の見出し。内訳（起点ごと・フリースローの種類ごと）は 1st Shot・To FT の見出しの ▸ で開閉する。
 * 見出しにカーソルを当てると日本語名（statJa）の説明が出る。クリックで並べ替え（項目名の見出しは値の列で並べ替える）
 */
export function TtsTable<T>({ leading, rows, rowKey, valuesOf, perspective, linkTo, defaultSortKey, defaultSortDir = "desc", pinnedRows, rowNumbers, tierColors, view = DEFAULT_TTS_VIEW, onViewChange }: TtsTableProps<T>) {
  const [sortKey, setSortKey] = useState(defaultSortKey);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const items = TTS_TABLE_ITEMS.filter((x) => !x.group || view.open.includes(x.group));
  // 1項目の値の列: 割合のある項目は「%」の表示のときだけ割合、ほかは秒
  const kindOf = (x: (typeof TTS_TABLE_ITEMS)[number]): "avg" | "pct" => (x.hasPct && view.unit === "pct" ? "pct" : "avg");
  const valueColumn = (key: string): { item: (typeof TTS_TABLE_ITEMS)[number]["item"]; kind: "avg" | "pct" | "n" } | null => {
    const [kind, item] = key.split(":");
    return (kind === "avg" || kind === "pct" || kind === "n") && item ? { item: item as never, kind } : null;
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
  const toggle = (group: "start" | "ft") =>
    onViewChange?.({ ...view, open: view.open.includes(group) ? view.open.filter((g) => g !== group) : [...view.open, group] });

  // 秒の列ごとの色（teamId ではなく行のキーで引く）
  const tiers = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    if (!tierColors) return map;
    for (const { item } of TTS_TABLE_ITEMS) {
      const entries = rows.map((r) => {
        const avg = valuesOf(r)?.[item]?.avg ?? null;
        return { id: rowKey(r), value: avg === null ? Number.NaN : avg, text: formatTtsSeconds(avg, perspective) };
      });
      map.set(item, tierClassesFromValues(entries, perspective === "opp"));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tierColors, perspective, valuesOf]);

  const cells = (row: T, isLink: boolean, index?: number) => {
    const v = valuesOf(row);
    const to = isLink ? linkTo?.(row) : undefined;
    const wrap = (text: string) => (to ? <SeasonLink to={to} className="cell-link">{text}</SeasonLink> : text);
    return (
      <>
        {rowNumbers && <td className="align-right row-number-cell">{index !== undefined ? index + 1 : ""}</td>}
        {leading.map((c) => (
          <td key={c.key} className={c.align === "left" ? "align-left" : "align-right"}>
            {to ? (
              <SeasonLink to={to} className="cell-link">
                {c.render(row)}
              </SeasonLink>
            ) : (
              c.render(row)
            )}
          </td>
        ))}
        {items.flatMap((x) => {
          const kind = kindOf(x);
          const tier = kind === "avg" && isLink ? tiers.get(x.item)?.get(rowKey(row)) : undefined;
          const value = kind === "pct" ? formatTtsPct(v?.[x.item].pct ?? null, perspective) : formatTtsSeconds(v?.[x.item].avg ?? null, perspective);
          return [
            <td key={`${kind}:${x.item}`} className={`align-right${tier ? ` ${tier}` : ""}`}>
              {wrap(value)}
            </td>,
            ...(x.hasCount
              ? [
                  <td key={`n:${x.item}`} className="align-right tts-count-cell">
                    {wrap(isLink ? formatTtsCount(v?.[x.item].n ?? null, perspective) : "-")}
                  </td>,
                ]
              : []),
          ];
        })}
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
          {items.map((x) => (
            <th key={x.item} colSpan={x.hasCount ? 2 : 1} className={`align-center tts-group-head${x.group ? " tts-group-sub" : ""}`} title={statDescription(x.abbr, "team")}>
              {x.abbr}
              {x.toggles && onViewChange && (
                <button
                  type="button"
                  className="tts-toggle export-hide"
                  aria-expanded={view.open.includes(x.toggles)}
                  title={view.open.includes(x.toggles) ? "内訳を閉じる" : "内訳を開く"}
                  onClick={() => toggle(x.toggles!)}
                >
                  {view.open.includes(x.toggles) ? "◂" : "▸"}
                </button>
              )}
            </th>
          ))}
        </tr>
        <tr>
          {items.flatMap((x) => {
            const kind = kindOf(x);
            const key = `${kind}:${x.item}`;
            const name = kind === "pct" ? `${x.abbr}%` : x.abbr;
            return [
              <th key={key} className="align-right tts-sub-head" onClick={() => click(key)} aria-sort={aria(key)} title={`${statJa(name, "team")}（${name}）`}>
                {kind === "pct" ? "%" : "秒"}
                {mark(key)}
              </th>,
              ...(x.hasCount
                ? [
                    <th key={`n:${x.item}`} className="align-right tts-sub-head" onClick={() => click(`n:${x.item}`)} aria-sort={aria(`n:${x.item}`)} title={`${statJa(`${x.abbr} N`, "team")}（${x.abbr} N）`}>
                      {x.item === "ft" ? "件数" : "本数"}
                      {mark(`n:${x.item}`)}
                    </th>,
                  ]
                : []),
            ];
          })}
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

/** 表の上の「秒／%」の切り替え（480章）。内訳の開閉は表の見出しの ▸ */
export function TtsViewControls({ view, onChange }: { view: TtsView; onChange: (view: TtsView) => void }) {
  return (
    <div className="tts-view-controls export-hide" role="group" aria-label="表示する値">
      {(["s", "pct"] as const).map((u) => (
        <button key={u} type="button" className={`tab-button${view.unit === u ? " active" : ""}`} aria-pressed={view.unit === u} onClick={() => onChange({ ...view, unit: u })}>
          {u === "s" ? "秒" : "%"}
        </button>
      ))}
      <span className="tts-view-hint">内訳は 1st Shot・To FT の見出しの ▸ で開閉できます</span>
    </div>
  );
}

/** 表の下の「項目の名前」（日本語名の一覧）。カーソルを当てられないスマホ幅でも日本語名が見られるよう、開いて読める形で出す */
export function TtsNameLegend() {
  return (
    <details className="tts-name-legend">
      <summary>項目の名前（日本語）</summary>
      <dl>
        {TTS_TABLE_ITEMS.map(({ abbr, hasPct, hasCount }) => (
          <div key={abbr}>
            <dt>{abbr}</dt>
            <dd>
              {statJa(abbr, "team")}
              {hasPct ? `／${statJa(`${abbr}%`, "team")}` : ""}
              {hasCount ? `／${statJa(`${abbr} N`, "team")}` : ""}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
