// ランキングの1試合記録（個人・チーム、シーズン・歴代）の「試合の条件」（DESIGN.md 220章）。
// 条件・URLの読み書き・タイトルの条件ラベルだけを持つ（索引を引く処理は gameRecordQuery.ts）。
// 集計のコードから読まれない場所（src/lib の保存キーの対象外）に置く。
import type { Division } from "../../shared/types";
import { DIVISION_LABELS } from "./divisionGroups";
import { MARGIN_CONDITION_LABELS, type MarginCondition } from "./situational";
import type { UrlCodec } from "./urlState";

/** 延長の条件: なし／あり（1本以上）／ちょうど1本／ちょうど2本／3本以上 */
export type OvertimeCondition = "none" | "any" | "1" | "2" | "3";
export const OVERTIME_CONDITIONS: OvertimeCondition[] = ["none", "any", "1", "2", "3"];
export const OVERTIME_LABELS: Record<OvertimeCondition, string> = {
  none: "延長なし",
  any: "延長あり",
  "1": "延長1本",
  "2": "延長2本",
  "3": "延長3本以上",
};

export interface GameRecordConditions {
  result?: "win" | "loss";
  homeAway?: "home" | "away";
  /** 対戦相手のチームID（どれか）。空は絞り込みなし */
  opponents: string[];
  overtime?: OvertimeCondition;
  /** 最終点差（勝敗によらない点差の大きさ）の範囲。片側だけも可 */
  marginMin?: number;
  marginMax?: number;
  /** 試合中の最大点差（既存の「点差」と同じ選択肢。DESIGN.md 150章） */
  margin?: MarginCondition;
  /** 自チームの地区・対戦相手の地区（どちらも、その試合のシーズンの地区。行ごとに判定する） */
  ownDivision?: Division;
  oppDivision?: Division;
  /** 前後半5分の特別な試合を含めるか。未指定は、少ない方から並べるとき除き、多い方から並べるとき含める */
  includeSpecial?: boolean;
}

export const DEFAULT_GAME_RECORD_CONDITIONS: GameRecordConditions = { opponents: [] };

/** 試合の条件が1つでもあるか（前後半5分の特別な試合の扱いは含めない） */
export function hasGameConditions(c: GameRecordConditions): boolean {
  return (
    !!c.result ||
    !!c.homeAway ||
    c.opponents.length > 0 ||
    !!c.overtime ||
    c.marginMin !== undefined ||
    c.marginMax !== undefined ||
    !!c.margin ||
    !!c.ownDivision ||
    !!c.oppDivision
  );
}

/** 前後半5分の特別な試合を含めるか（未指定の既定: 少ない方から並べるときは除き、それ以外は含める） */
export function effectiveIncludeSpecial(c: GameRecordConditions, lowerFirst: boolean): boolean {
  return c.includeSpecial ?? !lowerFirst;
}

// ---- URL（res・ven・opp・ot・fm・mg・dv・div・sp。DESIGN.md 220章） ----

const RESULT = ["win", "loss"] as const;
const VENUE = ["home", "away"] as const;
const DIVISIONS = ["east", "central", "west", "north", "south"] as const;
const MARGIN = ["lead10", "lead20", "trail10", "trail20", "close"] as const;
const FM_RE = /^(\d*)-(\d*)$/;

function pick<T extends string>(raw: string | null, values: readonly T[]): T | undefined {
  return values.find((v) => v === raw);
}

/**
 * res（勝敗）・ven（会場）・opp（対戦相手のチームID、カンマ区切り）・ot（延長 none／any／1／2／3）・fm（最終点差の範囲 「5-10」「5-」「-10」）・
 * mg（試合中の点差）・dv（自チームの地区）・div（対戦相手の地区）・sp（前後半5分の特別な試合 1＝含める／0＝除く）
 */
export const GAME_RECORD_CONDITION_KEYS = ["res", "ven", "opp", "ot", "fm", "mg", "dv", "div", "sp"];

export const gameRecordConditionsParam: UrlCodec<GameRecordConditions> = {
  keys: GAME_RECORD_CONDITION_KEYS,
  read: (p) => {
    const c: GameRecordConditions = { opponents: [] };
    const result = pick(p.get("res"), RESULT);
    if (result) c.result = result;
    const homeAway = pick(p.get("ven"), VENUE);
    if (homeAway) c.homeAway = homeAway;
    const opponents = (p.get("opp") ?? "").split(",").filter((id) => /^\d+$/.test(id));
    if (opponents.length > 0) c.opponents = opponents;
    const overtime = pick(p.get("ot"), OVERTIME_CONDITIONS);
    if (overtime) c.overtime = overtime;
    const fm = FM_RE.exec(p.get("fm") ?? "");
    if (fm && (fm[1] !== "" || fm[2] !== "")) {
      const min = fm[1] === "" ? undefined : Number(fm[1]);
      const max = fm[2] === "" ? undefined : Number(fm[2]);
      // 下限が上限より大きい指定も、そのまま持つ（入力の途中で消えないように。該当する試合は無い）
      if (min !== undefined) c.marginMin = min;
      if (max !== undefined) c.marginMax = max;
    }
    const margin = pick(p.get("mg"), MARGIN);
    if (margin) c.margin = margin;
    const ownDivision = pick(p.get("dv"), DIVISIONS);
    if (ownDivision) c.ownDivision = ownDivision;
    const oppDivision = pick(p.get("div"), DIVISIONS);
    if (oppDivision) c.oppDivision = oppDivision;
    const sp = p.get("sp");
    if (sp === "1") c.includeSpecial = true;
    else if (sp === "0") c.includeSpecial = false;
    return c;
  },
  write: (p, c) => {
    if (c.result) p.set("res", c.result);
    if (c.homeAway) p.set("ven", c.homeAway);
    if (c.opponents.length > 0) p.set("opp", c.opponents.join(","));
    if (c.overtime) p.set("ot", c.overtime);
    if (c.marginMin !== undefined || c.marginMax !== undefined) p.set("fm", `${c.marginMin ?? ""}-${c.marginMax ?? ""}`);
    if (c.margin) p.set("mg", c.margin);
    if (c.ownDivision) p.set("dv", c.ownDivision);
    if (c.oppDivision) p.set("div", c.oppDivision);
    if (c.includeSpecial !== undefined) p.set("sp", c.includeSpecial ? "1" : "0");
  },
};

// ---- タイトルの下の行・画像ファイル名のラベル（指定したときだけ書く） ----

/** 最終点差の範囲の文言（「最終点差 5〜10点」「最終点差 5点以上」「最終点差 10点以下」） */
export function marginRangeLabel(min: number | undefined, max: number | undefined): string | null {
  if (min === undefined && max === undefined) return null;
  if (min !== undefined && max !== undefined) return min === max ? `最終点差 ${min}点` : `最終点差 ${min}〜${max}点`;
  return min !== undefined ? `最終点差 ${min}点以上` : `最終点差 ${max}点以下`;
}

/**
 * 試合の条件のラベル。前後半5分の特別な試合は、既定と違う指定のときだけ書く（既定のときは表の下の注記で知らせる）。
 * opponentLabel はチームIDから表示名（スマホ幅では略称）を引く関数
 */
export function gameRecordConditionLabels(c: GameRecordConditions, opponentLabel: (teamId: string) => string, includeSpecialDefault: boolean): string[] {
  const labels: string[] = [];
  if (c.result) labels.push(c.result === "win" ? "勝った試合" : "負けた試合");
  if (c.homeAway) labels.push(c.homeAway === "home" ? "ホーム" : "アウェイ");
  if (c.opponents.length > 0) {
    const shown = c.opponents.slice(0, 3).map(opponentLabel).join("、");
    labels.push(`対戦相手: ${shown}${c.opponents.length > 3 ? ` 他${c.opponents.length - 3}` : ""}`);
  }
  if (c.overtime) labels.push(OVERTIME_LABELS[c.overtime]);
  const range = marginRangeLabel(c.marginMin, c.marginMax);
  if (range) labels.push(range);
  if (c.margin) labels.push(MARGIN_CONDITION_LABELS[c.margin]);
  if (c.ownDivision) labels.push(`地区: ${DIVISION_LABELS[c.ownDivision]}`);
  if (c.oppDivision) labels.push(`対戦相手の地区: ${DIVISION_LABELS[c.oppDivision]}`);
  if (c.includeSpecial !== undefined && c.includeSpecial !== includeSpecialDefault) {
    labels.push(c.includeSpecial ? "前後半5分の特別試合を含む" : "前後半5分の特別試合を除く");
  }
  return labels;
}

/**
 * シーズンを変えたとき（とページを開いたとき）に、そのシーズンに無い対戦相手・地区を外す（範囲「シーズン」のみ。DESIGN.md 164章と同じ考え方）。
 * 外したことは知らせない。外すものが無ければ null
 */
export function cleanGameConditionsForSeason(c: GameRecordConditions, teamIds: readonly string[], divisions: readonly Division[]): GameRecordConditions | null {
  let next = c;
  const kept = c.opponents.filter((id) => teamIds.includes(id));
  if (kept.length < c.opponents.length) next = { ...next, opponents: kept };
  if (c.ownDivision && !divisions.includes(c.ownDivision)) next = { ...next, ownDivision: undefined };
  if (c.oppDivision && !divisions.includes(c.oppDivision)) next = { ...next, oppDivision: undefined };
  return next === c ? null : next;
}
