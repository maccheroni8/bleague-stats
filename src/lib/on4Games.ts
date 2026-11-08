// 「on4 が可能だった試合」（そのチームのベンチ入り〔出場しなかった選手を含む〕に、同時に4人出せるだけの外国籍・帰化・アジア特別枠の選手がいた試合）の判定と、
// 試合の元ファイルを読んで求める部分（On-Court Foreign の切り替え。DESIGN.md 352章）。画面だけの部品（保存キーの対象外）。
// 数え方はシーズンごとの規則（season-rules.json）に合わせる: 2026-27 の B.PREMIER は「外国籍3名以内＋帰化かアジア特別枠いずれか1名以内（別枠）」が同時に出られる最大4名なので、
// ベンチ入りに外国籍が3名以上いて、帰化かアジア特別枠が1名以上いれば on4 が可能。区分が分からない選手は数えない（推測しない）。
import { makeClassifier, type SeasonRegistrationFile } from "../../shared/registration";
import type { PlayerMasterEntry } from "../../shared/types";
import { benchForeignCounts, on4Feasible, type BenchForeignCount, type ClassLookup } from "./on4Core";
export { on4Supported, on4Feasible, benchForeignCounts } from "./on4Core";
export type { BenchForeignCount } from "./on4Core";
import { fetchGameAsStored, fetchPlayersMaster, fetchSeasonRegistrations } from "./data";
import { leagueCacheKey, type League } from "./league";

export interface On4Result {
  /** "チームID|scheduleKey" → on4 が可能だった試合か */
  feasible: ReadonlyMap<string, boolean>;
  /** 数えた試合のうち、区分の分からない選手がベンチにいた（のでその分は数えていない）チーム・試合の数 */
  withUnknown: number;
  /** 読み込みにかかった時間（ミリ秒。キャッシュを使ったときは0） */
  elapsedMs: number;
}

export function on4Key(teamId: string, scheduleKey: string): string {
  return `${teamId}|${scheduleKey}`;
}

const CONCURRENCY = 8;
const gameCache = new Map<string, Promise<Map<string, BenchForeignCount>>>();
const classifierCache = new Map<string, Promise<ClassLookup>>();

function classifierFor(season: string, league: League): Promise<ClassLookup> {
  const key = leagueCacheKey(season, league);
  let p = classifierCache.get(key);
  if (!p) {
    p = Promise.all([fetchPlayersMaster(), fetchSeasonRegistrations(season, league)]).then(([master, regs]: [PlayerMasterEntry[], SeasonRegistrationFile | null]) =>
      makeClassifier(season, regs, new Map(master.map((m) => [m.playerId, m]))) as ClassLookup,
    );
    p.catch(() => classifierCache.delete(key));
    classifierCache.set(key, p);
  }
  return p;
}

function gameCounts(season: string, league: League, scheduleKey: string, classify: ClassLookup): Promise<Map<string, BenchForeignCount>> {
  const key = `${leagueCacheKey(season, league)}|${scheduleKey}`;
  let p = gameCache.get(key);
  if (!p) {
    p = fetchGameAsStored(season, scheduleKey, league).then((g) => benchForeignCounts(g, classify));
    p.catch(() => gameCache.delete(key));
    gameCache.set(key, p);
  }
  return p;
}

/**
 * 指定した試合の元ファイルを読み、チームごとに on4 が可能だったかを求める。進み具合は onProgress（読み終えた数, 全体）で知らせる。
 * 失敗した試合があれば例外（中途半端な結果を出さない）。signal.aborted のときは中止（例外 "aborted"）
 */
export async function loadOn4Games(
  season: string,
  league: League,
  scheduleKeys: readonly string[],
  onProgress: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<On4Result> {
  const started = performance.now();
  const classify = await classifierFor(season, league);
  const keys = [...new Set(scheduleKeys)];
  const feasible = new Map<string, boolean>();
  let withUnknown = 0;
  let done = 0;
  let next = 0;
  let cached = true;
  onProgress(0, keys.length);
  const worker = async () => {
    while (next < keys.length) {
      if (signal?.aborted) throw new Error("aborted");
      const key = keys[next++]!;
      const had = gameCache.has(`${leagueCacheKey(season, league)}|${key}`);
      if (!had) cached = false;
      const counts = await gameCounts(season, league, key, classify);
      for (const [teamId, c] of counts) {
        feasible.set(on4Key(teamId, key), on4Feasible(c));
        if (c.unknown > 0) withUnknown += 1;
      }
      onProgress(++done, keys.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker));
  if (signal?.aborted) throw new Error("aborted");
  return { feasible, withUnknown, elapsedMs: cached ? 0 : Math.round(performance.now() - started) };
}
