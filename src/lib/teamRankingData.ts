import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fetchDivisionHistory, fetchGame, fetchGameSummaries, fetchTeamGameLogs } from "./data";
import {
  buildGameTeamsByScheduleKey,
  buildRecordsBeforeGame,
  ownTeamResolverFromGames,
  type OwnTeamResolver,
  type RecordBeforeGame,
} from "./situational";
import type { DivisionHistoryFile, GameSummary, StoredGame, TeamGameLog } from "../../shared/types";

/**
 * 26チーム分（または指定したチーム一覧分）のteam-games/{teamId}.jsonを並行取得する。
 * 「チーム」ページ「全チームスタッツ」タブ・ランキングページのチーム版で共通利用する
 * （元はTeamsListPage.tsxに実装されていたものを抽出）
 */
export function useAllTeamGameLogs(
  season: string,
  teams: { teamId: string }[] | null,
): { gameLogsByTeam: Map<string, TeamGameLog[]> | null; loading: boolean } {
  const [gameLogsByTeam, setGameLogsByTeam] = useState<Map<string, TeamGameLog[]> | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!teams) return;
    let cancelled = false;
    setLoading(true);
    setGameLogsByTeam(null);
    Promise.all(
      teams.map(async (t): Promise<readonly [string, TeamGameLog[]]> => {
        try {
          return [t.teamId, await fetchTeamGameLogs(season, t.teamId)] as const;
        } catch {
          return [t.teamId, []] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setGameLogsByTeam(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teams, season]);

  return { gameLogsByTeam, loading };
}

/**
 * シチュエーション別成績（対勝率別・地区別）フィルタが必要とする、シーズン全体の試合サマリ・
 * 地区マスタ・そこから求めた「試合前時点の対戦成績」を取得する。取得に失敗しても該当フィルタが
 * 使えなくなるだけで他の機能は継続する（「チーム」ページと同じ方針）
 */
export function useLeagueSituationalContext(
  season: string,
  enabled = true,
): {
  summaries: GameSummary[] | null;
  divisionHistory: DivisionHistoryFile | null;
  opponentRecords: Map<string, Map<string, RecordBeforeGame>> | undefined;
  /** 選手の試合ログから試合ごとの自チームを引く（対戦地区の「同地区/他地区」用）。日程未取得ならundefined */
  playerOwnTeamOf: OwnTeamResolver | undefined;
} {
  const [summaries, setSummaries] = useState<GameSummary[] | null>(null);
  const [divisionHistory, setDivisionHistory] = useState<DivisionHistoryFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummaries(null);
    setDivisionHistory(null);
    // 前シーズン比較の前季は、比較をオンにしたときだけ読む（enabled が false の間は読まない）
    if (!enabled) return;
    Promise.all([fetchGameSummaries(season), fetchDivisionHistory()])
      .then(([s, d]) => {
        if (!cancelled) {
          setSummaries(s);
          setDivisionHistory(d);
        }
      })
      .catch(() => {
        // 対勝率別・地区フィルタが使えなくなるだけなので、失敗しても他の機能は継続する
      });
    return () => {
      cancelled = true;
    };
  }, [season, enabled]);

  const opponentRecords = useMemo<Map<string, Map<string, RecordBeforeGame>> | undefined>(
    () => (summaries ? buildRecordsBeforeGame(summaries) : undefined),
    [summaries],
  );

  const playerOwnTeamOf = useMemo(
    () => ownTeamResolverFromGames(summaries ? buildGameTeamsByScheduleKey(summaries) : undefined),
    [summaries],
  );

  return { summaries, divisionHistory, opponentRecords, playerOwnTeamOf };
}

/**
 * ランキングページのQ別/前後半トグル用。指定したscheduleKey一覧の生データ（StoredGame、
 * PlayByPlays込み）を取得し、ページ内でキャッシュする（「使うまで取得しない」方針。
 * DESIGN.md参照）。requestedScheduleKeysが空配列（＝トグルが「試合」のまま）の間は
 * 何も取得しない。一度取得したscheduleKeyはseasonが変わらない限り再取得しない
 * （フィルタ・カテゴリ切替でrequestedScheduleKeysの中身が変わっても、既に取得済みの
 * キーは飛ばして差分だけ追加取得する）。
 * 1回やり直しても読めなかった試合は取得済みにせず、failedCount（求めている試合のうち読めなかった数）で知らせる。
 * retry() で、読めなかった試合だけをもう一度取りに行く
 */
export function useLeagueRawGames(
  season: string,
  requestedScheduleKeys: string[],
): { gamesByScheduleKey: Map<string, StoredGame>; loading: boolean; failedCount: number; retry: () => void } {
  const [gamesByScheduleKey, setGamesByScheduleKey] = useState<Map<string, StoredGame>>(new Map());
  const [loading, setLoading] = useState(false);
  const [failedKeys, setFailedKeys] = useState<ReadonlySet<string>>(new Set());
  const [retryNonce, setRetryNonce] = useState(0);
  const fetchedRef = useRef<Set<string>>(new Set());
  const seasonRef = useRef(season);
  // 読み込み中のまとまりの数（条件を変えて対象の試合が変わると、前のまとまりと新しいまとまりが重なって動く）
  const inFlightRef = useRef(0);

  useEffect(() => {
    if (seasonRef.current === season) return;
    seasonRef.current = season;
    fetchedRef.current = new Set();
    setGamesByScheduleKey(new Map());
    setFailedKeys(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [season]);

  useEffect(() => {
    const missing = requestedScheduleKeys.filter((k) => !fetchedRef.current.has(k));
    if (missing.length === 0) return;
    for (const k of missing) fetchedRef.current.add(k);
    const fetchSeason = season;
    inFlightRef.current += 1;
    setLoading(true);
    setFailedKeys((prev) => (missing.some((k) => prev.has(k)) ? new Set([...prev].filter((k) => !missing.includes(k))) : prev));
    Promise.all(
      missing.map(async (scheduleKey): Promise<readonly [string, StoredGame] | null> => {
        // 同時に多数読むと一部が失敗することがあるので、1回だけやり直す
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            return [scheduleKey, await fetchGame(fetchSeason, scheduleKey)] as const;
          } catch {
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
          }
        }
        return null;
      }),
    )
      .then((results) => {
        // 読み込み中に条件が変わっても、読めた試合は捨てない（取得済みとして記録しているので、捨てると二度と読まれず、表が「読み込み中」のまま止まる）。
        // シーズンが変わったときだけ捨てる（別のシーズンの試合なので）
        if (seasonRef.current !== fetchSeason) return;
        setGamesByScheduleKey((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
        // 読めなかった試合は取得済みから外し（retry() かあとの条件の変更でもう一度読めるように）、失敗として記録する
        const failed = missing.filter((_, i) => results[i] === null);
        if (failed.length > 0) {
          for (const k of failed) fetchedRef.current.delete(k);
          setFailedKeys((prev) => new Set([...prev, ...failed]));
        }
      })
      .finally(() => {
        inFlightRef.current -= 1;
        if (inFlightRef.current === 0) setLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedScheduleKeys.join("|"), season, retryNonce]);

  const failedCount = useMemo(() => requestedScheduleKeys.filter((k) => failedKeys.has(k)).length, [requestedScheduleKeys, failedKeys]);
  const retry = useCallback(() => setRetryNonce((n) => n + 1), []);

  return { gamesByScheduleKey, loading, failedCount, retry };
}
