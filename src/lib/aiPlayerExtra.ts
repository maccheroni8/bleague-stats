// 選手詳細の md：その他の材料の型（組み合わせ・アシストペア・記録のランキング）。
import type { AssistPairsFile } from '../../shared/assistPairs';
import type { CompactStints } from '../../shared/onCourtTotals';
import type { LeaguePlayerCareerTopFile, LeaguePlayerGameRecordsFile, PlayerGameRecordsFile } from '../../shared/types';

export interface AiPlayerExtra {
  /** チームID → 出場区間（team-stints。2人・3人の組み合わせと On/Off の元） */
  stints: ReadonlyMap<string, CompactStints>;
  assistPairs: AssistPairsFile | null;
  /** そのシーズンの1試合記録の上位 */
  seasonRecords: PlayerGameRecordsFile | null;
  /** 歴代の1試合記録の上位（B.PREMIER） */
  allTimeRecords: LeaguePlayerGameRecordsFile | null;
  /** 通算記録の上位（B.PREMIER） */
  careerTop: LeaguePlayerCareerTopFile | null;
}
