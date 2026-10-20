import { useMemo, type ReactNode } from "react";
import { SortableTable, type Column } from "./SortableTable";
import { formatRecordShort } from "../lib/recordFormat";
import type { StatScope } from "../lib/statDescriptions";

/** 対戦相手別の表の1行に最低限必要な値（チーム詳細・個人詳細で共通） */
export interface OpponentRowBase {
  key: string;
  /** 対戦相手のクラブID。「全体」の行は null */
  opponentTeamId: string | null;
  /** 相手の名称。「全体」の行は「全体」 */
  name: string;
  /** G（チームは試合数、選手は出場した試合数） */
  gamesPlayed: number;
  wins: number;
  losses: number;
}

/**
 * 対戦相手別の表（チーム詳細・個人詳細の共通）。左から 相手・G・勝敗 と、カテゴリごとの成績の列。
 * 見出しを押すと並べ替える（初めは試合数の多い順）。一番下に「全体」の行を固定で置く（並べ替えの対象外）。
 * 左の3列（相手・G・勝敗）は横スクロールしても固定する（`.opp-split-table`。スマホ幅は相手が略称）
 */
export function OpponentSplitTable<R extends OpponentRowBase>({
  rows,
  total,
  statColumns,
  renderName,
  statScope,
}: {
  rows: R[];
  total: R;
  statColumns: Column<R>[];
  /** 相手の名前のセル（押すと対戦成績へ移る）。「全体」の行は呼ばれない */
  renderName: (row: R) => ReactNode;
  statScope: StatScope;
}) {
  const columns = useMemo<Column<R>[]>(
    () => [
      {
        key: "opponent",
        label: "相手",
        align: "left",
        sortValue: (r) => r.name,
        render: (r) => (r.opponentTeamId === null ? <span className="opp-split-total-label">{r.name}</span> : renderName(r)),
      },
      { key: "g", label: "G", sortValue: (r) => r.gamesPlayed, format: (r) => String(r.gamesPlayed) },
      {
        key: "record",
        label: "勝敗",
        // 勝ち越しの多い順、同じなら勝ちの多い順
        sortValue: (r) => r.wins - r.losses + r.wins / 1000,
        format: (r) => formatRecordShort(r.wins, r.losses),
      },
      ...statColumns,
    ],
    [statColumns, renderName],
  );
  return (
    <div className="table-scroll opp-split-table">
      <SortableTable columns={columns} rows={rows} pinnedRows={[total]} rowKey={(r) => r.key} defaultSortKey="g" statScope={statScope} />
    </div>
  );
}
