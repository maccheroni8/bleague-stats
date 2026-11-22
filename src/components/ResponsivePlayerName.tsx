import { NameText } from "./NameText";
import { normalizePlayerName } from "../../shared/playerName";
import { usePlayerLabel } from "../lib/playerLabel";

/**
 * スマホ幅（560px以下）では名字だけ、それ以外はフルネームの選手名（lib/playerLabel.ts）。
 * among に同じ一覧に並ぶ選手の名前を渡すと、名字が重なる選手はフルネームのまま。フルネームはツールチップ（title）に出す。
 * ルーキーの印（RookieBadge）は個人詳細ページだけに出す（DESIGN.md 217-3章）ので、ここでは付けない。
 * 名前の改行は常に「・」の後ろだけ（breakAtDot は呼び出し互換のため残す）。
 */
export function ResponsivePlayerName({
  name,
  among,
  exportLineFirst = false,
}: {
  name: string;
  among?: readonly string[];
  breakAtDot?: boolean;
  /** 保存画像だけ、名前を1行にする（入りきらない名前は字を小さくする。画面は変えない。NameText の exportLineFirst） */
  exportLineFirst?: boolean;
}) {
  const label = usePlayerLabel(among);
  const shown = label(name);
  const full = normalizePlayerName(name);
  const text = shown === full ? <NameText name={full} exportLineFirst={exportLineFirst} /> : <span title={full}><NameText name={shown} exportLineFirst={exportLineFirst} /></span>;
  return text;
}
