import { teamShortName } from "../../shared/teamNames";
import { useMediaQuery } from "../lib/useMediaQuery";

/**
 * スマホ幅（560px以下）では略称（teamShortName）、それ以外はフルのチーム名を出す。
 * 「名古屋ダイヤモンドドルフィンズ」のような長い名前が、表の列幅を押し広げたり折り返したりするのを避けるための表示。
 * 略称が無いチームはフルの名前のまま（teamShortNameのフォールバック）。
 * always を付けると幅によらず常に略称（狭いカードなど、広い画面でも長い名前が折れる場所用）。
 * nowrap を付けると、チーム名を途中で折り返さない（記録の一覧の名前の下の行。「琉球」が「琉／球」に割れるのを避ける。DESIGN.md 222-6）
 */
export function ResponsiveTeamName({ teamId, name, always = false, nowrap = false }: { teamId: string; name: string; always?: boolean; nowrap?: boolean }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const text = always || narrow ? teamShortName(teamId, name) : name;
  return nowrap ? <span className="record-date-nowrap">{text}</span> : <>{text}</>;
}
