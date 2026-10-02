// 個人賞の種類分け（ランキングのCareer・通算記録の回数。DESIGN.md 195章）。
// 賞の名称は data/player-awards.json の name（bleague.jp の表記。末尾の "(B1)" 等は category に分けてある）
import type { PlayerCareerCounts } from "./types.ts";

export type AwardCountKey = "awardMvp" | "awardBestFive" | "awardRookie" | "awardRookieBestFive" | "awardTitles";

/** 個人タイトル（スタッツの部門王。得点王など7つ）の賞名 */
export const STAT_TITLE_AWARD_NAMES = ["得点王", "リバウンド王", "アシスト王", "スティール王", "ブロック王", "ベスト3P成功率賞", "ベストFT成功率賞"] as const;

/** 賞の名称 → 数える項目。数えない賞（上に無い名称）は null */
export function awardCountKeyOf(name: string): AwardCountKey | null {
  switch (name) {
    case "レギュラーシーズン最優秀選手賞":
      return "awardMvp";
    case "レギュラーシーズンベストファイブ":
      return "awardBestFive";
    case "最優秀新人賞":
      return "awardRookie";
    case "新人賞ベストファイブ":
      return "awardRookieBestFive";
    default:
      return (STAT_TITLE_AWARD_NAMES as readonly string[]).includes(name) ? "awardTitles" : null;
  }
}

export const AWARD_COUNT_KEYS: AwardCountKey[] = ["awardMvp", "awardBestFive", "awardRookie", "awardRookieBestFive", "awardTitles"];

/** 個人賞の受賞数（古いデータで無いときは 0） */
export function awardCountOf(counts: PlayerCareerCounts | undefined, key: AwardCountKey): number {
  return counts?.[key] ?? 0;
}
