import { scaledMinForPeriod } from "./periodMinimum";
import { CRITERION_GROUP, CRITERION_KEY, type StatCondition, type StatConditionItem, type StatConditionsState } from "./statConditions";
import { statConditionsParam, type UrlCodec } from "./urlState";

/**
 * ランキングの掲載基準（成功率の項目の最低成功数・成功数の下限など）を、詳細フィルタの「スタッツの条件」の行にまとめるための部品
 * （画面だけ。保存キーの対象外。DESIGN.md 478章）。
 *
 * 成功率の項目を選ぶと、条件の1行目に「3PM 以上 1.5」のような掲載基準の行が最初から入る（項目 crit）。数字を変える・以下の行を足して上限をつける・
 * 行を消して「基準なし」にする、を詳細フィルタだけでできる。基準の行はほかのスタッツの条件とは別に、集計の引数（最低成功数・上限）として渡す
 * （前季比較の前季にも同じ値を渡すため、行の絞り込みでは判定しない）。
 *
 * URL: 基準の行は sk（書かない＝最初の基準・「-」＝基準なし・「ge.1.5,le.1.49」＝その行）。そのほかの条件は今までどおり sc・sm。
 * 前の書き方（mm＝1試合記録、ex・sa＝シーズン成績）で保存した URL・検索条件も、読むときに基準の行に読み替える
 */

/** 成功率の項目の最低成功数の、画面で出す名前（ランキングの掲載基準の書き方「FGM 1.5以上」と同じ） */
export const MIN_MADE_RULE_LABEL: Record<string, string> = { fgPct: "FGM", twoPct: "2PM", tpPct: "3PM", ftPct: "FTM" };

/** 区間（Q別・前後半）を選んでいるときは、区間の長さに合わせて下げる。基準なし（0）は0のまま */
export function scaledMinMade(min: number, period: string | null): number {
  return min <= 0 ? 0 : scaledMinForPeriod(min, period);
}

/** 成功率の判定: 基準なし（0）でも、試投が1本以上ある試合だけ（試投が0の試合の率は出せない）。max があれば成功数の上限 */
export function passesMinMade(made: number, attempted: number, min: number, max?: number): boolean {
  if (max !== undefined && made > max) return false;
  return min <= 0 ? attempted > 0 : made >= min;
}

// ---- 基準の行 ----

/** 掲載基準の行1つ（詳細フィルタの項目の選択肢）。判定には使わない（集計の引数に渡す）ので、表示は「-」 */
export function criterionItem<R>(label: string, unit: string, extra: Partial<StatConditionItem<R>> = {}): StatConditionItem<R> {
  return {
    key: CRITERION_KEY,
    label: `${label}（掲載基準）`,
    shortLabel: label,
    group: CRITERION_GROUP,
    kind: "rate",
    unit,
    suffix: "",
    display: () => "-",
    ...extra,
  };
}

const newRow = (id: number, op: "gte" | "lte", value: string): StatCondition => ({ id, key: CRITERION_KEY, op, value });

/** 最初の状態（基準のある項目は、基準の行が1つ入っている。ない項目は空） */
export function seedConditions(seed: number | null): StatConditionsState {
  return { match: "all", conditions: seed === null ? [] : [newRow(1, "gte", String(seed))] };
}

/** 基準の行の数値（下限＝以上の最大・上限＝以下の最小。値が数値でない行は使わない）。下限0＝基準なし・上限 Infinity＝上限なし */
export function criterionBounds(state: StatConditionsState): { min: number; max: number } {
  let min = 0;
  let max = Infinity;
  for (const c of state.conditions) {
    if (c.key !== CRITERION_KEY) continue;
    const v = c.value.trim() === "" ? NaN : Number(c.value.replace(/[,\s]/g, ""));
    if (!Number.isFinite(v)) continue;
    if (c.op === "gte") min = Math.max(min, v);
    else max = Math.min(max, v);
  }
  return { min, max };
}

/** 基準の行を、集計の引数に渡す形にする。最初の基準のままなら changed が false（今までの経路・上位20位のファイルで出せる） */
export function criterionArgs(state: StatConditionsState, seed: number | null): { changed: boolean; min: number; max: number | undefined } {
  const b = criterionBounds(state);
  if (seed === null) return { changed: false, min: 0, max: undefined };
  const changed = b.min !== seed || b.max !== Infinity;
  return { changed, min: b.min, max: b.max === Infinity ? undefined : b.max };
}

/** 基準の行を除いた、ほかのスタッツの条件（行ごとの判定に使う） */
export function withoutCriterion(state: StatConditionsState): StatConditionsState {
  return state.conditions.some((c) => c.key === CRITERION_KEY) ? { ...state, conditions: state.conditions.filter((c) => c.key !== CRITERION_KEY) } : state;
}

/** 最初の状態のままか（基準の行が最初の1行だけで、ほかの条件が無い。「適用中」のチップを出さない・「初期の条件に戻す」を出さない判断） */
export function isSeedConditions(state: StatConditionsState, seed: number | null): boolean {
  if (state.match !== "all") return false;
  if (seed === null) return state.conditions.length === 0;
  const [c, ...rest] = state.conditions;
  return rest.length === 0 && !!c && c.key === CRITERION_KEY && c.op === "gte" && Number(c.value) === seed;
}

export interface CriterionLegacy {
  /** 前の書き方の URL のキー（書き込むときに消す） */
  keys: string[];
  /** 前の書き方から読んだ基準: undefined＝書いていない・null＝基準なし・数＝その下限 */
  read: (p: URLSearchParams) => number | null | undefined;
}

/** 基準の行のある URL の読み書き。seed が null（基準のない項目）のときは、基準の行を使わず sc・sm だけ */
export function criterionConditionsParam(seed: number | null, legacy?: CriterionLegacy): UrlCodec<StatConditionsState> {
  const base = statConditionsParam;
  return {
    keys: [...base.keys, "sk", ...(legacy?.keys ?? [])],
    read: (p) => {
      const rest = base.read(p);
      let crit: StatCondition[] | undefined;
      if (seed !== null) {
        const raw = p.get("sk");
        if (raw !== null) {
          crit =
            raw === "-"
              ? []
              : raw.split(",").flatMap((part) => {
                  const [op, ...v] = part.split(".");
                  return op === "ge" || op === "le" ? [newRow(0, op === "ge" ? "gte" : "lte", v.join("."))] : [];
                });
        } else {
          const old = legacy?.read(p);
          if (old !== undefined) crit = old === null ? [] : [newRow(0, "gte", String(old))];
        }
      }
      if (!rest && crit === undefined) return undefined;
      const rows = [...(crit ?? seedConditions(seed).conditions), ...(rest?.conditions ?? [])].map((c, i) => ({ ...c, id: i + 1 }));
      return { match: rest?.match ?? "all", conditions: rows };
    },
    write: (p, v) => {
      if (seed === null) {
        base.write(p, v);
        return;
      }
      const crit = v.conditions.filter((c) => c.key === CRITERION_KEY);
      base.write(p, withoutCriterion(v));
      const isSeed = crit.length === 1 && crit[0]!.op === "gte" && Number(crit[0]!.value) === seed;
      if (!isSeed) p.set("sk", crit.length === 0 ? "-" : crit.map((c) => `${c.op === "gte" ? "ge" : "le"}.${c.value.replace(/[,\s]/g, "")}`).join(","));
    },
  };
}

/** 前の書き方（mm＝1試合記録の最低成功数。-1・書かない＝最初の基準、0＝基準なし、1以上＝その成功数）を読む。区間を選んでいたときは、その長さに合わせて下げた数 */
export function legacyMinMade(period: string | null): CriterionLegacy {
  return {
    keys: ["mm"],
    read: (p) => {
      const raw = p.get("mm");
      if (raw === null) return undefined;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return undefined;
      return v === 0 ? null : scaledMinMade(v, period);
    },
  };
}

/** 前の書き方（ex＝シーズン成績の追加基準の下限、0＝基準なし。sa=1＝シュートタイプ別の最低試投数を外す）を読む */
export function legacyExtraThreshold(keys: ["ex"] | ["sa"]): CriterionLegacy {
  const key = keys[0];
  return {
    keys: [key],
    read: (p) => {
      const raw = p.get(key);
      if (raw === null) return undefined;
      if (key === "sa") return raw === "1" ? null : undefined;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0) return undefined;
      return v === 0 ? null : v;
    },
  };
}
