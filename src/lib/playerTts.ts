// 選手の Time to Shot（DESIGN.md 480章）。導出データ data/{season}/player-tts.json（形式は shared/playerTts.ts）を読み、
// 個人詳細（シーズン×チーム・移籍した選手は合計の行も）と全選手スタッツ（シーズン合計）の値を出す。
// - Player TTS＝その選手が打った計測できた FG の「秒数の合計 ÷ 本数」（チームの TTS と同じ数え方。シュートを打った選手に結び付ける）
// - Player To FT＝その選手が FT を打った回の、フリースローをもらうまでの時間（参考。個人詳細だけ）
// - シーズン全体の値だけ（試合区分は選べる）。期間・Q別などの条件を選んだときは「-」
// 集計のコードから読まれない場所（保存キーの対象外）に置く。
import { useEffect, useState } from "react";
import { PLAYER_TTS_VERSION, type PlayerTtsFile } from "../../shared/playerTts";
import type { SeasonGameTypeFilter } from "../../shared/gameType";
import { TTS_FIRST_SEASON } from "../../shared/ttsIndex";
import { fetchPlayerTtsIndex } from "./data";
import { leagueCacheKey, type League } from "./league";

/** 全選手スタッツで並べ替え・順位の対象にする、ボックススコアの FGA の1試合平均の下限（未満の選手は値だけ出す） */
export const PLAYER_TTS_MIN_FGA_PER_GAME = 1.0;

/** 順位の対象か（FGA の1試合平均が下限以上。試合数0は対象外） */
export function playerTtsEligible(fga: number, games: number): boolean {
  return games > 0 && fga / games >= PLAYER_TTS_MIN_FGA_PER_GAME;
}

export const PLAYER_TTS_TAB_LABEL = "Time to Shot";

/** 条件を選んだときの理由（値は「-」） */
export const PLAYER_TTS_FILTER_NOTE = "選手の Time to Shot はシーズン全体の値だけです。期間・Q別などの条件を選んでいるときは「-」にしています。";

export interface PlayerTtsTotals {
  fgN: number;
  fgS: number;
  ftN: number;
  ftS: number;
}

export function emptyPlayerTtsTotals(): PlayerTtsTotals {
  return { fgN: 0, fgS: 0, ftN: 0, ftS: 0 };
}

export function addPlayerTtsTotals(into: PlayerTtsTotals, from: PlayerTtsTotals): void {
  into.fgN += from.fgN;
  into.fgS += from.fgS;
  into.ftN += from.ftN;
  into.ftS += from.ftS;
}

export function playerTtsAvg(t: PlayerTtsTotals | null | undefined, kind: "fg" | "ft"): number | null {
  if (!t) return null;
  const n = kind === "fg" ? t.fgN : t.ftN;
  const s = kind === "fg" ? t.fgS : t.ftS;
  return n > 0 ? s / n : null;
}

/** 1シーズン分: 選手ID → チームID → 合計（試合区分で絞った値） */
export type PlayerTtsByTeam = Map<string, Map<string, PlayerTtsTotals>>;

export function playerTtsByTeam(file: PlayerTtsFile, gameType: SeasonGameTypeFilter): PlayerTtsByTeam {
  const out: PlayerTtsByTeam = new Map();
  const r = file.rows;
  for (let i = 0; i < r.player.length; i++) {
    const playoff = r.playoff[i] === 1;
    if (gameType === "regular" && playoff) continue;
    if (gameType === "playoff" && !playoff) continue;
    const pid = r.player[i]!;
    const tid = r.team[i]!;
    let teams = out.get(pid);
    if (!teams) out.set(pid, (teams = new Map()));
    let t = teams.get(tid);
    if (!t) teams.set(tid, (t = emptyPlayerTtsTotals()));
    addPlayerTtsTotals(t, { fgN: r.fgN[i]!, fgS: r.fgS[i]!, ftN: r.ftN[i]!, ftS: r.ftS[i]! });
  }
  return out;
}

/** 選手のシーズン合計（移籍した選手は全チームの合計） */
export function playerTtsSeasonTotal(byTeam: PlayerTtsByTeam, playerId: string): PlayerTtsTotals | null {
  const teams = byTeam.get(playerId);
  if (!teams) return null;
  const t = emptyPlayerTtsTotals();
  for (const v of teams.values()) addPlayerTtsTotals(t, v);
  return t;
}

export function playerTtsSeasonSupported(season: string): boolean {
  return season >= TTS_FIRST_SEASON;
}

const cache = new Map<string, Promise<PlayerTtsFile | null>>();

/** 1シーズン分を読む。無い・版が合わないときは null（失敗は持たない） */
export function loadPlayerTts(season: string, league: League = "premier"): Promise<PlayerTtsFile | null> {
  if (!playerTtsSeasonSupported(season)) return Promise.resolve(null);
  const key = leagueCacheKey(season, league);
  const cached = cache.get(key);
  if (cached) return cached;
  const p: Promise<PlayerTtsFile | null> = fetchPlayerTtsIndex(season, league).then((f: PlayerTtsFile | null) => (f && f.version === PLAYER_TTS_VERSION ? f : null));
  p.then((v) => v ?? cache.delete(key), () => cache.delete(key));
  cache.set(key, p);
  return p;
}

/** 有効なときだけ読む（全選手スタッツ用） */
export function usePlayerTts(season: string, enabled: boolean, league: League = "premier"): { file: PlayerTtsFile | null; loading: boolean } {
  const [state, setState] = useState<{ key: string; file: PlayerTtsFile | null } | null>(null);
  const key = leagueCacheKey(season, league);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadPlayerTts(season, league).then(
      (file) => alive && setState({ key, file }),
      () => alive && setState({ key, file: null }),
    );
    return () => {
      alive = false;
    };
  }, [season, league, enabled, key]);
  const ready = state?.key === key;
  return { file: ready ? state!.file : null, loading: enabled && !ready };
}

/** 秒（小数2桁）。値が無ければ「-」 */
export function formatPlayerTtsSeconds(v: number | null): string {
  return v === null ? "-" : v.toFixed(2);
}

/**
 * 全選手スタッツの順位（速い順＝秒の少ない順。同じ表示値は同じ順位・次は飛ばす）。順位の対象（playerTtsEligible）の選手だけ
 */
export function playerTtsRanks(entries: readonly { id: string; avg: number | null; eligible: boolean }[]): Map<string, number> {
  const eligible = entries.filter((e) => e.avg !== null && e.eligible).map((e) => ({ id: e.id, v: Number(e.avg!.toFixed(2)) }));
  eligible.sort((a, b) => a.v - b.v);
  const ranks = new Map<string, number>();
  eligible.forEach((e, i) => {
    const prev = eligible[i - 1];
    ranks.set(e.id, prev && prev.v === e.v ? ranks.get(prev.id)! : i + 1);
  });
  return ranks;
}
