/**
 * スタッツの条件（詳細フィルタ）。「項目・以上/以下・値」の行を並べ、「すべて満たす／どれかを満たす」で組み合わせて、
 * 個人一覧・チーム一覧・ランキングの行を絞り込む（DESIGN.md 162章）。
 *
 * 判定は「表に出している値」で行う。各ページは、表の列と同じ表示（display）を返す項目（StatConditionItem）を渡し、
 * ここで表示の文字列を数値に読み直して比べる。平均/合計・Q別/前後半・シチュエーション別の絞り込みを選んでいれば、
 * 表と同じくその値で判定される。% は「35」と入れれば35%、MIN は「20」（=20:00）・「20:15」（分:秒）・「20.5」（小数の分）のどれでも入れられる。
 * 表示（単位・タイトル・チップ）は常に「分:秒」（20:15。サイト全体の時間の書式。CLAUDE.md）。URLには入力した文字列のまま持つ
 */
import { formatMinutesColon } from "./minutesFormat";


export type StatConditionOp = "gte" | "lte";
export type StatConditionMatch = "all" | "any";

export interface StatCondition {
  id: number;
  key: string;
  op: StatConditionOp;
  /** 入力欄の文字列そのまま（空・数値でない行は判定に使わない） */
  value: string;
}

export interface StatConditionsState {
  match: StatConditionMatch;
  conditions: StatCondition[];
}

export const DEFAULT_STAT_CONDITIONS: StatConditionsState = { match: "all", conditions: [] };

export const STAT_CONDITION_OP_LABELS: Record<StatConditionOp, string> = { gte: "以上", lte: "以下" };
export const STAT_CONDITION_MATCH_LABELS: Record<StatConditionMatch, string> = { all: "すべて満たす", any: "どれかを満たす" };

/** 値の読み方。pct は「35.0%」、winPct は勝率の「.750」（どちらも%の数で比べる）、minutes は「20:15」 */
export type StatValueKind = "count" | "rate" | "pct" | "winPct" | "minutes" | "fixed";

/** 条件に選べる項目1つ（ページが表の列から作る） */
export interface StatConditionItem<R> {
  key: string;
  label: string;
  /** 選択肢の区切り（Traditional・opp Traditional・Shooting 等） */
  group: string;
  kind: StatValueKind;
  /** 条件の行に出す単位（「分:秒・1試合平均」「%」「シーズン通算」等） */
  unit: string;
  /** タイトルの書き出しで値の後ろに付ける単位（「%」「cm」等。MINは値そのものが「20:15」の形なので付けない） */
  suffix: string;
  /** 表と同じ表示の文字列（値が無ければ「-」） */
  display: (row: R) => string;
}

/** 項目を作るための定義。display は今の平均/合計のもの、displayOther は平均/合計を逆にしたもの（あれば、カウント系かの判定に使う） */
export interface StatConditionItemDef<R> {
  key: string;
  label: string;
  group: string;
  display: (row: R) => string;
  displayOther?: (row: R) => string;
  /** シーズン通算の値で判定する項目（シューティング・プロフィール・キャリア・シーズン値のEFF/PER/PPP）。単位に「シーズン通算」と出す */
  seasonTotal?: boolean;
  /** 単位を固定する項目（身長の cm 等） */
  fixedSuffix?: string;
}

export const DISPLAY_MODE_UNIT: Record<string, string> = { perGame: "1試合平均", total: "合計", per30: "30分換算" };

const MINUTES_RE = /^(\d+):(\d{2})$/;
const WIN_PCT_RE = /^\d?\.\d{3}$/;

function normalizeDigits(text: string): string {
  return text
    .replace(/[０-９．－＋：]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−–—]/g, "-")
    .replace(/,/g, "")
    .trim();
}

/** 表示の文字列を、条件と比べる数値に読み直す。値が無い（「-」等）ときは null */
export function parseDisplayedValue(text: string, kind: StatValueKind): number | null {
  const t = normalizeDigits(text);
  if (kind === "minutes") {
    const m = MINUTES_RE.exec(t);
    if (m) return Number(m[1]) + Number(m[2]) / 60;
  }
  if (kind === "winPct" && WIN_PCT_RE.test(t)) return Number(t) * 100;
  const m = /[-+]?\d+(?:\.\d+)?/.exec(t);
  if (!m) return null;
  return Number(m[0]);
}

/** 入力欄の「20:15」（分:秒。秒は2桁で00〜59）。分で返す */
const MINUTES_INPUT_RE = /^(\d+):([0-5]\d)$/;

/**
 * 入力欄の文字列を数値にする（全角数字・「％」「分」付きも受け付ける）。数値でなければ null。
 * 「20:15」（分:秒）は20.25（分）。コロンの形がどの項目で使えるかは parseConditionInputFor が見る
 */
export function parseConditionInput(text: string): number | null {
  const t = normalizeDigits(text).replace(/[%％分]$/, "");
  const clock = MINUTES_INPUT_RE.exec(t);
  if (clock) return Number(clock[1]) + Number(clock[2]) / 60;
  if (t === "" || !/^[-+]?\d*(?:\.\d+)?$/.test(t) || t === "-" || t === "+") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

/** 項目の種類を踏まえて読む。「20:15」の形は MIN（minutes）の項目だけで使える（ほかの項目では数値として読まない） */
export function parseConditionInputFor(text: string, kind: StatValueKind | undefined): number | null {
  if (kind !== "minutes" && normalizeDigits(text).includes(":")) return null;
  return parseConditionInput(text);
}

function detectKind<R>(def: StatConditionItemDef<R>, rows: readonly R[]): StatValueKind {
  if (def.fixedSuffix !== undefined) return "fixed";
  const sample = rows.slice(0, 40);
  const shown = sample.map((r) => normalizeDigits(def.display(r))).filter((t) => t !== "" && t !== "-");
  if (shown.some((t) => t.endsWith("%"))) return "pct";
  if (shown.some((t) => MINUTES_RE.test(t))) return "minutes";
  if (shown.length > 0 && shown.every((t) => WIN_PCT_RE.test(t))) return "winPct";
  if (def.displayOther && sample.some((r) => def.display(r) !== def.displayOther!(r))) return "count";
  return "rate";
}

/**
 * 定義から項目を作る。単位は表示の文字列から決める（「%」で終われば%、「20:15」なら分、平均/合計で値が変わればカウント系）。
 * rows は判定に使う行（単位を決めるための見本にもする）。行が無いときは単位を空にする
 */
export function buildStatConditionItems<R>(
  defs: StatConditionItemDef<R>[],
  rows: readonly R[],
  displayMode: string | null,
): StatConditionItem<R>[] {
  const seen = new Set<string>();
  const items: StatConditionItem<R>[] = [];
  const modeUnit = displayMode ? (DISPLAY_MODE_UNIT[displayMode] ?? "") : "";
  for (const def of defs) {
    if (seen.has(def.key)) continue;
    seen.add(def.key);
    const kind = detectKind(def, rows);
    const suffix =
      kind === "fixed" ? (def.fixedSuffix ?? "") : kind === "pct" || kind === "winPct" ? "%" : "";
    const base =
      kind === "fixed"
        ? (def.fixedSuffix ?? "")
        : kind === "pct" || kind === "winPct"
          ? "%"
          : kind === "minutes"
            ? `分:秒${modeUnit ? `・${modeUnit}` : ""}`
            : kind === "count"
              ? modeUnit
              : "";
    const unit = def.seasonTotal ? [base, "シーズン通算"].filter(Boolean).join("・") : base;
    items.push({ key: def.key, label: def.label, group: def.group, kind, unit, suffix, display: def.display });
  }
  return items;
}

interface ActiveCondition<R> {
  condition: StatCondition;
  item: StatConditionItem<R>;
  threshold: number;
}

/** 判定に使う条件（項目が見つかり、値が数値の行）だけを返す */
export function activeStatConditions<R>(state: StatConditionsState, items: readonly StatConditionItem<R>[]): ActiveCondition<R>[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  return state.conditions.flatMap((condition) => {
    const item = byKey.get(condition.key);
    const threshold = parseConditionInputFor(condition.value, item?.kind);
    return item && threshold !== null ? [{ condition, item, threshold }] : [];
  });
}

/** 使える（項目が選べて値が入っている）条件があるか */
export function hasActiveStatConditions<R>(state: StatConditionsState, items: readonly StatConditionItem<R>[]): boolean {
  return activeStatConditions(state, items).length > 0;
}

/** 値が無い行（「-」）は、その条件を満たさない扱いにする */
function satisfies<R>(row: R, c: ActiveCondition<R>): boolean {
  const v = parseDisplayedValue(c.item.display(row), c.item.kind);
  if (v === null) return false;
  // 表示の丸めた値で比べる。浮動小数の誤差で「35.0 ≥ 35」が外れないよう、わずかな幅を持たせる
  const eps = 1e-9;
  return c.condition.op === "gte" ? v >= c.threshold - eps : v <= c.threshold + eps;
}

/**
 * 条件を行ごとに判定する関数（使える条件が無ければ null）。大量の行を1件ずつ判定するとき（1試合記録の索引。DESIGN.md 220章）に、
 * 行の配列を作らずに使う。判定は filterByStatConditions と同じ
 */
export function statConditionMatcher<R>(state: StatConditionsState, items: readonly StatConditionItem<R>[]): ((row: R) => boolean) | null {
  const active = activeStatConditions(state, items);
  if (active.length === 0) return null;
  return state.match === "any" ? (row) => active.some((c) => satisfies(row, c)) : (row) => active.every((c) => satisfies(row, c));
}

export function filterByStatConditions<R>(rows: readonly R[], state: StatConditionsState, items: readonly StatConditionItem<R>[]): R[] {
  const active = activeStatConditions(state, items);
  if (active.length === 0) return [...rows];
  return rows.filter((row) =>
    state.match === "any" ? active.some((c) => satisfies(row, c)) : active.every((c) => satisfies(row, c)),
  );
}

/** 条件のキーから、判定に要る項目の区切り（group）を引く。試合ログの読み込みが要るかどうか等の判断に使う */
export function activeStatConditionKeys(state: StatConditionsState): string[] {
  return state.conditions.filter((c) => parseConditionInput(c.value) !== null).map((c) => c.key);
}

/** タイトルに書き出す条件の文言（「MIN 20:15以上」「3P% 35%以上」等）。1条件＝1ラベル */
export function statConditionLabels<R>(state: StatConditionsState, items: readonly StatConditionItem<R>[]): string[] {
  return activeStatConditions(state, items).map(
    ({ condition, item, threshold }) =>
      `${item.label} ${item.kind === "minutes" ? formatMinutesColon(threshold) : `${formatThreshold(threshold)}${item.suffix}`}${STAT_CONDITION_OP_LABELS[condition.op]}`,
  );
}

function formatThreshold(v: number): string {
  return String(Number(v.toFixed(3)));
}

/** タイトルでの条件どうしのつなぎ（「すべて」は「・」、「どれか」は「または」） */
export function statConditionJoiner(match: StatConditionMatch): string {
  return match === "any" ? " または " : "・";
}

/** フィルタの「適用中」のチップ・タイトルで使う1行の文言 */
export function statConditionsSummary<R>(state: StatConditionsState, items: readonly StatConditionItem<R>[]): string {
  return statConditionLabels(state, items).join(statConditionJoiner(state.match));
}

let nextConditionId = 1;
export function newStatCondition(key: string): StatCondition {
  nextConditionId += 1;
  return { id: Date.now() * 1000 + nextConditionId, key, op: "gte", value: "" };
}

/** ConditionTitle の statConditions に渡す形 */
export function statConditionsTitle<R>(state: StatConditionsState, items: readonly StatConditionItem<R>[]): { labels: string[]; joiner: string } {
  return { labels: statConditionLabels(state, items), joiner: statConditionJoiner(state.match) };
}
