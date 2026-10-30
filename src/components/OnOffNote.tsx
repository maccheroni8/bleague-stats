// on/off タブの注記（src/lib/playerOnOffColumns.ts）。出せない理由（2016-17〜2019-20・Q別・前後半）と、数え方の要点
import { onOffUnavailableReason } from "../lib/playerOnOffColumns";

export function OnOffNote({ seasons, periodSelected }: { seasons: readonly string[]; periodSelected: boolean }) {
  const reasons = [...new Set(seasons.map((s) => onOffUnavailableReason(s, periodSelected)).filter((r): r is string => r !== null))];
  return (
    <>
      {reasons.map((r) => (
        <p key={r} className="rule-change-footnote">※ {r}</p>
      ))}
      <p className="rule-change-footnote">
        ※ On はその選手がコートにいた時間、Off はその選手が出場した試合でコートにいなかった時間です。ORtg・DRtg は得点と攻撃回数を足してから割った値で、
        平均・合計で変わりません（アドバンスドの個人 ORtg・DRtg とは別の項目です）。G は記録がそろう出場試合の数です。
      </p>
    </>
  );
}
