// チーム詳細のチームスタッツの数字の下に出す、リーグの全チームの中の順位と、上位3位・下位3位の色（DESIGN.md 406章）。
// 順位は、ランキング（チーム・シーズン成績）・比較ページと同じ集計（useTeamSeasonRanking）を、表で効いている条件（シーズン・試合区分・Q別・登録区分・平均／合計・視点）で
// 全チームに掛けて出す。表の行ごとに1つ置き、行の中身を children（lookup を受け取る）で描く。enabled が false の間は何も読まず、lookup は常に undefined
import type { ReactNode } from "react";
import { useMemo } from "react";
import type { BoxscoreTabKey } from "./BoxscoreTable";
import type { League } from "../lib/league";
import type { SeasonDisplayMode, SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import type { PeriodRangeValue } from "../lib/periodRange";
import { DEFAULT_STAT_CONDITIONS } from "../lib/statConditions";
import { matchRankColumn, rankText, teamRanksOf, type TeamRankResult } from "../lib/compareRank";
import { useTeamSeasonRanking, type TeamRankingParams } from "../lib/teamSeasonRanking";
import type { TeamPerspective } from "../lib/teamStatsColumns";

/** 数字の下に出す順位（text）と、マスの色（tier） */
export interface TeamCellRank {
  text: string;
  tier: TeamRankResult["tier"];
  /** 色の意味（良し悪し＝緑・赤、多い・少ない＝青・オレンジ） */
  kind: TeamRankResult["kind"];
  /** 色の濃さ（1＝いちばん濃い。上位は順位、下位はいちばん悪い方からの順位） */
  level: number;
}

/** 表の項目（key・label）の順位。順位を付けない項目（良し悪しなし・ランキングに無い項目・値の無いシーズン）は undefined */
export type TeamRankLookup = (col: { key: string; label: string }) => TeamCellRank | undefined;

export const NO_TEAM_RANK: TeamRankLookup = () => undefined;

const DEFAULT_FILTER = { range: { kind: "all" } } as const;

export function TeamRankScope({
  season,
  league,
  teamId,
  categories,
  mode,
  perspective,
  period = "all",
  classFilter = "all",
  gameType = "regular",
  enabled,
  rankAllNeutral = false,
  children,
}: {
  season: string;
  league: League;
  teamId: string;
  /** 項目を探すランキングのカテゴリ（先のものを優先。最大2つ） */
  categories: readonly [BoxscoreTabKey] | readonly [BoxscoreTabKey, BoxscoreTabKey];
  mode: SeasonDisplayMode;
  perspective: TeamPerspective;
  period?: PeriodRangeValue;
  classFilter?: string;
  gameType?: SeasonGameTypeFilter;
  enabled: boolean;
  /** 良し悪しなしの項目にも、色なしで多い順の順位を出す（シーズン別成績。DESIGN.md 455章） */
  rankAllNeutral?: boolean;
  children: (lookup: TeamRankLookup) => ReactNode;
}) {
  const paramsOf = (category: BoxscoreTabKey): TeamRankingParams => ({
    category,
    statKey: "",
    displayMode: mode,
    gameType,
    perspective,
    filter: DEFAULT_FILTER,
    turnoverDirection: "forced",
    period,
    statConditions: DEFAULT_STAT_CONDITIONS,
    classFilter,
  });
  // フックの数は変えない。2つ目は、カテゴリが2つあるときだけ読む
  const first = useTeamSeasonRanking(season, paramsOf(categories[0]), { enabled, skipConditionItems: true, league, foulIndex: categories[0] === "misc" });
  const second = useTeamSeasonRanking(season, paramsOf(categories[1] ?? categories[0]), { enabled: enabled && categories.length > 1, skipConditionItems: true, league, foulIndex: categories[1] === "misc" });
  const sources = [first, second];
  const cache = useMemo(() => new Map<string, Map<string, TeamRankResult> | null>(), [first.columns, first.boxRows, second.columns, second.boxRows, perspective, rankAllNeutral]);
  const lookup: TeamRankLookup = (col) => {
    if (!enabled) return undefined;
    for (let i = 0; i < categories.length; i++) {
      const source = sources[i]!;
      if (source.gameLogsLoading || !source.gameLogsByTeam) continue;
      const column = matchRankColumn(source.columns, col);
      if (!column) continue;
      const cacheKey = `${i}:${column.key}`;
      if (!cache.has(cacheKey)) cache.set(cacheKey, teamRanksOf(source.boxRows, column, perspective, rankAllNeutral, true));
      const result = cache.get(cacheKey)?.get(teamId);
      return result ? { text: rankText(result.rank), tier: result.tier, kind: result.kind, level: result.tier === "bottom" ? result.bottomRank : result.rank } : undefined;
    }
    return undefined;
  };
  return <>{children(lookup)}</>;
}

/** 順位を付けたマスの className の足し分（上位・下位の色） */
export function rankTierClass(rank: TeamCellRank | undefined): string {
  if (!rank?.tier) return "";
  // 良し悪しのない項目: 多い上位3は青・少ない下位3はオレンジ（1位・最下位がいちばん濃い）
  if (rank.kind === "count") return ` count-${rank.tier === "top" ? "hi" : "lo"}-${Math.min(3, Math.max(1, rank.level))}`;
  return rank.tier === "top" ? " rank-tier-top" : " rank-tier-bottom";
}

/** マスの値の下の順位（小さい字。比較ページと同じ部品の見た目） */
export function TeamRankText({ rank }: { rank: TeamCellRank | undefined }) {
  return rank ? <span className="compare-rank">{rank.text}</span> : null;
}
