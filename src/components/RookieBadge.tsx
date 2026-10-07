/**
 * ルーキーの印（DESIGN.md 217-3章）。名前の右に付ける小さなバッジで、デスクトップは「Rookie」、スマホ幅（560px以下）は「R」（ツールチップは常に「Rookie」）。
 * 付けるかどうかは呼び出し側が `useIsRookie` の結果で決める（行のシーズンで判定する）
 */
export function RookieBadge() {
  return (
    <span className="rookie-badge" title="Rookie">
      <span className="rookie-badge-full">Rookie</span>
      <span className="rookie-badge-short" aria-hidden="true">
        R
      </span>
    </span>
  );
}
