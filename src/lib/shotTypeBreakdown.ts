// シュートタイプ別の成功/試投カウント（Yahoo!スポーツplay-by-play由来。DESIGN.md参照）。
// 「キャッチアンドシュート」に相当する独立タグはデータ上存在せず、無印の「ジャンプショット」
// （全体の約51%）に一括りになっている点に注意。scripts/aggregate.tsのシーズン集計版
// （buildShotTypeBreakdownByPlayer）と同じ「Yahoo表記の原文をそのままキーにする」方針を踏襲する。

import type { ShotTypeBreakdown, ShotTypeCounts, YahooShotEvent } from "../../shared/types";

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

/**
 * 表示用の英語ラベル（DESIGN.md参照。日本語表記は長くテーブル列見出しとして冗長なため、
 * 表示時のみ英語に変換する。集計・データのキー自体はYahoo表記の原文のまま変更しない）。
 * 未知のシュートタイプ（新規語彙）は原文のままフォールバック表示する
 */
const SHOT_TYPE_LABELS: Record<string, string> = {
  ジャンプショット: "Jump Shot",
  プルアップジャンプショット: "Pull-Up",
  ドライビングレイアップ: "Driving Layup",
  レイアップ: "Layup",
  ステップバックジャンプショット: "Step Back",
  フローティングジャンプショット: "Floater",
  フェイドアウェイ: "Fadeaway",
  フックショット: "Hook Shot",
  ターンアラウンドジャンプショット: "Turnaround",
  ダンク: "Dunk",
  アリウープ: "Alley-Oop",
};

export function shotTypeLabel(key: string): string {
  return SHOT_TYPE_LABELS[key] ?? key;
}

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

/** 指定したキー（playerIdまたはteamId）単位でシュートタイプ別（2P/3P別）成功/試投カウントを組み立てる */
function buildShotTypeBreakdownBy(
  shots: YahooShotEvent[],
  keyFn: (shot: YahooShotEvent) => string | null,
): Map<string, ShotTypeBreakdown> {
  const byKey = new Map<string, ShotTypeBreakdown>();
  for (const shot of shots) {
    const key = keyFn(shot);
    if (!key || !shot.shotType) continue;
    const breakdown = byKey.get(key) ?? {};
    const split = breakdown[shot.shotType] ?? {
      twoPoint: { made: 0, attempted: 0 },
      threePoint: { made: 0, attempted: 0 },
    };
    const counts = shot.shotValue === 3 ? split.threePoint : split.twoPoint;
    counts.attempted += 1;
    if (shot.made) counts.made += 1;
    breakdown[shot.shotType] = split;
    byKey.set(key, breakdown);
  }
  return byKey;
}

/** 選手ごとのシュートタイプ別（2P/3P別）成功/試投カウントを1試合分のYahooShotEvent[]から組み立てる */
export function buildShotTypeBreakdownByPlayer(shots: YahooShotEvent[]): Map<string, ShotTypeBreakdown> {
  return buildShotTypeBreakdownBy(shots, (s) => s.playerId);
}

/** チーム全選手合算版。TeamDetailPageの「シューティング」セクション用（DESIGN.md参照） */
export function buildShotTypeBreakdownByTeam(shots: YahooShotEvent[]): Map<string, ShotTypeBreakdown> {
  return buildShotTypeBreakdownBy(shots, (s) => s.teamId);
}

export function sumShotTypeCounts(a: ShotTypeCounts, b: ShotTypeCounts): ShotTypeCounts {
  return { made: a.made + b.made, attempted: a.attempted + b.attempted };
}

/** 平均/合計切り替え用に成功/試投数を係数倍する（成功率は分子分母とも同じ係数のため不変） */
export function scaleShotTypeCounts(counts: ShotTypeCounts, factor: number): ShotTypeCounts {
  return { made: counts.made * factor, attempted: counts.attempted * factor };
}

export function formatShotTypeCell(counts: { made: number; attempted: number } | undefined, digits = 0): string {
  if (!counts || counts.attempted === 0) return "-";
  const pct = (100 * counts.made) / counts.attempted;
  return `${counts.made.toFixed(digits)}/${counts.attempted.toFixed(digits)} (${pct.toFixed(1)}%)`;
}
