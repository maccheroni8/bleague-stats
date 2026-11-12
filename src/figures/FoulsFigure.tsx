// 図解「ファウル」（チーム・選手）の共通部分。読むのはファウルの導出データ（data/{season}/fouls.json）だけ。説明は用語集（図解：ファウル）
import { useMemo, useRef, type ReactNode } from "react";
import { seasonGameTypeLabels, type SeasonGameTypeFilter } from "../../shared/gameType";
import { enumParam, situationalParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { gameTypeAxis, situationalAxes, type FilterAxis } from "../lib/filterAxes";
import type { SituationalFilter } from "../lib/situational";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { situationalFilterLabels, visibleConditionLabels } from "../lib/conditionLabels";
import { fetchFoulsIndex } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { formatDecimal } from "../lib/format";
import { foulSortLabel, sortFoulRows, topThreeLevels } from "../lib/figureFouls";
import type { FoulsIndexFile } from "../../shared/foulsIndex";
import type { Category } from "../../shared/types";
import { FilterBar } from "../components/FilterBar";
import { ExportTarget } from "../components/ExportTarget";
import { ConditionTitle } from "../components/ConditionTitle";
import { FigureExportButton } from "./FigureExport";
import "./FoulsFigure.css";

const DEFAULT: SituationalFilter = { range: { kind: "all" } };
const rangeCodec: UrlCodec<SituationalFilter> = {
  keys: ["rng"],
  read: p => { const range = situationalParam.read(p)?.range; return range && (range.kind !== "recent" || range.n === 5 || range.n === 10) ? { range } : undefined; },
  write: (p, v) => situationalParam.write(p, { range: v.range }),
};
const gameCodec = { ...enumParam<SeasonGameTypeFilter>("gt", ["regular", "playoff", "both"], "regular"), read: GAME_TYPE_PARAM.read };

/** 試合の範囲・試合区分（今ある図解の表と同じ選び方）と、ファウルの導出データの読み込み */
export function useFoulsScope(season: string, category: Category, stateKey: string) {
  const [filter, setFilter] = useUrlState(rangeCodec, DEFAULT);
  const [gameType, setGameType] = useUrlState(gameCodec, "regular");
  const request = useJsonData(() => fetchFoulsIndex(season, category), [season, category]);
  const rangeAxes = situationalAxes(filter, v => setFilter({ range: v.range })).filter(a => a.id === "s.range" || (filter.range.kind === "dateRange" && (a.id === "s.dateStart" || a.id === "s.dateEnd")))
    .map(a => a.kind === "select" ? { ...a, options: a.options.filter(o => ["all", "recent:5", "recent:10", "custom"].includes(o.value)) } : { ...a, tier: "primary" as const });
  const axes: FilterAxis[] = [...rangeAxes, gameTypeAxis(gameType, setGameType, season)];
  const [periodLabel] = situationalFilterLabels(filter);
  const conditions = visibleConditionLabels([periodLabel ?? "", seasonGameTypeLabels(season)[gameType]].filter(Boolean));
  const filterBar = <FilterBar axes={axes} stateKey={stateKey} onClearAll={() => { setFilter(DEFAULT); setGameType("regular"); }} />;
  return { scope: { gameType, range: filter.range }, conditions, filterBar, request: request as { data: FoulsIndexFile | null | undefined; loading: boolean; error: unknown } };
}

export interface FoulColumn<R> {
  key: string;
  label: string;
  value: (row: R) => number;
}

/** 表ごとの並べ替えの URL（`{param}=列` で多い順・`列:asc` で少ない順）。初期値（主な数の多い順）は URL に載せない */
function sortCodec(param: string, keys: readonly string[], mainKey: string): UrlCodec<{ key: string; descending: boolean }> {
  return {
    keys: [param],
    read: p => {
      const [key, dir] = (p.get(param) ?? "").split(":");
      return key && keys.includes(key) ? { key, descending: dir !== "asc" } : undefined;
    },
    write: (p, v) => { p.delete(param); if (v.key !== mainKey || !v.descending) p.set(param, v.descending ? v.key : `${v.key}:asc`); },
  };
}

/**
 * 1つの表（見出し・保存ボタン・表）。見出しを押すとその列で並べ替え（1回目は多い順、もう1回で少ない順）。初めは mainKey の列の多い順。
 * 順位は並べている列の多い順の順位（少ない順は並びだけ逆）。塗りは並べ替えに関係なく列ごとのトップ3（0 は塗らない）。
 * 保存画像は画面の並びのまま、サブタイトルに並び順（「合計↓」）
 */
export function FoulTable<R>({ title, exportLabel, filename, season, conditions, gameType, rows, rowKey, rowName, columns, mainKey, sortParam, nameHeader, renderName, average, emptyText }: {
  title: string; exportLabel: string; filename: string; season: string; conditions: string[]; gameType: SeasonGameTypeFilter;
  /** 並べる前の行 */
  rows: readonly R[]; rowKey: (row: R) => string; rowName: (row: R) => string; columns: readonly FoulColumn<R>[];
  /** 初めに並べる列（その表の主な数） */
  mainKey: string;
  /** 並べ替えを持つ URL の名前（表ごとに別） */
  sortParam: string;
  nameHeader: string; renderName: (row: R) => ReactNode; average?: boolean; emptyText: string;
}) {
  const target = useRef<HTMLDivElement>(null);
  const baseDate = { kind: "season" as const, season, gameType };
  const codec = useMemo(() => sortCodec(sortParam, columns.map(c => c.key), mainKey), [sortParam, columns, mainKey]);
  const [sortState, setSort] = useUrlState(codec, { key: mainKey, descending: true });
  const sortCol = columns.find(c => c.key === sortState.key) ?? columns.find(c => c.key === mainKey)!;
  const descending = sortCol.key === sortState.key ? sortState.descending : true;
  const main = columns.find(c => c.key === mainKey)!;
  const { rows: sorted, ranks } = useMemo(() => sortFoulRows(rows, sortCol.value, [main, ...columns.filter(c => c !== main)].filter(c => c !== sortCol).map(c => c.value), rowName, descending),
    [rows, sortCol, main, columns, rowName, descending]);
  // 塗りは並びに関係なく、列ごとの多い順トップ3（並べたあとの順の位置に合わせて出す）
  const levels = useMemo(() => columns.map(c => topThreeLevels(sorted.map(r => c.value(r)))), [sorted, columns]);
  const averages = average && rows.length > 0 ? columns.map(c => rows.reduce((n, r) => n + c.value(r), 0) / rows.length) : null;
  const titleConditions = [...conditions, foulSortLabel(sortCol.label, descending)];
  const onSort = (key: string) => setSort({ key, descending: sortCol.key === key ? !descending : true });
  return <section className="fouls-block" aria-label={title}>
    <FigureExportButton label={exportLabel} targetRef={target} filename={`${filename}_${[season, ...titleConditions].join("_")}`} baseDate={baseDate} />
    <ExportTarget ref={target} className="fouls-export" baseDate={baseDate}>
      <ConditionTitle title={title} exportScope={`${season}シーズン`} conditions={titleConditions} />
      {rows.length === 0 ? <p className="empty-message">{emptyText}</p> :
        <div className="fouls-scroll" tabIndex={0} role="region" aria-label={title}>
          <table className={`fouls-table fouls-cols-${columns.length}`}>
            <thead><tr>
              <th className="fouls-rank">#</th>
              <th className="fouls-name">{nameHeader}</th>
              {columns.map(c => {
                const active = c.key === sortCol.key;
                return <th key={c.key} className={`fouls-col${active ? " fouls-sorted" : ""}`} aria-sort={active ? (descending ? "descending" : "ascending") : "none"}>
                  <button type="button" onClick={() => onSort(c.key)} title={active ? (descending ? "多い順（押すと少ない順）" : "少ない順（押すと多い順）") : "押すと多い順に並べ替え"}>
                    {c.label}<span className="export-hide fouls-sort-mark">{active ? (descending ? "↓" : "↑") : "↕"}</span>
                  </button>
                </th>;
              })}
            </tr></thead>
            <tbody>
              {sorted.map((row, i) => <tr key={rowKey(row)}>
                <td className="fouls-rank">{ranks[i]}</td>
                <td className="fouls-name">{renderName(row)}</td>
                {columns.map((c, j) => { const level = levels[j]![i]; return <td key={c.key} className={`fouls-cell${level ? ` fouls-l${level}` : ""}`}>{c.value(row)}</td>; })}
              </tr>)}
              {averages && <tr className="fouls-average">
                <td className="fouls-rank" />
                <td className="fouls-name">平均</td>
                {averages.map((v, j) => <td key={columns[j]!.key} className="fouls-cell">{formatDecimal(v)}</td>)}
              </tr>}
            </tbody>
          </table>
        </div>}
    </ExportTarget>
  </section>;
}

/** 読み込み中・失敗・データなしの表示（無ければ null） */
export function foulsStatus(request: { data: FoulsIndexFile | null | undefined; loading: boolean; error: unknown }): ReactNode {
  if (request.loading) return <p role="status">読み込み中…</p>;
  if (request.error) return <p role="alert">データを読み込めませんでした。ページを読み直してください。</p>;
  if (!request.data) return <p className="empty-message">このシーズンのファウルの記録はありません。</p>;
  return null;
}
