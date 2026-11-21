// 結果だけの試合（不戦勝・ボックススコアの無い試合。228章）の注意書きの文（設計書449章）。短い形にそろえ、試合は「信州 20-0 茨城」の形（複数は「、」でつなぐ）。
// 画面・通信に依存しない純粋な関数だけ（保存キーの対象外）
import { teamShortName } from "../../shared/teamNames";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";

/** 「信州 20-0 茨城の不戦勝」「A 20-0 B、C 20-0 D の不戦勝、E 3-2 F のボックススコアなしの試合」 */
export function resultOnlyGamesText(games: readonly ResultOnlyGameEntry[]): string {
  const one = (g: ResultOnlyGameEntry) => `${teamShortName(g.homeTeamId, g.homeTeamName)} ${g.homeScore}-${g.awayScore} ${teamShortName(g.awayTeamId, g.awayTeamName)}`;
  const forfeit = games.filter((g) => g.reason === "forfeit");
  const other = games.filter((g) => g.reason !== "forfeit");
  const parts: string[] = [];
  if (forfeit.length > 0) parts.push(`${forfeit.map(one).join("、")}の不戦勝`);
  if (other.length > 0) parts.push(`${other.map(one).join("、")}のボックススコアなしの試合`);
  return parts.join("、");
}

/** 全チームスタッツ・チームの表: 試合数・勝敗はボックススコアのある試合だけ、順位表の勝敗は含む */
export function resultOnlyStatsNote(games: readonly ResultOnlyGameEntry[]): string {
  return `試合数・勝敗はボックススコアのある試合のみ（順位表の勝敗は${resultOnlyGamesText(games)}を含む）`;
}

/** 順位表・チーム詳細: 勝敗には含むが、試合数・スタッツ・ランキングには入らない */
export function resultOnlyRecordNote(games: readonly ResultOnlyGameEntry[]): string {
  return `勝敗は${resultOnlyGamesText(games)}を含む（試合数・スタッツ・ランキングには入らない）`;
}
