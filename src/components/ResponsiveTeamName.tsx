import { NameText } from "./NameText";
import { teamShortName } from "../../shared/teamNames";
import { useMediaQuery } from "../lib/useMediaQuery";
import { TeamChip } from "./TeamChip";

/**
 * スマホ幅（560px以下）では略称（teamShortName）、それ以外はフルのチーム名を出す。
 * 「名古屋ダイヤモンドドルフィンズ」のような長い名前が、表の列幅を押し広げたり折り返したりするのを避けるための表示。
 * 略称が無いチームはフルの名前のまま（teamShortNameのフォールバック）。
 * always を付けると幅によらず常に略称（狭いカードなど、広い画面でも長い名前が折れる場所用）。
 * chip を付けると、保存画像だけチームの色で塗る（選手の行に添えるチーム名など、横にロゴが無い所。TeamChip）
 * nowrap を付けると、チーム名を途中で折り返さない（記録の一覧の名前の下の行。「琉球」が「琉／球」に割れるのを避ける。DESIGN.md 222-6）
 */
export function ResponsiveTeamName({ teamId, name, always = false, nowrap = false, chip = false }: { teamId: string; name: string; always?: boolean; nowrap?: boolean; chip?: boolean }) {
  const narrow = useMediaQuery("(max-width: 560px)");
  const text = always || narrow ? teamShortName(teamId, name) : name;
  const body = nowrap ? <span className="record-date-nowrap">{text}</span> : <NameText name={text} kind="team" />;
  return chip ? <TeamChip teamId={teamId}>{body}</TeamChip> : body;
}
