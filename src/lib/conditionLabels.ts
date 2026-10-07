// 「選択中の条件」をタイトル・画像ファイル名に反映するための共通ヘルパー。
//
// 設計方針:
// - 軸ごとに「ラベル配列（string[]）を返す関数」を用意する（シチュエーション・G・P・D・V・
//   登録区分・掲載基準等）。配列にしているのは、1つの軸が複数のラベルを持つ場合
//   （シチュエーションのAND合成など）があるため
// - ページ側は必要な軸のラベル配列を composeLabels() で並べて合成する。どの軸をどの順で
//   出すかはページごとに決める（軸の組み合わせがページごとに異なるため）
// - タイトル表示（joinLabels）と画像ファイル名（buildExportFilename）は同じラベル配列から作る。
//   これにより「画像に写っている条件」と「ファイル名の条件」が食い違わない
// - ConditionalStandingsTable.tsxのdescribeCondition()は単一軸（1つ選ぶと他が外れる）専用の
//   別実装で、こちらとは統合しない
//
// 軸の略称（DESIGN.md 95章）: S=シチュエーション（SituationalFilter）、G=レギュラー/プレーオフ/合算、
// P=Q別/前後半、D=平均/合計/30分換算、V=自チーム/opp/+/-

import type { PeriodRangeOption } from "./periodRange";
import { MARGIN_CONDITION_LABELS, type SeasonHalfBoundary, type ShotChartGameFilters, type SituationalAndFilters, type SituationalFilter } from "./situational";
import {
  SEASON_DISPLAY_MODE_LABELS,
  postseasonLabel,
  seasonGameTypeLabels,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "./playerSeasonBoxscore";
import { TEAM_PERSPECTIVE_LABELS, type TeamPerspective } from "./teamStatsColumns";
import type { ClassificationGroupFilter } from "./classificationFilter";
import { CATEGORY_LABELS } from "./categoryLabels";
import { DIVISION_LABELS } from "./divisionGroups";

/** 何も絞り込んでいない状態のシチュエーション・ラベル（既存のdescribe系関数と同じ文言） */
export const SITUATIONAL_DEFAULT_LABEL = "シーズン全体";

export interface SituationalLabelOptions {
  /** 前半戦/後半戦をdateRangeの境界日との一致で判定するための境界日（SituationalFilterPickerと同じ判定） */
  boundary?: SeasonHalfBoundary | null;
  /** trueのとき、filter.includePlayoffsを「PO込み」ラベルとして含める。
   * G軸（レギュラー/プレーオフ/合算）を別トグルとして持つページ（ランキング等）では
   * filter.includePlayoffsを使わないためfalse（既定）のままにする */
  includePlayoffs?: boolean;
}

/** S軸: シチュエーション別フィルタ（range＋AND合成の各軸）。何も選ばれていなければ["シーズン全体"] */
export function situationalFilterLabels(filter: SituationalFilter, options: SituationalLabelOptions = {}): string[] {
  const { boundary = null, includePlayoffs = false } = options;
  const parts: string[] = [];
  switch (filter.range.kind) {
    case "all":
      break;
    case "recent":
      parts.push(`直近${filter.range.n}試合`);
      break;
    case "dateRange":
      if (boundary && filter.range.start === "" && filter.range.end === boundary.firstHalfEnd) parts.push("前半戦");
      else if (boundary && filter.range.start === boundary.secondHalfStart && filter.range.end === "") parts.push("後半戦");
      else if (!filter.range.start && !filter.range.end) parts.push("期間指定");
      else parts.push(`${filter.range.start || "…"}〜${filter.range.end || "…"}`);
      break;
  }
  parts.push(...situationalAndFilterParts(filter));
  if (includePlayoffs && filter.includePlayoffs) parts.push("PO込み");
  return parts.length > 0 ? parts : [SITUATIONAL_DEFAULT_LABEL];
}

const DIVISION_FILTER_LABELS = { east: "対東地区", west: "対西地区", same: "対同地区", other: "対他地区" } as const;

/** AND合成の各軸（勝敗・会場・地区・月別・年明け前後・平日開催・対勝率別）。SituationalFilterと
 * ShotChartGameFiltersが共有する（situational.tsのmatchesSituationalAndFiltersと同じ軸） */
function situationalAndFilterParts(filter: SituationalAndFilters): string[] {
  const parts: string[] = [];
  if (filter.result) parts.push(filter.result === "win" ? "勝った試合" : "負けた試合");
  if (filter.homeAway) parts.push(filter.homeAway === "home" ? "ホーム" : "アウェイ");
  if (filter.division) parts.push(DIVISION_FILTER_LABELS[filter.division]);
  // 自チームの地区は、指定したときだけ「地区: 東地区」の形で書く（登録区分・ポジションと同じ見出し付き。ファイル名では値だけになる）
  if (filter.ownDivision) parts.push(`地区: ${DIVISION_LABELS[filter.ownDivision]}`);
  if (filter.months?.length) parts.push([...filter.months].sort((a, b) => a - b).map((m) => `${m}月`).join("・"));
  if (filter.newYear) parts.push(filter.newYear === "before" ? "年明け前" : "年明け後");
  if (filter.weekday) parts.push("平日開催");
  if (filter.weekend) parts.push("土日開催");
  if (filter.opponentWinRate) {
    parts.push(filter.opponentWinRate === "under50" ? "対5割未満" : filter.opponentWinRate === "atLeast50" ? "対5割以上" : "対6割以上");
  }
  if (filter.margin) parts.push(MARGIN_CONDITION_LABELS[filter.margin]);
  return parts;
}

/**
 * 選手詳細ページのショットチャート固有の試合絞り込み（ShotChartFilterPicker。AND条件＋シーズン内移籍時の
 * チーム別）。何も選ばれていなければ["シーズン全体"]。ownTeamNameは選択中のチーム名（呼び出し側で解決）
 */
export function shotChartGameFilterLabels(filters: ShotChartGameFilters, ownTeamName?: string): string[] {
  const parts = situationalAndFilterParts(filters);
  if (filters.ownTeamId) parts.push(ownTeamName ?? "チーム指定");
  return parts.length > 0 ? parts : [SITUATIONAL_DEFAULT_LABEL];
}

/**
 * G軸: レギュラーシーズン/ポストシーズン/合算。トグルのボタン表示は「合算」だが、タイトルでは
 * 何と何の合算か分かるよう「レギュラー+CS」「レギュラー+プレーオフ」のように表記する。
 * ポストシーズンの名称はシーズンで変わるため、season（複数シーズンをまたぐ表示ではnull＝
 * 「ポストシーズン」）を必ず渡す（DESIGN.md 128章）
 */
export function gameTypeLabels(gameType: SeasonGameTypeFilter, season: string | null): string[] {
  return [gameType === "both" ? `レギュラー+${postseasonLabel(season)}` : seasonGameTypeLabels(season)[gameType]];
}

/**
 * P軸: Q別/前後半。「試合」（絞り込みなし）は「試合全体」と明示する（Q別と区別できるように）。
 * 前半/後半は、S軸の「前半戦/後半戦」（シーズンの前半・後半）と紛らわしいため、
 * 「試合前半/試合後半」（1試合の中の前半・後半）と表記する
 */
export function periodLabels(option: PeriodRangeOption | undefined): string[] {
  if (!option || option.periods === null) return ["試合全体"];
  if (option.value === "h1") return ["試合前半"];
  if (option.value === "h2") return ["試合後半"];
  return [option.label];
}

/** D軸: 平均/合計/30分換算 */
export function displayModeLabels(mode: SeasonDisplayMode): string[] {
  return [SEASON_DISPLAY_MODE_LABELS[mode]];
}

/** V軸: 自チーム/opp/+/- */
export function perspectiveLabels(perspective: TeamPerspective): string[] {
  return [TEAM_PERSPECTIVE_LABELS[perspective]];
}

/**
 * 登録区分フィルタ（全選手/日本人/外国籍・帰化・アジア）。指定したときは「登録区分: 日本人」の形にする（「外国籍・帰化・アジア」の「・」が
 * 条件の区切りと紛れないよう、ポジション・クラブと同じ見出し付き）。「全選手」はタイトルの下の行・ファイル名には出ない（visibleConditionLabels）
 */
export function classificationLabels(filter: ClassificationGroupFilter): string[] {
  return [filter === "all" ? "全選手" : `登録区分: ${filter}`];
}

/** ルーキーの絞り込み。オンにしたときだけ「ルーキー」と書く（オフのときは何も書かない。DESIGN.md 217章） */
export function rookieLabels(active: boolean): string[] {
  return active ? ["ルーキー"] : [];
}

export interface EligibilityLabelInput {
  /** 出場率の下限（0〜1） */
  gamesRatio: number;
  /** スタッツ固有の追加基準（EXTRA_ELIGIBILITY_RULESの該当ルールがあるときのみ） */
  extra?: { label: string; unit: string } | null;
  extraThreshold?: number;
}

/** ランキングの掲載基準（出場率＋スタッツ固有の追加基準） */
export function eligibilityLabels({ gamesRatio, extra, extraThreshold }: EligibilityLabelInput): string[] {
  const labels = [`出場率${Math.round(gamesRatio * 100)}%以上`];
  if (extra && extraThreshold !== undefined) labels.push(`${extra.label}${extraThreshold.toFixed(1)}${extra.unit}以上`);
  return labels;
}

/**
 * シーズン通算値（レギュラーシーズンのみ）しか使えないカテゴリ（シューティング・強制ターンオーバー等）で
 * 固定になる、G軸と「S・V・P等は対象外」の明示ラベル
 */
export const SEASON_TOTAL_ONLY_LABELS: string[] = [...gameTypeLabels("regular", null), "シーズン通算値"];

/**
 * G軸（SituationalFilterのincludePlayoffsトグルで表現するページ用）。SituationalFilterPickerの
 * 末尾トグル（レギュラーシーズンのみ/レギュラー+ポストシーズン）に対応する。3値トグル
 * （SeasonGameTypeFilter）を別に持つページはgameTypeLabels()を使う
 */
export function includePlayoffsGameTypeLabels(includePlayoffs: boolean | undefined, season: string | null): string[] {
  return [includePlayoffs ? `レギュラー+${postseasonLabel(season)}` : "レギュラーシーズン"];
}

/**
 * 複数選択フィルタ（クラブ・ポジション等）。未選択（＝絞り込みなし）は「全◯◯」と明示する。
 * 選択数が多いとタイトルが長くなりすぎるため、maxShown件を超えた分は「他N」にまとめる。
 * ラベル自体に「・」（条件の区切り）が入らないよう、選択値の区切りは「、」にする
 */
export function multiSelectLabels(prefix: string, values: string[], allLabel: string, maxShown = 3): string[] {
  if (values.length === 0) return [allLabel];
  const shown = values.slice(0, maxShown).join("、");
  const rest = values.length - maxShown;
  return [`${prefix}: ${shown}${rest > 0 ? ` 他${rest}` : ""}`];
}

/** 出場試合率の範囲スライダー（下限〜上限、%） */
export function gamesPlayedRatioRangeLabels(minPct: number, maxPct: number): string[] {
  return [`出場試合率${minPct}%〜${maxPct}%`];
}

/** 歴代記録の会場（トータル/ホーム/アウェイ）。歴代記録タブのボタン表示と共通 */
export type LeagueVenue = "total" | "home" | "away";
export const LEAGUE_VENUE_LABELS: Record<LeagueVenue, string> = { total: "トータル", home: "ホーム", away: "アウェイ" };
export function leagueVenueLabels(venue: LeagueVenue): string[] {
  return [LEAGUE_VENUE_LABELS[venue]];
}

/** 各軸のラベル配列（または単独の文字列）を1本のラベル配列に合成する。空・未指定は無視する */
export function composeLabels(...groups: (string[] | string | null | undefined | false)[]): string[] {
  const result: string[] = [];
  for (const g of groups) {
    if (!g) continue;
    if (typeof g === "string") result.push(g);
    else result.push(...g);
  }
  return result;
}

/**
 * タイトルの下の行・画像ファイル名に書かないラベル（DESIGN.md 170章）。初期値のままの項目（シーズン全体・試合全体・自チーム・全ポジション・
 * 全クラブ・全選手）と、カテゴリ名（Traditional 等。表の中身で分かる）は書かない。登録区分は指定したときだけ「登録区分: 日本人」の形で書く。
 * 軸ごとのラベル関数は従来どおり全軸のラベルを返し、表示とファイル名の直前でここを通して除く（どの表も同じ扱いになるように）
 */
const OMITTED_CONDITION_LABELS: ReadonlySet<string> = new Set([
  SITUATIONAL_DEFAULT_LABEL,
  "試合全体",
  TEAM_PERSPECTIVE_LABELS.own,
  "全ポジション",
  "全クラブ",
  "全選手",
  ...Object.values(CATEGORY_LABELS),
]);

/** タイトルの下の行・画像ファイル名に書くラベルだけを残す */
export function visibleConditionLabels(labels: string[]): string[] {
  return labels.filter((label) => !OMITTED_CONDITION_LABELS.has(label));
}

/** タイトルの条件行に出す区切り文字（既存のdescribeSituationalFilter等と同じ「・」） */
export const LABEL_SEPARATOR = "・";

export function joinLabels(labels: string[]): string {
  return labels.join(LABEL_SEPARATOR);
}

// ファイル名に使えない文字は、見た目が近い全角文字に置き換える（"+/-"の"/"が区切りに化けない等）
const FILENAME_UNSAFE_CHARS: Record<string, string> = {
  "/": "／",
  "\\": "＼",
  ":": "：",
  "*": "＊",
  "?": "？",
  '"': "＂",
  "<": "＜",
  ">": "＞",
  "|": "｜",
};

/**
 * ファイル名の本体部分の最大バイト数。OSの上限（255バイト前後）に対し、保存先のフォルダ名の長さや、同名のときにOSが付ける「 (1)」、
 * 共有先での扱いに余裕を持たせる（日本語で約50文字。DESIGN.md 170章。以前は200バイト）
 */
const MAX_FILENAME_BODY_BYTES = 150;

function sanitizeFilenamePart(part: string): string {
  // 先に NFC にそろえる（濁点・半濁点が分かれた形のままだと、保存先や共有先で「ランキンク」のように落ちることがあるため）。
  // 「登録区分: 日本人」「ポジション: PG」のような見出し付きのラベルは、ファイル名では値だけにする（「登録区分：_日本人」にしない）
  return part
    .normalize("NFC")
    .replace(/^[^:：]+:\s*/, "")
    .replace(/[/\\:*?"<>|]/g, (c) => FILENAME_UNSAFE_CHARS[c]!).replace(/\s+/g, "_");
}

/** ラベル配列（タイトルと同じもの）から画像ファイル名を作る。長すぎる場合は末尾を切り詰める */
export function buildExportFilename(parts: string[], ext = "png"): string {
  const encoder = new TextEncoder();
  let body = visibleConditionLabels(parts)
    .map(sanitizeFilenamePart).filter((p) => p.length > 0).join("_");
  if (encoder.encode(body).length > MAX_FILENAME_BODY_BYTES) {
    const chars = Array.from(body);
    while (chars.length > 0 && encoder.encode(chars.join("")).length > MAX_FILENAME_BODY_BYTES - 3) chars.pop();
    body = `${chars.join("")}...`;
  }
  return `${body}.${ext}`.normalize("NFC");
}
