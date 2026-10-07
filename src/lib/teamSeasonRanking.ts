import { useMemo } from "react";
import { fetchTeams } from "./data";
import { useJsonData } from "./useJsonData";
import { foulColumnsSplit } from "./ruleChange";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import type { Column } from "../components/SortableTable";
import type { RankableStat } from "../components/RankedList";
import { filterGameLogs, type SituationalFilter } from "./situational";
import {
  SEASON_BOX_PERIOD_OPTIONS,
  filterByGameType,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "./playerSeasonBoxscore";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  DEFAULT_SORT_KEY,
  sumTeamGameBoxTotalsForPeriod,
  sumTeamGameLogs,
  type AllTeamsRow,
  type TeamPerspective,
} from "./teamStatsColumns";
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeEntityColumns } from "./shotTypeBreakdown";
import { useAllTeamGameLogs, useLeagueRawGames, useLeagueSituationalContext } from "./teamRankingData";
import {
  buildStatConditionItems,
  filterByStatConditions,
  hasActiveStatConditions,
  type StatConditionsState,
} from "./statConditions";
import { buildTeamConditionDefs } from "./teamConditionItems";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import type { PeriodRangeValue } from "./periodRange";
import type { TeamForcedTurnovers, TeamGameLog, TeamSummary } from "../../shared/types";

/** チームランキングのカテゴリ。既存のBOXSCORE_TABS（トラディショナル/アドバンスド/Misc/
 * スコアリング）に、チーム詳細ページ「チームスタッツ」タブと同じ2カテゴリ（シューティング・
 * 強制ターンオーバー）を追加したもの。この2つはteams.json（TeamSummary）に既に持っている
 * シーズン集計値（shotTypes・forcedTurnovers/turnoversCommitted）をそのまま使うため、
 * 他4カテゴリと異なりチーム試合ログの取得・シチュエーション別フィルタ・レギュラー/
 * プレーオフ切替・自チーム/opp切替の対象外（レギュラーシーズンの通算値のみ） */
export type TeamRankingCategory = BoxscoreTabKey | "shooting" | "forcedTurnovers";

const BOXSCORE_TAB_KEYS = new Set<string>(BOXSCORE_TABS.map((t) => t.key));
export function isBoxscoreCategory(c: TeamRankingCategory): c is BoxscoreTabKey {
  return BOXSCORE_TAB_KEYS.has(c);
}

/** 「強制ターンオーバー」カテゴリの項目定義（TeamForcedTurnoversの各フィールド＋合計）。
 * 奪った（forced）/記録した（committed）どちらの視点でも同じ項目を使う */
export const FORCED_TURNOVER_ITEMS: { key: string; label: string; value: (d: TeamForcedTurnovers) => number }[] = [
  { key: "offensiveFoul", label: "オフェンスファウル", value: (d) => d.offensiveFoul },
  { key: "violation24sec", label: "24秒バイオレーション", value: (d) => d.violation24sec },
  { key: "backcourtViolation", label: "バックコート", value: (d) => d.backcourtViolation },
  { key: "violation5sec", label: "5秒バイオレーション", value: (d) => d.violation5sec },
  { key: "violation8sec", label: "8秒バイオレーション", value: (d) => d.violation8sec },
  { key: "otherDead", label: "その他デッドボール", value: (d) => d.otherDead },
  { key: "live", label: "ライブボール（参考）", value: (d) => d.live },
  {
    key: "total",
    label: "合計",
    value: (d) =>
      d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live,
  },
];
export type TurnoverDirection = "forced" | "committed";
export const TURNOVER_DIRECTION_LABELS: Record<TurnoverDirection, string> = {
  forced: "奪った（自チームが強制）",
  committed: "記録した（相手に強制された）",
};
export function buildTeamCategoryColumns(
  category: BoxscoreTabKey,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  paintSupported: boolean,
  classificationSupported: boolean,
  foulSplit: boolean,
): Column<AllTeamsRow>[] {
  switch (category) {
    case "traditional":
      return buildTraditionalColumns(mode, perspective);
    case "advanced":
      return buildAdvancedColumns(mode, perspective);
    case "misc":
      return buildMiscColumns(mode, perspective, classificationSupported, foulSplit);
    case "scoring":
      return buildScoringColumns(mode, perspective, paintSupported, classificationSupported);
  }
}
export function teamDefaultStatKey(category: TeamRankingCategory): string {
  if (category === "shooting") return `${SHOT_TYPE_DISPLAY_ORDER[0]}_2pm`;
  if (category === "forcedTurnovers") return "total";
  return DEFAULT_SORT_KEY[category];
}

/** チームランキングの集計に渡す条件（URL の状態から決まる値）。前シーズン比較では、前季にも同じ形で渡す（DESIGN.md 218章） */
export interface TeamRankingParams {
  category: TeamRankingCategory;
  statKey: string;
  displayMode: SeasonDisplayMode;
  gameType: SeasonGameTypeFilter;
  perspective: TeamPerspective;
  filter: SituationalFilter;
  turnoverDirection: TurnoverDirection;
  period: PeriodRangeValue;
  statConditions: StatConditionsState;
}

/**
 * チームランキング（シーズン成績）の集計。シーズンを引数に取り、選んだ項目の「行・値の定義・スタッツの条件の項目」までを返す。
 * 今のシーズンの表と、前シーズン比較の前季（DESIGN.md 218章）で同じ処理を使うため、ページから切り出した。
 * enabled が false の間は何も読み込まない（前季は、比較をオンにしたときだけ読む）
 */
export function useTeamSeasonRanking(
  season: string,
  params: TeamRankingParams,
  opts: { enabled?: boolean; skipConditionItems?: boolean } = {},
) {
  const enabled = opts.enabled ?? true;
  const { category, statKey, displayMode, gameType, perspective, filter, turnoverDirection, period, statConditions } = params;
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(
    () => (enabled ? fetchTeams(season) : Promise.resolve(null)),
    [season, enabled],
  );
  // ペイント内外の内訳は、プレーバイプレーの公式の区分で数えるため全シーズンで出る（2026-09-26。DESIGN.md 155章）
  const paintSupported = true;

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, enabled ? teams : null);
  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season, enabled);

  const periodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === period) ?? SEASON_BOX_PERIOD_OPTIONS[0]!;
  // ファウルの列は、2026-27以降のシーズンではTF1・TF2・FLAG・DISR、それ以前ではUFOUL・TF。そのシーズンに無い項目・条件は外す（DESIGN.md 16-8章）
  const foulSplit = foulColumnsSplit([season]);

  // シチュエーション別フィルタ・レギュラー/プレーオフ切替を適用した後の、チームごとの対象試合
  // （TeamGameLog[]）。Q別/前後半の選択に関わらず「どの試合が対象か」自体は変わらないため、
  // 生データ取得が必要なscheduleKeyの洗い出し・試合数/勝敗（常に試合全体で決まる）の
  // 両方でこの結果を再利用する
  const scopedLogsByTeam = useMemo(() => {
    const map = new Map<string, TeamGameLog[]>();
    if (!teams || !gameLogsByTeam) return map;
    for (const team of teams) {
      const logs = gameLogsByTeam.get(team.teamId) ?? [];
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => team.teamId);
      map.set(team.teamId, filterByGameType(situational, gameType));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season]);

  // Q別/前後半選択時のみ、対象チーム全員分の生データ（StoredGame）を一括取得する。
  // 「試合」選択時はrequestedScheduleKeysが常に空配列のため、useLeagueRawGamesは何も取得しない
  const requestedScheduleKeys = useMemo(() => {
    if (periodOption.periods === null) return [];
    const keys = new Set<string>();
    for (const logs of scopedLogsByTeam.values()) for (const g of logs) keys.add(g.scheduleKey);
    return [...keys];
  }, [periodOption, scopedLogsByTeam]);
  const { gamesByScheduleKey, loading: rawGamesLoading } = useLeagueRawGames(season, requestedScheduleKeys);
  const periodDataReady = periodOption.periods === null || requestedScheduleKeys.every((k) => gamesByScheduleKey.has(k));

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const scoped = scopedLogsByTeam.get(team.teamId) ?? [];
      const wins = scoped.filter((g) => g.win).length;
      const totals =
        periodOption.periods === null
          ? sumTeamGameLogs(scoped)
          : sumTeamGameBoxTotalsForPeriod(
              scoped.flatMap((g) => {
                const game = gamesByScheduleKey.get(g.scheduleKey);
                return game ? [{ game, isHome: g.isHome }] : [];
              }),
              periodOption,
            );
      return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals };
    });
  }, [teams, gameLogsByTeam, scopedLogsByTeam, periodOption, gamesByScheduleKey]);

  // スタッツの条件の判定に使う行。Shooting・Forced TOV のカテゴリでは上の絞り込みが効かないため、
  // 絞り込みの無いレギュラーシーズン全体の値で判定する
  const seasonRows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const logs = filterByGameType(gameLogsByTeam.get(team.teamId) ?? [], "regular");
      const wins = logs.filter((g) => g.win).length;
      return { team, gamesPlayed: logs.length, wins, losses: logs.length - wins, totals: sumTeamGameLogs(logs) };
    });
  }, [teams, gameLogsByTeam]);
  // 自チームの地区で絞る（ランキングのシーズン成績。DESIGN.md 213章）。試合の絞り込み（filterGameLogs）では地区の外のチームは試合数0になるだけで
  // 一覧に残るので、そのシーズンの地区が違うチームは一覧から外す。履歴が読めるまでは空にする（絞り込みの前の順位を一瞬出さない）
  const rowsInOwnDivision: AllTeamsRow[] = useMemo(() => {
    if (!filter.ownDivision) return rows;
    if (!divisionHistory) return [];
    return rows.filter((r) => teamDivisionForSeason(divisionHistory, r.team.teamId, season) === filter.ownDivision);
  }, [rows, filter.ownDivision, divisionHistory, season]);
  const conditionRows = isBoxscoreCategory(category) ? rowsInOwnDivision : seasonRows;
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t])), [teams]);
  const conditionClassificationSupported = !isBoxscoreCategory(category) || periodOption.periods === null;
  const conditionItems = useMemo(
    () =>
      opts.skipConditionItems
        ? []
        : buildStatConditionItems(
            buildTeamConditionDefs({
              mode: displayMode,
              columnsFor: (tab, mode, p) =>
                buildTeamCategoryColumns(tab, mode, p, paintSupported, conditionClassificationSupported, foulSplit),
              sampleRows: conditionRows,
              shotTypesOf: (r) => teamById.get(r.team.teamId)?.shotTypes,
              shotGamesOf: (r) => teamById.get(r.team.teamId)?.gamesPlayed ?? 0,
              shotTypeKeys: SHOT_TYPE_DISPLAY_ORDER,
            }),
            conditionRows,
            displayMode,
          ),
    [opts.skipConditionItems, displayMode, paintSupported, conditionClassificationSupported, foulSplit, conditionRows, teamById],
  );
  const conditionActive = hasActiveStatConditions(statConditions, conditionItems);
  const passingTeamIds = useMemo(
    () =>
      conditionActive ? new Set(filterByStatConditions(conditionRows, statConditions, conditionItems).map((r) => r.team.teamId)) : null,
    [conditionActive, conditionRows, statConditions, conditionItems],
  );
  const passes = (teamId: string) => !passingTeamIds || passingTeamIds.has(teamId);

  const columns = useMemo(
    () =>
      isBoxscoreCategory(category)
        ? buildTeamCategoryColumns(category, displayMode, perspective, paintSupported, periodOption.periods === null, foulSplit)
        : [],
    [category, displayMode, perspective, paintSupported, periodOption, foulSplit],
  );
  const selectedColumn = columns.find((c) => c.key === statKey) ?? columns[0];
  const teamDef: RankableStat<AllTeamsRow> | null = selectedColumn
    ? {
        key: selectedColumn.key,
        label: selectedColumn.label,
        value: (row) => Number(selectedColumn.sortValue(row)),
        format: (row) => (selectedColumn.format ? selectedColumn.format(row) : String(selectedColumn.sortValue(row))),
        higherIsBetter: selectedColumn.higherIsBetter,
      }
    : null;

  // シューティングカテゴリ: teams.jsonのshotTypes（チーム全選手合算、2023-24シーズン以降のみ）を
  // shotTypeEntityColumns（RankingsPage/TeamsListPage/TeamDetailPageで共通利用する既存ライブラリ）に
  // そのまま渡す。試合ログ取得・シチュエーション別フィルタは不要（シーズン集計値をそのまま使う）
  const shootingColumns = useMemo(
    () =>
      shotTypeEntityColumns(
        SHOT_TYPE_DISPLAY_ORDER,
        (t: TeamSummary) => t.shotTypes,
        displayMode as "total" | "perGame",
        (t) => t.gamesPlayed,
      ),
    [displayMode],
  );
  const teamsWithShotTypes = useMemo(() => (teams ?? []).filter((t) => !!t.shotTypes && passes(t.teamId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teams, passingTeamIds]);
  const selectedShootingColumn = shootingColumns.find((c) => c.key === statKey) ?? shootingColumns[0];
  const shootingDef: RankableStat<TeamSummary> | null = selectedShootingColumn
    ? {
        key: selectedShootingColumn.key,
        label: selectedShootingColumn.label,
        value: (t) => Number(selectedShootingColumn.sortValue(t)),
        format: (t) => (selectedShootingColumn.format ? selectedShootingColumn.format(t) : String(selectedShootingColumn.sortValue(t))),
        higherIsBetter: selectedShootingColumn.higherIsBetter,
      }
    : null;

  // 強制ターンオーバーカテゴリ: teams.jsonのforcedTurnovers/turnoversCommitted
  // （Yahoo!スポーツplay-by-play由来、2023-24シーズン以降のみ）をそのまま使う
  const teamsWithForcedTurnovers = useMemo(
    () => (teams ?? []).filter((t) => !!t.forcedTurnovers && !!t.turnoversCommitted && passes(t.teamId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teams, passingTeamIds],
  );
  const selectedTurnoverItem = FORCED_TURNOVER_ITEMS.find((i) => i.key === statKey) ?? FORCED_TURNOVER_ITEMS[0]!;
  const forcedTurnoverDef: RankableStat<TeamSummary> = {
    key: selectedTurnoverItem.key,
    label: selectedTurnoverItem.label,
    value: (t) => selectedTurnoverItem.value(turnoverDirection === "forced" ? t.forcedTurnovers! : t.turnoversCommitted!),
    format: (t) =>
      String(selectedTurnoverItem.value(turnoverDirection === "forced" ? t.forcedTurnovers! : t.turnoversCommitted!)),
  };

  // 表に出す行（スタッツの条件に通ったチーム）
  const boxRows = passingTeamIds ? rowsInOwnDivision.filter((r) => passes(r.team.teamId)) : rowsInOwnDivision;

  return {
    teams,
    teamsLoading,
    teamsError,
    gameLogsByTeam,
    gameLogsLoading,
    divisionHistory,
    opponentRecords,
    periodOption,
    foulSplit,
    paintSupported,
    rawGamesLoading,
    periodDataReady,
    conditionItems,
    conditionActive,
    columns,
    teamDef,
    boxRows,
    shootingColumns,
    shootingDef,
    teamsWithShotTypes,
    forcedTurnoverDef,
    teamsWithForcedTurnovers,
  };
}
