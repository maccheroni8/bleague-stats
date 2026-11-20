// 試合詳細の「md」ボタン（AI向けの書き出し）。書き出し画面の部品は、押したときに初めて読み込む（選手詳細・チーム詳細の md と同じ置き方）
import { useSaveMenuEntry } from './SaveMenu';
import { Component, lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import type { GameMdInput } from '../lib/gameMd';

const AI_EXPORT_BUTTON_LABEL = 'md';

/** 書き出し画面の部品（別ファイル）を読み込めなかったことを表す。画面の中の別のエラーとは区別する。 */
class DialogLoadError extends Error {}

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
    if (!(error instanceof DialogLoadError)) throw error;
    return null;
  }
}

/** ready=false（スポーツナビの記録を読み込み中）のあいだは押せない */
export function GameMdButton({ input, ready }: { input: GameMdInput; ready: boolean }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const Dialog = useMemo(() => lazy(() =>
    import('./GameMdDialog').catch((error: unknown) => { throw Object.assign(new DialogLoadError('書き出し画面を読み込めませんでした'), { cause: error }); })), [attempt]);
  const press = () => {
    if (failed) { setFailed(false); setAttempt(n => n + 1); }
    setOpen(true);
  };
  const saveEntry = useSaveMenuEntry({ label: 'md', order: 2, title: ready ? 'AI向けに試合のデータを書き出す' : '記録を読み込み中です', disabled: !ready, onSelect: press });
  return <>
    {saveEntry}
    {open && !failed && <DialogLoadBoundary key={attempt} onFail={() => setFailed(true)}>
      <Suspense fallback={<p role="status">書き出し画面を準備しています…</p>}>
        <Dialog input={input} close={() => setOpen(false)} />
      </Suspense>
    </DialogLoadBoundary>}
    {open && failed && <div className="ai-export-load-error" role="alert">
      <p>書き出し画面を読み込めませんでした。もう一度押してください。{attempt > 0 && '改善しないときは、ページを読み込み直してください。'}</p>
      <div className="ai-export-load-error-actions">
        <button type="button" autoFocus onClick={press}>もう一度読み込む</button>
        {attempt > 0 && <button type="button" onClick={() => window.location.reload()}>ページを読み込み直す</button>}
        <button type="button" onClick={() => { setOpen(false); setFailed(false); }}>閉じる</button>
      </div>
    </div>}
  </>;
}
