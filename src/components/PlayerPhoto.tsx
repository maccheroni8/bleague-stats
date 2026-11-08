import { useCallback, useState } from "react";
import { playerPhotoUrl } from "../lib/data";

// data/player-photos/{playerId}.webpは選手写真が取得できた選手のみ存在する
// （新規選手が翌週の再スキャンで取得されるまでの間や、写真自体が非公開の選手は404になりうる）。
// 404時は、既定では要素ごと非表示にする。placeholder を付けると、同じ大きさの枠（「NO PHOTO」の文字）を出す
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
  // 画面に出る前に読み込みの失敗が確定していた画像（キャッシュされた404など。onError が間に合わない）も、枠に切り替える
  const checkBroken = useCallback(
    (img: HTMLImageElement | null) => {
      if (img && placeholder && img.complete && img.naturalWidth === 0) setFailed(true);
    },
    [placeholder],
  );
  const cls = `player-photo${className ? ` ${className}` : ""}`;
  if (failed && placeholder) {
    return (
      <span className={`${cls} player-photo-placeholder`} style={{ width: size, height: size }} aria-hidden="true">
        <span className="player-photo-placeholder-text" style={{ fontSize: Math.max(8, Math.round(size * 0.2)) }}>
          NO
          <br />
          PHOTO
        </span>
      </span>
    );
  }
  return (
    <img
      ref={checkBroken}
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
