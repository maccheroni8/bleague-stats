// 比較ページの順位（ランキング > シーズン成績と同じ計算から出す。DESIGN.md 404章）。
// チームは useTeamSeasonRanking が返す全チームの行・列をそのまま使い、並べ方・同じ値の扱いは RankedList と同じ
// （良い方が上位・表示の文字が同じなら同じ順位・次は飛ばす）。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
import type { AllTeamsRow, TeamPerspective } from "./teamStatsColumns";
import type { Column } from "../components/SortableTable";
import { rankDirectionOf, normalizeRankKey } from "./rankDirection";
import { rankPositions } from "./seasonCompare";
import { isPaint2Key, paintRankable, paintOf } from "./teamPaint2";

/** 比較の順位を出す選手の上限（この順位以内だけ出す） */
export const COMPARE_PLAYER_RANK_LIMIT = 20;

export function rankText(rank: number, equivalent = false): string {
  return `${rank}位${equivalent ? "相当" : ""}`;
}

/** 比較の項目（key・label）に対応するランキングの列。ラベルが同じ列を優先し、なければキーが同じ列 */
export function matchRankColumn<C extends { key: string; label: string }>(columns: readonly C[], def: { key: string; label: string }): C | undefined {
  return (
    columns.find((c) => normalizeRankKey(c.label) === normalizeRankKey(def.label)) ??
    columns.find((c) => normalizeRankKey(c.key) === normalizeRankKey(def.key))
  );
}

/** チームの順位。ランキングのチーム・シーズン成績（RankedList + noGamesRanking）と同じ。良し悪しなしの項目・値の無いチームは null */
export function teamRankOf(
  rows: readonly AllTeamsRow[],
  column: Column<AllTeamsRow>,
  perspective: TeamPerspective,
  teamId: string,
): number | null {
  if (rankDirectionOf(column.key, perspective) === "neutral") return null;
  const higherIsBetter = rankDirectionOf(column.key, perspective) !== "lower";
  const value = (r: AllTeamsRow) => Number(column.sortValue(r));
  const format = (r: AllTeamsRow) => (column.format ? column.format(r) : String(column.sortValue(r)));
  const unranked = (r: AllTeamsRow) =>
    r.gamesPlayed === 0 || (isPaint2Key(column.key) && !paintRankable(paintOf(r.totals), column.key, perspective));
  const ranked = rows.filter((r) => !unranked(r));
  const sorted = [...ranked].sort((a, b) => (higherIsBetter ? value(b) - value(a) : value(a) - value(b)));
  const ranks = rankPositions(sorted.map(format));
  const at = sorted.findIndex((r) => r.team.teamId === teamId);
  return at < 0 || format(sorted[at]!) === "-" ? null : ranks[at]!;
}
