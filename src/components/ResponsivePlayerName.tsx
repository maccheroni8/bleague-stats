import { usePlayerLabel } from "../lib/playerLabel";

/**
 * スマホ幅（560px以下）では名字だけ、それ以外はフルネームの選手名（lib/playerLabel.ts）。
 * among に同じ一覧に並ぶ選手の名前を渡すと、名字が重なる選手はフルネームのまま。フルネームはツールチップ（title）に出す
 */
export function ResponsivePlayerName({ name, among }: { name: string; among?: readonly string[] }) {
  const label = usePlayerLabel(among);
  const shown = label(name);
  return shown === name ? <>{name}</> : <span title={name}>{shown}</span>;
}
