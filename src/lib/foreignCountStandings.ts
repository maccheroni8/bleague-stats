// 順位表「外国籍人数別」タブの集計（画面だけ。保存キーの対象外）。
// 条件別順位表の「外国籍の人数」の条件（392章）と同じ判定（matchesForeignCount）で、チームごと・まとまりごとに試合数・勝敗を数える
import type { TeamGameLog } from "../../shared/types";
import { matchesForeignCount, type CountMode, type ForeignMeasure } from "./situationalRecords";

export interface ForeignCountGroup {
  key: string;
  /** 選ぶボタンの名前 */
  label: string;
  /** 表の見出し（短く） */
  short: string;
  measure: ForeignMeasure;
  mode: CountMode;
  n: number;
}

export const FOREIGN_COUNT_GROUPS: readonly ForeignCountGroup[] = [
  { key: "f3", label: "外国籍 3人", short: "外国籍3人", measure: "foreignPlayed", mode: "eq", n: 3 },
  { key: "f2", label: "外国籍 2人", short: "外国籍2人", measure: "foreignPlayed", mode: "eq", n: 2 },
  { key: "f1", label: "外国籍 1人", short: "外国籍1人", measure: "foreignPlayed", mode: "eq", n: 1 },
  { key: "f0", label: "外国籍 0人", short: "外国籍0人", measure: "foreignPlayed", mode: "eq", n: 0 },
  { key: "fle2", label: "外国籍 2人以下", short: "外国籍2人以下", measure: "foreignPlayed", mode: "le", n: 2 },
  { key: "i4", label: "外国籍・帰化・アジア 4人", short: "外・帰・ア4人", measure: "intlPlayed", mode: "eq", n: 4 },
  { key: "ile3", label: "外国籍・帰化・アジア 3人以下", short: "外・帰・ア3人以下", measure: "intlPlayed", mode: "le", n: 3 },
];

/** 最初に表示するまとまり */
export const DEFAULT_FOREIGN_COUNT_GROUPS: readonly string[] = ["f3", "fle2"];

export interface ForeignCountRecord {
  games: number;
  wins: number;
  losses: number;
}

/** チームのレギュラーシーズンの試合ログから、そのまとまりの試合数・勝敗。条件別順位表の数え方と同じ（負け＝試合数−勝ち） */
export function foreignGroupRecord(regularLogs: readonly TeamGameLog[], group: ForeignCountGroup): ForeignCountRecord {
  let games = 0;
  let wins = 0;
  for (const g of regularLogs) {
    if (!matchesForeignCount(g, group.mode, group.n, group.measure)) continue;
    games++;
    if (g.win) wins++;
  }
  return { games, wins, losses: games - wins };
}
