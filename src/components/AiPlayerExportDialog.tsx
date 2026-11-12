import { useEffect, useRef, useState } from 'react';
import { buildPlayerExport, type PlayerMdOutput } from '../lib/aiPlayerExport';
import { loadPlayerExport } from '../lib/aiPlayerExportLoad';
import { OPPONENT_KIND_LABELS, ONE_THREE_TERMS_REASON, TERM_CHOICES, type OpponentKind, type TermKind } from '../lib/aiExportScope';
import { LEAGUE_LABELS, type League } from '../lib/league';
import './AiExportDialog.css';

const OPP_CHOICES: OpponentKind[] = ['all', 'atLeast60'];
const TERM_HINTS: Partial<Record<TermKind, string>> = {
  threeTerms: 'リーグ共通の中断期間（11月と2月ごろ）で、開幕〜11月の中断／中断明け〜2月の中断／2月の中断明け〜の3つに分けます。シーズン成績の章は、3つの期間と、参考のシーズン全体の列を並べます。',
  halves: '各チームの試合数の半分で前半戦・後半戦に分けます（奇数は前半戦が1試合多い）。進行中のシーズンは30試合目までを前半戦にします。シーズン成績の章は、2つの期間と、参考のシーズン全体の列を並べます。',
};

/** 選手詳細の md。選ぶのは ターム → 対戦相手。作るのは「書き出しを作る」を押したときだけ（リーグ全体の記録を読むため）。 */
export default function AiPlayerExportDialog({ season, playerId, league, close }: { season: string; playerId: string; league: League; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [term, setTerm] = useState<TermKind>('season');
  const [opp, setOpp] = useState<OpponentKind>('all');
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<PlayerMdOutput | null>(null);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const run = useRef(0);
  const abort = useRef({ aborted: false });
  useEffect(() => { dialog.current?.showModal(); }, []);
  // 選び直したら、前に作った内容は古いので消す
  useEffect(() => { run.current++; abort.current.aborted = true; setOutput(null); setError(''); setNotice(''); setBusy(false); setProgress(''); }, [term, opp, compare, season, playerId, league]);
  useEffect(() => { if (league === 'one' && term === 'threeTerms') setTerm('season'); }, [league, term]);

  const cancel = () => { run.current++; abort.current.aborted = true; setBusy(false); setProgress(''); setNotice('中止しました。'); };
  const create = async () => {
    const id = ++run.current;
    abort.current.aborted = true;
    const signal = { aborted: false };
    abort.current = signal;
    setBusy(true); setError(''); setOutput(null); setNotice(''); setProgress('');
    let timeout = 0;
    const arm = () => { window.clearTimeout(timeout); timeout = window.setTimeout(() => { if (run.current === id) { run.current++; signal.aborted = true; setBusy(false); setProgress(''); setError('読み込みに時間がかかっています。もう一度お試しください。'); } }, 60_000); };
    arm();
    try {
      const input = await loadPlayerExport(season, playerId, { league, term, opp, compare }, undefined, undefined, { signal, onProgress: t => { arm(); if (run.current === id) setProgress(t); } });
      const out = buildPlayerExport(input);
      if (run.current === id) setOutput(out);
    } catch (e) {
      if (run.current === id && !signal.aborted) setError(e instanceof Error && e.message ? `書き出せませんでした。完成版としてコピー・保存できません。${e.message}` : '書き出せませんでした。完成版としてコピー・保存できません。時間をおいて、もう一度お試しください。');
    } finally { window.clearTimeout(timeout); if (run.current === id) { setBusy(false); setProgress(''); } }
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
  return <dialog ref={dialog} className="ai-export-dialog" aria-labelledby="ai-player-export-title" onClose={close}>
    <div className="ai-export-heading"><h2 id="ai-player-export-title">AI向けに選手のデータを書き出す</h2><button type="button" onClick={() => dialog.current?.close()}>閉じる</button></div>
    <div className="ai-detailed">
      <p>対象：{LEAGUE_LABELS[league]}・{season}シーズン・レギュラーシーズン。基本情報・シーズン成績・リーグ内の順位・シュート・時間帯・チームへの影響・条件別・試合ログ・通算と記録を、AIに渡しやすい形の表で書き出します（「書き出しを作る」を押すと作ります。リーグ全体の記録を読むため、パソコンで数秒、スマホでは30秒ほどかかることがあります）。</p>
      {league === 'one' && <p className="ai-detailed-hint">B.ONE にはスポーツナビの記録が無いため、シュートタイプとシュートタイプ別の順位は出ません（書き出しにも理由を書きます）。</p>}
      <fieldset className="ai-detailed-group"><legend>ターム</legend>
        {TERM_CHOICES.map(c => { const oneNo = league === 'one' && c.kind === 'threeTerms'; return <label key={c.kind}><input type="radio" name="ai-player-term" disabled={!c.available || oneNo} checked={term === c.kind} onChange={() => setTerm(c.kind)} />{c.label}</label>; })}
        {league === 'one' && <p className="ai-detailed-hint">{ONE_THREE_TERMS_REASON}</p>}
        {TERM_HINTS[term] && <p className="ai-detailed-hint">{TERM_HINTS[term]}</p>}
      </fieldset>
      <fieldset className="ai-detailed-group"><legend>対戦相手</legend>
        {OPP_CHOICES.map(o => <label key={o}><input type="radio" name="ai-player-opp" checked={opp === o} onChange={() => setOpp(o)} />{OPPONENT_KIND_LABELS[o]}</label>)}
        {opp === 'atLeast60' && <p className="ai-detailed-hint">その試合に入る時点の相手の勝率が6割以上の試合だけを使います（相手が5試合未満の試合は外します）。リーグ内の順位の章は、条件にかかわらずシーズン全体です。</p>}
      </fieldset>
      <fieldset className="ai-detailed-group"><legend>前季との比較</legend>
        <label><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />前季全体と比べる</label>
        {compare && <p className="ai-detailed-hint">比べる相手は、どの対象期間のときも前のシーズンのレギュラーシーズン全体です。シーズン成績・リーグ内の順位・シュート・時間帯・On/Off に、前季全体の値と差を足します。前季に出場していない、または別のリーグにいた場合は「前季なし」と理由を書きます。前季の記録も読むので、時間が少し長くなります。</p>}
      </fieldset>
      <div className="ai-export-actions">
        <button type="button" disabled={busy} onClick={create}>{busy ? '作っています…' : '書き出しを作る'}</button>
        {busy && <button type="button" onClick={cancel}>中止</button>}
        <button type="button" disabled={!output} onClick={copy}>コピー</button>
        <button type="button" disabled={!output} onClick={save}>Markdownで保存</button>
        <button type="button" disabled={!output} onClick={selectAll}>全文を選択</button>
        {output && <span>{output.characters.toLocaleString('ja-JP')}文字{output.empty ? '（当てはまる試合なし）' : ''}</span>}
      </div>
      {busy && progress && <p role="status">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      <p className="ai-export-notice" role="status">{notice}</p>
      {output && <label className="ai-export-preview">Markdownプレビュー（コピー・保存される全文）
        <textarea ref={text} readOnly wrap="off" value={output.markdown} spellCheck={false} aria-label="書き出すMarkdown全文" />
      </label>}
    </div>
  </dialog>;
}
