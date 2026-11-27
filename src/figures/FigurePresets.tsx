import { useEffect, useId, useMemo, useState } from 'react';
import { FIGURES } from './catalog';
import {
  applyPresetParams, deletePreset, loadPresets, PRESET_NAME_MAX, PRESET_STORAGE_KEY, presetMatches, presetQuery, presetStorageAvailable, presetUrl,
  migrateLegacyPreset, renamePreset, savePresets, upsertPreset, type FigurePreset,
} from '../lib/figurePresets';
import './FigurePresets.css';

/** 一覧の1行の操作中の状態（名前の変更・削除の確認）。削除は「削除する／やめる」を選ぶまで消さない */
type RowEdit = { id: string; kind: 'rename'; name: string } | { id: string; kind: 'delete' };

/**
 * 図の設定の保存（ボタン1つ。押すと開く）。中に「いまの設定を名前を付けて保存」・保存した設定の一覧（押すとその設定で開く。
 * 名前の変更・削除・URL のコピーは各行から）をまとめる。保存先はこのブラウザ（localStorage）。1つの一覧に、図をまたいでまとめる
 */
export function FigurePresets({ entity, figureId, params, onApply }: {
  entity: 'team' | 'player'; figureId: string; params: URLSearchParams; onApply: (next: URLSearchParams) => void;
}) {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState(false);
  const [presets, setPresets] = useState<FigurePreset[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [rowEdit, setRowEdit] = useState<RowEdit | null>(null);
  const [message, setMessage] = useState('');
  const [manualUrl, setManualUrl] = useState('');
  const panelId = useId();
  useEffect(() => {
    setAvailable(presetStorageAvailable());
    setPresets(loadPresets());
    const onStorage = (e: StorageEvent) => { if (e.key === null || e.key === PRESET_STORAGE_KEY) setPresets(loadPresets()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  /** いま表示している図のタイトル（図の見出し。保存の名前の最初の値。無ければ空） */
  const currentTitle = () => (document.querySelector('#figure-active-panel .condition-title > h2.export-hide')?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, PRESET_NAME_MAX);
  const figureLabel = (e: string, id: string) => FIGURES.find(f => f.entity === e && f.id === id)?.label;
  const listed = useMemo(() => presets.map(migrateLegacyPreset).filter(p => figureLabel(p.entity, p.figure)), [presets]);
  const groups = useMemo(() => {
    const map = new Map<string, FigurePreset[]>();
    for (const p of listed) { const key = `${p.entity === 'team' ? 'チーム' : '選手'}｜${figureLabel(p.entity, p.figure)}`; map.set(key, [...(map.get(key) ?? []), p]); }
    return [...map.entries()];
  }, [listed]);
  const current = presetQuery(params);
  const persist = (next: FigurePreset[]) => {
    if (!savePresets(next)) { setAvailable(false); setMessage('保存できませんでした。このブラウザでは保存を使えません。'); return false; }
    setPresets(next);
    return true;
  };
  const submitSave = () => {
    if (saving === null) return;
    const name = saving.trim();
    if (!name) { setMessage('名前を入力してください。'); return; }
    const { list, saved } = upsertPreset(presets, { name, entity, figure: figureId, query: current });
    if (persist(list)) { setMessage(`「${saved.name}」を保存しました。`); setSaving(null); }
  };
  const submitRename = () => {
    if (rowEdit?.kind !== 'rename') return;
    const name = rowEdit.name.trim();
    if (!name) { setMessage('名前を入力してください。'); return; }
    if (persist(renamePreset(presets, rowEdit.id, name))) { setMessage('名前を変更しました。'); setRowEdit(null); }
  };
  const remove = (p: FigurePreset) => {
    if (persist(deletePreset(presets, p.id))) { setMessage(`「${p.name}」を削除しました。`); setRowEdit(null); }
  };
  const copy = async (p: FigurePreset) => {
    const url = presetUrl(window.location.href, p, params);
    try { await navigator.clipboard.writeText(url); setManualUrl(''); setMessage('URLをコピーしました。'); }
    catch { setManualUrl(url); setMessage('コピーできませんでした。下のURLを選んでコピーしてください。'); }
  };
  // 保存した設定を選んだら、開いている「図の設定」の欄は閉じる（チーム・選手とも全部の図で共通。DESIGN.md 475章）
  const apply = (p: FigurePreset) => { setRowEdit(null); setMessage(''); setSaving(null); setManualUrl(''); onApply(applyPresetParams(params, p)); setOpen(false); };
  return <div className="figure-presets" role="group" aria-label="図の設定の保存">
    <button type="button" className="figure-presets-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(v => !v)}>
      図の設定<span aria-hidden="true">{open ? '▴' : '▾'}</span>
    </button>
    {open && <div className="figure-presets-panel" id={panelId}>
      {saving === null
        ? <button type="button" className="figure-presets-save" disabled={!available} title={available ? undefined : 'このブラウザでは保存できません'} onClick={() => { setMessage(''); setSaving(currentTitle()); }}>いまの設定を保存</button>
        : <form className="figure-presets-edit" onSubmit={e => { e.preventDefault(); submitSave(); }}>
          <label>名前<input type="text" value={saving} maxLength={PRESET_NAME_MAX} autoFocus onChange={e => setSaving(e.target.value)} /></label>
          <button type="submit">保存する</button>
          <button type="button" onClick={() => setSaving(null)}>やめる</button>
        </form>}
      {listed.length === 0
        ? <p className="figure-presets-empty">{available ? '保存した設定はまだありません。' : 'このブラウザでは保存を使えません。'}</p>
        : groups.map(([group, items]) => <div key={group} className="figure-presets-group">
          <p className="figure-presets-group-label">{group}</p>
          <ul className="figure-presets-list">
            {items.map(p => {
              const edit = rowEdit?.id === p.id ? rowEdit : null;
              const matched = presetMatches(p, entity, figureId, params);
              return <li key={p.id} className="figure-presets-item">
                {edit?.kind === 'rename'
                  ? <form className="figure-presets-edit" onSubmit={e => { e.preventDefault(); submitRename(); }}>
                    <label>名前<input type="text" value={edit.name} maxLength={PRESET_NAME_MAX} autoFocus onChange={e => setRowEdit({ ...edit, name: e.target.value })} /></label>
                    <button type="submit">変更する</button>
                    <button type="button" onClick={() => setRowEdit(null)}>やめる</button>
                  </form>
                  : edit?.kind === 'delete'
                    ? <div className="figure-presets-edit">
                      <span>「{p.name}」を削除しますか？</span>
                      <button type="button" className="figure-presets-danger" onClick={() => remove(p)}>削除する</button>
                      <button type="button" onClick={() => setRowEdit(null)}>やめる</button>
                    </div>
                    : <>
                      <button type="button" className={`figure-presets-apply${matched ? ' active' : ''}`} aria-pressed={matched} onClick={() => apply(p)}>{p.name}</button>
                      <span className="figure-presets-actions">
                        <button type="button" onClick={() => { setMessage(''); setRowEdit({ id: p.id, kind: 'rename', name: p.name }); }}>名前を変更</button>
                        <button type="button" onClick={() => copy(p)}>URLをコピー</button>
                        <button type="button" onClick={() => { setMessage(''); setRowEdit({ id: p.id, kind: 'delete' }); }}>削除</button>
                      </span>
                    </>}
              </li>;
            })}
          </ul>
        </div>)}
      {manualUrl && <input className="figure-presets-url" readOnly value={manualUrl} aria-label="コピーするURL" onFocus={e => e.currentTarget.select()} />}
      {message && <p className="figure-presets-message" role="status">{message}</p>}
    </div>}
  </div>;
}
