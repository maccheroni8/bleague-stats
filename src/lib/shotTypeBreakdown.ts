// シュートタイプ別の成功/試投カウント（Yahoo!スポーツplay-by-play由来。DESIGN.md参照）。
// 「キャッチアンドシュート」に相当する独立タグはデータ上存在せず、無印の「ジャンプショット」
// （全体の約51%）に一括りになっている点に注意。scripts/aggregate.tsのシーズン集計版
// （buildShotTypeBreakdownByPlayer）と同じ「Yahoo表記の原文をそのままキーにする」方針を踏襲する。

import type { ShotTypeBreakdown, YahooShotEvent } from "../../shared/types";

/**
 * 実データでの出現頻度順（DESIGN.md参照、2024-25シーズン全737試合・95,484本の集計に基づく）。
 * 未知のシュートタイプ（新規語彙）は末尾に追加で表示する
 */
export const SHOT_TYPE_DISPLAY_ORDER = [
  "ジャンプショット",
  "プルアップジャンプショット",
  "ドライビングレイアップ",
  "レイアップ",
  "ステップバックジャンプショット",
  "フローティングジャンプショット",
  "フェイドアウェイ",
  "フックショット",
  "ターンアラウンドジャンプショット",
  "ダンク",
  "アリウープ",
];

export function sortShotTypeKeys(keys: string[]): string[] {
  return [...keys].sort((a, b) => {
    const ia = SHOT_TYPE_DISPLAY_ORDER.indexOf(a);
    const ib = SHOT_TYPE_DISPLAY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

/** 選手ごとのシュートタイプ別成功/試投カウントを1試合分のYahooShotEvent[]から組み立てる */
export function buildShotTypeBreakdownByPlayer(shots: YahooShotEvent[]): Map<string, ShotTypeBreakdown> {
  const byPlayer = new Map<string, ShotTypeBreakdown>();
  for (const shot of shots) {
    if (!shot.playerId || !shot.shotType) continue;
    const breakdown = byPlayer.get(shot.playerId) ?? {};
    const counts = breakdown[shot.shotType] ?? { made: 0, attempted: 0 };
    counts.attempted += 1;
    if (shot.made) counts.made += 1;
    breakdown[shot.shotType] = counts;
    byPlayer.set(shot.playerId, breakdown);
  }
  return byPlayer;
}

export function formatShotTypeCell(counts: { made: number; attempted: number } | undefined): string {
  if (!counts || counts.attempted === 0) return "-";
  const pct = (100 * counts.made) / counts.attempted;
  return `${counts.made}/${counts.attempted} (${pct.toFixed(1)}%)`;
}
