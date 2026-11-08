// on4 の判定の画面側の入口（判定そのものは shared/on4Possible.ts。集計が試合ログ TeamGameLog.on4Possible に保存した値を読む。DESIGN.md 353章）。
import type { TeamGameLog } from "../../shared/types";
import { on4RuleApplies } from "../../shared/on4Possible";
import type { League } from "./league";

/** on4 の切り替えを選べるのは、同時出場の上限が4人の B.PREMIER のシーズンだけ（B.ONE は上限3、過去のシーズンは上限が2〜3） */
export function on4Supported(league: League, maxForeignOnCourt: number | undefined): boolean {
  return league === "premier" && on4RuleApplies(maxForeignOnCourt);
}

/** 試合ログに on4 の判定があるか（古いデータには無い。1試合でもあれば、そのシーズンのデータは対応している） */
export function logsHaveOn4(logs: Iterable<TeamGameLog>): boolean {
  for (const g of logs) if (g.on4Possible !== undefined) return true;
  return false;
}

/** on4 が可能だった試合だけに絞る */
export function onlyOn4Games(logs: readonly TeamGameLog[]): TeamGameLog[] {
  return logs.filter((g) => g.on4Possible === true);
}

/** "チームID|試合キー" */
export function on4Key(teamId: string, scheduleKey: string): string {
  return `${teamId}|${scheduleKey}`;
}
