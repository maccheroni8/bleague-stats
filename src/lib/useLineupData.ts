// ランキング > 個人 > On/Off・組み合わせ（DESIGN.md 224章）が読むデータ。選手の索引（試合の表・チーム辞書・選手辞書。219章）と、各チームの出場区間（team-stints。204章）。
// 出場区間は数をまとめた1本の配列（CompactStints）にして、ページを開いている間メモリに持つ（全シーズンでも約30MB。条件を変えても読み直さない）。
// 通算は全シーズンのチーム分（166ファイル、圧縮で約4.6MB）を読むので、読み込んだファイルの数を進み具合として返す。
import { useCallback, useEffect, useState } from "react";
import { compactStints, type CompactStints } from "../../shared/onCourtTotals";
import { fetchSeasons, fetchTeamStints } from "./data";
import { loadPlayerGameIndex } from "./gameIndexLoad";
import type { LineupSeasonData } from "./lineupRanking";
import { lineupSeasonSupported } from "./lineupRanking";

const stintsCache = new Map<string, Promise<CompactStints>>();

/** 1チーム・1シーズンの出場区間。読めなかったときは持たず、次の呼び出しでやり直す */
function loadStints(season: string, teamId: string): Promise<CompactStints> {
  const key = `${season}/${teamId}`;
  let p = stintsCache.get(key);
  if (!p) {
    p = fetchTeamStints(season, teamId).then(compactStints);
    p.catch(() => stintsCache.delete(key));
    stintsCache.set(key, p);
  }
  return p;
}

/** 同時に読むファイルの数（166ファイルを一度に要求して、展開のバッファが重なるのを避ける） */
const CONCURRENCY = 8;

async function runPool<T>(tasks: (() => Promise<T>)[]): Promise<T[]> {
  const results = new Array<T>(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  return results;
}

export interface LineupProgress {
  done: number;
  total: number;
}

export interface LineupData {
  /** 読み込み済みのデータ（シーズンの昇順）。読み込み前・読み込めなかったときは null */
  data: LineupSeasonData[] | null;
  loading: boolean;
  error: string | null;
  progress: LineupProgress;
  retry: () => void;
}

/** 通算で読むシーズン（出場区間のある、終了した試合のあるシーズン。昇順） */
export async function lineupCareerSeasons(): Promise<string[]> {
  return (await fetchSeasons()).filter((s) => s.hasCompletedGames && lineupSeasonSupported(s.season)).map((s) => s.season).sort();
}

/**
 * 選手の索引と出場区間を読む。seasons が null の間（通算のシーズンの一覧を読むまで）は待つ。
 * 1つでも読めないファイルがあるときは、読めた分だけの順位を出さずにエラーにする（値が欠けるため）
 */
export function useLineupData(seasons: string[] | null, enabled: boolean): LineupData {
  const key = seasons ? seasons.join(",") : "";
  const [state, setState] = useState<{ key: string; data: LineupSeasonData[] | null; error: string | null; progress: LineupProgress }>({
    key: "",
    data: null,
    error: null,
    progress: { done: 0, total: 0 },
  });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !seasons || seasons.length === 0) return;
    let cancelled = false;
    const list = seasons;
    (async () => {
      let done = 0;
      let total = list.length;
      const report = () => {
        if (!cancelled) setState((s) => ({ ...s, key, progress: { done, total } }));
      };
      setState({ key, data: null, error: null, progress: { done: 0, total } });
      const views = await runPool(
        list.map((season) => async () => {
          const view = await loadPlayerGameIndex(season);
          if (!view) throw new Error(`${season}の試合のデータを読み込めませんでした`);
          done += 1;
          report();
          return view;
        }),
      );
      const teamIds = views.map((v) => v.file.teams.map((t) => t[0]));
      total = list.length + teamIds.reduce((n, ids) => n + ids.length, 0);
      report();
      const tasks = list.flatMap((season, i) =>
        teamIds[i]!.map((teamId) => async () => {
          const c = await loadStints(season, teamId).catch(() => {
            throw new Error(`${season}の出場区間（チーム ${teamId}）を読み込めませんでした`);
          });
          done += 1;
          report();
          return { i, teamId, c };
        }),
      );
      const loaded = await runPool(tasks);
      const data: LineupSeasonData[] = list.map((_, i) => ({
        view: views[i]!,
        stints: new Map(loaded.filter((l) => l.i === i).map((l) => [l.teamId, l.c] as const)),
      }));
      if (!cancelled) setState({ key, data, error: null, progress: { done: total, total } });
    })().catch((err: unknown) => {
      if (!cancelled) setState((s) => ({ ...s, key, data: null, error: err instanceof Error ? err.message : String(err) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, attempt]);

  const current = state.key === key && !!seasons;
  const waiting = enabled && (!seasons || !current || (!state.data && !state.error));
  return {
    data: enabled && current ? state.data : null,
    loading: waiting,
    error: enabled && current ? state.error : null,
    progress: current ? state.progress : { done: 0, total: 0 },
    retry,
  };
}
