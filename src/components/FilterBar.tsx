import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { axisValueLabel, isAxisChipped, type FilterAxis } from "../lib/filterAxes";
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
  onClearAll: () => void;
}

/** ボタンを押すとポップオーバー（axis.content）を開く軸。外側クリック・Escで閉じる */
function FilterPopoverControl({ axis, id }: { axis: Extract<FilterAxis, { kind: "popover" }>; id: string }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [alignRight, setAlignRight] = useState(false);
  const disabled = !!axis.disabledReason;

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
        title={axis.disabledReason}
        onClick={() => setOpen((v) => !v)}
      >
        <span>{axis.summary}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && !disabled && (
        <div ref={panelRef} className={`filter-popover-panel${alignRight ? " align-right" : ""}`}>
          {axis.content}
        </div>
      )}
    </div>
  );
}

function FilterField({ axis }: { axis: FilterAxis }) {
  const id = useId();
  const changed = isAxisChipped(axis);
  const disabled = !!axis.disabledReason;
  return (
    <div className={`filter-field${changed ? " changed" : ""}${disabled ? " disabled" : ""}`}>
      <label htmlFor={id}>{axis.label}</label>
      {axis.kind === "popover" ? (
        <FilterPopoverControl axis={axis} id={id} />
      ) : axis.kind === "select" ? (
        <select id={id} value={axis.value} disabled={disabled} title={axis.disabledReason} onChange={(e) => axis.onChange(e.target.value)}>
          {axis.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
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
export function FilterBar({ axes, stateKey, onClearAll }: FilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = usePageState<boolean>(`${stateKey}:advancedOpen`, false);
  const panelId = useId();
  const primary = axes.filter((a) => a.tier === "primary");
  const advanced = axes.filter((a) => a.tier === "advanced");
  const chips = axes.filter(isAxisChipped);
  const advancedChangedCount = advanced.filter(isAxisChipped).length;
  const disabledReasons = [
    ...new Set(axes.filter((a) => a.disabledReason && !a.quietDisabled).map((a) => a.disabledReason as string)),
  ];

  // すべての軸が今のタブでは効かないとき、バー全体を薄くして「操作できない」ことを見た目で示す
  const allDisabled = axes.length > 0 && axes.every((a) => a.disabledReason);

  return (
    <div className={`filter-bar${allDisabled ? " all-disabled" : ""}`}>
      <div className="filter-bar-grid">
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
          <button type="button" className="filter-chips-clear" onClick={onClearAll}>
            すべてクリア
          </button>
        </div>
      )}
    </div>
  );
}
