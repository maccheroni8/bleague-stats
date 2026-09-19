/**
 * 身長・体重はplayers-master.jsonの現在値1つを全シーズンに適用しており（公式サイトに当時の記録が
 * 無いため。DESIGN.md 101章）、終了済みシーズンでは当時の値ではない。その旨の脚注。
 * 身長・体重を表示する表・プロフィールの直下に置く（現在進行中・開幕前のシーズンでは何も出さない）
 */
import { HEIGHT_WEIGHT_CURRENT_NOTE, isPastSeason } from "../lib/season";

export function HeightWeightNote({ season }: { season: string }) {
  if (!isPastSeason(season)) return null;
  return <p className="rule-change-footnote">※ {HEIGHT_WEIGHT_CURRENT_NOTE}</p>;
}
