// ランキングの1試合記録（条件付き）が読むデータ（DESIGN.md 220章）。索引は条件を付けたときだけ読む（enabled）。
// 同じシーズンの索引はページを開いている間メモリに持つ（gameIndexLoad.ts）ので、条件を外して付け直しても読み直さない。
import { useCallback, useEffect, useMemo, useState } from "react";
import { teamShortName } from "../../shared/teamNames";
import type { Division, DivisionHistoryFile, RookieEligibilityFile } from "../../shared/types";
import { fetchDivisionHistory, fetchRookieEligibility, fetchSeasons, fetchTeams } from "./data";
import { DIVISION_ORDER, seasonDivisions } from "./divisionGroups";
import type { PlayerGameIndexView, TeamGameIndexView } from "./gameIndex";
import { loadAssistPairs, loadPlayerGameIndex, loadTeamGameIndex } from "./gameIndexLoad";
import type { PairSeasonData } from "./clutchQuery";
import { leagueTeamDisplayName } from "./leagueTeamNames";
import type { RecordsScope } from "./urlFilterParams";
import { useJsonData } from "./useJsonData";

type IndexSubject = "player" | "team";
type ViewOf<S extends IndexSubject> = S extends "player" ? PlayerGameIndexView : TeamGameIndexView;

interface IndexState<V> {
  key: string;
  views: V[] | null;
  error: string | null;
}

export interface GameIndexViews<V> {
  /** 読み込み済みの索引（範囲「シーズン」はそのシーズン1つ、「歴代」は試合のあるシーズンすべて） */
  views: V[] | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/**
 * 1試合行の索引を読む。enabled が false の間は読まない（条件なしの初期表示は上位20位のファイルを使う）。
 * 歴代は全シーズンを並列で読む。1つでも読めないシーズンがあるときは、読めた分だけの記録を出さずにエラーにする（値が欠けるため）
 */
export function useGameIndexViews<S extends IndexSubject>(subject: S, scope: RecordsScope, season: string, enabled: boolean): GameIndexViews<ViewOf<S>> {
  const key = `${subject}:${scope === "season" ? season : "all"}`;
  const [state, setState] = useState<IndexState<ViewOf<S>>>({ key: "", views: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      const seasons =
        scope === "season"
          ? [season]
          : (await fetchSeasons()).filter((s) => s.hasCompletedGames).map((s) => s.season).sort();
      const loaded = await Promise.all(seasons.map((s) => (subject === "player" ? loadPlayerGameIndex(s) : loadTeamGameIndex(s))));
      const missing = seasons.filter((_, i) => loaded[i] === null);
      if (missing.length > 0) throw new Error(`${missing.join("・")}の試合のデータを読み込めませんでした`);
      if (!cancelled) setState({ key, views: loaded as ViewOf<S>[], error: null });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ key, views: null, error: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, subject, scope, season, key, attempt]);

  const current = state.key === key;
  return {
    views: enabled && current ? state.views : null,
    loading: enabled && (!current || (!state.views && !state.error)),
    error: enabled && current ? state.error : null,
    retry,
  };
}

export interface AssistPairData {
  /** 読み込み済みのアシストペア（シーズン単位は選んだシーズン1つ、それ以外は試合のあるシーズンすべて） */
  data: PairSeasonData[] | null;
  loading: boolean;
  error: string | null;
  retry: () => void;
}

/** アシストペアの試合ごとの行と、同じシーズンの選手の索引を読む。1つでも読めないシーズンがあるときはエラーにする（値が欠けるため） */
export function useAssistPairData(singleSeason: boolean, season: string): AssistPairData {
  const key = singleSeason ? season : "all";
  const [state, setState] = useState<{ key: string; data: PairSeasonData[] | null; error: string | null }>({ key: "", data: null, error: null });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const seasons = singleSeason ? [season] : (await fetchSeasons()).filter((s) => s.hasCompletedGames).map((s) => s.season).sort();
      const loaded = await Promise.all(seasons.map(async (s) => ({ pairs: await loadAssistPairs(s), index: await loadPlayerGameIndex(s) })));
      const missing = seasons.filter((_, i) => !loaded[i]!.pairs || !loaded[i]!.index);
      if (missing.length > 0) throw new Error(`${missing.join("・")}の試合のデータを読み込めませんでした`);
      if (!cancelled) setState({ key, data: loaded.map((l) => ({ pairs: l.pairs!, index: l.index! })), error: null });
    })().catch((err: unknown) => {
      if (!cancelled) setState({ key, data: null, error: err instanceof Error ? err.message : String(err) });
    });
    return () => {
      cancelled = true;
    };
  }, [singleSeason, season, key, attempt]);
  const current = state.key === key;
  return { data: current ? state.data : null, loading: !current || (!state.data && !state.error), error: current ? state.error : null, retry };
}

export interface GameRecordOptions {
  /** 対戦相手の選択肢（シーズン: そのシーズンのクラブ。歴代: B.PREMIERに在籍したことのあるクラブ） */
  teams: { value: string; label: string; name: string }[];
  /** 地区の選択肢（シーズン: そのシーズンの地区。歴代: どこかのシーズンにある地区） */
  divisions: Division[];
  /** 選択肢が読み込めたか（読み込み前に、選択中の値を外さないために使う） */
  ready: boolean;
}

/** 勝敗以外の条件の選択肢。軽いファイル（チーム一覧・地区の履歴）だけを読む */
export function useGameRecordOptions(scope: RecordsScope, season: string): GameRecordOptions {
  const { data: history } = useJsonData<DivisionHistoryFile | null>(() => fetchDivisionHistory().catch(() => null), []);
  const { data: teams } = useJsonData(() => (scope === "season" ? fetchTeams(season).catch(() => null) : Promise.resolve(null)), [scope, season]);
  return useMemo<GameRecordOptions>(() => {
    if (scope === "season") {
      const options = (teams ?? []).map((t) => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName), name: t.teamName }));
      return { teams: options.sort((a, b) => a.label.localeCompare(b.label, "ja")), divisions: seasonDivisions(history, season), ready: !!teams && history !== null };
    }
    const ids = new Set<string>();
    const divisions = new Set<Division>();
    for (const bySeason of Object.values(history?.premier ?? {})) {
      for (const [teamId, division] of Object.entries(bySeason)) {
        ids.add(teamId);
        divisions.add(division);
      }
    }
    const options = [...ids].map((id) => ({ value: id, label: teamShortName(id, leagueTeamDisplayName(id)), name: leagueTeamDisplayName(id) }));
    return {
      teams: options.sort((a, b) => a.label.localeCompare(b.label, "ja")),
      divisions: DIVISION_ORDER.filter((d) => divisions.has(d)),
      ready: history !== null,
    };
  }, [scope, season, history, teams]);
}

/** ルーキーの導出データ（ルーキーで絞り込むときだけ読む） */
export function useRookieFile(enabled: boolean): { file: RookieEligibilityFile | null; loading: boolean; error: string | null } {
  const { data, loading, error } = useJsonData(() => (enabled ? fetchRookieEligibility() : Promise.resolve(null)), [enabled]);
  return { file: enabled ? data : null, loading: enabled && loading, error: enabled ? error : null };
}
