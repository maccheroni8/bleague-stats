import type { ReactNode } from "react";
import { statDescription } from "../lib/statDescriptions";
import { statJa } from "../lib/statNames";
import { SHOOT_LEVELS } from "../lib/figureShootTable";
import "./ShootTableFigure.css";
import { SortMark } from "../components/SortMark";

export interface ShootViewColumn<R> {
  key: string;
  label: string;
  /** 表に出す文字 */
  text: (row: R) => string;
  /** 色の段階（0〜4）。色を塗らない列・値の無いマスは null */
  level: (row: R) => number | null;
  /** 成績の列の先頭（左に太い線） */
  groupStart?: boolean;
  /** 見出しのツールチップ用に、statNames の略称（無ければ label） */
  stat?: string;
  scope: "player" | "team";
}
export interface ShootSort { key: string; descending: boolean }

const headerTitle = (label: string, scope: "player" | "team") => {
  if (label.startsWith("opp ")) { const base = label.slice(4); return `相手の${statDescription(base, scope) ?? statJa(base, scope)}`; }
  if (label.endsWith(" +/-")) { const base = label.slice(0, -4); return `${statDescription(base, scope) ?? statJa(base, scope)}の差（自チーム−相手）`; }
  return statDescription(label, scope) ?? statJa(label, scope);
};

/** 色の見方（低い〜高い）。表の下に小さく出す。保存画像にも入る */
export function ShootLegend({ reversed = false }: { reversed?: boolean }) {
  // 相手の視点は低いほど緑なので、左（赤）が「高い」、右（緑）が「低い」
  return <div className="shoot-legend" aria-label="色の見方">
    <span>{reversed ? "高い" : "低い"}</span>
    {Array.from({ length: SHOOT_LEVELS }, (_, i) => <span key={i} className={`shoot-swatch shoot-l${i}`} />)}
    <span>{reversed ? "低い" : "高い"}</span>
  </div>;
}

/** 色分けの表（選手・チームで共通）。見出しを押すと並べ替え（同じ列をもう一度で逆順） */
export function ShootTableView<R>({ rows, rowKey, columns, sort, onSort, ranks, nameHeader, renderName, ariaLabel, className, highlight }: {
  rows: readonly R[]; rowKey: (row: R) => string; columns: readonly ShootViewColumn<R>[];
  sort: ShootSort; onSort: (key: string) => void; ranks: readonly (number | null)[];
  nameHeader: string; renderName: (row: R) => ReactNode; ariaLabel: string; className?: string; highlight?: (row: R) => boolean;
}) {
  return <div className={`shoot-scroll${className ? ` ${className}` : ""}`} tabIndex={0} role="region" aria-label={ariaLabel}>
    <table className="shoot-table">
      <thead><tr>
        <th className="shoot-rank">#</th>
        <th className="shoot-name">{nameHeader}</th>
        {columns.map(c => <th key={c.key} className={`shoot-col${c.groupStart ? " shoot-group-start" : ""}`} aria-sort={sort.key === c.key ? (sort.descending ? "descending" : "ascending") : "none"}>
          <button title={headerTitle(c.stat ?? c.label, c.scope)} onClick={() => onSort(c.key)}>
            {c.label.startsWith("opp ") ? <><span className="shoot-opp">opp</span><span className="shoot-opp">{c.label.slice(4)}</span></> : c.label}
            <SortMark active={sort.key === c.key} descending={sort.descending} />
          </button>
        </th>)}
      </tr></thead>
      <tbody>
        {rows.map((row, i) => <tr key={rowKey(row)}>
          <td className="shoot-rank">{ranks[i] ?? ""}</td>
          <td className={`shoot-name${highlight?.(row) ? " shoot-hl" : ""}`}>{renderName(row)}</td>
          {columns.map(c => { const level = c.level(row); return <td key={c.key} className={`shoot-cell${c.groupStart ? " shoot-group-start" : ""}${level === null ? "" : ` shoot-l${level}`}`}>{c.text(row)}</td>; })}
        </tr>)}
      </tbody>
    </table>
  </div>;
}
