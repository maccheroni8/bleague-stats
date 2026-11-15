import { useEffect, useRef, useState } from 'react';
import { buildGameMd, type GameMdInput, type GameMdOutput } from '../lib/gameMd';
import './AiExportDialog.css';

/** 試合詳細の md。材料は試合詳細ページが読み込み済みなので、「書き出しを作る」を押したときに組み立てるだけ。 */
export default function GameMdDialog({ input, close }: { input: GameMdInput; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<GameMdOutput | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { dialog.current?.showModal(); }, []);

  const create = () => {
    setBusy(true); setError(''); setOutput(null); setNotice('');
    // 「作っています…」を先に描いてから組み立てる
    window.setTimeout(() => {
      try { setOutput(buildGameMd(input)); }
      catch (e) { setError(e instanceof Error && e.message ? `書き出せませんでした。完成版としてコピー・保存できません。${e.message}` : '書き出せませんでした。完成版としてコピー・保存できません。時間をおいて、もう一度お試しください。'); }
      finally { setBusy(false); }
    }, 30);
  };
  const selectAll = () => { text.current?.focus(); text.current?.select(); };
  const copy = async () => {
    if (!output) return;
    try { await navigator.clipboard.writeText(output.markdown); setNotice('コピーしました。'); }
    catch { selectAll(); setNotice('コピーできませんでした。全文を選択しました。端末のコピー操作を使ってください。'); }
  };
  const save = () => {
    if (!output) return;
    try {
      const url = URL.createObjectURL(new Blob([output.markdown], { type: 'text/markdown;charset=utf-8' }));
      const a = document.createElement('a'); a.href = url; a.download = output.filename;
      document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setNotice('保存を開始しました。端末によっては、開いたファイルの共有メニューから保存できます。');
    } catch { setNotice('保存を開始できませんでした。「コピー」または「全文を選択」を使ってください。'); }
  };
  return <dialog ref={dialog} className="ai-export-dialog" aria-labelledby="game-md-title" onClose={close}>
    <div className="ai-export-heading"><h2 id="game-md-title">AI向けに試合のデータを書き出す</h2><button type="button" onClick={() => dialog.current?.close()}>閉じる</button></div>
    <div className="ai-detailed">
      <p>対象：{input.game.homeTeam.name} vs {input.game.awayTeam.name}（{input.game.date}）。試合の基本・キースタッツ・ゲームリーダー・試合の流れ（点差の推移・ラン・クラッチタイム・出場交代）・シュート・オンザコートと起用・ボックススコア（全選手・全項目）を、AIに渡しやすい形の表で書き出します（「書き出しを作る」を押すと作ります）。</p>
      <div className="ai-export-actions">
        <button type="button" disabled={busy} onClick={create}>{busy ? '作っています…' : '書き出しを作る'}</button>
        <button type="button" disabled={!output} onClick={copy}>コピー</button>
        <button type="button" disabled={!output} onClick={save}>Markdownで保存</button>
        <button type="button" disabled={!output} onClick={selectAll}>全文を選択</button>
        {output && <span>{output.characters.toLocaleString('ja-JP')}文字</span>}
      </div>
      {error && <p role="alert">{error}</p>}
      <p className="ai-export-notice" role="status">{notice}</p>
      {output && <label className="ai-export-preview">Markdownプレビュー（コピー・保存される全文）
        <textarea ref={text} readOnly wrap="off" value={output.markdown} spellCheck={false} aria-label="書き出すMarkdown全文" />
      </label>}
    </div>
  </dialog>;
}
