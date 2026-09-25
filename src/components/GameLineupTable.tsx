import { useState, type CSSProperties } from "react";
import { SortableTable, type Column } from "./SortableTable";
import { StatHeaderLabel } from "./StatHeaderLabel";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatSigned } from "../lib/format";
import { statDescription } from "../lib/statDescriptions";
import {
  foreignCountBucket,
  summarizeByForeignCount,
  type GameLineupRow,
  type OnCourtSummaryRow,
  type RangeTotals,
} from "../lib/gameLineups";
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
  /** 5人のうち外国籍・帰化・アジア特別枠の選手の人数（オンザコート。区分不明の選手がいれば null） */
  foreignCountOf: (row: GameLineupRow) => number | null;
  /** そのシーズンに同時に出られる人数の上限（season-rules.json の maxForeignOnCourt）。不明ならオンザコート別の合計を出さない */
  maxForeignOnCourt?: number;
  /** 選んだ範囲の試合時間・得点・失点（オンザコート別の合計の集計外を出すのに使う） */
  totals: RangeTotals;
}

/**
 * 人数に応じた行の塗り: 4はチームカラーを背景に混ぜて塗る、3はその半分の濃さ、2以下は塗らない（DESIGN.md 142章）。
 * 区分不明（null）と、そのシーズンの上限を超える人数（公式記録の取り違え等で集計外に入る組）は塗らない
 */
function highlightStrength(count: number | null, maxOnCourt: number | undefined): "full" | "half" | undefined {
  if (count === null || (maxOnCourt !== undefined && count > maxOnCourt)) return undefined;
  if (count >= 4) return "full";
  if (count === 3) return "half";
  return undefined;
}

/** 試合詳細ページのラインナップ別成績（1チーム分）。上にオンザコート別の合計、下に5人組の一覧（既定は出場時間の長い順） */
export function GameLineupTable({
  teamName,
  rows,
  playerOrder,
  playerNames,
  playerSurnames,
  color,
  foreignCountOf,
  maxForeignOnCourt,
  totals,
}: GameLineupTableProps) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const [expanded, setExpanded] = useState(false);
  // オンザコート別の合計で選んだ行（人数、集計外は null、未選択は undefined）。一覧をその行の組み合わせだけに絞る
  const [selectedCount, setSelectedCount] = useState<number | null | undefined>(undefined);
  const names = narrow ? playerSurnames : playerNames;
  const teamColor = color ?? "var(--accent)";
  const lineupLabel = (row: GameLineupRow) =>
    [...row.playerIds]
      .sort((a, b) => (playerOrder.get(a) ?? 99) - (playerOrder.get(b) ?? 99))
      .map((id) => names.get(id) ?? playerNames.get(id) ?? id)
      .join(" / ");

  const columns: Column<GameLineupRow>[] = [
    // OCは先頭（横スクロールで固定される列）に置き、スマホ幅でも名前・数値と一緒に見えるようにする
    {
      key: "onCourt",
      align: "left",
      label: "OC",
      sortValue: (r) => foreignCountOf(r) ?? -1,
      format: (r) => {
        const c = foreignCountOf(r);
        return c === null ? "−" : String(c);
      },
    },
    { key: "lineup", label: "5人の組み合わせ", align: "left", sortValue: lineupLabel, format: lineupLabel },
    { key: "seconds", label: "出場時間", sortValue: (r) => r.seconds, format: (r) => formatMinutesFromSeconds(r.seconds) },
    { key: "ownPoints", label: "得点", sortValue: (r) => r.ownPoints },
    { key: "oppPoints", label: "失点", sortValue: (r) => r.oppPoints, higherIsBetter: false },
    { key: "netPoints", label: "得失点", sortValue: (r) => r.netPoints, format: (r) => formatSigned(r.netPoints, 0) },
  ];

  const summary = maxForeignOnCourt === undefined ? null : summarizeByForeignCount(rows, foreignCountOf, maxForeignOnCourt, totals);
  const filteredRows =
    selectedCount === undefined || maxForeignOnCourt === undefined
      ? rows
      : rows.filter((r) => foreignCountBucket(foreignCountOf(r), maxForeignOnCourt) === selectedCount);
  // 上位10パターンは出場時間の長い順で決め、列ソートはその10パターンの中で並べ替える
  const displayedRows = expanded ? filteredRows : filteredRows.slice(0, MAX_GAME_LINEUP_ROWS);
  const selectedLabel = selectedCount === undefined ? null : selectedCount === null ? "集計外" : `OC ${selectedCount}`;

  return (
    <div className="game-lineup-team">
      <h3 className="game-lineup-team-name">{teamName}</h3>
      {rows.length === 0 ? (
        <p className="empty-message">この範囲のラインナップはありません</p>
      ) : (
        <>
          {summary && (
            <OnCourtSummaryTable
              summary={summary}
              totals={totals}
              color={teamColor}
              selected={selectedCount}
              onSelect={(c) => {
                setSelectedCount((prev) => (prev === c ? undefined : c));
                setExpanded(false);
              }}
            />
          )}
          {selectedLabel && (
            <p className="game-oc-filter-note">
              {selectedLabel}の組み合わせだけを表示しています
              <button type="button" onClick={() => setSelectedCount(undefined)}>
                すべて表示
              </button>
            </p>
          )}
          {filteredRows.length === 0 ? (
            <p className="empty-message">該当する組み合わせはありません</p>
          ) : (
            <div className="table-scroll">
              <SortableTable
                columns={columns}
                rows={displayedRows}
                rowKey={(r) => r.lineupKey}
                defaultSortKey="seconds"
                statScope="team"
                rowAccentColor={(r) => (highlightStrength(foreignCountOf(r), maxForeignOnCourt) === "full" ? teamColor : "transparent")}
                rowHighlightColor={(r) => (highlightStrength(foreignCountOf(r), maxForeignOnCourt) ? teamColor : undefined)}
                rowHighlightStrength={(r) => highlightStrength(foreignCountOf(r), maxForeignOnCourt) ?? "full"}
              />
            </div>
          )}
          {filteredRows.length > MAX_GAME_LINEUP_ROWS && (
            <button className="load-more-button" type="button" onClick={() => setExpanded((v) => !v)}>
              {expanded ? `上位${MAX_GAME_LINEUP_ROWS}パターンのみ表示` : `全パターン表示（全${filteredRows.length}パターン）`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

const SUMMARY_HEADERS = ["OC", "出場時間", "得点", "失点", "得失点"] as const;

/** オンザコート別の合計（人数ごとの出場時間・得点・失点・得失点）。行を押すと下の一覧をその人数の組み合わせに絞る */
function OnCourtSummaryTable({
  summary,
  totals,
  color,
  selected,
  onSelect,
}: {
  summary: OnCourtSummaryRow[];
  totals: RangeTotals;
  color: string;
  selected: number | null | undefined;
  onSelect: (count: number | null) => void;
}) {
  return (
    <div className="game-oc-summary table-scroll">
      <table className="sortable-table game-oc-summary-table">
        <thead>
          <tr>
            {SUMMARY_HEADERS.map((h, i) => (
              <th key={h} className={i === 0 ? "align-left" : "align-right"} title={statDescription(h, "team")}>
                <StatHeaderLabel label={h} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {summary.map((s) => {
            // 時間も得点も無い人数の行は塗らない
            const strength = s.seconds > 0 || s.ownPoints > 0 || s.oppPoints > 0 ? highlightStrength(s.count, undefined) : undefined;
            const isSelected = selected === s.count;
            return (
              <tr
                key={s.count ?? "excluded"}
                className={[
                  "game-oc-row",
                  strength ? "row-highlight" : "",
                  strength === "half" ? "row-highlight-half" : "",
                  isSelected ? "is-selected" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                style={strength ? ({ "--row-highlight-color": color } as CSSProperties) : undefined}
                onClick={() => onSelect(s.count)}
                tabIndex={0}
                aria-pressed={isSelected}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(s.count);
                  }
                }}
              >
                <td className="align-left" title={s.count === null ? statDescription("集計外", "team") : undefined}>
                  {s.count === null ? "集計外" : s.count}
                  {isSelected ? " ✓" : ""}
                </td>
                <td className="align-right">{formatMinutesFromSeconds(s.seconds)}</td>
                <td className="align-right">{s.ownPoints}</td>
                <td className="align-right">{s.oppPoints}</td>
                <td className="align-right">{formatSigned(s.netPoints, 0)}</td>
              </tr>
            );
          })}
          <tr className="game-oc-total">
            <td className="align-left">合計</td>
            <td className="align-right">{formatMinutesFromSeconds(totals.seconds)}</td>
            <td className="align-right">{totals.ownPoints}</td>
            <td className="align-right">{totals.oppPoints}</td>
            <td className="align-right">{formatSigned(totals.ownPoints - totals.oppPoints, 0)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
