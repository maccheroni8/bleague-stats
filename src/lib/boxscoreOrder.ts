import type { BoxscoreRow } from "../../shared/types";
import { playTimeToSeconds } from "./boxscoreAggregate";

/**
 * 試合詳細ページの選手の並び（出場交代・ボックススコア〔各カテゴリタブ・シューティング〕で共通）。
 *
 * - スタメン（StartingFlg=1）を上に固定し、その中は出場時間の長い順
 * - 控えは出場時間の長い順
 * - 出場時間が同じときは、元の並び（背番号など）のまま（安定ソート）
 * - 出場しなかった選手（PlayTime が "DNP"）は、スタメン・控えそれぞれの末尾（元の並びのまま）
 *
 * 出場時間は試合全体（PeriodCategory=18）の PlayTime。ボックススコアでQ別・前後半を選んでも
 * 並びは変えない（出場交代と同じ並びを保つため）。
 * 引数は試合全体の選手行（`Category === 1 && PeriodCategory === 18`）。
 */
export function orderPlayersByPlayTime(rows: BoxscoreRow[]): BoxscoreRow[] {
  const byPlayTimeDesc = (a: BoxscoreRow, b: BoxscoreRow): number => {
    const aDnp = a.PlayTime === "DNP";
    const bDnp = b.PlayTime === "DNP";
    if (aDnp !== bDnp) return aDnp ? 1 : -1;
    if (aDnp) return 0;
    return playTimeToSeconds(b.PlayTime) - playTimeToSeconds(a.PlayTime);
  };
  const starters = rows.filter((r) => r.StartingFlg === 1).sort(byPlayTimeDesc);
  const bench = rows.filter((r) => r.StartingFlg !== 1).sort(byPlayTimeDesc);
  return [...starters, ...bench];
}

/** 試合全体の選手行（Category=1・PeriodCategory=18）の並び順（選手ID → 何番目か） */
export function playTimeOrderIndex(allRows: BoxscoreRow[]): Map<string, number> {
  const gameRows = allRows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
  return new Map(orderPlayersByPlayTime(gameRows).map((r, i) => [r.PlayerID, i] as const));
}
