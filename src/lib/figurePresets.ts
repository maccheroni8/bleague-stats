// 画面専用（図解の「設定の保存」）。図の設定（URL の条件）に名前を付けて、このブラウザの localStorage に保存する。
// 保存する中身は URL の条件と同じ文字列（season・league・entity・figure は含めない）。読めない項目は図が無視するので、図の設定が増えても古い保存が開ける。
// 読み書きはすべて失敗しうる（プライベートモードなど）ので、例外は外に出さない。
import { isLegacyPlayerScatterFigure, legacyPlayerScatterParams, PLAYER_SCATTER_ID } from './figurePlayerLegacy';

export const PRESET_STORAGE_KEY = 'bleague-stats:figure-presets';
export const PRESET_NAME_MAX = 40;
/** 保存の対象外にする URL のキー（シーズン・リーグは今開いているものを使う） */
export const PRESET_GLOBAL_KEYS = ['season', 'league', 'entity', 'figure'] as const;

export interface FigurePreset { id: string; name: string; entity: 'team' | 'player'; figure: string; query: string; savedAt: number }
export interface PresetStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }

const defaultStorage = (): PresetStorage | null => { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } };

/** 図の条件だけを、キー順に並べた文字列にする（同じ設定なら同じ文字列） */
export function presetQuery(params: URLSearchParams): string {
  const entries = [...params.entries()].filter(([k]) => !(PRESET_GLOBAL_KEYS as readonly string[]).includes(k));
  entries.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  return new URLSearchParams(entries).toString();
}

/** 保存された文字列を読む。壊れた項目・知らない形は捨てる（全体が壊れていれば空） */
export function parsePresets(raw: string | null): FigurePreset[] {
  if (!raw) return [];
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return []; }
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: FigurePreset[] = [];
  for (const item of items) {
    const p = item as Partial<FigurePreset> | null;
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || typeof p.figure !== 'string' || typeof p.query !== 'string') continue;
    if (p.entity !== 'team' && p.entity !== 'player') continue;
    if (!p.name.trim() || out.some(o => o.id === p.id)) continue;
    out.push({ id: p.id, name: p.name.slice(0, PRESET_NAME_MAX), entity: p.entity, figure: p.figure, query: presetQuery(new URLSearchParams(p.query)), savedAt: typeof p.savedAt === 'number' ? p.savedAt : 0 });
  }
  return out;
}
export function loadPresets(storage: PresetStorage | null = defaultStorage()): FigurePreset[] {
  try { return parsePresets(storage?.getItem(PRESET_STORAGE_KEY) ?? null); } catch { return []; }
}
/** 保存できたか */
export function savePresets(presets: readonly FigurePreset[], storage: PresetStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(PRESET_STORAGE_KEY, JSON.stringify({ v: 1, items: presets }));
    return true;
  } catch { return false; }
}
/** このブラウザに保存できるか（書き込みを試す） */
export function presetStorageAvailable(storage: PresetStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    const key = `${PRESET_STORAGE_KEY}:test`;
    storage.setItem(key, '1');
    storage.removeItem(key);
    return true;
  } catch { return false; }
}

export const newPresetId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 同じ図・同じ名前なら上書き、なければ追加 */
export function upsertPreset(list: readonly FigurePreset[], input: { name: string; entity: 'team' | 'player'; figure: string; query: string }, now = Date.now(), id = newPresetId()): { list: FigurePreset[]; saved: FigurePreset } {
  const name = input.name.trim().slice(0, PRESET_NAME_MAX);
  const same = list.find(p => p.figure === input.figure && p.entity === input.entity && p.name === name);
  const saved: FigurePreset = { id: same?.id ?? id, name, entity: input.entity, figure: input.figure, query: input.query, savedAt: now };
  return { list: same ? list.map(p => (p.id === same.id ? saved : p)) : [...list, saved], saved };
}
export const renamePreset = (list: readonly FigurePreset[], id: string, name: string): FigurePreset[] =>
  list.map(p => (p.id === id ? { ...p, name: name.trim().slice(0, PRESET_NAME_MAX) } : p));
export const deletePreset = (list: readonly FigurePreset[], id: string): FigurePreset[] => list.filter(p => p.id !== id);

/** 選んだ設定を開くための URL の条件（シーズン・リーグは今のものを残す） */
export function applyPresetParams(current: URLSearchParams, preset: FigurePreset): URLSearchParams {
  const next = new URLSearchParams(preset.query);
  for (const key of ['season', 'league']) { const v = current.get(key); if (v !== null) next.set(key, v); }
  next.set('entity', preset.entity);
  next.set('figure', preset.figure);
  return next;
}
/** 別の端末で開ける URL（今のシーズン・リーグ付き） */
export function presetUrl(baseHref: string, preset: FigurePreset, current: URLSearchParams): string {
  const base = baseHref.split('#')[0]!;
  return `${base}#/figures?${applyPresetParams(current, preset).toString()}`;
}
/** 今の設定が、保存した設定と同じか */
export const presetMatches = (preset: FigurePreset, entity: string, figure: string, params: URLSearchParams) =>
  preset.entity === entity && preset.figure === figure && preset.query === presetQuery(params);

/** 選手の散布図に置き換えた3つの図（得点 × アシスト・USG% × PPP・シュート% × 試投数）で保存した設定は、選手の散布図の設定として扱う（保存済みの文字列は書き換えない） */
export function migrateLegacyPreset(preset: FigurePreset): FigurePreset {
  if (preset.entity !== 'player' || !isLegacyPlayerScatterFigure(preset.figure)) return preset;
  const converted = legacyPlayerScatterParams(preset.figure, new URLSearchParams(preset.query));
  return converted ? { ...preset, figure: PLAYER_SCATTER_ID, query: presetQuery(converted) } : preset;
}
