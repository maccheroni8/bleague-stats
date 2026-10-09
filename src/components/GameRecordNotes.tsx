import { PERIOD_PLUS_MINUS_NOTE } from "../lib/gameRecordPeriod";
import { ROOKIE_NOTE } from "../lib/rookieFilter";

/** 当時の値でなく補ったポジションの印（＊）の注記（ポジションで絞り込んだ1試合記録。DESIGN.md 220章） */
const POSITION_FALLBACK_NOTE = "ポジションは当時の値です。＊は当時の値が見つからず補った値です（近いシーズンの当時の値、無ければ現在の値）。";

/**
 * 1試合記録の表の下の注記（条件を付けたときに、その条件で何が起きているかを知らせる。DESIGN.md 220章）。
 * 該当するものだけを出す
 */
export function GameRecordNotes({
  excludedSpecial,
  ascendingDefault,
  rookie,
  positionFallback,
  period,
}: {
  /** 除いた前後半5分の特別な試合の数 */
  excludedSpecial: number;
  /** 少ない方から並べるため、既定で除いているか（そうでなければ、選んで除いている） */
  ascendingDefault: boolean;
  /** ルーキーで絞り込んでいるとき、2016-17の試合が含まれない理由も添えるか */
  rookie?: { allTime: boolean };
  positionFallback: boolean;
  /** Q別・前後半・延長を選んでいるとき */
  period?: {
    /** 延長を選んでいるか（延長のあった試合だけが対象） */
    overtime: boolean;
    /** 区間の記録が無い前後半5分の特別な試合（ほかの条件に当てはまる分）の数 */
    shortGames: number;
    /** 公式のQ別・前後半の +/- が無いために除いた行の数（+/- を並べているとき） */
    noPlusMinus: number;
  };
}) {
  return (
    <>
      {excludedSpecial > 0 && (
        <p className="rule-change-footnote">
          ※ 前後半5分ずつで行った特別な試合（2016-17・2017-18のチャンピオンシップ。{excludedSpecial}件）は、
          {ascendingDefault ? "少ない方から並べるため、" : ""}除いています。
          {ascendingDefault ? "詳細フィルタの「前後半5分の特別試合」で含められます。" : ""}
        </p>
      )}
      {rookie && (
        <p className="rule-change-footnote">
          ※ {ROOKIE_NOTE}
          {rookie.allTime ? "2016-17は、ルーキーを判定できないため、含めていません。" : ""}
        </p>
      )}
      {positionFallback && <p className="rule-change-footnote">※ {POSITION_FALLBACK_NOTE}</p>}
      {period?.overtime && <p className="rule-change-footnote">※ 延長は、延長のあった試合の、すべての延長の合計です。</p>}
      {period && period.shortGames > 0 && (
        <p className="rule-change-footnote">
          ※ 前後半5分ずつで行った特別な試合（2016-17・2017-18のチャンピオンシップ。{period.shortGames}件）は、1Q〜4Qが無く、Q別・前半・後半の記録が無いため、含めていません。
        </p>
      )}
      {period && period.noPlusMinus > 0 && <p className="rule-change-footnote">※ {PERIOD_PLUS_MINUS_NOTE}</p>}
    </>
  );
}
