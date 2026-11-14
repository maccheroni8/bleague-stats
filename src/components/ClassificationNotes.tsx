import { classificationNotes } from "../lib/classificationFilter";

/** 登録区分を選んだときの表の下の注記（日本人＝見做し日本人を含む。DESIGN.md 298・388章） */
export function ClassificationNotes({ filter, scope }: { filter: string; scope: "season" | "allTime" }) {
  const notes = classificationNotes(filter, scope);
  return (
    <>
      {notes.map((n) => (
        <p key={n} className="rule-change-footnote">
          ※ {n}
        </p>
      ))}
    </>
  );
}
