/** シーズンを変えたときに、そのシーズンでは意味が変わるフィルタを外したことを知らせる（フィルタのすぐ下。DESIGN.md 164章） */
export function SeasonFilterNotice({ notices, onDismiss }: { notices: string[]; onDismiss: () => void }) {
  if (notices.length === 0) return null;
  return (
    <div className="season-filter-notice" role="status">
      <ul>
        {notices.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>
      <button type="button" aria-label="お知らせを閉じる" onClick={onDismiss}>
        ×
      </button>
    </div>
  );
}
