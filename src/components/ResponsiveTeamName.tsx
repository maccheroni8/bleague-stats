import { teamShortName } from "../../shared/teamNames";
import { useMediaQuery } from "../lib/useMediaQuery";

/**
 * スマホ幅（560px以下）では略称（teamShortName）、それ以外はフルのチーム名を出す。
 * 「名古屋ダイヤモンドドルフィンズ」のような長い名前が、表の列幅を押し広げたり折り返したりするのを避けるための表示。
 * 略称が無いチームはフルの名前のまま（teamShortNameのフォールバック）。
 * always を付けると幅によらず常に略称（狭いカードなど、広い画面でも長い名前が折れる場所用）
 */
export function ResponsiveTeamName({ teamId, name, always = false }: { teamId: string; name: string; always?: boolean }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  return <>{always || narrow ? teamShortName(teamId, name) : name}</>;
}
