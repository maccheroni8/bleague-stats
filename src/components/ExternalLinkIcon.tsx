/**
 * 外部サイトへのリンクであることを明示する小さなアイコンリンク（新しいタブで開く）。
 * サイト内リンク（<Link>/<SeasonLink>）とは視覚的に区別するための専用コンポーネント。
 *
 * 選手名リンク（<Link to={`/players/...`}>）の中に置かれることが多いため、クリック時に
 * stopPropagation()して親のクリックハンドラ（react-router Linkの内部ナビゲーション）が
 * 同時に発火しないようにしている。target="_blank"の実際のページ遷移自体はこのアンカー自身の
 * 標準動作でそのまま行われる（stopPropagationは親要素へのイベント伝播だけを止める）。
 */
export function ExternalLinkIcon({ href, title }: { href: string; title: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="external-link-icon"
      title={title}
      onClick={(e) => e.stopPropagation()}
    >
      ↗
    </a>
  );
}
