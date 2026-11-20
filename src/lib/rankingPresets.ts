// 画面専用（ランキングの「検索条件の保存」。設計書435章）。ランキングの URL の条件（項目・シーズン・区分・Q別・クラッチ・スタメン／ベンチ・掲載基準・並び順など）
// に名前を付けて、このブラウザの localStorage に保存する。図解の「図の設定」（figurePresets.ts）と同じ形で、保存先は別。
// 保存する中身は URL の条件と同じ文字列（読めない項目は画面が無視するので、条件が増えても古い保存が開ける）。読み書きはすべて失敗しうるので例外は外に出さない。
export const RANKING_PRESET_STORAGE_KEY = "bleague-stats:ranking-presets";
export const RANKING_PRESET_NAME_MAX = 40;
/** 保存の対象外にする URL のキー（画面の確認用の記録） */
const EXCLUDED_KEYS = ["debug", "exp"] as const;

export interface RankingPreset {
  id: string;
  name: string;
  query: string;
  savedAt: number;
}
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const defaultStorage = (): PresetStorage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** 条件を、キー順に並べた文字列にする（同じ条件なら同じ文字列） */
export function rankingPresetQuery(params: URLSearchParams): string {
  const entries = [...params.entries()].filter(([k]) => !(EXCLUDED_KEYS as readonly string[]).includes(k));
  entries.sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : av > bv ? 1 : 0) : a < b ? -1 : 1));
  return new URLSearchParams(entries).toString();
}

export function parseRankingPresets(raw: string | null): RankingPreset[] {
  if (!raw) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  const items = (data as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  const out: RankingPreset[] = [];
  for (const item of items) {
    const p = item as Partial<RankingPreset> | null;
    if (!p || typeof p.id !== "string" || typeof p.name !== "string" || typeof p.query !== "string") continue;
    if (!p.name.trim() || out.some((o) => o.id === p.id)) continue;
    out.push({ id: p.id, name: p.name.slice(0, RANKING_PRESET_NAME_MAX), query: rankingPresetQuery(new URLSearchParams(p.query)), savedAt: typeof p.savedAt === "number" ? p.savedAt : 0 });
  }
  return out;
}
export function loadRankingPresets(storage: PresetStorage | null = defaultStorage()): RankingPreset[] {
  try {
    return parseRankingPresets(storage?.getItem(RANKING_PRESET_STORAGE_KEY) ?? null);
  } catch {
    return [];
  }
}
/** 保存できたか */
export function saveRankingPresets(presets: readonly RankingPreset[], storage: PresetStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(RANKING_PRESET_STORAGE_KEY, JSON.stringify({ v: 1, items: presets }));
    return true;
  } catch {
    return false;
  }
}
/** このブラウザに保存できるか（書き込みを試す） */
export function rankingPresetStorageAvailable(storage: PresetStorage | null = defaultStorage()): boolean {
  try {
    if (!storage) return false;
    const key = `${RANKING_PRESET_STORAGE_KEY}:test`;
    storage.setItem(key, "1");
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export const newRankingPresetId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 同じ名前なら上書き、なければ追加 */
export function upsertRankingPreset(list: readonly RankingPreset[], input: { name: string; query: string }, now = Date.now(), id = newRankingPresetId()): { list: RankingPreset[]; saved: RankingPreset } {
  const name = input.name.trim().slice(0, RANKING_PRESET_NAME_MAX);
  const same = list.find((p) => p.name === name);
  const saved: RankingPreset = { id: same?.id ?? id, name, query: input.query, savedAt: now };
  return { list: same ? list.map((p) => (p.id === same.id ? saved : p)) : [...list, saved], saved };
}
export const renameRankingPreset = (list: readonly RankingPreset[], id: string, name: string): RankingPreset[] =>
  list.map((p) => (p.id === id ? { ...p, name: name.trim().slice(0, RANKING_PRESET_NAME_MAX) } : p));
export const deleteRankingPreset = (list: readonly RankingPreset[], id: string): RankingPreset[] => list.filter((p) => p.id !== id);

/** 別の端末で開ける URL */
export function rankingPresetUrl(baseHref: string, pathname: string, preset: RankingPreset): string {
  const base = baseHref.split("#")[0]!;
  return `${base}#${pathname}${preset.query ? `?${preset.query}` : ""}`;
}
/** 今の条件が、保存した条件と同じか */
export const rankingPresetMatches = (preset: RankingPreset, params: URLSearchParams) => preset.query === rankingPresetQuery(params);
