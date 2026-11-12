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
import { competitionRanks, topThreeLevels } from "../lib/figureFouls";
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

/** 1つの表（見出し・保存ボタン・表）。順位は rankColumn（省略は先頭の列）の多い順、塗りは列ごとのトップ3（0 は塗らない） */
export function FoulTable<R>({ title, exportLabel, filename, season, conditions, gameType, rows, rowKey, columns, nameHeader, renderName, average, emptyText, rankColumn }: {
  title: string; exportLabel: string; filename: string; season: string; conditions: string[]; gameType: SeasonGameTypeFilter;
  rows: readonly R[]; rowKey: (row: R) => string; columns: readonly FoulColumn<R>[];
  nameHeader: string; renderName: (row: R) => ReactNode; average?: boolean; emptyText: string;
  /** 順位を付ける列（省略は先頭の列）。行はこの列の多い順に並べて渡す */
  rankColumn?: FoulColumn<R>;
}) {
  const target = useRef<HTMLDivElement>(null);
  const baseDate = { kind: "season" as const, season, gameType };
  const rankBy = rankColumn ?? columns[0]!;
  const ranks = useMemo(() => competitionRanks(rows.map(r => rankBy.value(r))), [rows, rankBy]);
  const levels = useMemo(() => columns.map(c => topThreeLevels(rows.map(r => c.value(r)))), [rows, columns]);
  const averages = average && rows.length > 0 ? columns.map(c => rows.reduce((n, r) => n + c.value(r), 0) / rows.length) : null;
  return <section className="fouls-block" aria-label={title}>
    <FigureExportButton label={exportLabel} targetRef={target} filename={`${filename}_${[season, ...conditions].join("_")}`} baseDate={baseDate} />
    <ExportTarget ref={target} className="fouls-export" baseDate={baseDate}>
      <ConditionTitle title={title} exportScope={`${season}シーズン`} conditions={conditions} />
      {rows.length === 0 ? <p className="empty-message">{emptyText}</p> :
        <div className="fouls-scroll" tabIndex={0} role="region" aria-label={title}>
          <table className={`fouls-table fouls-cols-${columns.length}`}>
            <thead><tr>
              <th className="fouls-rank">#</th>
              <th className="fouls-name">{nameHeader}</th>
              {columns.map(c => <th key={c.key} className="fouls-col">{c.label}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row, i) => <tr key={rowKey(row)}>
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
