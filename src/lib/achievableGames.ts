// 出場率の掲載基準の「◯%以上達成可能」（ランキング・図解・全選手スタッツ・チーム内リーダーで共通。DESIGN.md 249章・365章）。
// 達成可能＝（今の出場試合数＋チームの残り試合数）÷（チームの今までの試合数＋残り試合数）が出場率以上。
// 残り試合数は進出争いのデータ（playoff-race.json）のチームごとの remaining。終わったシーズン・ファイルが無いシーズンは残りなし（今の掲載基準と同じ結果）。
// 画面だけの部品（保存キーの対象外）。計算は playerRankingEligibility.ts の filterAchievablePlayers と同じ式（isAchievable）
import { useMemo } from "react";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { fetchPlayoffRace } from "./data";
import type { League } from "./league";
import { useJsonData } from "./useJsonData";
import type { SituationalRange } from "./situational";
import type { UrlCodec } from "./urlState";

/** URL の `ach=1`。既定（チェックなし）は書かない */
export const ACHIEVABLE_PARAM: UrlCodec<boolean> = {
  keys: ["ach"],
  read: (p) => (p.get("ach") === "1" ? true : undefined),
  write: (p, v) => {
    p.delete("ach");
    if (v) p.set("ach", "1");
  },
};

export { isAchievable } from "./playerRankingEligibility";

/**
 * チームごとの残り試合数（レギュラーシーズン）。needed が true のときだけ読む。
 * ready＝読み終わった（needed が false のときは常に true）。remainingByTeam は needed のときだけ（ファイルが無いシーズンは空）
 */
export function useRemainingGames(season: string, league: League, needed: boolean): { remainingByTeam: ReadonlyMap<string, number> | undefined; ready: boolean } {
  const { data, loading } = useJsonData(
    () => (needed ? fetchPlayoffRace(season, league).then((race) => ({ season, league, race })) : Promise.resolve(null)),
    [needed, season, league],
  );
  const ready = !needed || (!loading && data?.season === season && data.league === league);
  const remainingByTeam = useMemo<ReadonlyMap<string, number> | undefined>(() => {
    if (!needed) return undefined;
    const race = data?.season === season && data.league === league ? data.race : null;
    return new Map((race?.teams ?? []).map((t) => [t.teamId, t.remaining]));
  }, [needed, data, season, league]);
  return { remainingByTeam, ready };
}

/**
 * 図解のように、期間・試合区分で出場率の分母が変わる場所で、残り試合数を使ってよいか。
 * 残り試合数はレギュラーシーズンの残りなので、全期間のレギュラーシーズン（またはレギュラー＋ポストシーズン）だけ。
 * 直近5・10試合や日付の範囲、ポストシーズンだけのときは、残りを足さない（チェックを入れても今の掲載基準と同じ結果）
 */
export function remainingForScope(remainingByTeam: ReadonlyMap<string, number> | undefined, range: SituationalRange, gameType: SeasonGameTypeFilter): ReadonlyMap<string, number> | undefined {
  if (!remainingByTeam) return undefined;
  return range.kind === "all" && gameType !== "playoff" ? remainingByTeam : undefined;
}
