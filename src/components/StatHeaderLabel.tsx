import { Fragment } from "react";

/**
 * 表の列見出し・比較の項目名の表示。「外国籍・帰化・アジア PTS」のように「・」を含む長い項目名は、列の幅を抑えるため
 * 「・」の後ろでだけ折り返す（表記は変えない。DESIGN.md 138章）。それ以外の項目名はそのまま返す
 */
export function StatHeaderLabel({ label }: { label: string }) {
  if (!label.includes("・")) return <>{label}</>;
  const parts = label.split(/(?<=・)/);
  return (
    <span className="stat-header-wrap">
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part.replace(/ /g, " ")}
        </Fragment>
      ))}
    </span>
  );
}
