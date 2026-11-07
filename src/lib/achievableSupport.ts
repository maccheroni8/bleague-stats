// 個人ランキングの掲載基準「◯%以上達成可能」を出せるか。
// 達成可能は「今の出場試合数＋チームの残り試合数」で判定するので、残り試合数が正しくないと結果が狂う。
// B.PREMIER は今までどおり。B.ONE は、進出争いのデータ（playoff-race.json）が「全クラブの 勝ち＋負け＋残り が規定の試合数に一致」と
// 確かめられているとき（判定を止める理由が無いとき）だけ出す。一部のクラブの日程が足りない間は出さない。
import { fetchPlayoffRace } from "./data";
import type { League } from "./league";
import { useJsonData } from "./useJsonData";

export function useAchievableSupport(season: string, league: League): boolean {
  const { data } = useJsonData(
    () => (league === "one" ? fetchPlayoffRace(season, league).then((race) => ({ season, league, ok: !!race && !race.unavailableReason })) : Promise.resolve(null)),
    [season, league],
  );
  if (league === "premier") return true;
  return !!data && data.season === season && data.league === league && data.ok;
}
