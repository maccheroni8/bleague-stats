// 通算記録（ランキング > 個人／チーム > 通算記録。DESIGN.md 192章）の値の表記。個人・チームの記録タブのカードとランキングで共通
import { formatMinutesFromSeconds } from "./boxscoreAggregate";
import { formatSigned } from "./format";

/** minMinutes（出場時間）はformatMinutesFromSecondsで、plusMinus（プラスマイナス）は符号付きで、それ以外は桁区切り整数で表示する */
export function formatLeaguePlayerRecordValue(statKey: string, value: number): string {
  if (statKey === "minMinutes") return formatMinutesFromSeconds(Math.round(value * 60));
  if (statKey === "plusMinus") return formatSigned(value, 0);
  return Math.round(value).toLocaleString();
}

/** チームの通算成績の値（桁区切りの数値） */
export function formatLeagueTeamCareerValue(value: number): string {
  return value.toLocaleString();
}
