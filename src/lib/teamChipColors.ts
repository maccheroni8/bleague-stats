// 保存画像でチーム名・略称を塗る色（DESIGN.md 364章。362章の塗りを、選手が並ぶ画像の略称にも広げた）。
// 色の決まり方: 画面のアクセント色と同じ（fetchTeamColors の primary＝手動上書き→ロゴから自動抽出した色。輝度が暗すぎ・明るすぎれば
// secondary、それも無理なら画面の文字色〔mono〕）。ただし TEAM_CHIP_OVERRIDES にあるチームは、その背景・文字で塗る（mono になるチームも）。
// アルティーリ千葉（2486）は、ロゴから抽出した黒系の主の色（#001030）。アクセント色の側（細い線）は今のまま
import { readableInkOn } from "./color";
import { fetchTeamColors } from "./data";
import { useJsonData } from "./useJsonData";
import type { TeamColors } from "../../shared/types";
import type { CSSProperties } from "react";

/**
 * 塗りの手動上書き（背景 bg だけ・文字 ink だけでも指定できる。無い側は、ロゴから取った色／背景の明るさで白か黒を選ぶ従来の決め方）。
 * 変えるのはこの保存画像の塗り（TeamChip・RankedList の塗り）だけ。順位推移・表の色の帯などのチームカラー（fetchTeamColors）は変えない。
 * アルティーリ千葉は、アクセント色が mono になり塗る色が決まらないので、ここで黒系を指定している
 */
export const TEAM_CHIP_OVERRIDES: Record<string, { bg?: string; ink?: "#ffffff" | "#111111" }> = {
  "2486": { bg: "#001030" }, // アルティーリ千葉（黒系）
  "706": { bg: "#000000" }, // アルバルク東京（黒）
  "696": { ink: "#ffffff" }, // 富山グラウジーズ（背景はロゴの赤のまま、文字を白）
  "729": { bg: "#CD1B2F" }, // 名古屋ダイヤモンドドルフィンズ（368章でメインの色も #CD1B2F にそろえた。teamColorOverrides.ts）
  "721": { ink: "#ffffff" }, // 広島ドラゴンフライズ
  "1638": { ink: "#ffffff" }, // 佐賀バルーナーズ
};

/**
 * 塗る色。"#rrggbb"（背景だけ）か、文字の色を決めたチームは "#rrggbb|#ffffff"（背景|文字）。
 * 決まらないチームは undefined（塗らない）。teamChipStyle に渡すと CSS の変数になる
 */
export function teamChipColor(teamId: string, colors: Record<string, TeamColors> | null | undefined): string | undefined {
  const o = TEAM_CHIP_OVERRIDES[teamId];
  const primary = colors?.[teamId]?.primary;
  const bg = o?.bg ?? (primary && /^#[0-9a-fA-F]{6}$/.test(primary) ? primary : undefined);
  if (!bg) return undefined;
  return o?.ink ? `${bg}|${o.ink}` : bg;
}

/** 塗りの色と文字の色（CSS の変数）。決まらなければ undefined */
export function teamChipStyle(fill: string | undefined): CSSProperties | undefined {
  const [color, forcedInk] = (fill ?? "").split("|");
  const ink = forcedInk || readableInkOn(color);
  return color && ink && readableInkOn(color) ? ({ "--team-color": color, "--team-ink": ink } as CSSProperties) : undefined;
}

let cache: Promise<Record<string, TeamColors>> | null = null;

/** チームの色（ページを開いている間は1回だけ読む。読めなければ空） */
export function useTeamColorsForChip(): Record<string, TeamColors> | null {
  const { data } = useJsonData(() => (cache ??= fetchTeamColors().catch(() => ({}))), []);
  return data ?? null;
}
