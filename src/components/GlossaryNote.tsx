import type { ReactNode } from "react";
import { SeasonLink } from "./SeasonLink";
import type { GlossaryAnchor } from "../lib/glossaryAnchors";

/**
 * 表・グラフの下に置く1行: その表がどのフィルタに連動するか（scope）と、用語集の該当の節へのリンク。
 * 見方・定義は用語集に書き、ここには書かない（DESIGN.md 161章）。画像出力（.export-target）の外に置く
 */
export function GlossaryNote({ scope, anchor, label }: { scope?: ReactNode; anchor: GlossaryAnchor; label: string }) {
  return (
    <p className="page-subtitle glossary-note">
      {scope}
      {scope ? " " : null}
      <SeasonLink to={`/glossary#${anchor}`}>{label}の見方（用語集）</SeasonLink>
    </p>
  );
}
