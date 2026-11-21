// 画面専用（図解の散布図の「ここまでの相手の強さ」「残りの相手の強さ」）。順位表と同じ材料（最新の順位表・試合の概要・日程・プレーオフ争い）を読み、同じ関数（standingsOpponentStrength.ts）で出す。
// enabled が false の間は何も読まない。読み込めなかった材料は null のまま渡す（順位表と同じく、試合の概要が無ければここまで、日程が無ければ残りは出さない）
import { fetchGameSummaries, fetchPlayoffRace, fetchSchedule, fetchStandingsHistory } from '../lib/data';
import type { League } from '../lib/league';
import { computeStandingsOpponentStrengths, type StandingsOpponentStrengths } from '../lib/standingsOpponentStrength';
import { useJsonData } from '../lib/useJsonData';

export function useOpponentStrengths(season: string, league: League, enabled: boolean): { data: StandingsOpponentStrengths | null; loading: boolean } {
  const r = useJsonData(async () => {
    if (!enabled) return null;
    const orNull = <T,>(p: Promise<T>) => p.catch(() => null);
    const [history, schedule, gameSummaries, playoffRace] = await Promise.all([orNull(fetchStandingsHistory(season, league)), orNull(fetchSchedule(season, league)), orNull(fetchGameSummaries(season, league)), orNull(fetchPlayoffRace(season, league))]);
    const latest = history && history.length > 0 ? history[history.length - 1]! : null;
    if (!latest) return null;
    return computeStandingsOpponentStrengths({ teams: latest.teams, gameSummaries, schedule, playoffRace });
  }, [season, league, enabled], { discardStale: true });
  return { data: r.data ?? null, loading: enabled && r.loading };
}
