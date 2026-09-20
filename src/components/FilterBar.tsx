import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { axisValueLabel, isAxisChipped, type FilterAxis, type FilterAxisOption, type FilterMultiAxis } from "../lib/filterAxes";
import { usePageState } from "../lib/pageStateCache";

interface FilterBarProps {
  axes: FilterAxis[];
  /**
   * 「詳細フィルタ」の開閉状態をusePageStateで保持するキー（ブラウザバックで復元される）。
   * ページ・タブごとに一意にする
   */
  stateKey: string;
  /**
   * 「すべてクリア」で全軸を既定値に戻す処理。軸ごとのonChangeを続けて呼ぶと、同じSituationalFilter
   * を別々に更新する呼び出しが互いを上書きしてしまうため、ページ側でまとめて既定値に戻す
   */
  onClearAll?: () => void;
  /**
   * 簡易モード: 軸が2〜3個だけのタブ（歴代記録・直近成績）用。ラベル付きドロップダウンだけを並べ、
   * 詳細フィルタ・チップ・「すべてクリア」は出さない
   */
  simple?: boolean;
  /**
   * 幅の狭い枠（比較スロット）用: 常時表示の軸も2列で折り返す。横1列に統一しているのは
   * ページ幅いっぱいのバーだけで、3分割したスロットでは1列にすると値が読めない
   */
  compact?: boolean;
  /**
   * 1軸だけで選択肢の文言が長いバー（ランキングの「スタッツ項目」）用: 1列の幅を広げる。
   * 通常のバーは1列を最大200pxに抑えて横1列に収めている
   */
  wide?: boolean;
}

/** ボタン（summary表示）を押すとポップオーバー（children）を開く共通部品。外側クリック・Escで閉じる */
function PopoverShell({
  id,
  summary,
  disabledReason,
  children,
}: {
  id: string;
  summary: string;
  disabledReason?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  const disabled = !!disabledReason;

  // パネルが画面の右端からはみ出す位置（右側の列の軸）では、ボタンの右端に揃えて開く
  useLayoutEffect(() => {
    if (!open || !wrapRef.current || !panelRef.current) return;
    const left = wrapRef.current.getBoundingClientRect().left;
    setAlignRight(left + panelRef.current.offsetWidth > document.documentElement.clientWidth - 8);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="filter-popover" ref={wrapRef}>
      <button
        id={id}
        type="button"
        className="filter-popover-button"
        aria-expanded={open && !disabled}
        disabled={disabled}
        title={disabled ? disabledReason : summary}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <div ref={panelRef} className={`filter-popover-panel${alignRight ? " align-right" : ""}`}>
          {children}
        </div>
      )}
    </div>
  );
}

/** 複数選択の中身: 検索・プリセット・チェックボックス一覧・全解除 */
function MultiSelectContent({ axis }: { axis: FilterMultiAxis }) {
  const [query, setQuery] = useState("");
  const selected = new Set(axis.selected);
  const visible = query ? axis.options.filter((o) => o.label.includes(query)) : axis.options;
  const toggle = (value: string) => {
    axis.onChangeSelected(selected.has(value) ? axis.selected.filter((v) => v !== value) : [...axis.selected, value]);
  };
  return (
    <div className="filter-multi">
      {axis.searchable && (
        <input
          type="search"
          className="filter-multi-search"
          placeholder="検索"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label={`${axis.label}を検索`}
        />
      )}
      <div className="filter-multi-actions">
        {axis.presets?.map((p) => (
          <button key={p.label} type="button" onClick={() => axis.onChangeSelected(p.values)}>
            {p.label}
          </button>
        ))}
        <button type="button" onClick={() => axis.onChangeSelected([])} disabled={axis.selected.length === 0}>
          すべて解除
        </button>
      </div>
      <div className="filter-multi-list">
        {visible.map((o) => (
          <label key={o.value} className="filter-multi-item">
            <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggle(o.value)} />
            {o.label}
          </label>
        ))}
        {visible.length === 0 && <span className="filter-multi-empty">該当なし</span>}
      </div>
    </div>
  );
}

/** select の選択肢を、group なし（先頭）→ group ごとの順にまとめる。group を持つ選択肢が無ければ1かたまり */
function selectOptionGroups(options: FilterAxisOption[]): { label: string | null; options: FilterAxisOption[] }[] {
  const groups: { label: string | null; options: FilterAxisOption[] }[] = [];
  for (const o of options) {
    const label = o.group ?? null;
    let g = groups.find((x) => x.label === label);
    if (!g) {
      g = { label, options: [] };
      if (label === null) groups.unshift(g);
      else groups.push(g);
    }
    g.options.push(o);
  }
  return groups;
}

function FilterField({ axis }: { axis: FilterAxis }) {
  const id = useId();
  const changed = isAxisChipped(axis);
  const disabled = !!axis.disabledReason;
  return (
    <div className={`filter-field${changed ? " changed" : ""}${disabled ? " disabled" : ""}`}>
      <label htmlFor={id}>{axis.label}</label>
      {axis.kind === "popover" ? (
        <PopoverShell id={id} summary={axis.summary} disabledReason={axis.disabledReason}>
          {axis.content}
        </PopoverShell>
      ) : axis.kind === "multi" ? (
        <PopoverShell id={id} summary={axis.summary} disabledReason={axis.disabledReason}>
          <MultiSelectContent axis={axis} />
        </PopoverShell>
      ) : axis.kind === "select" ? (
        <select id={id} value={axis.value} disabled={disabled} title={axis.disabledReason} onChange={(e) => axis.onChange(e.target.value)}>
          {selectOptionGroups(axis.options).map((g) =>
            g.label === null ? (
              g.options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))
            ) : (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ),
          )}
        </select>
      ) : (
        <input id={id} type="date" value={axis.value} disabled={disabled} title={axis.disabledReason} onChange={(e) => axis.onChange(e.target.value)} />
      )}
    </div>
  );
}

/**
 * フィルタ共通のバー（DESIGN.md 105章）。ラベル付きドロップダウンで軸を並べ、使用頻度の低い軸は
 * 「詳細フィルタ」に折りたたみ、既定値から変更した軸だけをチップ（×で解除）として出す。
 * 表・画像出力（.export-target）の外に置く。画像に写る「選択中の条件」は ConditionTitle が担う
 */
export function FilterBar({ axes, stateKey, onClearAll, simple = false, compact = false, wide = false }: FilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = usePageState<boolean>(`${stateKey}:advancedOpen`, false);
  const panelId = useId();
  const primary = axes.filter((a) => a.tier === "primary");
  const advanced = simple ? [] : axes.filter((a) => a.tier === "advanced");
  const chips = simple ? [] : axes.filter(isAxisChipped);
  const advancedChangedCount = advanced.filter(isAxisChipped).length;
  const disabledReasons = [
    ...new Set(axes.filter((a) => a.disabledReason && !a.quietDisabled).map((a) => a.disabledReason as string)),
  ];

  // すべての軸が今のタブでは効かないとき、バー全体を薄くして「操作できない」ことを見た目で示す
  const allDisabled = axes.length > 0 && axes.every((a) => a.disabledReason);

  return (
    <div className={`filter-bar${allDisabled ? " all-disabled" : ""}${compact ? " compact" : ""}${wide ? " wide" : ""}`}>
      <div
        className="filter-bar-grid filter-bar-primary"
        style={{ "--filter-cols": primary.length } as React.CSSProperties}
      >
        {primary.map((a) => (
          <FilterField key={a.id} axis={a} />
        ))}
      </div>
      {disabledReasons.length > 0 && <p className="filter-bar-note">{disabledReasons.join(" ")}</p>}
      {advanced.length > 0 && (
        <div className="filter-bar-advanced-row">
          <button
            type="button"
            className="filter-advanced-toggle"
            aria-expanded={advancedOpen}
            aria-controls={panelId}
            onClick={() => setAdvancedOpen((v) => !v)}
          >
            詳細フィルタ
            {advancedChangedCount > 0 && <span className="filter-badge">{advancedChangedCount}</span>}
            <span aria-hidden="true">{advancedOpen ? "▴" : "▾"}</span>
          </button>
        </div>
      )}
      {advanced.length > 0 && advancedOpen && (
        <div className="filter-bar-advanced" id={panelId}>
          <div className="filter-bar-grid">
            {advanced.map((a) => (
              <FilterField key={a.id} axis={a} />
            ))}
          </div>
        </div>
      )}
      {chips.length > 0 && (
        <div className="filter-chips">
          <span className="filter-chips-label">適用中</span>
          {chips.map((a) => (
            <button
              key={a.id}
              type="button"
              className="filter-chip"
              aria-label={`${a.label}: ${axisValueLabel(a)}を解除`}
              onClick={() => a.onChange(a.defaultValue)}
            >
              <b>{a.label}:</b> {axisValueLabel(a)}
              <span className="filter-chip-x" aria-hidden="true">
                ×
              </span>
            </button>
          ))}
          {onClearAll && (
            <button type="button" className="filter-chips-clear" onClick={onClearAll}>
              すべてクリア
            </button>
          )}
        </div>
      )}
    </div>
  );
}
