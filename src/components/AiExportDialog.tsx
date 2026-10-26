import { useEffect, useMemo, useRef, useState } from 'react';
import { buildAiExport, type AiExportInput } from '../lib/aiExport';
import { loadAiExport } from '../lib/aiExportLoad';
import { teamNameInSeason, useTeamLabel } from '../lib/teamLabel';
import './AiExportDialog.css';

export default function AiExportDialog({ season, teamId, close }: { season: string; teamId: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState<AiExportInput | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [opponentId, setOpponentId] = useState('');
  const [notice, setNotice] = useState('');
  const teamLabel = useTeamLabel();
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let active = true;
    setInput(null); setError(''); setNotice('');
    const timeout = window.setTimeout(() => {
      if (active) { active = false; setError('読み込みに時間がかかっています。もう一度お試しください。'); }
    }, 45_000);
    loadAiExport(season, teamId, undefined, 'premier').then(data => {
      if (active) { window.clearTimeout(timeout); setInput(data); }
    }, () => {
      if (active) { window.clearTimeout(timeout); setError('必要なデータを読み込めませんでした。完成版としてコピー・保存できません。時間をおいて、もう一度お試しください。'); }
    });
    return () => { active = false; window.clearTimeout(timeout); };
  }, [season, teamId, attempt]);
  const result = useMemo(() => {
    if (!input) return null;
    try { return { output: buildAiExport({ ...input, opponentId: opponentId || undefined }), error: '' }; }
    catch (e) { return { output: null, error: e instanceof Error ? e.message : '書き出す内容を作れませんでした。' }; }
  }, [input, opponentId]);
  const output = result?.output;
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
  return <dialog ref={dialog} className="ai-export-dialog" aria-labelledby="ai-export-title" onClose={close}>
    <div className="ai-export-heading"><h2 id="ai-export-title">AI向けにデータを書き出す</h2><button type="button" onClick={() => dialog.current?.close()}>閉じる</button></div>
    <p>対象：{season}シーズン・レギュラーシーズン・試合全体。画面の視点・区間・条件は引き継ぎません。</p>
    {error || result?.error ? <div role="alert"><p>{error || result?.error}</p><button type="button" onClick={() => setAttempt(n => n + 1)}>もう一度読み込む</button></div> : !input ? <p role="status">チーム・リーグ・前季・選手の記録を読み込んでいます…</p> : null}
    {input && <label className="ai-export-opponent">比較する相手
      <select value={opponentId} onChange={e => { setOpponentId(e.target.value); setNotice(''); }}>
        <option value="">選択なし（比較の章を出さない）</option>
        {input.current.teams.filter(t => t.teamId !== teamId).map(t => <option key={t.teamId} value={t.teamId}>{teamLabel(t.teamId, teamNameInSeason(input.history, t.teamId, season, t.teamName))}</option>)}
      </select>
    </label>}
    <div className="ai-export-actions">
      <button type="button" disabled={!output || !!error} onClick={copy}>コピー</button>
      <button type="button" disabled={!output || !!error} onClick={save}>Markdownで保存</button>
      <button type="button" disabled={!output || !!error} onClick={selectAll}>全文を選択</button>
      {output && <span>{output.characters.toLocaleString('ja-JP')}文字</span>}
    </div>
    <p className="ai-export-notice" role="status">{notice}</p>
    {output && !error && <label className="ai-export-preview">Markdownプレビュー（コピー・保存される全文）
      <textarea ref={text} readOnly wrap="off" value={output.markdown} spellCheck={false} aria-label="書き出すMarkdown全文" />
    </label>}
  </dialog>;
}
