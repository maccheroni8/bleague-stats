import type { PlayerCareerCounts, PlayerSummary } from "../../shared/types";
import { ageForSeason } from "./age";
import { CATEGORY_LABELS } from "./categoryLabels";
import { heightText, weightText } from "./profileMark";
import type { StatConditionItemDef } from "./statConditions";

/**
 * 選手のスタッツの条件のうち、プロフィール（身長・体重・年齢）とキャリアの項目（DESIGN.md 162章）。
 * 個人一覧と選手ランキングで共通。値はランキングのプロフィール・キャリアのカテゴリと同じ
 * （身長・体重はそのシーズンの当時の値、年齢はそのシーズンの6月30日時点（進行中は今日時点。lib/age.ts）、キャリアはそのシーズン終了時点までの累計）
 */

/** キャリアの項目のキーの前置き（ボックススコアの項目のキーと重ならないようにする） */
export const CAREER_CONDITION_KEY_PREFIX = "career_";

export const CAREER_ITEM_DEFS: { key: keyof PlayerCareerCounts; label: string; unit: string }[] = [
  { key: "titles", label: "リーグ優勝", unit: "回" },
  { key: "divisionTitles", label: "地区優勝", unit: "回" },
  { key: "finals", label: "ファイナル出場", unit: "回" },
  { key: "postseasons", label: "ポストシーズン出場", unit: "回" },
  { key: "awards", label: "個人賞", unit: "回" },
  { key: "seasons", label: "在籍シーズン", unit: "シーズン" },
  { key: "clubs", label: "所属クラブ", unit: "クラブ" },
  { key: "games", label: "通算出場試合", unit: "試合" },
];

export function playerProfileConditionDefs(season: string): StatConditionItemDef<PlayerSummary>[] {
  const group = CATEGORY_LABELS.profile;
  return [
    { key: "height", label: "身長", group, display: (p) => heightText(p) ?? "-", fixedSuffix: "cm", seasonTotal: true },
    { key: "weight", label: "体重", group, display: (p) => weightText(p) ?? "-", fixedSuffix: "kg", seasonTotal: true },
    {
      key: "age",
      label: "年齢",
      group,
      display: (p) => (p.birthDate ? `${ageForSeason(p.birthDate, season)}歳` : "-"),
      fixedSuffix: "歳",
      seasonTotal: true,
    },
  ];
}

export function playerCareerConditionDefs(
  careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined,
): StatConditionItemDef<PlayerSummary>[] {
  return CAREER_ITEM_DEFS.map((d) => ({
    key: `${CAREER_CONDITION_KEY_PREFIX}${d.key}`,
    label: d.label,
    group: CATEGORY_LABELS.career,
    display: (p) => {
      const counts = careerOf(p);
      return counts ? `${counts[d.key]}${d.unit}` : "-";
    },
    fixedSuffix: d.unit,
    seasonTotal: true,
  }));
}

/** 行の型が PlayerSummary を包む形（一覧の { player } 等）のときに、定義をその行の型に移す */
export function mapConditionDefs<A, B>(defs: StatConditionItemDef<A>[], pick: (row: B) => A): StatConditionItemDef<B>[] {
  return defs.map((d) => ({
    ...d,
    display: (row: B) => d.display(pick(row)),
    displayOther: d.displayOther ? (row: B) => d.displayOther!(pick(row)) : undefined,
  }));
}
