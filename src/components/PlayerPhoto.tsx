import { playerPhotoUrl } from "../lib/data";

// data/player-photos/{playerId}.webpは選手写真が取得できた選手のみ存在する
// （新規選手が翌週の再スキャンで取得されるまでの間や、写真自体が非公開の選手は404になりうる）。
// 404時は要素ごと非表示にする
export function PlayerPhoto({ playerId, size = 96, className }: { playerId: string; size?: number; className?: string }) {
  return (
    <img
      src={playerPhotoUrl(playerId)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      className={`player-photo${className ? ` ${className}` : ""}`}
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  );
}
