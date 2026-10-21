import { lazy, Suspense, useState } from 'react';
const AI_EXPORT_BUTTON_LABEL = 'md';
const AiExportDialog = lazy(() => import('./AiExportDialog'));

/** チーム詳細からはこのボタンだけを置く。取得はプレビューを開いたときに開始する。 */
export function AiExportButton({ season, teamId }: { season: string; teamId: string }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="export-image-button ai-export-button" aria-label="AI向けにデータを書き出す" title="AI向けにデータを書き出す" onClick={() => setOpen(true)}>{AI_EXPORT_BUTTON_LABEL}</button>
    {open && <Suspense fallback={<p role="status">書き出し画面を準備しています…</p>}>
      <AiExportDialog key={`${season}/${teamId}`} season={season} teamId={teamId} close={() => setOpen(false)} />
    </Suspense>}
  </>;
}
