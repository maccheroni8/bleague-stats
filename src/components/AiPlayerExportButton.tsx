import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { League } from '../lib/league';
const AI_EXPORT_BUTTON_LABEL = 'md';

/** 書き出し画面の部品（別ファイル）を読み込めなかったことを表す。画面の中の別のエラーとは区別する。 */
class DialogLoadError extends Error {}

/** 部品の読み込みに失敗したとき、ページ全体ではなく書き出し画面の場所だけに案内を出す。 */
class DialogLoadBoundary extends Component<{ onFail: () => void; children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown): { error: unknown } { return { error }; }
  componentDidCatch(error: unknown): void {
    if (!(error instanceof DialogLoadError)) return;
    console.error(error);
    this.props.onFail();
  }
  render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    // 部品の読み込み以外のエラーは、これまでどおりページ側の案内に任せる（上の境界へ投げ直す）
    if (!(error instanceof DialogLoadError)) throw error;
    return null;
  }
}

/** 選手詳細からはこのボタンだけを置く。部品の読み込みも取得も、ボタンを押したときに始める。 */
export function AiPlayerExportButton({ season, playerId, league }: { season: string; playerId: string; league: League }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // 読み込みの試行ごとに作り直す（失敗した読み込みの結果は React.lazy に残るため、同じものでは再試行できない）
  const [attempt, setAttempt] = useState(0);
  const Dialog = useMemo(() => lazy(() =>
    import('./AiPlayerExportDialog').catch((error: unknown) => { throw Object.assign(new DialogLoadError('書き出し画面を読み込めませんでした'), { cause: error }); })), [attempt]);
  const press = () => {
    if (failed) { setFailed(false); setAttempt(n => n + 1); }
    setOpen(true);
  };
  return <>
    <button type="button" className="export-image-button ai-export-button" aria-label="AI向けに選手のデータを書き出す" title="AI向けに選手のデータを書き出す" onClick={press}>{AI_EXPORT_BUTTON_LABEL}</button>
    {open && !failed && <DialogLoadBoundary key={attempt} onFail={() => setFailed(true)}>
      <Suspense fallback={<p role="status">書き出し画面を準備しています…</p>}>
        <Dialog key={`${league}/${season}/${playerId}`} season={season} playerId={playerId} league={league} close={() => setOpen(false)} />
      </Suspense>
    </DialogLoadBoundary>}
    {open && failed && <div className="ai-export-load-error" role="alert">
      <p>書き出し画面を読み込めませんでした。もう一度押してください。{attempt > 0 && '改善しないときは、ページを読み込み直してください。'}</p>
      <div className="ai-export-load-error-actions">
        <button type="button" autoFocus onClick={press}>もう一度読み込む</button>
        {/* ブラウザは失敗した読み込みの結果を同じページの間は覚えているため、2回目以降の失敗ではページごとの読み込み直しを案内する */}
        {attempt > 0 && <button type="button" onClick={() => window.location.reload()}>ページを読み込み直す</button>}
        <button type="button" onClick={() => { setOpen(false); setFailed(false); }}>閉じる</button>
      </div>
    </div>}
  </>;
}
