// ランキング（チーム）の名前の下の行「5試合（4勝1敗）」。試合数と勝敗は、その値の計算に使った試合と同じ試合で数える。
// 結果だけの試合（不戦勝など、ボックススコアが無い試合）はスタッツの試合ではないので数えない（比較の表の G の勝敗と同じ。DESIGN.md 234章）
import type { TeamGameLog } from "../../shared/types";
import { filterByGameType } from "../../shared/gameType";

export interface TeamRankingRecord {
  games: number;
  wins: number;
}

export function teamRecordText(r: TeamRankingRecord): string {
  return `${r.games}試合（${r.wins}勝${r.games - r.wins}敗）`;
}

export function recordOfLogs(logs: readonly Pick<TeamGameLog, "win">[]): TeamRankingRecord {
  return { games: logs.length, wins: logs.filter((g) => g.win).length };
}

/**
 * Shooting・Forced TOV の元になる、スポーツナビの記録がある試合（レギュラーシーズン）の試合数と勝敗。
 * 試合ごとのシュートタイプ別（shotTypes）は、スポーツナビの記録がある試合にだけ付く
 */
export function yahooRecordByTeam(gameLogsByTeam: ReadonlyMap<string, readonly TeamGameLog[]> | null | undefined): Map<string, TeamRankingRecord> {
  const map = new Map<string, TeamRankingRecord>();
  if (!gameLogsByTeam) return map;
  for (const [teamId, logs] of gameLogsByTeam) {
    map.set(teamId, recordOfLogs(filterByGameType([...logs], "regular").filter((g) => g.shotTypes !== undefined)));
  }
  return map;
}

/**
 * 試合が0のチーム（対象期間・試合種別に該当する試合が無い）は、値を「-」にして順位を付けず、末尾に並べる（0.00 として順位に入れない）。
 * RankedList の unranked・unrankedLabel・renderValue にそのまま渡す。extraUnranked は、ほかの理由で順位を付けない行（2P内訳の対象外など。順位欄は「参考」）
 */
export function noGamesRanking<T extends { gamesPlayed: number }>(format: (row: T) => string, extraUnranked: (row: T) => boolean = () => false) {
  return {
    unranked: (row: T) => row.gamesPlayed === 0 || extraUnranked(row),
    unrankedLabel: (row: T) => (row.gamesPlayed === 0 ? "-" : "参考"),
    renderValue: (row: T) => (row.gamesPlayed === 0 ? "-" : format(row)),
  };
}
