// 歴代記録（data/league-team-rankings.json）の「1シーズン記録」のワースト側（最多敗戦数・最多連敗）の保存の形。
// shared/types.ts（保存キーの対象）を変えずに足すため、別のファイルに置く。追加前に作ったファイルには無いので省略可能。
import type { LeagueRankingGameType, LeagueRecordEntry } from "./types.ts";

/** 最多連敗の行: ongoing は、作ったときに続いていた連敗（シーズンの最後の試合まで続いていて、そのシーズンがまだ終わっていない） */
export type LeagueSeasonWorstEntry = LeagueRecordEntry & { ongoing?: boolean };

export type LeagueSeasonWorstKey = "losses" | "lossStreak";

/** レギュラーシーズンだけ。ほかの試合区分は空 */
export type LeagueSeasonWorstTop20 = Record<LeagueRankingGameType, Record<LeagueSeasonWorstKey, LeagueSeasonWorstEntry[]>>;
