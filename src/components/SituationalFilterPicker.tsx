import { RECENT_N_OPTIONS, type SituationalFilter } from "../lib/situational";

interface Props {
  filter: SituationalFilter;
  onChange: (filter: SituationalFilter) => void;
}

export function SituationalFilterPicker({ filter, onChange }: Props) {
  const dateRange = filter.kind === "dateRange" ? filter : { start: "", end: "" };
  const includePlayoffs = filter.includePlayoffs ?? false;
  // kind側の切り替えではincludePlayoffsの選択を維持する
  const withKind = (kind: SituationalFilter): SituationalFilter => ({ ...kind, includePlayoffs });

  return (
    <div className="situational-filter">
      <div className="mode-toggle">
        <button className={filter.kind === "all" ? "active" : ""} onClick={() => onChange(withKind({ kind: "all" }))}>
          シーズン全体
        </button>
        {RECENT_N_OPTIONS.map((n) => (
          <button
            key={n}
            className={filter.kind === "recent" && filter.n === n ? "active" : ""}
            onClick={() => onChange(withKind({ kind: "recent", n }))}
          >
            直近{n}試合
          </button>
        ))}
        <button
          className={filter.kind === "result" && filter.win ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "result", win: true }))}
        >
          勝った試合
        </button>
        <button
          className={filter.kind === "result" && !filter.win ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "result", win: false }))}
        >
          負けた試合
        </button>
        <button
          className={filter.kind === "dateRange" ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "dateRange", start: dateRange.start, end: dateRange.end }))}
        >
          期間指定
        </button>
      </div>
      {filter.kind === "dateRange" && (
        <div className="date-range-inputs">
          <input type="date" value={filter.start} onChange={(e) => onChange({ ...filter, start: e.target.value })} />
          <span>〜</span>
          <input type="date" value={filter.end} onChange={(e) => onChange({ ...filter, end: e.target.value })} />
        </div>
      )}
      <div className="mode-toggle">
        <button className={!includePlayoffs ? "active" : ""} onClick={() => onChange({ ...filter, includePlayoffs: false })}>
          レギュラーシーズンのみ
        </button>
        <button className={includePlayoffs ? "active" : ""} onClick={() => onChange({ ...filter, includePlayoffs: true })}>
          レギュラー+ポストシーズン
        </button>
      </div>
    </div>
  );
}
