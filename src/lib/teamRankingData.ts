import { useEffect, useMemo, useState } from "react";
import { fetchDivisionHistory, fetchGameSummaries, fetchTeamGameLogs } from "./data";
import { buildRecordsBeforeGame, type RecordBeforeGame } from "./situational";
import type { DivisionHistoryFile, GameSummary, TeamGameLog } from "../../shared/types";

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
export function useLeagueSituationalContext(season: string): {
  summaries: GameSummary[] | null;
  divisionHistory: DivisionHistoryFile | null;
  opponentRecords: Map<string, Map<string, RecordBeforeGame>> | undefined;
} {
  const [summaries, setSummaries] = useState<GameSummary[] | null>(null);
  const [divisionHistory, setDivisionHistory] = useState<DivisionHistoryFile | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSummaries(null);
    setDivisionHistory(null);
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
  }, [season]);

  const opponentRecords = useMemo<Map<string, Map<string, RecordBeforeGame>> | undefined>(
    () => (summaries ? buildRecordsBeforeGame(summaries) : undefined),
    [summaries],
  );

  return { summaries, divisionHistory, opponentRecords };
}
