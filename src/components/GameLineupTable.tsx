import { useState } from "react";
import { SortableTable, type Column } from "./SortableTable";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatSigned } from "../lib/format";
import type { GameLineupRow } from "../lib/gameLineups";
import { useMediaQuery } from "../lib/useMediaQuery";

// 初期表示は上位10パターンまで（出場時間の長い順）。それ以下は「全パターン表示」ボタンで展開する
// （チーム詳細ページの「よく使われるラインナップ」と同じパターン）
const MAX_GAME_LINEUP_ROWS = 10;

interface GameLineupTableProps {
  teamName: string;
  rows: GameLineupRow[];
  /** 5人の並び順（ボックススコアの並び＝スタメン→ベンチ）と表示名 */
  playerOrder: Map<string, number>;
  playerNames: Map<string, string>;
  /** スマホ幅（560px以下）で使う名字のみの表記（lib/playerSurname.ts） */
  playerSurnames: Map<string, string>;
  color?: string;
}

/** 試合詳細ページのラインナップ別成績（1チーム分）。既定は出場時間の長い順 */
export function GameLineupTable({ teamName, rows, playerOrder, playerNames, playerSurnames, color }: GameLineupTableProps) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const [expanded, setExpanded] = useState(false);
  const names = narrow ? playerSurnames : playerNames;
  const lineupLabel = (row: GameLineupRow) =>
    [...row.playerIds]
      .sort((a, b) => (playerOrder.get(a) ?? 99) - (playerOrder.get(b) ?? 99))
      .map((id) => names.get(id) ?? playerNames.get(id) ?? id)
      .join(" / ");

  const columns: Column<GameLineupRow>[] = [
    { key: "lineup", label: "5人の組み合わせ", align: "left", sortValue: lineupLabel, format: lineupLabel },
    { key: "seconds", label: "出場時間", sortValue: (r) => r.seconds, format: (r) => formatMinutesFromSeconds(r.seconds) },
    { key: "ownPoints", label: "得点", sortValue: (r) => r.ownPoints },
    { key: "oppPoints", label: "失点", sortValue: (r) => r.oppPoints, higherIsBetter: false },
    { key: "netPoints", label: "得失点", sortValue: (r) => r.netPoints, format: (r) => formatSigned(r.netPoints, 0) },
  ];

  // 上位10パターンは出場時間の長い順で決め、列ソートはその10パターンの中で並べ替える
  const displayedRows = expanded ? rows : rows.slice(0, MAX_GAME_LINEUP_ROWS);

  return (
    <div className="game-lineup-team">
      <h3 className="game-lineup-team-name">{teamName}</h3>
      {rows.length === 0 ? (
        <p className="empty-message">この範囲のラインナップはありません</p>
      ) : (
        <>
          <div className="table-scroll">
            <SortableTable
              columns={columns}
              rows={displayedRows}
              rowKey={(r) => r.lineupKey}
              defaultSortKey="seconds"
              rowAccentColor={() => color}
            />
          </div>
          {rows.length > MAX_GAME_LINEUP_ROWS && (
            <button className="load-more-button" type="button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? `上位${MAX_GAME_LINEUP_ROWS}パターンのみ表示` : `全パターン表示（全${rows.length}パターン）`}
            </button>
          )}
        </>
      )}
    </div>
  );
}
