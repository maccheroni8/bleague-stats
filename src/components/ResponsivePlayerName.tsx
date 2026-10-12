import { Fragment, type ReactNode } from "react";
import { normalizePlayerName } from "../../shared/playerName";
import { usePlayerLabel } from "../lib/playerLabel";
import { useIsRookie } from "../lib/rookieFilter";
import { RookieBadge } from "./RookieBadge";

/**
 * スマホ幅（560px以下）では名字だけ、それ以外はフルネームの選手名（lib/playerLabel.ts）。
 * among に同じ一覧に並ぶ選手の名前を渡すと、名字が重なる選手はフルネームのまま。フルネームはツールチップ（title）に出す。
 * playerId と season（その行のシーズン）を渡すと、そのシーズンのルーキーには名前の右に印（RookieBadge。DESIGN.md 217-3章）を付ける。
 * 通算・複数シーズンを合わせた行では、season を渡さない（付けない）
 * breakAtDot を指定すると、「・」の後ろでだけ折り返せる（外国籍選手の長い名前を、名前の途中で切らずに複数行に収める。アシストペア・組み合わせ）
 */
export function ResponsivePlayerName({
  name,
  among,
  playerId,
  season,
  breakAtDot = false,
}: {
  name: string;
  among?: readonly string[];
  playerId?: string;
  season?: string;
  breakAtDot?: boolean;
}) {
  const label = usePlayerLabel(among);
  const isRookie = useIsRookie();
  const shown = label(name);
  const full = normalizePlayerName(name);
  const body = (s: string): ReactNode =>
    breakAtDot
      ? s.split("・").map((part, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <>
                ・<wbr />
              </>
            )}
            {part}
          </Fragment>
        ))
      : s;
  const text = shown === full ? <>{body(full)}</> : <span title={full}>{body(shown)}</span>;
  return playerId && season && isRookie(playerId, season) ? (
    <>
      {text}
      <RookieBadge />
    </>
  ) : (
    text
  );
}
