import { useId, type ReactNode } from "react";
import {
  newStatCondition,
  parseConditionInput,
  parseConditionInputFor,
  STAT_CONDITION_MATCH_LABELS,
  STAT_CONDITION_OP_LABELS,
  type StatCondition,
  type StatConditionItem,
  type StatConditionMatch,
  type StatConditionOp,
  type StatConditionsState,
  statConditionsSummary,
} from "../lib/statConditions";

/** 選択肢に出すだけの項目の情報（行の型に依存しない） */
type ItemOption = Pick<StatConditionItem<unknown>, "key" | "label" | "group" | "unit"> & Partial<Pick<StatConditionItem<unknown>, "kind">>;

/**
 * スタッツの条件の編集欄（詳細フィルタの一番下に幅いっぱいで置く。DESIGN.md 162章）。
 * 1行＝「項目・以上/以下・値・単位・削除」。スマホ幅では項目を1段目、残りを2段目に折る
 */
export function StatConditionsEditor({
  state,
  onChange,
  items,
  defaultKey,
  disabledReason,
  title = "スタッツの条件",
  minConditions = 0,
  quickValues,
  hint,
}: {
  state: StatConditionsState;
  onChange: (next: StatConditionsState) => void;
  items: readonly ItemOption[];
  /** 「条件を追加」で最初に選んでおく項目 */
  defaultKey: string;
  disabledReason?: string;
  /** 見出し（達成記録では「しきい値」） */
  title?: string;
  /** これ以下には減らせない行数（達成記録のしきい値は1行以上。0なら「条件をすべて削除」も出す） */
  minConditions?: number;
  /** 項目ごとの「すぐ選べる」値。各行の下にボタンで出す（label があれば値の代わりにその名前） */
  quickValues?: Record<string, { value: number; label?: string }[]>;
  /** 行の下に出す補足 */
  hint?: ReactNode;
}) {
  const baseId = useId();
  const groups: { label: string; items: ItemOption[] }[] = [];
  for (const item of items) {
    let g = groups.find((x) => x.label === item.group);
    if (!g) {
      g = { label: item.group, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  const byKey = new Map(items.map((i) => [i.key, i]));
  const update = (id: number, patch: Partial<StatCondition>) =>
    onChange({ ...state, conditions: state.conditions.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: number) => onChange({ ...state, conditions: state.conditions.filter((c) => c.id !== id) });
  const add = () => onChange({ ...state, conditions: [...state.conditions, newStatCondition(byKey.has(defaultKey) ? defaultKey : (items[0]?.key ?? defaultKey))] });
  const disabled = !!disabledReason;

  return (
    <div className={`stat-conditions${disabled ? " disabled" : ""}`}>
      <div className="stat-conditions-head">
        <span className="stat-conditions-title">{title}</span>
        {(minConditions === 0 || state.conditions.length > 1) && (
        <div className="mode-toggle stat-conditions-match" role="group" aria-label="条件の組み合わせ">
          {(Object.keys(STAT_CONDITION_MATCH_LABELS) as StatConditionMatch[]).map((m) => (
            <button
              key={m}
              type="button"
              className={state.match === m ? "active" : ""}
              aria-pressed={state.match === m}
              disabled={disabled}
              onClick={() => onChange({ ...state, match: m })}
            >
              {STAT_CONDITION_MATCH_LABELS[m]}
            </button>
          ))}
        </div>
        )}
      </div>
      {disabledReason && <p className="filter-bar-note">{disabledReason}</p>}
      {state.conditions.map((c, i) => {
        const item = byKey.get(c.key);
        const invalid = c.value.trim() !== "" && parseConditionInputFor(c.value, item?.kind) === null;
        const isMinutes = item?.kind === "minutes";
        const quick = quickValues?.[c.key] ?? [];
        return (
          <div key={c.id}>
          <div className="stat-condition-row">
            <select
              className="stat-condition-item"
              aria-label={`条件${i + 1}の項目`}
              value={item ? c.key : ""}
              disabled={disabled}
              onChange={(e) => update(c.id, { key: e.target.value })}
            >
              {!item && <option value="">（この表に無い項目）</option>}
              {groups.map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <select
              className="stat-condition-op"
              aria-label={`条件${i + 1}の以上/以下`}
              value={c.op}
              disabled={disabled}
              onChange={(e) => update(c.id, { op: e.target.value as StatConditionOp })}
            >
              {(Object.keys(STAT_CONDITION_OP_LABELS) as StatConditionOp[]).map((op) => (
                <option key={op} value={op}>
                  {STAT_CONDITION_OP_LABELS[op]}
                </option>
              ))}
            </select>
            <input
              id={`${baseId}-${c.id}`}
              className={`stat-condition-value${invalid ? " invalid" : ""}`}
              type="text"
              inputMode={isMinutes ? "text" : "decimal"}
              enterKeyHint="done"
              placeholder={isMinutes ? "20:00" : "値"}
              aria-label={`条件${i + 1}の値`}
              value={c.value}
              disabled={disabled}
              onChange={(e) => update(c.id, { value: e.target.value })}
            />
            <span className="stat-condition-unit">{item?.unit ?? ""}</span>
            <button
              type="button"
              className="stat-condition-remove"
              aria-label={`条件${i + 1}を削除`}
              disabled={disabled || state.conditions.length <= minConditions}
              onClick={() => remove(c.id)}
            >
              ×
            </button>
          </div>
          {quick.length > 0 && (
            <div className="stat-condition-quick" role="group" aria-label={`条件${i + 1}のよく使う値`}>
              {quick.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  className={parseConditionInput(c.value) === q.value ? "active" : ""}
                  aria-pressed={parseConditionInput(c.value) === q.value}
                  disabled={disabled}
                  onClick={() => update(c.id, { value: String(q.value) })}
                >
                  {q.label ? `${q.label}（${q.value}）` : q.value}
                </button>
              ))}
            </div>
          )}
          </div>
        );
      })}
      <div className="stat-conditions-actions">
        <button type="button" className="stat-conditions-add" disabled={disabled || items.length === 0} onClick={add}>
          ＋ 条件を追加
        </button>
        {state.conditions.length > 0 && minConditions === 0 && (
          <button type="button" className="stat-conditions-clear" disabled={disabled} onClick={() => onChange({ ...state, conditions: [] })}>
            条件をすべて削除
          </button>
        )}
      </div>
      {hint && <p className="filter-bar-note">{hint}</p>}
    </div>
  );
}

/**
 * FilterBar の advancedExtra に渡す形（編集欄と「適用中」のチップ）にまとめる。
 * チップの文言はタイトルの書き出しと同じ（「MIN 20:00以上・3P% 35%以上」「… または …」）
 */
export function statConditionsBarExtra<R>(
  state: StatConditionsState,
  onChange: (next: StatConditionsState) => void,
  items: readonly StatConditionItem<R>[],
  opts: { defaultKey: string; disabledReason?: string },
) {
  const summary = statConditionsSummary(state, items);
  return {
    content: (
      <StatConditionsEditor state={state} onChange={onChange} items={items} defaultKey={opts.defaultKey} disabledReason={opts.disabledReason} />
    ),
    chip: summary ? { label: "スタッツの条件", value: summary, onClear: () => onChange({ ...state, conditions: [] }) } : undefined,
  };
}
