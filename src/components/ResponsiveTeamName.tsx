import { teamShortName } from "../../shared/teamNames";
import { useMediaQuery } from "../lib/useMediaQuery";

/**
 * スマホ幅（560px以下）では略称（teamShortName）、それ以外はフルのチーム名を出す。
 * 「名古屋ダイヤモンドドルフィンズ」のような長い名前が、表の列幅を押し広げたり折り返したりするのを避けるための表示。
 * 略称が無いチームはフルの名前のまま（teamShortNameのフォールバック）
 */
export function ResponsiveTeamName({ teamId, name }: { teamId: string; name: string }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  return <>{narrow ? teamShortName(teamId, name) : name}</>;
}
