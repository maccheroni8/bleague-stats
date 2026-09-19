// フィルタUI（FilterBar）に渡す「軸」の定義。
//
// 設計方針（DESIGN.md 105章）:
// - 1軸＝1ドロップダウン。SituationalFilter等の既存のデータ型・stateは変えず、ページが持つ値と
//   setterを「軸」として包んでFilterBarに渡すだけにする（軸の値は常に文字列。未指定は既定値の"" 等）
// - 既定値（defaultValue）を軸が持つことで、「既定値から変更した軸だけをチップで出す」を
//   FilterBar側で一律に判定できる
// - ドロップダウンの選択肢・チップの文言は、既存の条件ラベル（conditionLabels.ts、
//   playerSeasonBoxscore.tsのSEASON_*_LABELS等）と同じ表記を使い、ConditionTitleとずれないようにする
// - 軸はtier（primary=常時表示 / advanced=「詳細フィルタ」に折りたたむ）を持つ

import type { ReactNode } from "react";
import { LEAGUE_VENUE_LABELS, periodLabels, type LeagueVenue } from "./conditionLabels";
import { CLASSIFICATION_GROUP_OPTIONS, type ClassificationGroupFilter } from "./classificationFilter";
import type { PeriodRangeOption, PeriodRangeValue } from "./periodRange";
import {
  RECENT_N_OPTIONS,
  type SeasonHalfBoundary,
  type SituationalFilter,
} from "./situational";
import {
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "./playerSeasonBoxscore";
import { TEAM_PERSPECTIVE_LABELS, type TeamPerspective } from "./teamStatsColumns";

export interface FilterAxisOption {
  value: string;
  label: string;
}

interface FilterAxisBase {
  /** 軸の識別子（チップ・詳細フィルタ内のkeyに使う。1つのFilterBar内で一意） */
  id: string;
  /** ドロップダウンの上に出すラベル。チップにも「ラベル: 値」の形で出す */
  label: string;
  /** primary=常時表示、advanced=「詳細フィルタ」内 */
  tier: "primary" | "advanced";
  value: string;
  /** 既定値。value !== defaultValue の軸だけがチップとして出る */
  defaultValue: string;
  onChange: (value: string) => void;
  /**
   * この軸が今のタブ・カテゴリでは効かないときの理由。指定すると操作不可（disabled）になり、
   * チップにも出さない。内部の値は保持されるので、効くカテゴリに戻すと復元される
   */
  disabledReason?: string;
  /** trueのとき、disabledReasonはツールチップにだけ出し、バー下の「対象外」の注記には出さない
   * （期間指定の日付のように、状態次第で有効になる軸用） */
  quietDisabled?: boolean;
  /** falseのとき、変更されていてもチップに出さない（同じ内容を別の軸のチップが表すとき） */
  chip?: boolean;
  /** チップに出す値の文言。未指定なら選択肢のlabel */
  chipValue?: string;
}

export interface FilterSelectAxis extends FilterAxisBase {
  kind: "select";
  options: FilterAxisOption[];
}

/** 日付入力（期間指定の開始・終了）。valueは"YYYY-MM-DD"、未指定は"" */
export interface FilterDateAxis extends FilterAxisBase {
  kind: "date";
}

/**
 * ドロップダウンでは表せない軸（出場率のスライダー等）。ボタン（summaryを表示）を押すとcontentを
 * ポップオーバーに出す。値（value/defaultValue）は状態を文字列にしたもので、チップの表示判定にだけ使う。
 * チップの×（onChange(defaultValue)）が呼ばれたら、ページ側でその軸を既定値に戻す
 */
export interface FilterPopoverAxis extends FilterAxisBase {
  kind: "popover";
  /** ボタンに出す現在値の要約（例: 出場率85%以上） */
  summary: string;
  content: ReactNode;
}

/**
 * 複数選択（ポジション・クラブ・対象クラブ等）。ボタンを押すとチェックボックスのポップオーバーが開く。
 * 未選択＝絞り込みなし（既定値）。値（value）は選択をソートして","で結んだ文字列で、チップの表示判定に使う
 * （チップの×は onChange("") ＝全解除）
 */
export interface FilterMultiAxis extends FilterAxisBase {
  kind: "multi";
  options: FilterAxisOption[];
  selected: string[];
  onChangeSelected: (values: string[]) => void;
  /** 未選択のときボタンに出す文言（例: 全ポジション） */
  allLabel: string;
  /** 一括選択のプリセット（例: 東地区のクラブ全部） */
  presets?: { label: string; values: string[] }[];
  /** trueのとき、選択肢を絞り込む検索欄を出す（選択肢が多いクラブ用） */
  searchable?: boolean;
  /** ボタン・チップに出す選択内容（未選択は allLabel） */
  summary: string;
}

export type FilterAxis = FilterSelectAxis | FilterDateAxis | FilterPopoverAxis | FilterMultiAxis;

const MULTI_SHOWN_LABELS = 3;

/** 複数選択の要約。3件までは「、」で並べ、それ以上は「他N」に省略する（multiSelectLabels と同じ考え方） */
function summarizeMulti(labels: string[], allLabel: string): string {
  if (labels.length === 0) return allLabel;
  if (labels.length <= MULTI_SHOWN_LABELS) return labels.join("、");
  return `${labels.slice(0, MULTI_SHOWN_LABELS).join("、")} 他${labels.length - MULTI_SHOWN_LABELS}`;
}

export function multiSelectAxis(input: {
  id: string;
  label: string;
  tier?: "primary" | "advanced";
  options: FilterAxisOption[];
  selected: string[];
  onChangeSelected: (values: string[]) => void;
  allLabel: string;
  presets?: { label: string; values: string[] }[];
  searchable?: boolean;
  disabledReason?: string;
}): FilterAxis {
  const selectedSet = new Set(input.selected);
  // 選択順ではなく選択肢の並び順で要約する（ボタン・チップの表示が選択の順序に左右されない）
  const summary = summarizeMulti(
    input.options.filter((o) => selectedSet.has(o.value)).map((o) => o.label),
    input.allLabel,
  );
  return {
    kind: "multi",
    id: input.id,
    label: input.label,
    tier: input.tier ?? "primary",
    options: input.options,
    selected: input.selected,
    onChangeSelected: input.onChangeSelected,
    allLabel: input.allLabel,
    presets: input.presets,
    searchable: input.searchable,
    summary,
    value: [...input.selected].sort().join(","),
    defaultValue: "",
    onChange: (v) => input.onChangeSelected(v === "" ? [] : v.split(",")),
    disabledReason: input.disabledReason,
    chipValue: summary,
  };
}

export const FILTER_ALL_LABEL = "すべて";

function optionsFromLabels<K extends string>(labels: Record<K, string>, keys: K[]): FilterAxisOption[] {
  return keys.map((k) => ({ value: k, label: labels[k] }));
}

/** 軸の現在値に対応する選択肢のラベル（チップ表示用）。該当なしは値そのもの */
export function axisValueLabel(axis: FilterAxis): string {
  if (axis.chipValue !== undefined) return axis.chipValue;
  if (axis.kind === "date") return axis.value;
  if (axis.kind === "popover" || axis.kind === "multi") return axis.summary;
  return axis.options.find((o) => o.value === axis.value)?.label ?? axis.value;
}

/** チップに出す軸（既定値から変更されていて、今のタブで有効で、チップ対象の軸）か */
export function isAxisChipped(axis: FilterAxis): boolean {
  return axis.value !== axis.defaultValue && !axis.disabledReason && axis.chip !== false;
}

interface SimpleAxisOptions {
  tier?: "primary" | "advanced";
  disabledReason?: string;
}

/** G軸: レギュラーシーズン/プレーオフ/合算 */
export function gameTypeAxis(
  value: SeasonGameTypeFilter,
  onChange: (v: SeasonGameTypeFilter) => void,
  opts: SimpleAxisOptions = {},
): FilterAxis {
  return {
    kind: "select",
    id: "gameType",
    label: "試合種別",
    tier: opts.tier ?? "primary",
    options: optionsFromLabels(SEASON_GAME_TYPE_LABELS, Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]),
    value,
    defaultValue: "regular",
    onChange: (v) => onChange(v as SeasonGameTypeFilter),
    disabledReason: opts.disabledReason,
  };
}

/** V軸: 自チーム/opp/+/- */
export function perspectiveAxis(
  value: TeamPerspective,
  onChange: (v: TeamPerspective) => void,
  opts: SimpleAxisOptions = {},
): FilterAxis {
  return {
    kind: "select",
    id: "perspective",
    label: "視点",
    tier: opts.tier ?? "primary",
    options: optionsFromLabels(TEAM_PERSPECTIVE_LABELS, ["own", "opp", "diff"]),
    value,
    defaultValue: "own",
    onChange: (v) => onChange(v as TeamPerspective),
    disabledReason: opts.disabledReason,
  };
}

/** D軸: 平均/合計（30分換算は現状どのページでも選択肢に出していない） */
export function displayModeAxis(
  value: SeasonDisplayMode,
  onChange: (v: SeasonDisplayMode) => void,
  opts: SimpleAxisOptions = {},
): FilterAxis {
  return {
    kind: "select",
    id: "displayMode",
    label: "表示",
    tier: opts.tier ?? "primary",
    options: optionsFromLabels(SEASON_DISPLAY_MODE_LABELS, ["perGame", "total"]),
    value,
    defaultValue: "perGame",
    onChange: (v) => onChange(v as SeasonDisplayMode),
    disabledReason: opts.disabledReason,
  };
}

/** P軸: 試合全体/1Q〜4Q/試合前半/試合後半（表記はConditionTitleと同じ periodLabels） */
export function periodAxis(
  value: PeriodRangeValue,
  onChange: (v: PeriodRangeValue) => void,
  options: PeriodRangeOption[],
  opts: SimpleAxisOptions = {},
): FilterAxis {
  return {
    kind: "select",
    id: "period",
    label: "Q別・前後半",
    tier: opts.tier ?? "primary",
    options: options.map((o) => ({ value: o.value, label: periodLabels(o)[0] ?? o.label })),
    value,
    defaultValue: "all",
    onChange: (v) => onChange(v as PeriodRangeValue),
    disabledReason: opts.disabledReason,
  };
}

/** 登録区分: 全選手/日本人/外国籍・帰化・アジア */
export function classificationAxis(
  value: ClassificationGroupFilter,
  onChange: (v: ClassificationGroupFilter) => void,
  opts: SimpleAxisOptions = {},
): FilterAxis {
  return {
    kind: "select",
    id: "classification",
    label: "登録区分",
    tier: opts.tier ?? "primary",
    options: [{ value: "all", label: "全選手" }, ...CLASSIFICATION_GROUP_OPTIONS.map((c) => ({ value: c, label: c }))],
    value,
    defaultValue: "all",
    onChange: (v) => onChange(v as ClassificationGroupFilter),
    disabledReason: opts.disabledReason,
  };
}

/** 汎用の単一選択軸（カテゴリ・直近N試合など、ページ固有の選択肢用） */
export function simpleSelectAxis(input: {
  id: string;
  label: string;
  options: FilterAxisOption[];
  value: string;
  defaultValue?: string;
  onChange: (v: string) => void;
  tier?: "primary" | "advanced";
  disabledReason?: string;
}): FilterAxis {
  return {
    kind: "select",
    id: input.id,
    label: input.label,
    tier: input.tier ?? "primary",
    options: input.options,
    value: input.value,
    defaultValue: input.defaultValue ?? input.options[0]?.value ?? "",
    onChange: input.onChange,
    disabledReason: input.disabledReason,
  };
}

/** 歴代記録の会場: トータル/ホーム/アウェイ（既定はトータル） */
export function leagueVenueAxis(value: LeagueVenue, onChange: (v: LeagueVenue) => void): FilterAxis {
  return simpleSelectAxis({
    id: "leagueVenue",
    label: "会場",
    options: (Object.keys(LEAGUE_VENUE_LABELS) as LeagueVenue[]).map((v) => ({ value: v, label: LEAGUE_VENUE_LABELS[v] })),
    value,
    defaultValue: "total",
    onChange: (v) => onChange(v as LeagueVenue),
  });
}

export interface SituationalAxesContext {
  /** 前半戦/後半戦の境界日。未指定または算出不能（null）なら、その選択肢自体を出さない */
  boundary?: SeasonHalfBoundary | null;
  /** 「対戦相手の勝率」の表示可否（対戦相手の勝率算出にシーズン全体の試合日程が必要なため） */
  opponentWinRateSupported?: boolean;
  /** S軸すべてが今のタブで効かないときの理由 */
  disabledReason?: string;
}

const RANGE_ALL = "all";
const RANGE_CUSTOM = "custom";
const RANGE_FIRST_HALF = "firstHalf";
const RANGE_SECOND_HALF = "secondHalf";

const recentValue = (n: number) => `recent:${n}`;

function rangeValueOf(filter: SituationalFilter, boundary: SeasonHalfBoundary | null | undefined): string {
  const { range } = filter;
  if (range.kind === "all") return RANGE_ALL;
  if (range.kind === "recent") return recentValue(range.n);
  if (boundary && range.start === "" && range.end === boundary.firstHalfEnd) return RANGE_FIRST_HALF;
  if (boundary && range.start === boundary.secondHalfStart && range.end === "") return RANGE_SECOND_HALF;
  return RANGE_CUSTOM;
}

function rangeFromValue(
  value: string,
  filter: SituationalFilter,
  boundary: SeasonHalfBoundary | null | undefined,
): SituationalFilter["range"] {
  if (value === RANGE_ALL) return { kind: "all" };
  if (value.startsWith("recent:")) return { kind: "recent", n: Number(value.slice("recent:".length)) };
  if (value === RANGE_FIRST_HALF && boundary) return { kind: "dateRange", start: "", end: boundary.firstHalfEnd };
  if (value === RANGE_SECOND_HALF && boundary) return { kind: "dateRange", start: boundary.secondHalfStart, end: "" };
  // 期間指定: 既に日付が入っていれば引き継ぐ（前半戦→期間指定への切り替えで日付を残す）
  const dates = filter.range.kind === "dateRange" ? filter.range : { start: "", end: "" };
  return { kind: "dateRange", start: dates.start, end: dates.end };
}

/**
 * SituationalFilter（range＋AND合成の各軸）を軸の配列に展開する。SituationalFilterPickerの
 * 代わりに使う。対象期間・会場を常時表示、それ以外（勝敗・対戦地区・月・年明け前後・曜日・
 * 対戦相手の勝率・期間指定の日付）を詳細フィルタに置く。filter.includePlayoffsは扱わない
 * （G軸は別途 gameTypeAxis を渡す運用。旧Pickerの hideGameTypeToggle 指定に相当）
 */
export function situationalAxes(
  filter: SituationalFilter,
  onChange: (filter: SituationalFilter) => void,
  ctx: SituationalAxesContext = {},
): FilterAxis[] {
  const { boundary = null, opponentWinRateSupported = false, disabledReason } = ctx;
  const rangeValue = rangeValueOf(filter, boundary);
  const dateRange = filter.range.kind === "dateRange" ? filter.range : null;
  const dateDisabledReason = disabledReason ?? (dateRange ? undefined : "対象期間で「期間指定」を選ぶと入力できます");

  const rangeOptions: FilterAxisOption[] = [
    { value: RANGE_ALL, label: "シーズン全体" },
    ...RECENT_N_OPTIONS.map((n) => ({ value: recentValue(n), label: `直近${n}試合` })),
    ...(boundary
      ? [
          { value: RANGE_FIRST_HALF, label: "前半戦" },
          { value: RANGE_SECOND_HALF, label: "後半戦" },
        ]
      : []),
    { value: RANGE_CUSTOM, label: "期間指定" },
  ];

  /** AND合成の1軸（"" = 未指定）を作る。setは値を受けてfilterの該当フィールドだけ差し替える */
  const andAxis = (
    id: string,
    label: string,
    tier: "primary" | "advanced",
    value: string,
    options: FilterAxisOption[],
    set: (next: SituationalFilter, v: string) => SituationalFilter,
  ): FilterAxis => ({
    kind: "select",
    id,
    label,
    tier,
    options: [{ value: "", label: FILTER_ALL_LABEL }, ...options],
    value,
    defaultValue: "",
    onChange: (v) => onChange(set(filter, v)),
    disabledReason,
  });

  const axes: FilterAxis[] = [
    {
      kind: "select",
      id: "s.range",
      label: "対象期間",
      tier: "primary",
      options: rangeOptions,
      value: rangeValue,
      defaultValue: RANGE_ALL,
      onChange: (v) => onChange({ ...filter, range: rangeFromValue(v, filter, boundary) }),
      disabledReason,
      // 期間指定の日付が入っているときは、チップには日付を出す（開始日・終了日の軸はチップに出さない）
      chipValue:
        rangeValue === RANGE_CUSTOM && dateRange && (dateRange.start || dateRange.end)
          ? `${dateRange.start || "…"}〜${dateRange.end || "…"}`
          : undefined,
    },
    andAxis("s.homeAway", "会場", "primary", filter.homeAway ?? "", [
      { value: "home", label: "ホーム" },
      { value: "away", label: "アウェイ" },
    ], (f, v) => ({ ...f, homeAway: v === "" ? undefined : (v as "home" | "away") })),
    andAxis("s.result", "勝敗", "advanced", filter.result ?? "", [
      { value: "win", label: "勝った試合" },
      { value: "loss", label: "負けた試合" },
    ], (f, v) => ({ ...f, result: v === "" ? undefined : (v as "win" | "loss") })),
    andAxis("s.division", "対戦地区", "advanced", filter.division ?? "", [
      { value: "east", label: "対東地区" },
      { value: "west", label: "対西地区" },
    ], (f, v) => ({ ...f, division: v === "" ? undefined : (v as "east" | "west") })),
    andAxis(
      "s.month",
      "月",
      "advanced",
      filter.month !== undefined ? String(filter.month) : "",
      Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: `${i + 1}月` })),
      (f, v) => ({ ...f, month: v === "" ? undefined : Number(v) }),
    ),
    andAxis("s.newYear", "年明け前後", "advanced", filter.newYear ?? "", [
      { value: "before", label: "年明け前" },
      { value: "after", label: "年明け後" },
    ], (f, v) => ({ ...f, newYear: v === "" ? undefined : (v as "before" | "after") })),
    andAxis("s.weekday", "曜日", "advanced", filter.weekday ? "weekday" : "", [
      { value: "weekday", label: "平日開催のみ" },
    ], (f, v) => ({ ...f, weekday: v === "" ? undefined : true })),
  ];

  if (opponentWinRateSupported) {
    axes.push(
      andAxis("s.opponentWinRate", "対戦相手の勝率", "advanced", filter.opponentWinRate ?? "", [
        { value: "under50", label: "5割未満" },
        { value: "atLeast50", label: "5割以上" },
        { value: "atLeast60", label: "6割以上" },
      ], (f, v) => ({ ...f, opponentWinRate: v === "" ? undefined : (v as "under50" | "atLeast50" | "atLeast60") })),
    );
  }

  const dateAxis = (id: string, label: string, key: "start" | "end"): FilterAxis => ({
    kind: "date",
    id,
    label,
    tier: "advanced",
    value: dateRange ? dateRange[key] : "",
    defaultValue: "",
    onChange: (v) => {
      const cur = filter.range.kind === "dateRange" ? filter.range : { start: "", end: "" };
      onChange({ ...filter, range: { kind: "dateRange", start: cur.start, end: cur.end, [key]: v } });
    },
    disabledReason: dateDisabledReason,
    quietDisabled: !disabledReason,
    chip: false,
  });
  axes.push(dateAxis("s.dateStart", "期間指定（開始）", "start"), dateAxis("s.dateEnd", "期間指定（終了）", "end"));

  return axes;
}
