import { FIRST_LEAGUE_SEASON } from "../../shared/rookieEligibility";
import { postseasonFormat } from "../../shared/postseasonFormat";
import type { Division } from "../../shared/types";
import { DIVISION_LABELS } from "./divisionGroups";
import { formatSigned } from "./format";
import { foulColumnsSplit, foulKeyVisible } from "./ruleChange";
import type { SituationalFilter } from "./situational";
import type { SeasonGameTypeFilter } from "./playerSeasonBoxscore";
import type { PeriodRangeValue } from "./periodRange";
import { enumParam } from "./urlState";
import { postseasonLabel } from "../../shared/gameType";

/**
 * ランキング（シーズン成績）の前シーズン比較（DESIGN.md 218章）。URL のキーは cmp（cmp=1 でオン）。
 * 前季のデータは、比較をオンにしたときだけ読む
 */
export type CompareToggle = "off" | "on";
export const COMPARE_PARAM = enumParam<CompareToggle>("cmp", ["off", "on"], "off", { on: "1" });

export const COMPARE_LABEL = "前シーズン比較";

/** シューティング・強制ターンオーバーの記録がある最初のシーズン（それ以前のシーズンは前季として使えない） */
const SHOT_DATA_FIRST_SEASON = "2023-24";

/** 選手のPACE（在コート区間のポゼッションから求める）の記録がある最初のシーズン（aggregate.ts は coverage が full の 2022-23 以降だけ在コート区間を数える） */
const PLAYER_PACE_FIRST_SEASON = "2022-23";

/** 選んだシーズンの直前のシーズン。最初のシーズン（2016-17）は null */
export function previousSeason(season: string): string | null {
  if (season <= FIRST_LEAGUE_SEASON) return null;
  const startYear = Number(season.slice(0, 4)) - 1;
  if (!Number.isFinite(startYear)) return null;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export interface CompareSupportInput {
  season: string;
  /** Traditional・Advanced・Misc・Scoring は "boxscore"。Shooting・Forced TOV は "seasonTotal"（シーズン通算の値だけ）。Profile・Career は "registered"（登録選手全員が対象） */
  categoryKind: "boxscore" | "seasonTotal" | "registered";
  statKey: string;
  /** 個人のランキングか、チームのランキングか（選手の POSS・PACE は値が無い。チームにはある） */
  subject: "player" | "team";
  /** 個人のランキングが、試合ログから値を作り直しているか（条件なしの集計済みの値では、PACE の元になる在コート区間のポゼッションを持たない） */
  fromGameLogs: boolean;
  filter: SituationalFilter;
  gameType: SeasonGameTypeFilter;
  period: PeriodRangeValue;
  /** 前季にある地区（履歴が読めるまでは null） */
  prevDivisions: Division[] | null;
}

/**
 * 前シーズン比較を使えない理由（使えるときは null）。利用者向けの文で、バーの下の注記・ツールチップに出す。
 * 比較は「両方のシーズンで、同じ条件・同じ掲載基準」で並べるため、前季に当てはめられない条件のときは無効にする
 */
export function compareUnsupportedReason(input: CompareSupportInput): string | null {
  const { season, categoryKind, statKey, subject, fromGameLogs, filter, gameType, period, prevDivisions } = input;
  const prev = previousSeason(season);
  if (!prev) {
    return `${COMPARE_LABEL}は、${season}では選べません。B.LEAGUE発足の最初のシーズンで、比べる前のシーズンがないためです。`;
  }
  if (categoryKind === "registered") {
    return `このカテゴリは、掲載基準を使わず、そのシーズンに登録していた選手全員が対象のため、${COMPARE_LABEL}は選べません。`;
  }
  if (categoryKind === "seasonTotal" && prev < SHOT_DATA_FIRST_SEASON) {
    return `このカテゴリの記録は${SHOT_DATA_FIRST_SEASON}シーズン以降のため、${prev}にはデータがなく、${COMPARE_LABEL}は選べません。`;
  }
  if (!foulKeyVisible(statKey, foulColumnsSplit([prev]))) {
    return `この項目は${prev}の表にないため、${COMPARE_LABEL}は選べません。`;
  }
  if (subject === "player" && statKey === "poss") {
    return `選手の POSS は値がなく、表示が「-」になるため、${COMPARE_LABEL}は選べません。`;
  }
  if (subject === "player" && statKey === "pace") {
    if (!fromGameLogs) {
      return `条件を付けていないとき、選手の PACE は値がなく、表示が「-」になるため、${COMPARE_LABEL}は選べません。`;
    }
    if (prev < PLAYER_PACE_FIRST_SEASON) {
      return `選手の PACE の記録は${PLAYER_PACE_FIRST_SEASON}シーズン以降のため、${prev}にはデータがなく、${COMPARE_LABEL}は選べません。`;
    }
  }
  if (categoryKind === "boxscore") {
    if (period !== "all") {
      return `Q別・前後半を選んでいるときは、前のシーズンの試合の生データも読み込む必要があり重くなるため、${COMPARE_LABEL}は選べません。`;
    }
    if (filter.range.kind === "dateRange") {
      return `期間指定は日付がシーズンごとに違い、前のシーズンには当てはめられないため、${COMPARE_LABEL}は選べません。`;
    }
    if (filter.ownDivision && prevDivisions && !prevDivisions.includes(filter.ownDivision)) {
      return `${DIVISION_LABELS[filter.ownDivision]}は${prev}にない地区のため、${COMPARE_LABEL}は選べません。`;
    }
    if (gameType !== "regular" && postseasonFormat(prev) === null) {
      return `${prev}は${postseasonLabel(prev)}が開催されなかったため、${COMPARE_LABEL}は選べません。`;
    }
  }
  return null;
}

// ---- 表示値どうしの差 ----

export interface DisplayedNumber {
  value: number;
  /** 表示の小数の桁数 */
  digits: number;
  /** 割合（%）の項目か */
  percent: boolean;
}

/**
 * 表の表示値（「15.2」「45.3%」「1,591」「+3.2」「45.0%（27/60）」など）から、先頭の数値を読む。読めないとき（「-」など）は null。
 * 差は、画面の前季・今季の値と必ず合うように、この表示値どうしで出す
 */
export function displayedNumber(text: string): DisplayedNumber | null {
  const m = /[+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)/.exec(text);
  if (!m) return null;
  const raw = m[0].replace(/,/g, "");
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const dot = raw.indexOf(".");
  return { value, digits: dot < 0 ? 0 : raw.length - dot - 1, percent: text.includes("%") };
}

export interface DisplayedDiff {
  /** 今季−前季（表示値どうし。桁数をそろえて丸め誤差を除いた値） */
  diff: number;
  text: string;
  percent: boolean;
}

/** 今季・前季の表示値の差。どちらかが数値として読めないとき（「-」など）は null */
export function displayedDiff(currentText: string, prevText: string): DisplayedDiff | null {
  const cur = displayedNumber(currentText);
  const prev = displayedNumber(prevText);
  if (!cur || !prev) return null;
  const digits = Math.max(cur.digits, prev.digits);
  const scale = 10 ** digits;
  const diff = (Math.round(cur.value * scale) - Math.round(prev.value * scale)) / scale;
  const percent = cur.percent && prev.percent;
  // 割合は、ポイントの差（「+1.2pt」）
  const text = `${formatSigned(diff, digits)}${percent ? "pt" : ""}`;
  return { diff, text, percent };
}

/** 差の色。少ない方が良い項目（higherIsBetter が false）は、減ったほうを「良くなった」にする。差が0のときは flat */
export function diffTone(diff: number, higherIsBetter: boolean | undefined): "good" | "bad" | "flat" {
  if (diff === 0) return "flat";
  const better = higherIsBetter === false ? diff < 0 : diff > 0;
  return better ? "good" : "bad";
}

/**
 * 並べ替えた表示値の並びから、順位（同じ値は同じ順位、次は飛ばす: 1・2・2・4。DESIGN.md 143-3章）を付ける。
 * 同じかどうかは表示値の文字列で決める（小数は丸めた後。RankedList と同じ）
 */
export function rankPositions(texts: readonly string[]): number[] {
  const ranks: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    ranks.push(i > 0 && texts[i] === texts[i - 1] ? ranks[i - 1]! : i + 1);
  }
  return ranks;
}

// ---- 比較の行を作る ----

export interface CompareEntry<P> {
  prev: P;
  prevText: string;
  diff: number;
  diffText: string;
  tone: "good" | "bad" | "flat";
}

/**
 * 今季の表（currentRows）と前季の全体（prevRows）から、両方にある行だけの比較を作る。
 * 表示値が読めない行は外す
 */
export function buildCompare<T, P>(opts: {
  currentRows: readonly T[];
  currentKey: (row: T) => string;
  currentDef: { format: (row: T) => string; higherIsBetter?: boolean };
  prevRows: readonly P[];
  prevKey: (row: P) => string;
  prevDef: { format: (row: P) => string };
  /** 比べない組（例: どちらかのシーズンで、その条件の試合が0のチーム）を外す */
  accept?: (row: T, prev: P) => boolean;
}): { rows: T[]; entries: Map<string, CompareEntry<P>> } {
  const { currentRows, currentKey, currentDef, prevRows, prevKey, prevDef, accept } = opts;
  const prevByKey = new Map(prevRows.map((r) => [prevKey(r), r]));
  const rows: T[] = [];
  const entries = new Map<string, CompareEntry<P>>();
  for (const row of currentRows) {
    const key = currentKey(row);
    const prev = prevByKey.get(key);
    if (!prev || (accept && !accept(row, prev))) continue;
    const prevText = prevDef.format(prev);
    const d = displayedDiff(currentDef.format(row), prevText);
    if (!d) continue;
    rows.push(row);
    entries.set(key, { prev, prevText, diff: d.diff, diffText: d.text, tone: diffTone(d.diff, currentDef.higherIsBetter) });
  }
  return { rows, entries };
}
