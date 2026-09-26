import type { ReactNode } from "react";
import { SeasonLink } from "./SeasonLink";
import type { GlossaryAnchor } from "../lib/glossaryAnchors";

/**
 * 表・グラフの下に置く1行: その表がどのフィルタに連動するか（scope）と、用語集の該当の節へのリンク（文言は「説明」）。
 * 見方・定義は用語集に書き、ここには書かない（DESIGN.md 161章）。画像出力（.export-target）の外に置く
 */
export function GlossaryNote({
  scope,
  anchor,
  label,
}: {
  scope?: ReactNode;
  anchor: GlossaryAnchor;
  /** 表・グラフの名前。リンクの文言は「説明」に統一し、読み上げ用の名前（aria-label）を「◯◯の説明」にする */
  label: string;
}) {
  return (
    <p className="page-subtitle glossary-note">
      {scope}
      {scope ? " " : null}
      <SeasonLink to={`/glossary#${anchor}`} aria-label={`${label}の説明`}>
        説明
      </SeasonLink>
    </p>
  );
}
