// 「プレーオフ圏内」（CS開催のシーズンは「CS圏内」）の一括選択。順位表の条件別順位表・日程・星取り表・図解の「対象クラブ」が同じ決め方を使う。
// 決め方は shared/postseasonFormat.ts（各地区の上位＋ワイルドカード）で、その時点＝最新の順位（終了したシーズンは最終順位）で決まる。
import { postseasonLabel } from "../../shared/gameType";
import { postseasonFormat, postseasonQualifiedTeamIds } from "../../shared/postseasonFormat";
import type { StandingsTeamSnapshot } from "../../shared/types";
import { fetchStandingsHistory } from "./data";
import type { League } from "./league";
import { useJsonData } from "./useJsonData";

export interface PlayoffZonePreset {
  label: string;
  teamIds: string[];
  /** ボタンの説明（マウスを載せたときに出る） */
  title: string;
}

/** 形式の無いシーズン（CS中止の2019-20など）と地区データの無いシーズンは null（ボタンを出さない） */
export function playoffZonePreset(season: string, league: League, teams: StandingsTeamSnapshot[] | null | undefined): PlayoffZonePreset | null {
  const format = postseasonFormat(season, league);
  if (!format || !teams || !teams.some((t) => t.division)) return null;
  const name = postseasonLabel(season);
  return {
    label: `${name}圏内（現時点）`,
    teamIds: [...postseasonQualifiedTeamIds(teams, format)],
    title: `いまの順位で${name}に出られる位置のクラブ（各地区の上位${format.divisionTop}クラブ＋ワイルドカード${format.wildcardSlots}クラブ）。順位が変わると入れ替わります。終了したシーズンは最終順位です。`,
  };
}

/** 最新の順位表から作った「プレーオフ圏内」のボタン（無ければ空）。順位表を読み込むまでも空 */
export function usePlayoffZonePresets(season: string, league: League): PlayoffZonePreset[] {
  const { data } = useJsonData(() => (postseasonFormat(season, league) ? fetchStandingsHistory(season, league) : Promise.resolve(null)), [season, league]);
  const latest = data && data.length > 0 ? data[data.length - 1]! : null;
  const preset = playoffZonePreset(season, league, latest?.teams);
  return preset ? [preset] : [];
}
