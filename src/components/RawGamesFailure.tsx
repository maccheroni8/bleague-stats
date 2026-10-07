/**
 * Q別・前後半の表で、やり直しても読めなかった試合があるとき。読めた分だけで表を出すと値が欠けて誤解を招くため、表は出さない。
 * 再読み込みは、読めなかった試合だけをもう一度取りに行く（ランキング・選手詳細で共通。DESIGN.md 218-8）
 */
export function RawGamesFailure({ count, onRetry, target = "Q別・前後半の表" }: { count: number; onRetry: () => void; target?: string }) {
  return (
    <div className="error-message">
      <p>{count}試合の記録を読み込めませんでした。{target}は、全試合がそろわないと値が欠けてしまうため、表示していません。</p>
      <button type="button" className="load-more-button" onClick={onRetry}>
        再読み込み
      </button>
    </div>
  );
}
