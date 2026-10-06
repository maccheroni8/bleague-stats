import { useCallback, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import { useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import type { SituationalFilter } from "./situational";
import type { StatConditionOp, StatConditionsState } from "./statConditions";

/**
 * フィルタの状態をURLのクエリに持たせる仕組み（個人一覧・チーム一覧・ランキング。DESIGN.md 163章）。
 *
 * - 既定値と同じ値はURLに載せない（何も選んでいないページのURLは ?season= だけのまま）
 * - フィルタを変えたときは履歴を増やさず、今の履歴を書き換える（replace）。ブラウザバックは「絞り込みを1つ戻す」ではなく
 *   「前のページへ戻る」のまま。別のページから戻ると、そのURLからフィルタが元に戻る
 * - 1回の操作で複数のフィルタを変える（「すべてクリア」等）ときは、同じ処理の中の書き換えを1回にまとめる
 *   （書き換えのたびに前の書き換えを上書きしないよう、書き換え待ちのクエリを1つだけ持つ）
 * - 読めない値（手で書き換えたURL等）は既定値として扱う
 */

let pending: URLSearchParams | null = null;
let latest: { pathname: string; search: string; navigate: NavigateFunction } | null = null;

function pendingParams(): URLSearchParams {
  if (!pending) {
    pending = new URLSearchParams(latest?.search ?? "");
    queueMicrotask(flush);
  }
  return pending;
}

function flush() {
  const params = pending;
  pending = null;
  if (!params || !latest) return;
  const search = params.toString();
  if (`?${search}` === latest.search || (search === "" && latest.search === "")) return;
  latest.navigate({ pathname: latest.pathname, search: search ? `?${search}` : "" }, { replace: true });
}

/** 今のクエリ（書き換え待ちがあればそれ） */
function currentParams(search: string): URLSearchParams {
  return pending ?? new URLSearchParams(search);
}

export interface UrlCodec<T> {
  /** URLの値（複数のキーを持つものは params 全体）から読む。読めなければ undefined（既定値になる） */
  read: (params: URLSearchParams) => T | undefined;
  /** 値をURLに書く（既定値のときは消す） */
  write: (params: URLSearchParams, value: T) => void;
  /** 同じURLの間は同じ値（オブジェクト）を返すための、読む対象のキーの一覧 */
  keys: string[];
}

/**
 * useState と同じ使い勝手で、値をURLのクエリに持つ。値はURLの文字列が変わらない間は同じオブジェクトのまま
 * （useMemo の依存に使っても再計算を起こさない）
 */
export function useUrlState<T>(codec: UrlCodec<T>, defaultValue: T): [T, Dispatch<SetStateAction<T>>] {
  const location = useLocation();
  const navigate = useNavigate();
  latest = { pathname: location.pathname, search: location.search, navigate };
  const params = new URLSearchParams(location.search);
  const signature = codec.keys.map((k) => `${k}=${params.getAll(k).join("\u0001")}`).join("&");
  // 既定値がほかの値で決まるもの（カテゴリごとの項目の既定値等）は、既定値が変わったときも読み直す
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const value = useMemo(() => codec.read(params) ?? defaultValue, [signature, defaultValue]);
  const codecRef = useRef(codec);
  codecRef.current = codec;
  const defaultRef = useRef(defaultValue);
  defaultRef.current = defaultValue;
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const c = codecRef.current;
    const prev = c.read(currentParams(latest?.search ?? "")) ?? defaultRef.current;
    const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
    const p = pendingParams();
    for (const k of c.keys) p.delete(k);
    c.write(p, resolved);
  }, []);
  return [value, setValue];
}

// ---- 値の種類ごとの読み書き ----

/** 1つのキーに1つの値（既定値のときは載せない）。aliases で URL 上の短い名前を決める（例: total → tot） */
export function enumParam<T extends string>(key: string, values: readonly T[], defaultValue: T, aliases: Partial<Record<T, string>> = {}): UrlCodec<T> {
  const toUrl = (v: T) => aliases[v] ?? v;
  return {
    keys: [key],
    read: (p) => {
      const raw = p.get(key);
      if (raw === null) return undefined;
      return values.find((v) => toUrl(v) === raw || v === raw);
    },
    write: (p, v) => {
      if (v !== defaultValue) p.set(key, toUrl(v));
    },
  };
}

/** カンマ区切りの一覧（空なら載せない） */
export function listParam(key: string): UrlCodec<string[]> {
  return {
    keys: [key],
    read: (p) => {
      const raw = p.get(key);
      if (raw === null) return undefined;
      return raw.split(",").filter(Boolean);
    },
    write: (p, v) => {
      if (v.length > 0) p.set(key, v.join(","));
    },
  };
}

export function numberParam(key: string, defaultValue: number, opts: { min?: number; max?: number } = {}): UrlCodec<number> {
  return {
    keys: [key],
    read: (p) => {
      const raw = p.get(key);
      if (raw === null || raw.trim() === "") return undefined;
      const v = Number(raw);
      if (!Number.isFinite(v)) return undefined;
      if (opts.min !== undefined && v < opts.min) return undefined;
      if (opts.max !== undefined && v > opts.max) return undefined;
      return v;
    },
    write: (p, v) => {
      if (v !== defaultValue) p.set(key, String(Number(v.toFixed(3))));
    },
  };
}

/** 範囲（「60-100」） */
export function rangeParam(key: string, defaultValue: readonly [number, number], bounds: [number, number]): UrlCodec<[number, number]> {
  return {
    keys: [key],
    read: (p) => {
      const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(p.get(key) ?? "");
      if (!m) return undefined;
      const a = Number(m[1]);
      const b = Number(m[2]);
      if (a < bounds[0] || b > bounds[1] || a > b) return undefined;
      return [a, b];
    },
    write: (p, v) => {
      if (v[0] !== defaultValue[0] || v[1] !== defaultValue[1]) p.set(key, `${v[0]}-${v[1]}`);
    },
  };
}

// ---- シチュエーション別の絞り込み（項目ごとに1つのキー） ----

const RESULT = ["win", "loss"] as const;
const VENUE = ["home", "away"] as const;
const DIVISION = ["east", "west", "same", "other"] as const;
const OWN_DIVISION = ["east", "central", "west", "north", "south"] as const;
const NEW_YEAR = ["before", "after"] as const;
const OPP_WIN = ["under50", "atLeast50", "atLeast60"] as const;
const MARGIN = ["lead10", "lead20", "trail10", "trail20", "close"] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function pick<T extends string>(raw: string | null, values: readonly T[]): T | undefined {
  return values.find((v) => v === raw);
}

/**
 * res（勝敗）・ven（会場）・div（対戦地区）・dv（自チームの地区。ランキングのシーズン成績だけ）・mon（月、カンマ区切り）・ny（年明け前後）・day（wkday／wkend）・
 * opw（対戦相手の勝率）・mg（点差）・rng（直近 r5、期間 2026-01-01~2026-02-28、片側だけなら ~2026-01-15・2026-01-16~）
 */
export const SITUATIONAL_KEYS = ["res", "ven", "div", "dv", "mon", "ny", "day", "opw", "mg", "rng"];

export const situationalParam: UrlCodec<SituationalFilter> = {
  keys: SITUATIONAL_KEYS,
  read: (p) => {
    const f: SituationalFilter = { range: { kind: "all" } };
    const rng = p.get("rng");
    if (rng) {
      const recent = /^r(\d+)$/.exec(rng);
      const dates = rng.split("~");
      // 期間指定は片側だけ（「前半」＝〜境目、「後半」＝境目〜）や、選んだ直後で日付がまだ空（~）のこともある
      const dateOrEmpty = (d: string) => d === "" || DATE_RE.test(d);
      if (recent) f.range = { kind: "recent", n: Number(recent[1]) };
      else if (dates.length === 2 && dateOrEmpty(dates[0]!) && dateOrEmpty(dates[1]!))
        f.range = { kind: "dateRange", start: dates[0]!, end: dates[1]! };
    }
    const result = pick(p.get("res"), RESULT);
    if (result) f.result = result;
    const homeAway = pick(p.get("ven"), VENUE);
    if (homeAway) f.homeAway = homeAway;
    const division = pick(p.get("div"), DIVISION);
    if (division) f.division = division;
    const ownDivision = pick(p.get("dv"), OWN_DIVISION);
    if (ownDivision) f.ownDivision = ownDivision;
    const months = (p.get("mon") ?? "")
      .split(",")
      .map(Number)
      .filter((m) => Number.isInteger(m) && m >= 1 && m <= 12);
    if (months.length > 0) f.months = months;
    const newYear = pick(p.get("ny"), NEW_YEAR);
    if (newYear) f.newYear = newYear;
    const day = p.get("day");
    if (day === "wkday") f.weekday = true;
    if (day === "wkend") f.weekend = true;
    const opw = pick(p.get("opw"), OPP_WIN);
    if (opw) f.opponentWinRate = opw;
    const margin = pick(p.get("mg"), MARGIN);
    if (margin) f.margin = margin;
    return f;
  },
  write: (p, f) => {
    if (f.range.kind === "recent") p.set("rng", `r${f.range.n}`);
    if (f.range.kind === "dateRange") p.set("rng", `${f.range.start}~${f.range.end}`);
    if (f.result) p.set("res", f.result);
    if (f.homeAway) p.set("ven", f.homeAway);
    if (f.division) p.set("div", f.division);
    if (f.ownDivision) p.set("dv", f.ownDivision);
    if (f.months?.length) p.set("mon", f.months.join(","));
    if (f.newYear) p.set("ny", f.newYear);
    if (f.weekday) p.set("day", "wkday");
    else if (f.weekend) p.set("day", "wkend");
    if (f.opponentWinRate) p.set("opw", f.opponentWinRate);
    if (f.margin) p.set("mg", f.margin);
  },
};

// ---- スタッツの条件（sc=min.ge.20,3ppct.ge.35 と sm=any） ----

const OPS: Record<string, StatConditionOp> = { ge: "gte", le: "lte" };

export const statConditionsParam: UrlCodec<StatConditionsState> = {
  keys: ["sc", "sm"],
  read: (p) => {
    const raw = p.get("sc");
    const match = p.get("sm") === "any" ? "any" : "all";
    if (!raw && match === "all") return undefined;
    const conditions = (raw ?? "")
      .split(",")
      .filter(Boolean)
      .flatMap((part, i) => {
        const [key, op, ...rest] = part.split(".");
        const o = OPS[op ?? ""];
        if (!key || !o) return [];
        // 行の id は並び順で決める（URLの文字列が変わるたびに id が変わると、入力中の欄が作り直されてしまう）
        return [{ id: i + 1, key, op: o, value: rest.join(".") }];
      });
    return { match, conditions };
  },
  write: (p, v) => {
    if (v.conditions.length > 0) {
      p.set(
        "sc",
        v.conditions.map((c) => `${c.key}.${c.op === "gte" ? "ge" : "le"}.${c.value.replace(/[,\s]/g, "")}`).join(","),
      );
    }
    if (v.match === "any") p.set("sm", "any");
  },
};

/** 文字列1つ（キーや年度など。check で読める値かを確かめる） */
export function stringParam(key: string, defaultValue: string, check: (v: string) => boolean = () => true): UrlCodec<string> {
  return {
    keys: [key],
    read: (p) => {
      const raw = p.get(key);
      return raw !== null && raw !== "" && check(raw) ? raw : undefined;
    },
    write: (p, v) => {
      if (v !== defaultValue) p.set(key, v);
    },
  };
}

/** 決まった数値の選択肢（直近5／10試合等） */
export function choiceNumberParam<T extends number>(key: string, values: readonly T[], defaultValue: T): UrlCodec<T> {
  return {
    keys: [key],
    read: (p) => values.find((v) => String(v) === p.get(key)),
    write: (p, v) => {
      if (v !== defaultValue) p.set(key, String(v));
    },
  };
}

/**
 * season 以外のクエリをすべて消す（ページのタブ・ランキングのチーム/個人を切り替えたとき、前のタブのフィルタを持ち越さない）。
 * 同じ処理の中で続けて呼ぶ setter の書き換えと1回にまとまる
 */
export function clearUrlParams(keep: string[] = ["season"]): void {
  const p = pendingParams();
  for (const k of [...new Set(p.keys())]) if (!keep.includes(k)) p.delete(k);
}
