import { useEffect, useMemo, useState } from 'react';
import { FIGURES } from './catalog';
import {
  applyPresetParams, deletePreset, loadPresets, PRESET_NAME_MAX, PRESET_STORAGE_KEY, presetMatches, presetQuery, presetStorageAvailable, presetUrl,
  migrateLegacyPreset, renamePreset, savePresets, upsertPreset, type FigurePreset,
} from '../lib/figurePresets';
import { builtinPresetParams, PLAYER_SCATTER_BUILTIN_PRESETS, PLAYER_SCATTER_ID } from '../lib/figurePlayerLegacy';
import './FigurePresets.css';

type Editing = null | { kind: 'save' | 'rename'; name: string } | { kind: 'delete' };

/** 図の設定の保存・選択・名前の変更・削除・URL のコピー。保存先はこのブラウザ（localStorage）。1つの一覧に、図をまたいでまとめる */
export function FigurePresets({ entity, figureId, params, onApply }: {
  entity: 'team' | 'player'; figureId: string; params: URLSearchParams; onApply: (next: URLSearchParams) => void;
}) {
  const [available, setAvailable] = useState(false);
  const [presets, setPresets] = useState<FigurePreset[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState<Editing>(null);
  const [message, setMessage] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  useEffect(() => {
    setAvailable(presetStorageAvailable());
    setPresets(loadPresets());
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === PRESET_STORAGE_KEY) setPresets(loadPresets()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const figureLabel = (e: string, id: string) => FIGURES.find(f => f.entity === e && f.id === id)?.label;
  const listed = useMemo(() => presets.map(migrateLegacyPreset).filter(p => figureLabel(p.entity, p.figure)), [presets]);
  // 選手の散布図には、保存した設定とは別に「用意された設定」（名前の変更・削除はできない）
  const builtins = entity === 'player' && figureId === PLAYER_SCATTER_ID ? PLAYER_SCATTER_BUILTIN_PRESETS : [];
  const groups = useMemo(() => {
    const map = new Map<string, FigurePreset[]>();
    for (const p of listed) { const key = `${p.entity === 'team' ? 'チーム' : '選手'}｜${figureLabel(p.entity, p.figure)}`; map.set(key, [...(map.get(key) ?? []), p]); }
    return [...map.entries()];
  }, [listed]);
  const selected = listed.find(p => p.id === selectedId);
  const current = presetQuery(params);
  const persist = (next: FigurePreset[]) => {
    if (!savePresets(next)) { setAvailable(false); setMessage('保存できませんでした。このブラウザでは保存を使えません。'); return false; }
    setPresets(next);
    return true;
  };
  const submitName = () => {
    if (!editing || editing.kind === 'delete') return;
    const name = editing.name.trim();
    if (!name) { setMessage('名前を入力してください。'); return; }
    if (editing.kind === 'save') {
      const { list, saved } = upsertPreset(presets, { name, entity, figure: figureId, query: current });
      if (persist(list)) { setSelectedId(saved.id); setMessage(`「${saved.name}」を保存しました。`); setEditing(null); }
    } else if (selected && persist(renamePreset(presets, selected.id, name))) { setMessage('名前を変更しました。'); setEditing(null); }
  };
  const remove = () => {
    if (!selected) return;
    if (persist(deletePreset(presets, selected.id))) { setMessage(`「${selected.name}」を削除しました。`); setSelectedId(''); setEditing(null); }
  };
  const copy = async () => {
    if (!selected) return;
    const url = presetUrl(window.location.href, selected, params);
    try { await navigator.clipboard.writeText(url); setManualUrl(''); setMessage('URLをコピーしました。'); }
    catch { setManualUrl(url); setMessage('コピーできませんでした。下のURLを選んでコピーしてください。'); }
  };
  const matched = selected && presetMatches(selected, entity, figureId, params);
  return <div className="figure-presets" role="group" aria-label="図の設定の保存">
    {builtins.length > 0 && <div className="figure-presets-row">
      <label className="figure-presets-field">用意された設定
        <select value="" onChange={e => {
          const q = builtinPresetParams(e.target.value);
          if (!q) return;
          setSelectedId(''); setEditing(null); setMessage('');
          const next = new URLSearchParams(q);
          for (const key of ['season', 'league']) { const v = params.get(key); if (v !== null) next.set(key, v); }
          onApply(next);
        }}>
          <option value="">選んでください</option>
          {builtins.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      </label>
    </div>}
    <div className="figure-presets-row">
      <label className="figure-presets-field">保存した設定
        <select value={selected?.id ?? ''} disabled={!listed.length} title={available ? undefined : 'このブラウザでは保存を使えません'}
          onChange={e => { const p = listed.find(x => x.id === e.target.value); setSelectedId(e.target.value); setEditing(null); setMessage(''); if (p) onApply(applyPresetParams(params, p)); }}>
          <option value="">{listed.length ? '選んでください' : available ? 'まだありません' : '使えません'}</option>
          {groups.map(([group, items]) => <optgroup key={group} label={group}>{items.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</optgroup>)}
        </select>
      </label>
      <div className="figure-presets-buttons">
        <button type="button" disabled={!available} title={available ? undefined : 'このブラウザでは保存できません'} onClick={() => { setMessage(''); setEditing({ kind: 'save', name: '' }); }}>いまの設定を保存</button>
        <button type="button" disabled={!selected} onClick={() => { setMessage(''); setEditing({ kind: 'rename', name: selected?.name ?? '' }); }}>名前を変更</button>
        <button type="button" disabled={!selected} onClick={() => { setMessage(''); setEditing({ kind: 'delete' }); }}>削除</button>
        <button type="button" disabled={!selected} onClick={copy}>URLをコピー</button>
      </div>
    </div>
    {editing && editing.kind !== 'delete' && <form className="figure-presets-edit" onSubmit={e => { e.preventDefault(); submitName(); }}>
      <label>名前<input type="text" value={editing.name} maxLength={PRESET_NAME_MAX} autoFocus onChange={e => setEditing({ ...editing, name: e.target.value })} /></label>
      <button type="submit">{editing.kind === 'save' ? '保存する' : '変更する'}</button>
      <button type="button" onClick={() => setEditing(null)}>やめる</button>
    </form>}
    {editing?.kind === 'delete' && selected && <div className="figure-presets-edit">
      <span>「{selected.name}」を削除しますか？</span>
      <button type="button" onClick={remove}>削除する</button>
      <button type="button" onClick={() => setEditing(null)}>やめる</button>
    </div>}
    {manualUrl && <input className="figure-presets-url" readOnly value={manualUrl} aria-label="コピーするURL" onFocus={e => e.currentTarget.select()} />}
    {(message || (selected && !matched)) && <p className="figure-presets-message" role="status">{message || '選んだ設定から変更しています。'}</p>}
  </div>;
}
