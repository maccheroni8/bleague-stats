import { RECENT_N_OPTIONS, type SeasonHalfBoundary, type SituationalFilter } from "../lib/situational";

interface Props {
  filter: SituationalFilter;
  onChange: (filter: SituationalFilter) => void;
  /** シーズン前半戦/後半戦ボタンの境界日。未指定または算出不能（null）の場合はボタン自体を出さない */
  seasonHalfBoundary?: SeasonHalfBoundary | null;
}

export function SituationalFilterPicker({ filter, onChange, seasonHalfBoundary }: Props) {
  const dateRange = filter.kind === "dateRange" ? filter : { start: "", end: "" };
  const includePlayoffs = filter.includePlayoffs ?? false;
  // kind側の切り替えではincludePlayoffsの選択を維持する
  const withKind = (kind: SituationalFilter): SituationalFilter => ({ ...kind, includePlayoffs });
  const isFirstHalf =
    !!seasonHalfBoundary &&
    filter.kind === "dateRange" &&
    filter.start === "" &&
    filter.end === seasonHalfBoundary.firstHalfEnd;
  const isSecondHalf =
    !!seasonHalfBoundary &&
    filter.kind === "dateRange" &&
    filter.start === seasonHalfBoundary.secondHalfStart &&
    filter.end === "";

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
          className={filter.kind === "dateRange" && !isFirstHalf && !isSecondHalf ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "dateRange", start: dateRange.start, end: dateRange.end }))}
        >
          期間指定
        </button>
        {seasonHalfBoundary && (
          <>
            <button
              className={isFirstHalf ? "active" : ""}
              onClick={() =>
                onChange(withKind({ kind: "dateRange", start: "", end: seasonHalfBoundary.firstHalfEnd }))
              }
            >
              前半戦
            </button>
            <button
              className={isSecondHalf ? "active" : ""}
              onClick={() =>
                onChange(withKind({ kind: "dateRange", start: seasonHalfBoundary.secondHalfStart, end: "" }))
              }
            >
              後半戦
            </button>
          </>
        )}
      </div>
      {filter.kind === "dateRange" && (
        <div className="date-range-inputs">
          <input type="date" value={filter.start} onChange={(e) => onChange({ ...filter, start: e.target.value })} />
          <span>〜</span>
          <input type="date" value={filter.end} onChange={(e) => onChange({ ...filter, end: e.target.value })} />
        </div>
      )}
      <div className="mode-toggle">
        <button
          className={filter.kind === "homeAway" && filter.home ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "homeAway", home: true }))}
        >
          ホーム
        </button>
        <button
          className={filter.kind === "homeAway" && !filter.home ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "homeAway", home: false }))}
        >
          アウェイ
        </button>
        <button
          className={filter.kind === "division" && filter.division === "east" ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "division", division: "east" }))}
        >
          対東地区
        </button>
        <button
          className={filter.kind === "division" && filter.division === "west" ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "division", division: "west" }))}
        >
          対西地区
        </button>
      </div>
      <div className="mode-toggle">
        <select
          value={filter.kind === "month" ? String(filter.month) : ""}
          onChange={(e) => {
            const value = e.target.value;
            onChange(value === "" ? withKind({ kind: "all" }) : withKind({ kind: "month", month: Number(value) }));
          }}
        >
          <option value="">月別</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <button
          className={filter.kind === "newYear" && filter.half === "before" ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "newYear", half: "before" }))}
        >
          年明け前
        </button>
        <button
          className={filter.kind === "newYear" && filter.half === "after" ? "active" : ""}
          onClick={() => onChange(withKind({ kind: "newYear", half: "after" }))}
        >
          年明け後
        </button>
        <button className={filter.kind === "weekday" ? "active" : ""} onClick={() => onChange(withKind({ kind: "weekday" }))}>
          平日開催
        </button>
      </div>
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
