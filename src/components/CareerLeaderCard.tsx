import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/**
 * 個人・チームの「記録」タブの通算成績のカード（DESIGN.md 192章）: 項目ごとの1位。カード全体が、ランキングページの通算記録の同じ項目へのリンク。
 * 同じ値（1位タイ）が複数あるときは、先頭の1件と「ほか◯人（チーム）」を出す
 */
export function CareerLeaderCard({
  label,
  valueText,
  name,
  sub,
  otherCount,
  unit,
  to,
}: {
  label: string;
  valueText: string;
  name: ReactNode;
  sub?: ReactNode;
  /** 1位タイの先頭以外の数 */
  otherCount: number;
  unit: "人" | "チーム" | "シーズン";
  to: string;
}) {
  return (
    <Link to={to} className="career-high-card career-high-card-link" aria-label={`${label}のランキングを見る`}>
      <div className="career-high-label">{label} ›</div>
      <div className="career-high-value career-high-value-fit">{valueText}</div>
      <div>
        <span className="record-team">{name}</span>
      </div>
      {sub && <div>{sub}</div>}
      {otherCount > 0 && (
        <div className="career-high-others-toggle">
          ほか{otherCount}
          {unit}
        </div>
      )}
    </Link>
  );
}
