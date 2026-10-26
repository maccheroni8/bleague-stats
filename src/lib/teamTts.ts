// Time to Shot（攻撃が始まってから最初のFGの試投までの秒数）の、全チームスタッツ・チーム詳細の集計（DESIGN.md Time to Shot の章）。
// 導出データ（data/{season}/team-tts.json。形式は shared/ttsIndex.ts）から、絞り込み済みの試合ログの合計を出す。
// - 平均＝秒数の合計 ÷ 本数、割合＝その分類の本数 ÷ 計測できた FG の総数。区間（前後半など）は秒数の合計と本数を足してから割る
// - 視点: own＝自チーム、opp＝同じ試合の相手のシュート、diff＝自チーム−opp（割合はポイントの差）
// - 2020-21 より前は導出データが無い（null）。画面は「-」にして理由を注記する
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { leagueCacheKey, type League } from "./league";
import { useEffect, useState } from "react";
import { TTS_ATOMS, TTS_FIRST_SEASON, TTS_INDEX_CATEGORIES, TTS_INDEX_VERSION, ttsExcludedKey, ttsKey, type TtsIndexCategory, type TtsIndexFile } from "../../shared/ttsIndex";
import type { TeamGameLog } from "../../shared/types";
import { fetchTeamTtsIndex } from "./data";
import { loadTeamGameIndex } from "./gameIndexLoad";
import { PERIOD_ATOM_INDEXES, type GameRecordPeriod } from "./periodIndex";

/** カテゴリタブの名前（CATEGORY_LABELS は保存キーの対象のファイルなので、ここに置く） */
export const TTS_CATEGORY_LABEL = "Time to Shot";

export type TtsPeriodValue = GameRecordPeriod;
export type TtsPerspective = "own" | "opp" | "diff";

/** 画面に出す項目（キー）。all＝全シュート、first＝初回全体（その他を含む）。ほかは分類の本数 */
export const TTS_ITEMS = ["all", "first", "score", "deadTo", "dreb", "steal", "quarter", "oreb"] as const;
export type TtsItem = (typeof TTS_ITEMS)[number];

export interface TtsSource {
  season: string;
  file: TtsIndexFile;
  /** scheduleKey → 試合の番号（チームの行の位置は 番号×2＋〔ホーム 0／アウェイ 1〕） */
  gameNo: Map<string, number>;
}

/** そのシーズンに導出データがあるか（2020-21 以降） */
export function ttsSeasonSupported(season: string): boolean {
  return season >= TTS_FIRST_SEASON;
}

const cache = new Map<string, Promise<TtsSource | null>>();

/** 1シーズン分を読む。無い・版や行数が合わないときは null。失敗は持たず、次の呼び出しでやり直す */
export function loadTtsSource(season: string, league: League = "premier"): Promise<TtsSource | null> {
  if (!ttsSeasonSupported(season)) return Promise.resolve(null);
  const key = leagueCacheKey(season, league);
  let p = cache.get(key);
  if (!p) {
    p = (async () => {
      const [team, file] = await Promise.all([loadTeamGameIndex(season, league), fetchTeamTtsIndex(season, league)]);
      if (!team || !file || file.version !== TTS_INDEX_VERSION || file.indexRows !== team.size) return null;
      const gameNo = new Map<string, number>(team.file.games.key.map((k, i) => [k, i]));
      return { season, file, gameNo };
    })();
    p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
    cache.set(key, p);
  }
  return p;
}

/** 有効なときだけ読む。source は読めたもの（読めなかったら null）、loading は読み込み中、retry() で読み直す */
export function useTtsSource(season: string, enabled: boolean, league: League = "premier"): { source: TtsSource | null; loading: boolean; retry: () => void } {
  const [state, setState] = useState<{ season: string; nonce: number; source: TtsSource | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadTtsSource(season, league).then(
      (source) => alive && setState({ season, nonce, source }),
      () => alive && setState({ season, nonce, source: null }),
    );
    return () => {
      alive = false;
    };
  }, [season, enabled, nonce, league]);
  const ready = state && state.season === season && state.nonce === nonce;
  return { source: ready ? state.source : null, loading: enabled && !ready, retry: () => setNonce((n) => n + 1) };
}

/** 分類ごとの本数と秒数の合計 */
export interface TtsTotals {
  /** 数えた試合（PBP のある試合） */
  games: number;
  byCategory: Record<TtsIndexCategory, { n: number; s: number }>;
  /** 計測できずに除外した FG の本数 */
  excluded: number;
}

export function emptyTtsTotals(): TtsTotals {
  return {
    games: 0,
    byCategory: Object.fromEntries(TTS_INDEX_CATEGORIES.map((c) => [c, { n: 0, s: 0 }])) as TtsTotals["byCategory"],
    excluded: 0,
  };
}

function addRow(t: TtsTotals, file: TtsIndexFile, row: number, atoms: readonly number[]): boolean {
  let any = false;
  for (const a of atoms) {
    const atom = TTS_ATOMS[a]!;
    const x = file.rows.counts[ttsExcludedKey(atom)]?.[row] ?? -1;
    if (x < 0) continue; // この区間の値が無い（PBP が無い試合・延長の無い試合の延長）
    any = true;
    t.excluded += x;
    for (const c of TTS_INDEX_CATEGORIES) {
      t.byCategory[c].n += file.rows.counts[ttsKey(atom, c, "n")]?.[row] ?? 0;
      t.byCategory[c].s += file.rows.counts[ttsKey(atom, c, "s")]?.[row] ?? 0;
    }
  }
  return any;
}

/**
 * 絞り込み済みの試合ログのうち、その区間の値がある試合の合計。side="opp" は同じ試合の相手のシュート（行 xor 1）。
 * period が "all" のときは全区間（Q1〜Q4＋延長）を足す
 */
export function sumTtsTotals(source: TtsSource, logs: readonly TeamGameLog[], period: TtsPeriodValue | "all", side: "own" | "opp"): TtsTotals {
  const atoms = period === "all" ? [0, 1, 2, 3, 4] : PERIOD_ATOM_INDEXES[period];
  const t = emptyTtsTotals();
  for (const g of logs) {
    const n = source.gameNo.get(g.scheduleKey);
    if (n === undefined) continue;
    const ownRow = n * 2 + (g.isHome ? 0 : 1);
    const row = side === "own" ? ownRow : ownRow ^ 1;
    if (addRow(t, source.file, row, atoms)) t.games += 1;
  }
  return t;
}

/** 項目の本数と秒数の合計（all は全分類、first は OREB 後以外の全分類〔その他を含む〕） */
export function ttsItemTotal(t: TtsTotals, item: TtsItem): { n: number; s: number } {
  const sum = (cats: readonly TtsIndexCategory[]) => cats.reduce((p, c) => ({ n: p.n + t.byCategory[c].n, s: p.s + t.byCategory[c].s }), { n: 0, s: 0 });
  if (item === "all") return sum(TTS_INDEX_CATEGORIES);
  if (item === "first") return sum(TTS_INDEX_CATEGORIES.filter((c) => c !== "oreb"));
  return t.byCategory[item];
}

/** 項目の平均の秒数（本数が 0 なら null）と割合（計測できた FG の総数が 0 なら null。0〜100） */
export function ttsItemValues(t: TtsTotals, item: TtsItem): { avg: number | null; pct: number | null; n: number } {
  const x = ttsItemTotal(t, item);
  const all = ttsItemTotal(t, "all");
  return { avg: x.n > 0 ? x.s / x.n : null, pct: all.n > 0 ? (100 * x.n) / all.n : null, n: x.n };
}

/** 視点を反映した値。diff は 自チーム−opp（どちらかが null なら null。割合はポイントの差） */
export function ttsPerspectiveValues(
  own: TtsTotals,
  opp: TtsTotals,
  perspective: TtsPerspective,
  item: TtsItem,
): { avg: number | null; pct: number | null; n: number } {
  if (perspective === "own") return ttsItemValues(own, item);
  if (perspective === "opp") return ttsItemValues(opp, item);
  const a = ttsItemValues(own, item);
  const b = ttsItemValues(opp, item);
  return {
    avg: a.avg !== null && b.avg !== null ? a.avg - b.avg : null,
    pct: a.pct !== null && b.pct !== null ? a.pct - b.pct : null,
    n: a.n - b.n,
  };
}

/** 表の項目の並び（TTS → 1st Shot → 初回の内訳 → After OR）。abbr は statNames.ts の略称（割合の列は abbr＋「%」）。TTS だけ割合を出さない */
export const TTS_TABLE_ITEMS: readonly { item: TtsItem; abbr: string; hasPct: boolean }[] = [
  { item: "all", abbr: "TTS", hasPct: false },
  { item: "first", abbr: "1st Shot", hasPct: true },
  { item: "score", abbr: "After Score", hasPct: true },
  { item: "deadTo", abbr: "After Dead TO", hasPct: true },
  { item: "dreb", abbr: "After DR", hasPct: true },
  { item: "steal", abbr: "After STL", hasPct: true },
  { item: "quarter", abbr: "Q Start", hasPct: true },
  { item: "oreb", abbr: "After OR", hasPct: true },
];

/** 表の1行の値。null は「-」（対象外のシーズンなど）。キーは項目 */
export type TtsRowValues = Record<TtsItem, { avg: number | null; pct: number | null; n: number }>;

export function ttsRowValues(own: TtsTotals, opp: TtsTotals, perspective: TtsPerspective): TtsRowValues {
  return Object.fromEntries(TTS_ITEMS.map((i) => [i, ttsPerspectiveValues(own, opp, perspective, i)])) as TtsRowValues;
}

/** 表示: 小数1桁。+/- は符号を付ける（丸めて0になる値は符号なしの 0.0）。値が無ければ「-」 */
function formatTtsNumber(v: number | null, perspective: TtsPerspective): string {
  if (v === null) return "-";
  const r = Number(v.toFixed(1));
  const text = Math.abs(r).toFixed(1);
  if (r === 0) return text;
  return r < 0 ? `-${text}` : perspective === "diff" ? `+${text}` : text;
}
export const formatTtsSeconds = formatTtsNumber;
export const formatTtsPct = formatTtsNumber;

/** 2020-21 より前のシーズンの注記（表は「-」にする） */
export const TTS_UNSUPPORTED_NOTE = "Time to Shot は 2020-21 シーズン以降だけです（それ以前は公式の記録の形式が違い、基準に届かないため「-」にしています）。";
