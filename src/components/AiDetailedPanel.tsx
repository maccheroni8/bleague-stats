import { useEffect, useRef, useState } from 'react';
import { buildDetailedExport, type DetailedKind, type DetailedOutput } from '../lib/aiDetailedExport';
import { loadDetailedExport } from '../lib/aiDetailedExportLoad';
import { OPPONENT_KIND_LABELS, ONE_THREE_TERMS_REASON, TERM_CHOICES, TIME_SLICE_CHOICES, type OpponentKind, type TermKind } from '../lib/aiExportScope';
import { LEAGUE_LABELS, type League } from '../lib/league';

const KIND_CHOICES: { key: DetailedKind; label: string }[] = [{ key: 'team', label: 'チーム情報' }, { key: 'player', label: '選手情報' }];
const OPP_CHOICES: OpponentKind[] = ['all', 'atLeast60'];
const TERM_HINTS: Partial<Record<TermKind, string>> = {
  threeTerms: 'リーグ共通の中断期間（11月と2月ごろ）で、開幕〜11月の中断／中断明け〜2月の中断／2月の中断明け〜の3つに分けます。チーム情報では最後にシーズン全体の列も付きます。分けられないシーズンは理由を出します。',
  halves: '各チームの試合数の半分で前半戦・後半戦に分けます（奇数は前半戦が1試合多い）。進行中のシーズンは30試合目までを前半戦にします。',
};

/** 「詳しい版」の選ぶ画面と書き出し。選ぶのは 種類 → ターム → 時間帯 → 対戦相手 → 前季比較（チーム情報のときだけ）。 */
export function AiDetailedPanel({ season, teamId, league }: { season: string; teamId: string; league: League }) {
  const text = useRef<HTMLTextAreaElement>(null);
  const [kind, setKind] = useState<DetailedKind>('team');
  const [term, setTerm] = useState<TermKind>('season');
  const [timeSlice, setTimeSlice] = useState('game');
  const [opp, setOpp] = useState<OpponentKind>('all');
  const [compare, setCompare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [output, setOutput] = useState<DetailedOutput | null>(null);
  const [notice, setNotice] = useState('');
  const [progress, setProgress] = useState('');
  const run = useRef(0);
  const abort = useRef({ aborted: false });
  // 選び直したら、前に作った内容は古いので消す（選んだ条件と違う内容をコピー・保存させない）
  useEffect(() => { run.current++; abort.current.aborted = true; setOutput(null); setError(''); setNotice(''); setBusy(false); setProgress(''); }, [kind, term, timeSlice, opp, compare, season, teamId, league]);
  // B.ONE では3タームを選べない（選んだままリーグが変わったときは1シーズンに戻す）
  useEffect(() => { if (league === 'one' && term === 'threeTerms') setTerm('season'); }, [league, term]);

  const cancel = () => { run.current++; abort.current.aborted = true; setBusy(false); setProgress(''); setNotice('中止しました。'); };
  const create = async () => {
    const id = ++run.current;
    abort.current.aborted = true;
    const signal = { aborted: false };
    abort.current = signal;
    setBusy(true); setError(''); setOutput(null); setNotice(''); setProgress('');
    // 読み込みが進んでいる間は待つ。45秒間まったく進まなければ止める
    let timeout = 0;
    const arm = () => { window.clearTimeout(timeout); timeout = window.setTimeout(() => { if (run.current === id) { run.current++; signal.aborted = true; setBusy(false); setProgress(''); setError('読み込みに時間がかかっています。もう一度お試しください。'); } }, 45_000); };
    arm();
    try {
      const input = await loadDetailedExport(season, teamId, { league, kind, term, opp, timeSlice, compare: kind === 'team' && compare }, undefined, undefined, {
        signal,
        onProgress: (done, total) => { arm(); if (run.current === id) setProgress(total ? `スポーツナビの記録を読み込んでいます… ${done}／${total}試合` : ''); },
      });
      const out = buildDetailedExport(input);
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
  return <div className="ai-detailed">
    <p>対象：{LEAGUE_LABELS[league]}・{season}シーズン・レギュラーシーズン。選んだ条件で、AIに渡しやすい形の表を書き出します（下の「書き出しを作る」を押すと作ります。チーム情報は全チームの記録を読むので、少し時間がかかります。ターム・対戦相手の条件によっては、スポーツナビの記録も多く読むため、さらに時間がかかります）。</p>
    {league === 'one' && <p className="ai-detailed-hint">B.ONE にはスポーツナビの記録が無いため、Shooting・Forced TOV の表は出ません（書き出しにも理由を書きます）。</p>}
    <fieldset className="ai-detailed-group"><legend>種類</legend>
      {KIND_CHOICES.map(c => <label key={c.key}><input type="radio" name="ai-detailed-kind" checked={kind === c.key} onChange={() => setKind(c.key)} />{c.label}</label>)}
    </fieldset>
    <fieldset className="ai-detailed-group"><legend>ターム</legend>
      {TERM_CHOICES.map(c => { const oneNo = league === 'one' && c.kind === 'threeTerms'; return <label key={c.kind}><input type="radio" name="ai-detailed-term" disabled={!c.available || oneNo} checked={term === c.kind} onChange={() => setTerm(c.kind)} />{c.label}{!c.available ? '（準備中）' : oneNo ? '（選べません）' : ''}</label>; })}
      {league === 'one' && <p className="ai-detailed-hint">{ONE_THREE_TERMS_REASON}</p>}
      {TERM_HINTS[term] && <p className="ai-detailed-hint">{TERM_HINTS[term]}</p>}
    </fieldset>
    <fieldset className="ai-detailed-group"><legend>時間帯</legend>
      {TIME_SLICE_CHOICES.map(c => { const ok = c.available(season); return <label key={c.key}><input type="radio" name="ai-detailed-slice" disabled={!ok} checked={timeSlice === c.key} onChange={() => setTimeSlice(c.key)} />{c.label}{ok ? '' : '（準備中）'}</label>; })}
    </fieldset>
    <fieldset className="ai-detailed-group"><legend>対戦相手</legend>
      {OPP_CHOICES.map(o => <label key={o}><input type="radio" name="ai-detailed-opp" checked={opp === o} onChange={() => setOpp(o)} />{OPPONENT_KIND_LABELS[o]}</label>)}
      {opp === 'atLeast60' && <p className="ai-detailed-hint">その試合に入る時点の相手の勝率が6割以上の試合だけを使います（相手が5試合未満の試合は外します）。{term === 'recent5' ? '直近5試合は、該当する試合の中の最後の5試合です。' : ''}</p>}
    </fieldset>
    {kind === 'team' && <fieldset className="ai-detailed-group"><legend>前季比較</legend>
      <label><input type="checkbox" checked={compare} onChange={e => setCompare(e.target.checked)} />前季全体と比べる（チームのまとめだけ）</label>
    </fieldset>}
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
  </div>;
}
