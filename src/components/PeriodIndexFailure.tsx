/**
 * Q別・前後半・延長の表で、ピリオド別の索引（DESIGN.md 225・256章）を読めなかったとき。一部のシーズンだけで表を出すと値が欠けて誤解を招くため、表は出さない。
 * 再読み込みは、読めなかったシーズンだけをもう一度取りに行く（ランキング・選手詳細で共通）
 */
export function PeriodIndexFailure({ onRetry, target = "Q別・前後半・延長の表" }: { onRetry: () => void; target?: string }) {
  return (
    <div className="error-message">
      <p>Q別・前後半・延長の記録を読み込めませんでした。{target}は、記録がそろわないと値が欠けてしまうため、表示していません。</p>
      <button type="button" className="load-more-button" onClick={onRetry}>
        再読み込み
      </button>
    </div>
  );
}
