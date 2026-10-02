import { useState } from "react";
import { playerPhotoUrl } from "../lib/data";

// data/player-photos/{playerId}.webpは選手写真が取得できた選手のみ存在する
// （新規選手が翌週の再スキャンで取得されるまでの間や、写真自体が非公開の選手は404になりうる）。
// 404時は、既定では要素ごと非表示にする。placeholder を付けると、同じ大きさの空の枠（シルエット）を出す
// （ランキングの一覧のように、写真のある行とない行の高さをそろえたい場所用）
export function PlayerPhoto({
  playerId,
  size = 96,
  className,
  placeholder = false,
}: {
  playerId: string;
  size?: number;
  className?: string;
  placeholder?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const cls = `player-photo${className ? ` ${className}` : ""}`;
  if (failed && placeholder) {
    return (
      <span className={`${cls} player-photo-placeholder`} style={{ width: size, height: size }} aria-hidden="true">
        <svg viewBox="0 0 24 24" width="62%" height="62%" fill="currentColor">
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" />
        </svg>
      </span>
    );
  }
  return (
    <img
      src={playerPhotoUrl(playerId)}
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
