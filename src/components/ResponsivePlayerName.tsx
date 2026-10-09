import { normalizePlayerName } from "../../shared/playerName";
import { usePlayerLabel } from "../lib/playerLabel";
import { useIsRookie } from "../lib/rookieFilter";
import { RookieBadge } from "./RookieBadge";

/**
 * スマホ幅（560px以下）では名字だけ、それ以外はフルネームの選手名（lib/playerLabel.ts）。
 * among に同じ一覧に並ぶ選手の名前を渡すと、名字が重なる選手はフルネームのまま。フルネームはツールチップ（title）に出す。
 * playerId と season（その行のシーズン）を渡すと、そのシーズンのルーキーには名前の右に印（RookieBadge。DESIGN.md 217-3章）を付ける。
 * 通算・複数シーズンを合わせた行では、season を渡さない（付けない）
 */
export function ResponsivePlayerName({
  name,
  among,
  playerId,
  season,
}: {
  name: string;
  among?: readonly string[];
  playerId?: string;
  season?: string;
}) {
  const label = usePlayerLabel(among);
  const isRookie = useIsRookie();
  const shown = label(name);
  const full = normalizePlayerName(name);
  const text = shown === full ? <>{full}</> : <span title={full}>{shown}</span>;
  return playerId && season && isRookie(playerId, season) ? (
    <>
      {text}
      <RookieBadge />
    </>
  ) : (
    text
  );
}
