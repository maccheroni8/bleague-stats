import type { ReactNode } from "react";
import { teamChipColor, teamChipStyle, useTeamColorsForChip } from "../lib/teamChipColors";

/**
 * 選手が並ぶ画面のチームの略称（横にロゴが無い所）。画面ではただの文字で、保存画像だけチームの色で塗る
 * （CSS の `.export-rendering .team-chip`。DESIGN.md 363章。塗りと文字の色は ranking の写真なしの塗りと同じ部品〔teamChipColors.ts〕）
 */
export function TeamChip({ teamId, children }: { teamId: string; children: ReactNode }) {
  const colors = useTeamColorsForChip();
  const style = teamChipStyle(teamChipColor(teamId, colors));
  return (
    <span className="team-chip" style={style}>
      {children}
    </span>
  );
}

/** 複数のチーム（移籍した選手の合算など）の略称を「・」でつないで、それぞれ塗る */
export function TeamChipList({ ids, labelOf }: { ids: readonly string[]; labelOf: (id: string) => string }) {
  return (
    <>
      {ids.map((id, i) => (
        <span key={id}>
          {i > 0 && "・"}
          <TeamChip teamId={id}>{labelOf(id)}</TeamChip>
        </span>
      ))}
    </>
  );
}
