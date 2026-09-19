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
import type { SeasonHalfBoundary, ShotChartGameFilters, SituationalAndFilters, SituationalFilter } from "./situational";
import {
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "./playerSeasonBoxscore";
import { TEAM_PERSPECTIVE_LABELS, type TeamPerspective } from "./teamStatsColumns";
import type { ClassificationGroupFilter } from "./classificationFilter";

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

/** AND合成の各軸（勝敗・会場・地区・月別・年明け前後・平日開催・対勝率別）。SituationalFilterと
 * ShotChartGameFiltersが共有する（situational.tsのmatchesSituationalAndFiltersと同じ軸） */
function situationalAndFilterParts(filter: SituationalAndFilters): string[] {
  const parts: string[] = [];
  if (filter.result) parts.push(filter.result === "win" ? "勝った試合" : "負けた試合");
  if (filter.homeAway) parts.push(filter.homeAway === "home" ? "ホーム" : "アウェイ");
  if (filter.division) parts.push(filter.division === "east" ? "対東地区" : "対西地区");
  if (filter.month !== undefined) parts.push(`${filter.month}月`);
  if (filter.newYear) parts.push(filter.newYear === "before" ? "年明け前" : "年明け後");
  if (filter.weekday) parts.push("平日開催");
  if (filter.opponentWinRate) {
    parts.push(filter.opponentWinRate === "under50" ? "対5割未満" : filter.opponentWinRate === "atLeast50" ? "対5割以上" : "対6割以上");
  }
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
 * G軸: レギュラーシーズン/プレーオフ/合算。トグルのボタン表示は「合算」だが、タイトルでは
 * 何と何の合算か分かるよう「レギュラー+プレーオフ」と表記する
 */
export function gameTypeLabels(gameType: SeasonGameTypeFilter): string[] {
  return [gameType === "both" ? "レギュラー+プレーオフ" : SEASON_GAME_TYPE_LABELS[gameType]];
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

/** 登録区分フィルタ（全選手/日本人/外国籍・帰化・アジア） */
export function classificationLabels(filter: ClassificationGroupFilter): string[] {
  return [filter === "all" ? "全選手" : filter];
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
export const SEASON_TOTAL_ONLY_LABELS: string[] = [...gameTypeLabels("regular"), "シーズン通算値"];

/**
 * G軸（SituationalFilterのincludePlayoffsトグルで表現するページ用）。SituationalFilterPickerの
 * 末尾トグル（レギュラーシーズンのみ/レギュラー+ポストシーズン）に対応する。3値トグル
 * （SeasonGameTypeFilter）を別に持つページはgameTypeLabels()を使う
 */
export function includePlayoffsGameTypeLabels(includePlayoffs: boolean | undefined): string[] {
  return [includePlayoffs ? "レギュラー+プレーオフ" : "レギュラーシーズン"];
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

/** OS・ブラウザによるファイル名の長さ制限（255バイト前後）に余裕を持たせた、本体部分の最大バイト数 */
const MAX_FILENAME_BODY_BYTES = 200;

function sanitizeFilenamePart(part: string): string {
  return part.replace(/[/\\:*?"<>|]/g, (c) => FILENAME_UNSAFE_CHARS[c]!).replace(/\s+/g, "_");
}

/** ラベル配列（タイトルと同じもの）から画像ファイル名を作る。長すぎる場合は末尾を切り詰める */
export function buildExportFilename(parts: string[], ext = "png"): string {
  const encoder = new TextEncoder();
  let body = parts.map(sanitizeFilenamePart).filter((p) => p.length > 0).join("_");
  if (encoder.encode(body).length > MAX_FILENAME_BODY_BYTES) {
    const chars = Array.from(body);
    while (chars.length > 0 && encoder.encode(chars.join("")).length > MAX_FILENAME_BODY_BYTES - 3) chars.pop();
    body = `${chars.join("")}...`;
  }
  return `${body}.${ext}`;
}
