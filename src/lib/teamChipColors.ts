// 保存画像でチーム名・略称を塗る色（DESIGN.md 363章。362章の塗りを、選手が並ぶ画像の略称にも広げた）。
// 色の決まり方: 画面のアクセント色と同じ（fetchTeamColors の primary＝手動上書き→ロゴから自動抽出した色。輝度が暗すぎ・明るすぎれば
// secondary、それも無理なら画面の文字色〔mono〕）。ただし mono になるチームは塗る色が決まらないので、ここの一覧の色で塗る。
// アルティーリ千葉（2486）は、ロゴから抽出した黒系の主の色（#001030）。アクセント色の側（細い線）は今のまま
import { readableInkOn } from "./color";
import { fetchTeamColors } from "./data";
import { useJsonData } from "./useJsonData";
import type { TeamColors } from "../../shared/types";
import type { CSSProperties } from "react";

/** アクセント色が mono になるチームの、塗る色 */
export const TEAM_FILL_COLORS: Record<string, string> = {
  "2486": "#001030", // アルティーリ千葉（黒系）
};

/** 塗る色（"#rrggbb"）。決まらないチームは undefined（塗らない） */
export function teamChipColor(teamId: string, colors: Record<string, TeamColors> | null | undefined): string | undefined {
  const own = TEAM_FILL_COLORS[teamId];
  if (own) return own;
  const primary = colors?.[teamId]?.primary;
  return primary && /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : undefined;
}

/** 塗りの色と文字の色（CSS の変数）。決まらなければ undefined */
export function teamChipStyle(color: string | undefined): CSSProperties | undefined {
  const ink = readableInkOn(color);
  return color && ink ? ({ "--team-color": color, "--team-ink": ink } as CSSProperties) : undefined;
}

let cache: Promise<Record<string, TeamColors>> | null = null;

/** チームの色（ページを開いている間は1回だけ読む。読めなければ空） */
export function useTeamColorsForChip(): Record<string, TeamColors> | null {
  const { data } = useJsonData(() => (cache ??= fetchTeamColors().catch(() => ({}))), []);
  return data ?? null;
}
