// 比較ページ（個人）の順位。ランキング > 個人 > シーズン成績（条件なし・レギュラーシーズン・平均）と同じ決め方
// （選手 md と同じ buildRankLines。掲載基準・追加の基準・同じ値の扱いも同じ）。20位以内だけ出し、出場率が基準に届かない選手は「◯位相当」。
// 画面の部品（読み込みのフック）と純粋な関数を同じファイルに置く。保存キーの対象外。
import { useEffect, useState } from "react";
import { fetchGameSummaries, fetchPlayerGameLogs, fetchPlayers, fetchTeamGameLogs, fetchTeams } from "./data";
import { buildRankLines, rankLogPlayers, type AiPlayerRankData, type RankLine } from "./aiPlayerRank";
import { COMPARE_PLAYER_RANK_LIMIT, rankText } from "./compareRank";
import type { League } from "./league";
import type { PlayerGameLog, PlayerSummary, TeamGameLog } from "../../shared/types";
import type { SeasonBoxTabKey } from "./playerSeasonBoxscore";

async function mapLimited<T>(items: T[], fn: (item: T) => Promise<void>, limit: number): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

const baseCache = new Map<string, Promise<AiPlayerRankData>>();

/** 1シーズン分の順位の材料。Misc・Scoring・Advanced は試合ログから出す項目があるので、掲載基準を満たす選手の試合ログも読む（Traditional は読まない） */
function loadRankData(season: string, league: League, withLogs: boolean): Promise<AiPlayerRankData> {
  const key = `${league}:${season}:${withLogs ? "logs" : "plain"}`;
  let p = baseCache.get(key);
  if (!p) {
    p = (async () => {
      const [players, teams, summaries] = await Promise.all([
        fetchPlayers(season, league),
        fetchTeams(season, league),
        withLogs ? fetchGameSummaries(season, league) : Promise.resolve([]),
      ]);
      const logs = new Map<string, PlayerGameLog[]>();
      const teamLogs = new Map<string, TeamGameLog[]>();
      if (withLogs) {
        await mapLimited(rankLogPlayers(players, teams), async (q) => void logs.set(q.playerId, await fetchPlayerGameLogs(season, q.playerId, league)), 16);
        await mapLimited(teams, async (t) => void teamLogs.set(t.teamId, await fetchTeamGameLogs(season, t.teamId, league)), 8);
      }
      return { season, players, teams, summaries, logs, teamLogs } satisfies AiPlayerRankData;
    })();
    p.catch(() => baseCache.delete(key));
    baseCache.set(key, p);
  }
  return p;
}

export type PlayerRankLabels = ReadonlyMap<string, string>;

/** 項目のキー → 「3位」「5位相当」。20位より下・良し悪しなしの項目・基準に届かない項目は入れない */
export function playerRankLabels(lines: readonly RankLine[], neutral: (key: string) => boolean): PlayerRankLabels {
  const out = new Map<string, string>();
  for (const l of lines) {
    if (l.rank === null || l.rank > COMPARE_PLAYER_RANK_LIMIT || neutral(l.key)) continue;
    out.set(l.key, rankText(l.rank, !!l.equivalent));
  }
  return out;
}

/**
 * 1人分の順位の表示（項目のキー → 文字）。enabled が false の間・読み込み中・読み込みに失敗したときは null（順位を出さない）
 */
export function usePlayerCompareRanks(opts: {
  season: string;
  league: League;
  tab: SeasonBoxTabKey;
  playerId: string;
  enabled: boolean;
  neutral: (key: string) => boolean;
}): PlayerRankLabels | null {
  const { season, league, tab, playerId, enabled, neutral } = opts;
  const [state, setState] = useState<{ key: string; labels: PlayerRankLabels } | null>(null);
  const withLogs = tab !== "traditional";
  const key = `${league}:${season}:${tab}:${playerId}`;
  useEffect(() => {
    if (!enabled || !playerId) return;
    let cancelled = false;
    (async () => {
      const base = await loadRankData(season, league, withLogs);
      const target = base.players.find((p: PlayerSummary) => p.playerId === playerId);
      if (!target) return;
      // 出場率が届かない選手は掲載基準の試合ログに入っていないので、本人の分を足す
      let data = base;
      if (withLogs && !base.logs.has(playerId)) {
        const logs = new Map(base.logs);
        logs.set(playerId, await fetchPlayerGameLogs(season, playerId, league));
        data = { ...base, logs };
      }
      const lines = buildRankLines(data, target, { only: [tab], equivalent: true });
      if (!cancelled) setState({ key, labels: playerRankLabels(lines, neutral) });
    })().catch(() => {
      if (!cancelled) setState(null);
    });
    return () => {
      cancelled = true;
    };
    // neutral は定義への参照で変わらない
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, key, withLogs]);
  return enabled && state?.key === key ? state.labels : null;
}
