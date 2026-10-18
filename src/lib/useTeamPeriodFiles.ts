// チームのピリオド別の索引を、1試合行の索引と同じシーズンぶん読む（設計書265章）。値を作る純粋な部分は teamPeriodGames.ts（検証スクリプトからも使うので、通信は含めない）。
import { useEffect, useState } from "react";
import type { TeamPeriodIndexFile } from "../../shared/periodIndex";
import type { TeamGameIndexView } from "./gameIndex";
import { loadTeamPeriodSource } from "./teamPeriodTotals";

export interface TeamPeriodFiles {
  /** 読み込み済みのチームのピリオド別の索引（シーズンをキーに。主索引と同じシーズンすべて） */
  files: Map<string, TeamPeriodIndexFile> | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * チームのピリオド別の索引を、読み込み済みの1試合行の索引と同じシーズンぶん読む。enabled が false の間（区間が「試合全体」のとき）は読まない。
 * 1つでも読めない（版・行数が合わない・古い索引）シーズンがあるときは、値が欠けるのでエラーにする
 */
export function useTeamPeriodFiles(main: readonly TeamGameIndexView[] | null, enabled: boolean): TeamPeriodFiles {
  const [state, setState] = useState<{ main: readonly TeamGameIndexView[] | null; files: Map<string, TeamPeriodIndexFile> | null; error: string | null }>({ main: null, files: null, error: null });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !main) return;
    let cancelled = false;
    (async () => {
      const loaded = await Promise.all(main.map((v) => loadTeamPeriodSource(v.season)));
      const missing = main.filter((v, k) => !loaded[k] || loaded[k]!.file.indexRows !== v.size).map((v) => v.season);
      if (missing.length > 0) throw new Error(`${missing.join("・")}のQ別・前後半のデータを読み込めませんでした`);
      if (!cancelled) setState({ main, files: new Map(loaded.map((s) => [s!.season, s!.file])), error: null });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ main, files: null, error: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, main, attempt]);
  const current = state.main === main && main !== null;
  return {
    files: enabled && current ? state.files : null,
    loading: enabled && !!main && (!current || (!state.files && !state.error)),
    error: enabled && current ? state.error : null,
    retry: () => setAttempt((n) => n + 1),
  };
}
