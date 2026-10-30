// シュートタイプ別の成功/試投カウント（Yahoo!スポーツplay-by-play由来。DESIGN.md参照）。
// 「キャッチアンドシュート」に相当する独立タグはデータ上存在せず、無印の「ジャンプショット」
// （全体の約51%）に一括りになっている点に注意。scripts/aggregate.tsのシーズン集計版
// （buildShotTypeBreakdownByPlayer）と同じ「Yahoo表記の原文をそのままキーにする」方針を踏襲する。

import type { ShotTypeBreakdown, ShotTypeCounts, YahooShotEvent } from "../../shared/types";
import type { Column } from "../components/SortableTable";

/**
 * 実データでの出現頻度順（DESIGN.md参照。当初は2024-25シーズン全737試合・95,484本のみで
 * 調査し11種類としていたが、Phase H6で2023-24・2025-26シーズンも含めて再調査したところ
 * リバースレイアップ・チップインレイアップ・ユーロステップ・アリウープダンク・チップインダンクの
 * 5種類が追加で見つかり、全16種類であることを確認した）。未知のシュートタイプ（新規語彙）は
 * 末尾に追加で表示する
 */
export const SHOT_TYPE_DISPLAY_ORDER = [
  "ジャンプショット",
  "プルアップジャンプショット",
  "ドライビングレイアップ",
  "レイアップ",
  "フローティングジャンプショット",
  "ステップバックジャンプショット",
  "フェイドアウェイ",
  "フックショット",
  "ダンク",
  "ターンアラウンドジャンプショット",
  "リバースレイアップ",
  "チップインレイアップ",
  "アリウープ",
  "ユーロステップ",
  "アリウープダンク",
  "チップインダンク",
];

/**
 * 表示用の英語ラベル（DESIGN.md参照。日本語表記は長くテーブル列見出しとして冗長なため、
 * 表示時のみ英語に変換する。集計・データのキー自体はYahoo表記の原文のまま変更しない）。
 * 未知のシュートタイプ（新規語彙）は原文のままフォールバック表示する
 */
export const SHOT_TYPE_LABELS: Record<string, string> = {
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
  リバースレイアップ: "Reverse Layup",
  チップインレイアップ: "Tip-In Layup",
  ユーロステップ: "Euro Step",
  アリウープダンク: "Alley-Oop Dunk",
  チップインダンク: "Tip-In Dunk",
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

/** キー分けせず渡された全ショットを1つのShotTypeBreakdownに合算する（既に対象を絞り込み済みの
 * ショット配列、例: 特定シーズン・特定行に属する試合群のショットをまとめる用途） */
export function buildShotTypeBreakdown(shots: YahooShotEvent[]): ShotTypeBreakdown {
  return buildShotTypeBreakdownBy(shots, () => "all").get("all") ?? {};
}

export function sumShotTypeCounts(a: ShotTypeCounts, b: ShotTypeCounts): ShotTypeCounts {
  return { made: a.made + b.made, attempted: a.attempted + b.attempted };
}

/** 平均/合計切り替え用に成功/試投数を係数倍する（成功率は分子分母とも同じ係数のため不変） */
export function scaleShotTypeCounts(counts: ShotTypeCounts, factor: number): ShotTypeCounts {
  return { made: counts.made * factor, attempted: counts.attempted * factor };
}

/** 成功数・試投数・成功率を独立した列に分けて表示する（ボックススコアのFG/2P/3P/FT分離と同じパターン）。
 * 試投数0（該当シュートタイプの試投が無い）の場合は3列とも"-"にする */
export function formatShotTypeMade(counts: { made: number; attempted: number } | undefined, digits = 0): string {
  if (!counts || counts.attempted === 0) return "-";
  return counts.made.toFixed(digits);
}

export function formatShotTypeAttempted(counts: { made: number; attempted: number } | undefined, digits = 0): string {
  if (!counts || counts.attempted === 0) return "-";
  return counts.attempted.toFixed(digits);
}

export function formatShotTypePct(counts: { made: number; attempted: number } | undefined): string {
  if (!counts || counts.attempted === 0) return "-";
  return `${((100 * counts.made) / counts.attempted).toFixed(2)}%`;
}

export function shotTypePctValue(counts: { made: number; attempted: number } | undefined): number {
  if (!counts || counts.attempted === 0) return -1;
  return counts.made / counts.attempted;
}

/**
 * 「行=任意のエンティティ（チーム・シーズン・シチュエーション区分・選手等）、列=シュートタイプ×
 * 2P/3P×成功数/試投数/成功率」という一覧表示用のSortableTable列を、シュートタイプキー一覧と
 * 行からShotTypeBreakdownを取り出す関数だけで組み立てる（全チームスタッツページで最初に実装した
 * パターンの汎用版。DESIGN.md参照）。
 *
 * `mode`が"perGame"の場合、成功数・試投数を`getGames`が返す試合数で割った平均値を表示する
 * （成功率は分子分母とも同じ係数で割るため元々不変）。`getGames`が未指定、または対象行の
 * 試合数が0以下の場合は「データ無し」として扱う（"-"表示）。
 */
export function shotTypeEntityColumns<T>(
  shotTypeKeys: string[],
  getBreakdown: (row: T) => ShotTypeBreakdown | undefined,
  mode: "total" | "perGame" = "total",
  getGames?: (row: T) => number,
): Column<T>[] {
  const at = (row: T, key: string, split: "twoPoint" | "threePoint"): ShotTypeCounts | undefined => {
    const counts = getBreakdown(row)?.[key]?.[split];
    if (!counts) return undefined;
    if (mode !== "perGame") return counts;
    const games = getGames?.(row) ?? 0;
    return games > 0 ? scaleShotTypeCounts(counts, 1 / games) : undefined;
  };
  const digits = mode === "perGame" ? 2 : 0;
  return shotTypeKeys.flatMap((key): Column<T>[] => {
    const label = shotTypeLabel(key);
    return [
      {
        key: `${key}_2pm`,
        label: `${label} 2PM`,
        sortValue: (r) => at(r, key, "twoPoint")?.made ?? -1,
        format: (r) => formatShotTypeMade(at(r, key, "twoPoint"), digits),
      },
      {
        key: `${key}_2pa`,
        label: `${label} 2PA`,
        sortValue: (r) => at(r, key, "twoPoint")?.attempted ?? -1,
        format: (r) => formatShotTypeAttempted(at(r, key, "twoPoint"), digits),
      },
      {
        key: `${key}_2ppct`,
        label: `${label} 2P%`,
        sortValue: (r) => shotTypePctValue(at(r, key, "twoPoint")),
        format: (r) => formatShotTypePct(at(r, key, "twoPoint")),
      },
      {
        key: `${key}_3pm`,
        label: `${label} 3PM`,
        sortValue: (r) => at(r, key, "threePoint")?.made ?? -1,
        format: (r) => formatShotTypeMade(at(r, key, "threePoint"), digits),
      },
      {
        key: `${key}_3pa`,
        label: `${label} 3PA`,
        sortValue: (r) => at(r, key, "threePoint")?.attempted ?? -1,
        format: (r) => formatShotTypeAttempted(at(r, key, "threePoint"), digits),
      },
      {
        key: `${key}_3ppct`,
        label: `${label} 3P%`,
        sortValue: (r) => shotTypePctValue(at(r, key, "threePoint")),
        format: (r) => formatShotTypePct(at(r, key, "threePoint")),
      },
    ];
  });
}

/**
 * 自チーム − 相手（+/-）のシュートタイプ別の列（全チームスタッツ Shooting の +/-。DESIGN.md 299-5・304章）。列の並び・キーは shotTypeEntityColumns と同じ。
 * - 成功数・試投数: 自チーム − 相手。平均は、両方を同じ対象試合数（スポーツナビの記録がある試合）で割ってから引く。差が0でも表示する
 * - 成功率: 100 × 自チームの成功 ÷ 自チームの試投 − 100 × 相手の成功 ÷ 相手の試投（パーセントポイント）。どちらかの試投が0なら「-」
 * 自チーム・相手のどちらかの値が無い（古いデータ）行は「-」
 */
export function shotTypeDiffColumns<T>(
  shotTypeKeys: string[],
  getOwn: (row: T) => ShotTypeBreakdown | undefined,
  getOpp: (row: T) => ShotTypeBreakdown | undefined,
  mode: "total" | "perGame",
  getGames: (row: T) => number,
): Column<T>[] {
  const zero: ShotTypeCounts = { made: 0, attempted: 0 };
  const pair = (row: T, key: string, split: "twoPoint" | "threePoint"): { own: ShotTypeCounts; opp: ShotTypeCounts } | null => {
    const own = getOwn(row);
    const opp = getOpp(row);
    if (!own || !opp) return null;
    const games = getGames(row);
    if (mode === "perGame" && games <= 0) return null;
    const f = mode === "perGame" ? 1 / games : 1;
    return { own: scaleShotTypeCounts(own[key]?.[split] ?? zero, f), opp: scaleShotTypeCounts(opp[key]?.[split] ?? zero, f) };
  };
  const digits = mode === "perGame" ? 2 : 0;
  const signed = (v: number, d: number) => {
    const t = v.toFixed(d);
    return Number(t) > 0 ? `+${t}` : Number(t) === 0 ? (0).toFixed(d) : t;
  };
  const countCol = (key: string, split: "twoPoint" | "threePoint", field: "made" | "attempted", suffix: string, label: string): Column<T> => ({
    key: `${key}_${suffix}`,
    label,
    sortValue: (r) => {
      const p = pair(r, key, split);
      return p ? p.own[field] - p.opp[field] : Number.NEGATIVE_INFINITY;
    },
    format: (r) => {
      const p = pair(r, key, split);
      return p ? signed(p.own[field] - p.opp[field], digits) : "-";
    },
  });
  const pctDiff = (r: T, key: string, split: "twoPoint" | "threePoint"): number | null => {
    const p = pair(r, key, split);
    if (!p || p.own.attempted === 0 || p.opp.attempted === 0) return null;
    return (100 * p.own.made) / p.own.attempted - (100 * p.opp.made) / p.opp.attempted;
  };
  const pctCol = (key: string, split: "twoPoint" | "threePoint", suffix: string, label: string): Column<T> => ({
    key: `${key}_${suffix}`,
    label,
    sortValue: (r) => pctDiff(r, key, split) ?? Number.NEGATIVE_INFINITY,
    format: (r) => {
      const v = pctDiff(r, key, split);
      return v === null ? "-" : signed(v, 2);
    },
  });
  return shotTypeKeys.flatMap((key): Column<T>[] => {
    const label = shotTypeLabel(key);
    return [
      countCol(key, "twoPoint", "made", "2pm", `${label} 2PM`),
      countCol(key, "twoPoint", "attempted", "2pa", `${label} 2PA`),
      pctCol(key, "twoPoint", "2ppct", `${label} 2P%`),
      countCol(key, "threePoint", "made", "3pm", `${label} 3PM`),
      countCol(key, "threePoint", "attempted", "3pa", `${label} 3PA`),
      pctCol(key, "threePoint", "3ppct", `${label} 3P%`),
    ];
  });
}
