import { RECENT_N_OPTIONS, type SeasonHalfBoundary, type SituationalAndFilters, type SituationalFilter } from "../lib/situational";

interface Props {
  filter: SituationalFilter;
  onChange: (filter: SituationalFilter) => void;
  /** シーズン前半戦/後半戦ボタンの境界日。未指定または算出不能（null）の場合はボタン自体を出さない */
  seasonHalfBoundary?: SeasonHalfBoundary | null;
  /** 「対勝率別」ボタンの表示可否（対戦相手の勝率算出にシーズン全体の試合日程が必要なため） */
  opponentWinRateSupported?: boolean;
  /**
   * 末尾の「レギュラーシーズンのみ/レギュラー+ポストシーズン」トグルを非表示にする。
   * 呼び出し側が別途レギュラー/プレーオフ/合算の3値トグル（SeasonGameTypeFilter）を
   * 持ち、そちらに一本化したい場合に指定する（個人詳細ページの比較タブ参照）
   */
  hideGameTypeToggle?: boolean;
}

/**
 * シチュエーション別フィルタの共通部品。「試合の範囲」（シーズン全体/直近N試合/期間指定。
 * 前半戦・後半戦はdateRangeの特殊値）は互いに排他な単一選択のまま、それ以外の軸（勝敗・会場・
 * 地区・月別・年明け前後・平日開催・対勝率別）は独立にON/OFFできAND条件で絞り込まれる
 * （ショットチャート専用フィルタ ShotChartFilterPicker と同じtoggle方式。2026-08-29、
 * 複数選択（AND条件）に対応した。DESIGN.md参照）
 */
export function SituationalFilterPicker({
  filter,
  onChange,
  seasonHalfBoundary,
  opponentWinRateSupported,
  hideGameTypeToggle,
}: Props) {
  const dateRange = filter.range.kind === "dateRange" ? filter.range : { start: "", end: "" };
  const includePlayoffs = filter.includePlayoffs ?? false;
  const isFirstHalf =
    !!seasonHalfBoundary &&
    filter.range.kind === "dateRange" &&
    filter.range.start === "" &&
    filter.range.end === seasonHalfBoundary.firstHalfEnd;
  const isSecondHalf =
    !!seasonHalfBoundary &&
    filter.range.kind === "dateRange" &&
    filter.range.start === seasonHalfBoundary.secondHalfStart &&
    filter.range.end === "";

  const toggle = <K extends keyof SituationalAndFilters>(key: K, value: NonNullable<SituationalAndFilters[K]>) => {
    onChange({ ...filter, [key]: filter[key] === value ? undefined : value });
  };

  return (
    <div className="situational-filter">
      <div className="mode-toggle">
        <button className={filter.range.kind === "all" ? "active" : ""} onClick={() => onChange({ ...filter, range: { kind: "all" } })}>
          シーズン全体
        </button>
        {RECENT_N_OPTIONS.map((n) => (
          <button
            key={n}
            className={filter.range.kind === "recent" && filter.range.n === n ? "active" : ""}
            onClick={() => onChange({ ...filter, range: { kind: "recent", n } })}
          >
            直近{n}試合
          </button>
        ))}
        <button
          className={filter.range.kind === "dateRange" && !isFirstHalf && !isSecondHalf ? "active" : ""}
          onClick={() => onChange({ ...filter, range: { kind: "dateRange", start: dateRange.start, end: dateRange.end } })}
        >
          期間指定
        </button>
        {seasonHalfBoundary && (
          <>
            <button
              className={isFirstHalf ? "active" : ""}
              onClick={() =>
                onChange({ ...filter, range: { kind: "dateRange", start: "", end: seasonHalfBoundary.firstHalfEnd } })
              }
            >
              前半戦
            </button>
            <button
              className={isSecondHalf ? "active" : ""}
              onClick={() =>
                onChange({ ...filter, range: { kind: "dateRange", start: seasonHalfBoundary.secondHalfStart, end: "" } })
              }
            >
              後半戦
            </button>
          </>
        )}
      </div>
      {filter.range.kind === "dateRange" && (
        <div className="date-range-inputs">
          <input
            type="date"
            value={dateRange.start}
            onChange={(e) => onChange({ ...filter, range: { kind: "dateRange", start: e.target.value, end: dateRange.end } })}
          />
          <span>〜</span>
          <input
            type="date"
            value={dateRange.end}
            onChange={(e) => onChange({ ...filter, range: { kind: "dateRange", start: dateRange.start, end: e.target.value } })}
          />
        </div>
      )}
      <div className="mode-toggle">
        <button className={filter.result === "win" ? "active" : ""} onClick={() => toggle("result", "win")}>
          勝った試合
        </button>
        <button className={filter.result === "loss" ? "active" : ""} onClick={() => toggle("result", "loss")}>
          負けた試合
        </button>
      </div>
      <div className="mode-toggle">
        <button className={filter.homeAway === "home" ? "active" : ""} onClick={() => toggle("homeAway", "home")}>
          ホーム
        </button>
        <button className={filter.homeAway === "away" ? "active" : ""} onClick={() => toggle("homeAway", "away")}>
          アウェイ
        </button>
        <button className={filter.division === "east" ? "active" : ""} onClick={() => toggle("division", "east")}>
          対東地区
        </button>
        <button className={filter.division === "west" ? "active" : ""} onClick={() => toggle("division", "west")}>
          対西地区
        </button>
      </div>
      <div className="mode-toggle">
        <select
          value={filter.month !== undefined ? String(filter.month) : ""}
          onChange={(e) => {
            const value = e.target.value;
            onChange({ ...filter, month: value === "" ? undefined : Number(value) });
          }}
        >
          <option value="">月別</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <button className={filter.newYear === "before" ? "active" : ""} onClick={() => toggle("newYear", "before")}>
          年明け前
        </button>
        <button className={filter.newYear === "after" ? "active" : ""} onClick={() => toggle("newYear", "after")}>
          年明け後
        </button>
        <button
          className={filter.weekday ? "active" : ""}
          onClick={() => onChange({ ...filter, weekday: filter.weekday ? undefined : true })}
        >
          平日開催
        </button>
      </div>
      {opponentWinRateSupported && (
        <div className="mode-toggle">
          <button className={filter.opponentWinRate === "under50" ? "active" : ""} onClick={() => toggle("opponentWinRate", "under50")}>
            対5割未満
          </button>
          <button
            className={filter.opponentWinRate === "atLeast50" ? "active" : ""}
            onClick={() => toggle("opponentWinRate", "atLeast50")}
          >
            対5割以上
          </button>
          <button
            className={filter.opponentWinRate === "atLeast60" ? "active" : ""}
            onClick={() => toggle("opponentWinRate", "atLeast60")}
          >
            対6割以上
          </button>
        </div>
      )}
      {!hideGameTypeToggle && (
        <div className="mode-toggle">
          <button className={!includePlayoffs ? "active" : ""} onClick={() => onChange({ ...filter, includePlayoffs: false })}>
            レギュラーシーズンのみ
          </button>
          <button className={includePlayoffs ? "active" : ""} onClick={() => onChange({ ...filter, includePlayoffs: true })}>
            レギュラー+ポストシーズン
          </button>
        </div>
      )}
    </div>
  );
}
