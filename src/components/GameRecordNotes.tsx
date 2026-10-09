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
  unavailableSeasons,
  unavailableLabel,
  rookie,
  positionFallback,
}: {
  /** 除いた前後半5分の特別な試合の数 */
  excludedSpecial: number;
  /** 少ない方から並べるため、既定で除いているか（そうでなければ、選んで除いている） */
  ascendingDefault: boolean;
  /** 項目の値を算出できず、含めなかったシーズン */
  unavailableSeasons: string[];
  /** 算出できなかった項目の呼び名（「ターンオーバーからの得点」） */
  unavailableLabel: string;
  /** ルーキーで絞り込んでいるとき、2016-17の試合が含まれない理由も添えるか */
  rookie?: { allTime: boolean };
  positionFallback: boolean;
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
      {unavailableSeasons.length > 0 && (
        <p className="rule-change-footnote">
          ※ {unavailableSeasons.join("・")}は、公式の記録に{unavailableLabel}が無いため、含めていません。
        </p>
      )}
      {rookie && (
        <p className="rule-change-footnote">
          ※ {ROOKIE_NOTE}
          {rookie.allTime ? "2016-17は、ルーキーを判定できないため、含めていません。" : ""}
        </p>
      )}
      {positionFallback && <p className="rule-change-footnote">※ {POSITION_FALLBACK_NOTE}</p>}
    </>
  );
}
