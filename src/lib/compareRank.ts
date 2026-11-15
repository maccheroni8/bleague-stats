// 比較ページの順位（ランキング > シーズン成績と同じ計算から出す。DESIGN.md 404章）。
// チームは useTeamSeasonRanking が返す全チームの行・列をそのまま使い、並べ方・同じ値の扱いは RankedList と同じ
// （良い方が上位・表示の文字が同じなら同じ順位・次は飛ばす）。画面・通信に依存しない純粋な関数だけ（保存キーの対象外）。
import type { AllTeamsRow, TeamPerspective } from "./teamStatsColumns";
import type { Column } from "../components/SortableTable";
import { rankDirectionOf, normalizeRankKey, isRankOnlyKey } from "./rankDirection";
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
    columns.find((c) => normalizeRankLabel(c.label) === normalizeRankLabel(def.label)) ??
    columns.find((c) => normalizeRankKey(c.key) === normalizeRankKey(def.key))
  );
}

/** 項目名の照合用。大文字小文字と空白だけをそろえる（日本語を消さない。消すと「外国籍 PTS」と「日本人 PTS」がどちらも「pts」になって取り違える） */
function normalizeRankLabel(label: string): string {
  return label.toLowerCase().replace(/\s+/g, "");
}

/** 順位の色を付ける範囲（上位・下位それぞれ何位まで。チーム詳細のチームスタッツ。DESIGN.md 406章） */
export const TEAM_RANK_TIER_SIZE = 3;

/** チーム1つの順位。tier＝上位3位以内（top）・下位3位以内（bottom）・それ以外（null）。total＝順位を付けたチーム数 */
export interface TeamRankResult {
  rank: number;
  total: number;
  tier: "top" | "bottom" | null;
}

/**
 * 全チームの順位（teamId → 順位・上位／下位の別）。ランキングのチーム・シーズン成績（RankedList + noGamesRanking）と同じ並べ方
 * （良い方が上位・表示の文字が同じなら同じ順位・次は飛ばす）。良し悪しなしの項目は null（順位も色も付けない）。ただし色なしで順位だけ出す項目（isRankOnlyKey）は、多い順の順位を返して tier は常に null。
 * 試合が0・値の無い（「-」）チームは順位に入れない。下位は、いちばん悪い方から数えた順位（同じ値は同じ順位）が3位以内。
 * 上位と下位が重なるほどチームが少ないとき（6チーム以下）は色を付けない
 */
export function teamRanksOf(
  rows: readonly AllTeamsRow[],
  column: Column<AllTeamsRow>,
  perspective: TeamPerspective,
): Map<string, TeamRankResult> | null {
  const direction = rankDirectionOf(column.key, perspective);
  // 良し悪しなしは順位も出さない。ただし isRankOnlyKey の項目は、多い順の順位だけ出す（色なし）
  const rankOnly = direction === "neutral" && isRankOnlyKey(column.key);
  if (direction === "neutral" && !rankOnly) return null;
  const higherIsBetter = direction !== "lower";
  const value = (r: AllTeamsRow) => Number(column.sortValue(r));
  const format = (r: AllTeamsRow) => (column.format ? column.format(r) : String(column.sortValue(r)));
  const unranked = (r: AllTeamsRow) =>
    r.gamesPlayed === 0 ||
    Number.isNaN(value(r)) ||
    format(r) === "-" ||
    (isPaint2Key(column.key) && !paintRankable(paintOf(r.totals), column.key, perspective));
  const ranked = rows.filter((r) => !unranked(r));
  const best = [...ranked].sort((a, b) => (higherIsBetter ? value(b) - value(a) : value(a) - value(b)));
  const fromTop = rankPositions(best.map(format));
  const fromBottom = rankPositions([...best].reverse().map(format));
  const total = best.length;
  const out = new Map<string, TeamRankResult>();
  best.forEach((r, i) => {
    const rank = fromTop[i]!;
    const bottomRank = fromBottom[total - 1 - i]!;
    const tier = rankOnly || total <= TEAM_RANK_TIER_SIZE * 2 ? null : rank <= TEAM_RANK_TIER_SIZE ? "top" : bottomRank <= TEAM_RANK_TIER_SIZE ? "bottom" : null;
    out.set(r.team.teamId, { rank, total, tier });
  });
  return out;
}

/** チームの順位。ランキングのチーム・シーズン成績（RankedList + noGamesRanking）と同じ。良し悪しなしの項目・値の無いチームは null */
export function teamRankOf(
  rows: readonly AllTeamsRow[],
  column: Column<AllTeamsRow>,
  perspective: TeamPerspective,
  teamId: string,
): number | null {
  return teamRanksOf(rows, column, perspective)?.get(teamId)?.rank ?? null;
}
