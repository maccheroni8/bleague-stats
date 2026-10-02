import { useState } from "react";
import { teamLogoUrl } from "../lib/data";

// data/logos/{teamId}.pngは現行B.PREMIER26クラブ分しか無い（scripts/lib/teamLogoCodes.ts参照）。
// 過去シーズンのみ在籍した降格クラブ等はロゴが存在しないため、404時は既定では要素ごと非表示にする。
// placeholder を付けると、同じ大きさの空の枠を出す（歴代の記録の一覧のように、ロゴのある行とない行の高さをそろえたい場所用）
export function TeamLogo({
  teamId,
  size = 24,
  className,
  placeholder = false,
}: {
  teamId: string;
  size?: number;
  className?: string;
  placeholder?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cls = `team-logo${className ? ` ${className}` : ""}`;
  if (failed && placeholder) {
    return <span className={`${cls} team-logo-placeholder`} style={{ width: size, height: size }} aria-hidden="true" />;
  }
  return (
    <img
      src={teamLogoUrl(teamId)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={cls}
      onError={(e) => {
        if (placeholder) setFailed(true);
        else e.currentTarget.style.display = "none";
      }}
    />
  );
}
