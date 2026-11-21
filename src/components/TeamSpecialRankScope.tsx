// チーム詳細のシーズン別成績の Shooting・Forced TOV の順位（DESIGN.md 455章）。
// ランキング（チーム・シーズン成績）の同じカテゴリと同じ集計（useTeamSeasonRanking の shootingColumns・teamsWithShotTypes・teamsWithForcedTurnovers）を
// そのシーズンの全チームに掛けて、順位と上位3位・下位3位の色を出す。表の行（シーズン）ごとに1つ置く
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { League } from "../lib/league";
import type { SeasonDisplayMode } from "../lib/playerSeasonBoxscore";
import { DEFAULT_STAT_CONDITIONS } from "../lib/statConditions";
import { rankText, TEAM_RANK_TIER_SIZE, type TeamRankResult } from "../lib/compareRank";
import { rankPositions } from "../lib/seasonCompare";
import { rankDirectionOf, type RankDirection } from "../lib/rankDirection";
import { FORCED_TURNOVER_ITEMS, useTeamSeasonRanking, type TeamRankingParams } from "../lib/teamSeasonRanking";
import type { TeamCellRank } from "./TeamRankScope";

/** 順位を付けた項目の引き当て。key は Shooting＝列のキー（例: ジャンプショット_2pm）、Forced TOV＝「forced:項目」「committed:項目」 */
export type SpecialRankLookup = (key: string) => TeamCellRank | undefined;

/** 全チームの順位。teamRanksOf と同じ決め方（表示の文字が同じなら同じ順位・次は飛ばす・6チーム以下は色なし）。tierless なら良し悪しのない項目として青・オレンジの色（kind=count） */
export function ranksOfRows<T extends { teamId: string; gamesPlayed: number }>(
  rows: readonly T[],
  value: (r: T) => number,
  format: (r: T) => string,
  direction: RankDirection,
  tierless = false,
): Map<string, TeamRankResult> {
  const higherIsBetter = direction !== "lower";
  const ranked = rows.filter((r) => r.gamesPlayed > 0 && !Number.isNaN(value(r)) && value(r) >= 0 && format(r) !== "-");
  const best = [...ranked].sort((a, b) => (higherIsBetter ? value(b) - value(a) : value(a) - value(b)));
  const fromTop = rankPositions(best.map(format));
  const fromBottom = rankPositions([...best].reverse().map(format));
  const total = best.length;
  const out = new Map<string, TeamRankResult>();
  best.forEach((r, i) => {
    const rank = fromTop[i]!;
    const bottomRank = fromBottom[total - 1 - i]!;
    const noTier = total <= TEAM_RANK_TIER_SIZE * 2;
    out.set(r.teamId, { rank, total, tier: noTier ? null : rank <= TEAM_RANK_TIER_SIZE ? "top" : bottomRank <= TEAM_RANK_TIER_SIZE ? "bottom" : null, kind: tierless || direction === "neutral" ? "count" : "quality", bottomRank });
  });
  return out;
}

const DEFAULT_FILTER = { range: { kind: "all" } } as const;

/** Forced TOV の表の列のキー → ランキングの項目のキー（名前が違うものだけ） */
const FORCED_ITEM_KEY: Record<string, string> = { backcourt: "backcourtViolation" };

export function TeamSpecialRankScope({
  season,
  league,
  teamId,
  kind,
  mode,
  enabled,
  children,
}: {
  season: string;
  league: League;
  teamId: string;
  kind: "shooting" | "forcedTurnovers";
  mode: SeasonDisplayMode;
  enabled: boolean;
  children: (lookup: SpecialRankLookup) => ReactNode;
}) {
  const params: TeamRankingParams = {
    category: kind,
    statKey: "",
    displayMode: mode,
    gameType: "regular",
    perspective: "own",
    filter: DEFAULT_FILTER,
    turnoverDirection: "forced",
    period: "all",
    statConditions: DEFAULT_STAT_CONDITIONS,
    classFilter: "all",
  };
  const r = useTeamSeasonRanking(season, params, { enabled, skipConditionItems: true, league });
  const cache = useMemo(() => new Map<string, Map<string, TeamRankResult>>(), [r.teamsWithShotTypes, r.teamsWithForcedTurnovers, r.shootingColumns]);
  const ready = enabled && !r.gameLogsLoading && !!r.gameLogsByTeam;
  const lookup: SpecialRankLookup = (key) => {
    if (!ready) return undefined;
    if (!cache.has(key)) {
      if (kind === "shooting") {
        const col = r.shootingColumns.find((c) => c.key === key);
        if (!col) return undefined;
        cache.set(key, ranksOfRows(r.teamsWithShotTypes, (t) => Number(col.sortValue(t)), (t) => (col.format ? col.format(t) : String(col.sortValue(t))), rankDirectionOf(key)));
      } else {
        const [dir, rawKey] = key.split(":") as ["forced" | "committed", string];
        const item = FORCED_TURNOVER_ITEMS.find((i) => i.key === (FORCED_ITEM_KEY[rawKey] ?? rawKey));
        if (!item) return undefined;
        const pick = (t: (typeof r.teamsWithForcedTurnovers)[number]) => item.value(dir === "forced" ? t.forcedTurnovers! : t.turnoversCommitted!);
        // 奪った数は多いほうが良い。記録した数は、ランキングと同じ多い順の順位だけ（色なし）
        cache.set(key, ranksOfRows(r.teamsWithForcedTurnovers, pick, (t) => String(pick(t)), "higher", dir === "committed"));
      }
    }
    const result = cache.get(key)?.get(teamId);
    return result ? { text: rankText(result.rank), tier: result.tier, kind: result.kind, level: result.tier === "bottom" ? result.bottomRank : result.rank } : undefined;
  };
  return <>{children(lookup)}</>;
}
