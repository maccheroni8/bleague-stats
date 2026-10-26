// チームの1試合記録のランキングの URL（チーム一覧の記録タブのカードから移る）と、記録の種類の URL キー。
// 画面の部品（TeamGameRecordRanking）から切り出した小さなファイル（チーム一覧が読み込み・表示を持つランキングの部品まで読まなくてよいように）
import type { SeasonGameTypeFilter } from "./playerSeasonBoxscore";
import type { TeamRecordMode } from "./teamGameRecords";
import { enumParam } from "./urlState";
import { GAME_TYPE_PARAM, RECORDS_SCOPE_PARAM, type RecordsScope } from "./urlFilterParams";

export const RECORD_MODE_PARAM = enumParam<TeamRecordMode>("rmode", ["record", "worst", "against"], "record");

/** チームの1試合記録のランキングの URL（チーム一覧の記録タブのカードから移るとき） */
export function teamGameRecordRankingUrl(opts: {
  scope: RecordsScope;
  gameType: SeasonGameTypeFilter;
  mode: TeamRecordMode;
  statKey: string;
  season?: string;
}): string {
  const p = new URLSearchParams();
  p.set("k", "game");
  RECORDS_SCOPE_PARAM.write(p, opts.scope);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  RECORD_MODE_PARAM.write(p, opts.mode);
  p.set("stat", opts.statKey);
  if (opts.season) p.set("season", opts.season);
  return `/rankings?${p.toString()}`;
}
