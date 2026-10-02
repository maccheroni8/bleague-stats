import { RankedList, type RankableStat } from "../components/RankedList";
import { PlayerGameRecordRanking } from "../components/PlayerGameRecordRanking";
import { EligibilitySlider } from "../components/EligibilitySlider";
import { useSeasonFilterCleanup } from "../lib/seasonFilterCleanup";
import { postseasonLabel } from "../../shared/gameType";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { fetchPlayerCareers, fetchPlayerGameLogs, fetchPlayerPageSeasons, fetchPlayers, fetchRegisteredPlayers, fetchTeamColors, fetchTeams } from "../lib/data";
import type { PlayerCareerCounts } from "../../shared/types";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { ExportImageButton } from "../components/ExportImageButton";
import { ConditionTitle } from "../components/ConditionTitle";
import { RuleChangeFootnote } from "../components/RuleChangeFootnote";
import { isRuleChangeStatKey } from "../lib/ruleChange";
import { ExternalLinkIcon } from "../components/ExternalLinkIcon";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import type { Column } from "../components/SortableTable";
import { FilterBar } from "../components/FilterBar";
import {
  classificationAxis,
  displayModeAxis,
  gameTypeAxis,
  multiSelectAxis,
  periodAxis,
  perspectiveAxis,
  situationalAxes,
  statItemAxis,
  type FilterAxis,
} from "../lib/filterAxes";
import { filterGameLogs, isDefaultFilter, type SituationalFilter } from "../lib/situational";
import {
  SEASON_ADVANCED_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  SEASON_MISC_COLUMNS,
  SEASON_SCORING_COLUMNS,
  SEASON_TRADITIONAL_COLUMNS,
  EMPTY_TEAM_TOTALS,
  buildPeriodFilteredRawTotals,
  buildSeasonBoxscoreCtx,
  computeGamePeriodTotals,
  countDigits,
  countDoubleTripleDoubles,
  filterByGameType,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  type GamePeriodTotals,
  type PlayerSeasonRawTotals,
  type SeasonBoxTabKey,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamSeasonRawTotals,
} from "../lib/playerSeasonBoxscore";
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
} from "../lib/teamStatsColumns";
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeEntityColumns, shotTypeLabel } from "../lib/shotTypeBreakdown";
import { useAllTeamGameLogs, useLeagueRawGames, useLeagueSituationalContext } from "../lib/teamRankingData";
import {
  matchesClassificationGroupFilter,
  matchesPositionFilter,
  positionFilterOptions,
  selectedPositionLabels,
} from "../lib/classificationFilter";
import {
  EXTRA_ELIGIBILITY_RULES,
  MIN_GAMES_PLAYED_RATIO_FOR_RANKING,
  filterEligiblePlayers,
} from "../lib/playerRankingEligibility";
import { formatDecimal } from "../lib/format";
import {
  buildExportFilename,
  classificationLabels,
  composeLabels,
  displayModeLabels,
  eligibilityLabels,
  multiSelectLabels,
  gameTypeLabels,
  perspectiveLabels,
  periodLabels,
  SEASON_TOTAL_ONLY_LABELS,
  SITUATIONAL_DEFAULT_LABEL,
  situationalFilterLabels,
} from "../lib/conditionLabels";
import { HeightWeightNote } from "../components/HeightWeightNote";
import { AGE_BASE_NOTE, ageBaseDateLabel, ageForSeason } from "../lib/age";
import { heightText, positionText, weightText } from "../lib/profileMark";
import { statDescription, type StatScope } from "../lib/statDescriptions";
import { StatHeaderLabel } from "../components/StatHeaderLabel";
import type { PlayerGameLog, PlayerSummary, TeamColors, TeamForcedTurnovers, TeamGameLog, TeamSummary } from "../../shared/types";
import { useTeamLabel } from "../lib/teamLabel";
import { usePlayerLabel } from "../lib/playerLabel";
import {
  activeStatConditionKeys,
  buildStatConditionItems,
  DEFAULT_STAT_CONDITIONS,
  filterByStatConditions,
  hasActiveStatConditions,
  statConditionsTitle,
  type StatConditionItemDef,
} from "../lib/statConditions";
import { statConditionsBarExtra } from "../components/StatConditionsEditor";
import { clearUrlParams, enumParam, numberParam, situationalParam, statConditionsParam, stringParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { CLASSIFICATION_PARAM, DISPLAY_MODE_PARAM, GAME_TYPE_PARAM, PERIOD_PARAM, PERSPECTIVE_PARAM, POSITION_PARAM, RECORDS_SCOPE_PARAM } from "../lib/urlFilterParams";
import { buildTeamConditionDefs } from "../lib/teamConditionItems";
import { CAREER_CONDITION_KEY_PREFIX, CAREER_ITEM_DEFS, playerCareerConditionDefs, playerProfileConditionDefs } from "../lib/playerConditionItems";

type Mode = "team" | "player";

/** チームランキングのカテゴリ。既存のBOXSCORE_TABS（トラディショナル/アドバンスド/Misc/
 * スコアリング）に、チーム詳細ページ「チームスタッツ」タブと同じ2カテゴリ（シューティング・
 * 強制ターンオーバー）を追加したもの。この2つはteams.json（TeamSummary）に既に持っている
 * シーズン集計値（shotTypes・forcedTurnovers/turnoversCommitted）をそのまま使うため、
 * 他4カテゴリと異なりチーム試合ログの取得・シチュエーション別フィルタ・レギュラー/
 * プレーオフ切替・自チーム/opp切替の対象外（レギュラーシーズンの通算値のみ） */
type TeamRankingCategory = BoxscoreTabKey | "shooting" | "forcedTurnovers";

const BOXSCORE_TAB_KEYS = new Set<string>(BOXSCORE_TABS.map((t) => t.key));
function isBoxscoreCategory(c: TeamRankingCategory): c is BoxscoreTabKey {
  return BOXSCORE_TAB_KEYS.has(c);
}

/** 「強制ターンオーバー」カテゴリの項目定義（TeamForcedTurnoversの各フィールド＋合計）。
 * 奪った（forced）/記録した（committed）どちらの視点でも同じ項目を使う */
const FORCED_TURNOVER_ITEMS: { key: string; label: string; value: (d: TeamForcedTurnovers) => number }[] = [
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
type TurnoverDirection = "forced" | "committed";
const TURNOVER_DIRECTION_LABELS: Record<TurnoverDirection, string> = {
  forced: "奪った（自チームが強制）",
  committed: "記録した（相手に強制された）",
};

/**
 * ランキングの表・画像出力の直上に出すタイトルと、画像ファイル名。選択中の全軸を条件ラベルとして
 * 持ち、タイトル表示とファイル名を同じラベル配列から作る（src/lib/conditionLabels.ts参照）
 */
interface RankingTitleInfo {
  title: string;
  conditions: string[];
  filename: string;
}

function makeRankingTitle(kind: "チーム" | "個人", season: string, statLabel: string, conditions: string[]): RankingTitleInfo {
  return {
    title: `${season}シーズン ${kind}ランキング：${statLabel}`,
    conditions,
    filename: buildExportFilename([`${kind}ランキング`, season, statLabel, ...conditions]),
  };
}

/** シューティングの項目（キー「{シュート種別}_2pm」等）を、シュート種別ごとのグループにする（項目数が多いため） */
function shootingStatItems(columns: { key: string; label: string }[]): { key: string; label: string; group: string }[] {
  return columns.map((c) => ({
    key: c.key,
    label: c.label,
    group: shotTypeLabel(c.key.replace(/_(2pm|2pa|2ppct|3pm|3pa|3ppct)$/, "")),
  }));
}

function buildTeamCategoryColumns(
  category: BoxscoreTabKey,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  paintSupported: boolean,
  classificationSupported: boolean,
): Column<AllTeamsRow>[] {
  switch (category) {
    case "traditional":
      return buildTraditionalColumns(mode, perspective);
    case "advanced":
      return buildAdvancedColumns(mode, perspective);
    case "misc":
      return buildMiscColumns(mode, perspective, classificationSupported);
    case "scoring":
      return buildScoringColumns(mode, perspective, paintSupported, classificationSupported);
  }
}


/**
 * ランキングのURLのキー（DESIGN.md 163章）。m＝チーム/個人、cat＝カテゴリ、stat＝項目、tov＝Forced TOV の向き、
 * elig＝掲載基準の出場率（%）、ex＝項目ごとの追加の基準。共通のキー（mode・gt・v・q・cls・pos・シチュエーション・スタッツの条件）は
 * src/lib/urlFilterParams.ts・src/lib/urlState.ts
 */
const RANKING_MODE_PARAM = enumParam<Mode>("m", ["team", "player"], "team");
/** 種類（DESIGN.md 190章）: シーズン成績（今までのランキング）／1試合記録（選手のみ。チームは段階2で追加） */
type RankingKind = "season" | "game";
const RANKING_KIND_PARAM = enumParam<RankingKind>("k", ["season", "game"], "season");
const RANKING_KIND_LABELS: Record<RankingKind, string> = { season: "シーズン成績", game: "1試合記録" };
const TEAM_CATEGORY_PARAM = enumParam<TeamRankingCategory>(
  "cat",
  ["traditional", "advanced", "misc", "scoring", "shooting", "forcedTurnovers"],
  "traditional",
  { traditional: "trad", advanced: "adv", shooting: "shoot", forcedTurnovers: "tov" },
);
const PLAYER_CATEGORY_PARAM = enumParam<PlayerRankCategory>(
  "cat",
  ["traditional", "advanced", "misc", "scoring", "shooting", "profile", "career"],
  "traditional",
  { traditional: "trad", advanced: "adv", shooting: "shoot" },
);
const TURNOVER_DIRECTION_PARAM = enumParam<TurnoverDirection>("tov", ["forced", "committed"], "forced");
const DEFAULT_RANKING_FILTER: SituationalFilter = { range: { kind: "all" } };
const EMPTY_POSITIONS: string[] = [];
/** 項目のキーとして読める値か（シュートタイプの項目は日本語を含む） */
function isStatKeyLike(v: string): boolean {
  return v.length <= 64 && !/[\s,&=]/.test(v);
}
function teamDefaultStatKey(category: TeamRankingCategory): string {
  if (category === "shooting") return `${SHOT_TYPE_DISPLAY_ORDER[0]}_2pm`;
  if (category === "forcedTurnovers") return "total";
  return DEFAULT_SORT_KEY[category];
}
function playerDefaultStatKey(category: PlayerRankCategory): string {
  return category === "shooting" ? `${SHOT_TYPE_DISPLAY_ORDER[0]}_2pm` : category === "profile" ? "height" : category === "career" ? "titles" : "pts";
}
/** 掲載基準の出場率は、URLでは%の整数（elig=70）、中では割合（0.7） */
const GAMES_RATIO_ELIG_PARAM: UrlCodec<number> = {
  keys: ["elig"],
  read: (p) => {
    const v = Number(p.get("elig"));
    return p.get("elig") !== null && Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : undefined;
  },
  write: (p, v) => {
    if (Math.round(v * 100) !== Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100)) p.set("elig", String(Math.round(v * 100)));
  },
};

/**
 * ランキングページのチーム版。チーム詳細ページ「チームスタッツ」タブ・「チーム」ページ
 * 「全チームスタッツ」タブと同じ項目（トラディショナル/アドバンスド/Misc/スコアリング、
 * シチュエーション別成績、自チーム/opp/+/-、平均/合計、レギュラー/プレーオフ/合算）を
 * 使い、スタッツ項目を1つ選んで全所属チームをランキング表示する形にしたもの（DESIGN.md参照）。
 * データ計算そのものはTeamsListPage.tsxの「全チームスタッツ」タブと同じ
 * src/lib/teamStatsColumns.ts・src/lib/teamRankingData.tsを共通利用しており、
 * 見せ方だけが「多数列の一覧表」か「1項目ずつのランキング」かで異なる
 */
function TeamRankingSection({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const teamLabel = useTeamLabel();
  const exportRef = useRef<HTMLDivElement>(null);
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  // ペイント内外の内訳は、プレーバイプレーの公式の区分で数えるため全シーズンで出る（2026-09-26。DESIGN.md 155章）
  const paintSupported = true;

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, teams);
  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season);

  // ブラウザバック等でページが一度アンマウント・再マウントされても、直前のフィルタ条件を
  // 復元する（src/lib/pageStateCache.ts参照。個人・チーム詳細ページと同じ仕組み。
  // RankingsPageはteamId/playerIdのような動的パラメータを持たないため固定キーを使う）
  // カテゴリ・項目・フィルタはURLのクエリに持つ（DESIGN.md 163章）。変えても履歴は増やさず、別のページから戻るとURLから元に戻る
  const [category, setCategory] = useUrlState(TEAM_CATEGORY_PARAM, "traditional");
  const defaultTeamStat = teamDefaultStatKey(category);
  const [statKey, setStatKey] = useUrlState(stringParam("stat", defaultTeamStat, isStatKeyLike), defaultTeamStat);
  const [displayMode, setDisplayMode] = useUrlState(DISPLAY_MODE_PARAM, "perGame");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [perspective, setPerspective] = useUrlState(PERSPECTIVE_PARAM, "own");
  const [filter, setFilter] = useUrlState(situationalParam, DEFAULT_RANKING_FILTER);
  const [turnoverDirection, setTurnoverDirection] = useUrlState(TURNOVER_DIRECTION_PARAM, "forced");
  // Q別/前後半トグル。「試合」（既定値）選択時は追加の生データ取得を発生させず、既存の
  // TeamGameLog永続集計（sumTeamGameLogs）をそのまま使う。Q別/前後半選択時のみ、対象チーム
  // 全員分の生データ（StoredGame）を一括取得する（useLeagueRawGames、DESIGN.md参照）
  const [period, setPeriod] = useUrlState(PERIOD_PARAM, "all");
  const periodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === period) ?? SEASON_BOX_PERIOD_OPTIONS[0]!;
  // スタッツの条件（DESIGN.md 162章）。ブラウザバックで戻っても保持する
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);
  // シーズンで意味が変わるフィルタ（地区・月・期間指定・ポストシーズン）は、そのシーズンに無ければ外す（DESIGN.md 164・165章）
  useSeasonFilterCleanup({ season, filter, setFilter, gameType, setGameType });

  const selectCategory = (next: TeamRankingCategory) => {
    setCategory(next);
    setStatKey(teamDefaultStatKey(next));
  };

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
  const conditionRows = isBoxscoreCategory(category) ? rows : seasonRows;
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t])), [teams]);
  const conditionClassificationSupported = !isBoxscoreCategory(category) || periodOption.periods === null;
  const conditionItems = useMemo(
    () =>
      buildStatConditionItems(
        buildTeamConditionDefs({
          mode: displayMode,
          columnsFor: (tab, mode, p) => buildTeamCategoryColumns(tab, mode, p, paintSupported, conditionClassificationSupported),
          sampleRows: conditionRows,
          shotTypesOf: (r) => teamById.get(r.team.teamId)?.shotTypes,
          shotGamesOf: (r) => teamById.get(r.team.teamId)?.gamesPlayed ?? 0,
          shotTypeKeys: SHOT_TYPE_DISPLAY_ORDER,
        }),
        conditionRows,
        displayMode,
      ),
    [displayMode, paintSupported, conditionClassificationSupported, conditionRows, teamById],
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
        ? buildTeamCategoryColumns(category, displayMode, perspective, paintSupported, periodOption.periods === null)
        : [],
    [category, displayMode, perspective, paintSupported, periodOption],
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

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  const isBoxscore = isBoxscoreCategory(category);

  // 表・画像出力に出すタイトル。カテゴリごとに実際に効いている軸だけを並べる
  // （シューティング・強制ターンオーバーはシーズン通算値のみで、シチュエーション別フィルタ・
  // レギュラー/プレーオフ・自チーム/opp・Q別/前後半は対象外。その旨をラベルで明示する）
  const boxscoreCategoryLabel = BOXSCORE_TABS.find((t) => t.key === category)?.label ?? category;
  const teamBoxscoreTitle = makeRankingTitle(
    "チーム",
    season,
    teamDef?.label ?? "",
    composeLabels(
      boxscoreCategoryLabel,
      displayModeLabels(displayMode),
      gameTypeLabels(gameType, season),
      perspectiveLabels(perspective),
      situationalFilterLabels(filter),
      periodLabels(periodOption),
    ),
  );
  const teamShootingTitle = makeRankingTitle(
    "チーム",
    season,
    shootingDef?.label ?? "",
    composeLabels(CATEGORY_LABELS.shooting, displayModeLabels(displayMode), SEASON_TOTAL_ONLY_LABELS),
  );
  const teamForcedTurnoverTitle = makeRankingTitle(
    "チーム",
    season,
    forcedTurnoverDef.label,
    composeLabels(CATEGORY_LABELS.forcedTurnovers, TURNOVER_DIRECTION_LABELS[turnoverDirection], SEASON_TOTAL_ONLY_LABELS),
  );

  // フィルタバー（DESIGN.md 105章）。シューティングは表示（平均/合計）のみ、強制ターンオーバーは
  // すべて対象外（シーズン通算値のみ。方向の切替はタブ右のトグルに残す）
  const isTeamShooting = category === "shooting";
  const teamFilterDisabledReason = isBoxscore
    ? undefined
    : isTeamShooting
      ? "このカテゴリはレギュラーシーズンの通算集計値のみ対応です（表示の平均/合計だけ連動します。2023-24シーズン以降のみ対応）。"
      : "このカテゴリはレギュラーシーズンの通算集計値のみ対応で、上の絞り込みは連動しません（2023-24シーズン以降のみ対応）。";
  const teamDisplayDisabledReason = isBoxscore || isTeamShooting ? undefined : teamFilterDisabledReason;
  const teamFilterAxes: FilterAxis[] = [
    gameTypeAxis(gameType, setGameType, season, { disabledReason: teamFilterDisabledReason }),
    perspectiveAxis(perspective, setPerspective, { disabledReason: teamFilterDisabledReason }),
    displayModeAxis(displayMode, setDisplayMode, { disabledReason: teamDisplayDisabledReason }),
    periodAxis(period, setPeriod, SEASON_BOX_PERIOD_OPTIONS, { disabledReason: teamFilterDisabledReason }),
    ...situationalAxes(filter, setFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
      disabledReason: teamFilterDisabledReason,
    }),
  ];
  const clearTeamFilters = () => {
    setGameType("regular");
    setPerspective("own");
    setDisplayMode("perGame");
    setPeriod("all");
    setFilter({ range: { kind: "all" } });
    setStatConditions({ ...statConditions, conditions: [] });
  };

  return (
    <>
      <FilterBar
        axes={teamFilterAxes}
        stateKey="rankings:team"
        onClearAll={clearTeamFilters}
        advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, conditionItems, { defaultKey: "pts" })}
      />
      <div className="tab-bar-with-toggle">
        <div className="tab-bar">
          {BOXSCORE_TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-button${category === t.key ? " active" : ""}`}
              onClick={() => selectCategory(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
          <button
            className={`tab-button${category === "shooting" ? " active" : ""}`}
            onClick={() => selectCategory("shooting")}
            type="button"
          >
            {CATEGORY_LABELS.shooting}
          </button>
          <button
            className={`tab-button${category === "forcedTurnovers" ? " active" : ""}`}
            onClick={() => selectCategory("forcedTurnovers")}
            type="button"
          >
            {CATEGORY_LABELS.forcedTurnovers}
          </button>
        </div>
        {category === "forcedTurnovers" ? (
          <div className="mode-toggle">
            {(Object.keys(TURNOVER_DIRECTION_LABELS) as TurnoverDirection[]).map((d) => (
              <button
                key={d}
                className={d === turnoverDirection ? "active" : ""}
                onClick={() => setTurnoverDirection(d)}
                type="button"
              >
                {TURNOVER_DIRECTION_LABELS[d]}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <FilterBar
        axes={[
          statItemAxis(
            category === "shooting"
              ? shootingStatItems(shootingColumns)
              : category === "forcedTurnovers"
                ? FORCED_TURNOVER_ITEMS
                : columns,
            statKey,
            setStatKey,
          ),
        ]}
        stateKey="rankings:team:stat"
        simple
        wide
      />

      {conditionActive && (gameLogsLoading || !gameLogsByTeam) ? (
        <p className="loading">読み込み中...</p>
      ) : category === "shooting" ? (
        !shootingDef ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ExportImageButton targetRef={exportRef} filename={teamShootingTitle.filename} />
            <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
              <ConditionTitle title={teamShootingTitle.title} conditions={teamShootingTitle.conditions} statConditions={statConditionsTitle(statConditions, conditionItems)} />
              <RankedList
                statScope="team"
                rows={teamsWithShotTypes}
                def={shootingDef}
                rowKey={(t) => t.teamId}
                name={(t) => teamLabel(t.teamId, t.teamName)}
                linkTo={(t) => `/teams/${t.teamId}`}
                teamColor={(t) => teamColors?.[t.teamId]?.primary}
                avatar={(t) => <TeamLogo teamId={t.teamId} size={48} />}
                compact
              />
            </div>
          </>
        )
      ) : category === "forcedTurnovers" ? (
        teamsWithForcedTurnovers.length === 0 ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ExportImageButton targetRef={exportRef} filename={teamForcedTurnoverTitle.filename} />
            <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
              <ConditionTitle title={teamForcedTurnoverTitle.title} conditions={teamForcedTurnoverTitle.conditions} statConditions={statConditionsTitle(statConditions, conditionItems)} />
              <RankedList
                statScope="team"
                rows={teamsWithForcedTurnovers}
                def={forcedTurnoverDef}
                rowKey={(t) => t.teamId}
                name={(t) => teamLabel(t.teamId, t.teamName)}
                linkTo={(t) => `/teams/${t.teamId}`}
                teamColor={(t) => teamColors?.[t.teamId]?.primary}
                avatar={(t) => <TeamLogo teamId={t.teamId} size={48} />}
                compact
              />
            </div>
          </>
        )
      ) : gameLogsLoading || !gameLogsByTeam || !teamDef || rawGamesLoading || !periodDataReady ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={teamBoxscoreTitle.filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
            <ConditionTitle title={teamBoxscoreTitle.title} conditions={teamBoxscoreTitle.conditions} statConditions={statConditionsTitle(statConditions, conditionItems)} />
            <RankedList
                statScope="team"
              rows={passingTeamIds ? rows.filter((r) => passes(r.team.teamId)) : rows}
              def={teamDef}
              rowKey={(r) => r.team.teamId}
              name={(r) => teamLabel(r.team.teamId, r.team.teamName)}
              linkTo={(r) => `/teams/${r.team.teamId}`}
              teamColor={(r) => teamColors?.[r.team.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.team.teamId} size={48} />}
              compact
            />
            {category === "misc" && isRuleChangeStatKey(teamDef.key) && <RuleChangeFootnote seasons={[season]} />}
          </div>
        </>
      )}
    </>
  );
}

const PLAYER_RANK_TOP_N = 20;

/** ボックススコア列キー（SEASON_TRADITIONAL_COLUMNS等、小文字。例: "fgpct"）→掲載基準
 * （EXTRA_ELIGIBILITY_RULES、statDefs.ts由来のキャメルケース。例: "fgPct"）キーの対応 */
const BOX_KEY_TO_EXTRA_RULE_KEY: Record<string, string> = {
  fgpct: "fgPct",
  "2ppct": "twoPct",
  "3ppct": "tpPct",
  ftpct: "ftPct",
};
function extraRuleKey(statKey: string): string {
  return BOX_KEY_TO_EXTRA_RULE_KEY[statKey] ?? statKey;
}

/** 選手ランキングのカテゴリ項目1つを表す最小限の型。valueがctx（未計算ならnull）を
 * 受け取れるようにし、SeasonBoxscoreColumn（PlayerGameLog取得が要る）とPLAYER_STAT_DEFS・
 * shotTypeEntityColumns（PlayerSummaryのみで完結、ctx不要）の両方をこの形に揃えて扱う */
interface PlayerRankItem {
  key: string;
  label: string;
  higherIsBetter?: boolean;
  value: (p: PlayerSummary, ctx: SeasonBoxscoreCtx | null) => number;
  format: (p: PlayerSummary, ctx: SeasonBoxscoreCtx | null) => string;
}

/**
 * シチュエーション別フィルタ・レギュラー/プレーオフ選択が既定値のときだけ使う0コスト経路。
 * PlayerSummary.totals（シーズン合計、既に取得済み）からSeasonBoxscoreColumnが必要とする
 * PlayerSeasonRawTotalsを組み立てる。PlayByPlays由来の項目（PTSOFFTO・DUNK・被アシスト内訳・
 * ペイント/ミッドレンジ分割・在コート区間・テクニカルファウル等）はPlayerSummaryに存在しない
 * ため0で埋める（Misc/スコアリングカテゴリはこの経路を使わず常にPlayerGameLogを取得する。
 * PlayerRankingSection参照）
 */
function rawTotalsFromPlayerSummary(p: PlayerSummary): PlayerSeasonRawTotals {
  const t = p.totals;
  return {
    gamesPlayed: t.gamesPlayed,
    gamesStarted: t.gamesStarted,
    min: t.min,
    pts: t.pts,
    fgm: t.fgm,
    fga: t.fga,
    tpm: t.tpm,
    tpa: t.tpa,
    ftm: t.ftm,
    fta: t.fta,
    oreb: t.oreb,
    dreb: t.dreb,
    reb: t.reb,
    ast: t.ast,
    tov: t.tov,
    stl: t.stl,
    blk: t.blk,
    pf: t.pf,
    foulsDrawn: t.foulsDrawn,
    blockedAgainst: t.blockedAgainst,
    technicalFouls: 0,
    pt2in: 0,
    ptfb: 0,
    pt2nd: 0,
    plusMinus: t.plusMinus,
    ptsOffTov: 0,
    dunks: 0,
    basketCounts: 0,
    unsportsmanlikeFouls: 0,
    disqualifyingFouls: 0,
    offensiveFoulsCommitted: 0,
    chargesDrawn: 0,
    assisted2m: 0,
    assisted3m: 0,
    assistedFtm: 0,
    paint2m: 0,
    paint2a: 0,
    mid2m: 0,
    mid2a: 0,
    onCourtOwnPoss: 0,
    onCourtOppPoss: 0,
    onCourtSeconds: 0,
  };
}

/**
 * SeasonBoxscoreColumn（トラディショナル/アドバンスド/Misc/スコアリング共通の列定義、
 * 個人詳細ページ「シーズン別成績」・チーム詳細ページ「選手スタッツ」タブと同じ
 * src/lib/playerSeasonBoxscore.tsを再利用）をPlayerRankItemに変換する。
 * EFFのみ、0コスト経路だとtechnicalFoulsが常に0になり不正確になるため（rawTotalsFromPlayerSummary
 * 参照）、常にPlayerSummary.advanced.eff（バックエンドで正しく計算済みの値）を直接使う
 * （シチュエーション別フィルタ・レギュラー/プレーオフ選択の対象外。従来の実装と同じ扱い）
 */
/** 個人ランキングの平均/合計（DESIGN.md 179章）。30分換算は選べない */
type PlayerRankMode = "perGame" | "total";

/** EFF（シーズンの値。シチュエーション別等の対象外）。平均は players.json の1試合平均、合計はそれ×出場試合数 */
function effValue(p: PlayerSummary, mode: PlayerRankMode): number {
  return mode === "total" ? p.advanced.eff * p.gamesPlayed : p.advanced.eff;
}

function effText(p: PlayerSummary, mode: PlayerRankMode): string {
  return formatDecimal(effValue(p, mode), countDigits(mode));
}

function boxColumnItem(col: SeasonBoxscoreColumn, mode: PlayerRankMode): PlayerRankItem {
  if (col.key === "eff") {
    return {
      key: col.key,
      label: col.label,
      higherIsBetter: col.higherIsBetter,
      value: (p) => effValue(p, mode),
      format: (p) => effText(p, mode),
    };
  }
  return {
    key: col.key,
    label: col.label,
    higherIsBetter: col.higherIsBetter,
    value: (_p, ctx) => (ctx ? col.value(ctx, mode) : 0),
    format: (_p, ctx) => (ctx ? col.format(ctx, mode) : "-"),
  };
}

/**
 * 平均/合計で値が変わらない項目（割合・率・試合数）。これらとProfile・Careerでは、平均/合計の切り替えを無効にする（DESIGN.md 179章）。
 * 名前に pct を含む項目（FG%・TOV%・%PTS・PAINT2%・シューティングの 2P% 等）もここに入れる
 */
const DDTD_PERIOD_REASON = (label: string) => `「${label}」は試合全体の記録でしか判定できないため、Q別・前後半を選んでいるときは対象外です。`;

const MODE_INVARIANT_KEYS: ReadonlySet<string> = new Set(["g", "gs", "asttov", "usg", "efg", "ts", "pps", "poss", "pace", "ortg", "drtg", "netrtg", "per", "ppp"]);

function displayModeApplies(category: string, statKey: string): boolean {
  if (category === "profile" || category === "career") return false;
  return !MODE_INVARIANT_KEYS.has(statKey) && !statKey.startsWith("pct") && !statKey.endsWith("pct");
}

/** DD2・TD3（達成した試合数と出場試合数。ダブルダブル・トリプルダブルは試合全体で判定する。DESIGN.md 60-4・179章） */
interface DoubleCounts {
  dd: number;
  td: number;
  games: number;
}

/** DD2・TD3 の項目。合計は回数、平均は達成率（達成した試合÷出場試合）に、達成した試合数と出場試合数を添える */
function doubleItems(countsOf: (p: PlayerSummary) => DoubleCounts | undefined, mode: PlayerRankMode): PlayerRankItem[] {
  const defs = [
    { key: "dd2", label: "DD2", count: (c: DoubleCounts) => c.dd },
    { key: "td3", label: "TD3", count: (c: DoubleCounts) => c.td },
  ];
  return defs.map((d) => ({
    key: d.key,
    label: d.label,
    value: (p) => {
      const c = countsOf(p);
      if (!c) return 0;
      return mode === "total" ? d.count(c) : c.games > 0 ? d.count(c) / c.games : 0;
    },
    format: (p) => {
      const c = countsOf(p);
      if (!c) return "-";
      if (mode === "total") return `${d.count(c)}回`;
      const rate = c.games > 0 ? (100 * d.count(c)) / c.games : 0;
      return `${rate.toFixed(1)}%（${d.count(c)}/${c.games}）`;
    },
  }));
}

/** スタッツの条件で判定する DD2・TD3 の表示（平均は「45.0%」、合計は「27」） */
function doubleConditionText(c: DoubleCounts | undefined, count: number | undefined, mode: PlayerRankMode): string {
  if (!c || count === undefined) return "-";
  if (mode === "total") return String(count);
  return `${(c.games > 0 ? (100 * count) / c.games : 0).toFixed(1)}%`;
}

const SEASON_BOX_COLUMNS_BY_TAB: Record<SeasonBoxTabKey, SeasonBoxscoreColumn[]> = {
  traditional: SEASON_TRADITIONAL_COLUMNS,
  advanced: SEASON_ADVANCED_COLUMNS,
  misc: SEASON_MISC_COLUMNS,
  scoring: SEASON_SCORING_COLUMNS,
};

/** アドバンスドカテゴリのみ、SeasonBoxscoreColumnには無いPER・PPP（statDefs.ts、シーズン合計値の
 * みでフィルタ非対応）を追加する。ランキングページが従来から提供していた項目を引き続き
 * 使えるようにするための補完 */
const EXTRA_ADVANCED_PLAYER_ITEMS: PlayerRankItem[] = PLAYER_STAT_DEFS.filter((d) => d.key === "per" || d.key === "ppp").map(
  (d) => ({
    key: d.key,
    label: d.label,
    higherIsBetter: d.higherIsBetter,
    value: (p: PlayerSummary) => d.value(p),
    format: (p: PlayerSummary) => d.format(p),
  }),
);

/**
 * 「プロフィール」カテゴリの項目（身長・体重・年齢）。値はPlayerSummaryのみで完結し（ctx不要）、
 * シチュエーション別フィルタ・レギュラー/プレーオフ・Q別/前後半の対象外。値が無い選手（マスタ未登録・
 * 生年月日欠損）は0扱いで下位に並べず、ランキングから除外する（rowsのuseMemo参照）。
 * 身長・体重はplayers.jsonの値
 * （終了したシーズンは当時の値。補った値には＊。DESIGN.md 148章）。年齢はageForSeason()
 * （そのシーズンの6月30日か今日（日本時間）の早い方の時点。DESIGN.md 172章）
 */
function buildProfileItems(season: string): PlayerRankItem[] {
  return [
    {
      key: "height",
      label: "身長",
      value: (p) => p.heightCm ?? 0,
      format: (p) => heightText(p) ?? "-",
    },
    {
      key: "weight",
      label: "体重",
      value: (p) => p.weightKg ?? 0,
      format: (p) => weightText(p) ?? "-",
    },
    {
      key: "age",
      label: "年齢",
      value: (p) => (p.birthDate ? ageForSeason(p.birthDate, season) : 0),
      format: (p) => (p.birthDate ? `${ageForSeason(p.birthDate, season)}歳` : "-"),
    },
  ];
}

/**
 * 「キャリア」カテゴリの項目（DESIGN.md 145章）。値は data/player-careers.json の、選んだシーズンの終了時点までの累計
 * （Bリーグ 2016-17 以降、B1／B.PREMIER の記録だけ）。0 の選手はランキングに並べない（rows の useMemo 参照）。
 * 項目の一覧（CAREER_ITEM_DEFS）はスタッツの条件と共通（src/lib/playerConditionItems.ts）
 */
function buildCareerItems(careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined): PlayerRankItem[] {
  return CAREER_ITEM_DEFS.map((d) => ({
    key: d.key,
    label: d.label,
    value: (p) => careerOf(p)?.[d.key] ?? 0,
    format: (p) => `${careerOf(p)?.[d.key] ?? 0}${d.unit}`,
  }));
}

const CAREER_NOTE =
  "回数はBリーグ（2016-17シーズン）以降、B1（B.PREMIER）の記録から数えた、このシーズン終了時点までの累計です（進行中のシーズンは現時点まで）。対象はこのシーズンに登録していた選手です（出場の有無は問いません）";

/**
 * スタッツの条件に使うと、選手の試合ログの読み込みが要る項目（Misc・Scoringのカテゴリにだけある項目）。
 * G・GS・MIN等、複数のカテゴリにある項目はトラディショナル側の扱い（読み込み不要）
 */
const PLAYER_CONDITION_KEYS_NEEDING_LOGS: ReadonlySet<string> = (() => {
  const seen = new Set<string>();
  const needs = new Set<string>();
  for (const tab of SEASON_BOX_TABS) {
    for (const col of SEASON_BOX_COLUMNS_BY_TAB[tab.key]) {
      if (seen.has(col.key)) continue;
      seen.add(col.key);
      if (tab.key === "misc" || tab.key === "scoring") needs.add(col.key);
    }
  }
  return needs;
})();

/**
 * 選手ランキングのスタッツの条件に選べる項目（DESIGN.md 162章）。今のタブに限らず全カテゴリから選べる。
 * ボックススコアの項目はランキングと同じ1試合平均の値（Q別・シチュエーション別を選んでいればその値）。
 * EFF・PER・PPP・シューティング・プロフィール・キャリアは、ランキングの表示と同じシーズン通算の値
 */
function buildPlayerConditionDefs(
  season: string,
  mode: PlayerRankMode,
  ctxOf: (p: PlayerSummary, mode: PlayerRankMode) => SeasonBoxscoreCtx | null,
  shootingPerGame: Column<PlayerSummary>[],
  shootingTotal: Column<PlayerSummary>[],
  careerOf: (p: PlayerSummary) => PlayerCareerCounts | undefined,
  doublesOf: (p: PlayerSummary) => DoubleCounts | undefined,
  ddtdOff: boolean,
): StatConditionItemDef<PlayerSummary>[] {
  // 判定は今の平均/合計の値（display）。displayOther は逆のほう（カウント系かの判定に使う。DESIGN.md 179章）
  const other: PlayerRankMode = mode === "total" ? "perGame" : "total";
  const defs: StatConditionItemDef<PlayerSummary>[] = [];
  for (const tab of SEASON_BOX_TABS) {
    for (const col of SEASON_BOX_COLUMNS_BY_TAB[tab.key]) {
      if (col.key === "eff") {
        defs.push({ key: "eff", label: col.label, group: tab.label, display: (p) => effText(p, mode), displayOther: (p) => effText(p, other), seasonTotal: true });
        continue;
      }
      defs.push({
        key: col.key,
        label: col.label,
        group: tab.label,
        display: (p) => {
          const ctx = ctxOf(p, mode);
          return ctx ? col.format(ctx, mode) : "-";
        },
        displayOther: (p) => {
          const ctx = ctxOf(p, other);
          return ctx ? col.format(ctx, other) : "-";
        },
      });
    }
    if (tab.key === "traditional") {
      // Q別/前後半を選んでいるときは値なし（「-」）で、条件に当てはまる選手がいなくなる（DESIGN.md 180章）
      const dd = (p: PlayerSummary, m: PlayerRankMode) => (ddtdOff ? "-" : doubleConditionText(doublesOf(p), doublesOf(p)?.dd, m));
      const td = (p: PlayerSummary, m: PlayerRankMode) => (ddtdOff ? "-" : doubleConditionText(doublesOf(p), doublesOf(p)?.td, m));
      defs.push(
        { key: "dd2", label: "DD2", group: tab.label, display: (p) => dd(p, mode), displayOther: (p) => dd(p, other) },
        { key: "td3", label: "TD3", group: tab.label, display: (p) => td(p, mode), displayOther: (p) => td(p, other) },
      );
    }
    if (tab.key === "advanced") {
      for (const item of EXTRA_ADVANCED_PLAYER_ITEMS) {
        defs.push({ key: item.key, label: item.label, group: tab.label, display: (p) => item.format(p, null), seasonTotal: true });
      }
    }
  }
  const cellText = (c: Column<PlayerSummary>, p: PlayerSummary) => (c.format ? c.format(p) : String(c.sortValue(p)));
  const shootingShown = mode === "total" ? shootingTotal : shootingPerGame;
  const shootingOther = mode === "total" ? shootingPerGame : shootingTotal;
  shootingShown.forEach((c, i) => {
    const o = shootingOther[i];
    defs.push({
      key: c.key,
      label: c.label,
      group: CATEGORY_LABELS.shooting,
      display: (p) => cellText(c, p),
      displayOther: o ? (p) => cellText(o, p) : undefined,
      seasonTotal: true,
    });
  });
  // 出場0試合の選手（Profile の対象に入る。DESIGN.md 173章）は、スタッツの項目を値なし（「-」）とし、条件に当てはまらない扱いにする
  const noGames = (p: PlayerSummary) => p.gamesPlayed === 0;
  const statDefs = defs.map((d) => ({
    ...d,
    display: (p: PlayerSummary) => (noGames(p) ? "-" : d.display(p)),
    displayOther: d.displayOther ? (p: PlayerSummary) => (noGames(p) ? "-" : d.displayOther!(p)) : undefined,
  }));
  return [...statDefs, ...playerProfileConditionDefs(season), ...playerCareerConditionDefs(careerOf)];
}

// 公式の選手ページで身長・体重が載っていない選手は 0 で入っているので、0 も値なしとして並べない（DESIGN.md 173章）
function profileItemHasValue(p: PlayerSummary, statKey: string): boolean {
  if (statKey === "weight") return !!p.weightKg;
  if (statKey === "age") return !!p.birthDate;
  return !!p.heightCm;
}

/** 選手ランキングのカテゴリ。チーム版・チーム詳細ページ「選手スタッツ」タブと同じ
 * トラディショナル/アドバンスド/Misc/スコアリング（SeasonBoxTabKey）に、シューティングを
 * 追加したもの */
type PlayerRankCategory = SeasonBoxTabKey | "shooting" | "profile" | "career";

/**
 * ランキングページの選手版。掲載基準（所属チーム試合数の85%以上に出場、3P%/FT%/FG%/2P%は
 * さらに1試合あたりの試投/成功数の下限を併用）をスライダーで調整できるようにし、トップ20を
 * 表示する（DESIGN.md参照）。国籍区分の複数選択フィルタ・シチュエーション別フィルタにも対応する。
 *
 * 項目はチーム版ランキング・チーム詳細ページ「選手スタッツ」タブと同じトラディショナル/
 * アドバンスド/Misc/スコアリング（src/lib/playerSeasonBoxscore.ts）＋シューティング
 * （src/lib/shotTypeBreakdown.ts、shotTypeEntityColumns）のカテゴリから選べる。シチュエーション
 * 別フィルタ・レギュラー/プレーオフ選択が既定値のときは対象選手のPlayerSummary（既に取得済み）
 * だけで完結する0コスト経路を使い、フィルタが有効、またはMisc/スコアリングカテゴリ選択時
 * （PlayByPlays由来の項目のみでPlayerSummaryに存在しないため常に必要）だけ、対象選手
 * （掲載基準・国籍区分フィルタ通過後）分のPlayerGameLogを取得する
 * （PlayersListPage.tsxの「全選手スタッツ」タブと同じ「フィルタ選択時のみ取得する」遅延方式）
 */
function PlayerRankingSection({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const { data: players, loading: playersLoading, error: playersError } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  // USG%・%-shareスタッツ・個人ORtg/DRtgの分母（チーム総計）用に、チーム版ランキングと共通の
  // フックで26チーム分のTeamGameLogを取得する
  const { gameLogsByTeam } = useAllTeamGameLogs(season, teams);

  // ブラウザバック等でページが一度アンマウント・再マウントされても、直前のフィルタ条件を
  // 復元する（src/lib/pageStateCache.ts参照）
  // カテゴリ・項目・フィルタはURLのクエリに持つ（DESIGN.md 163章）。elig＝掲載基準の出場率（%）、ex＝項目ごとの追加の基準
  const [category, setCategory] = useUrlState(PLAYER_CATEGORY_PARAM, "traditional");
  const defaultPlayerStat = playerDefaultStatKey(category);
  const [statKey, setStatKey] = useUrlState(stringParam("stat", defaultPlayerStat, isStatKeyLike), defaultPlayerStat);
  const [gamesRatio, setGamesRatio] = useUrlState(GAMES_RATIO_ELIG_PARAM, MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
  const defaultExtra = EXTRA_ELIGIBILITY_RULES[extraRuleKey(statKey)]?.defaultValue ?? 0;
  const [extraThreshold, setExtraThreshold] = useUrlState(numberParam("ex", defaultExtra, { min: 0 }), defaultExtra);
  const [selectedClassification, setSelectedClassification] = useUrlState(CLASSIFICATION_PARAM, "all");
  // ポジション（複数選択、未選択＝全ポジション）。登録どおり（PG・PG/SG 等の完全一致）で、どれかに当てはまる選手（DESIGN.md 171章）
  const [positions, setPositions] = useUrlState(POSITION_PARAM, EMPTY_POSITIONS);
  const positionOptions = useMemo(() => positionFilterOptions(players, positions), [players, positions]);
  const [filter, setFilter] = useUrlState(situationalParam, DEFAULT_RANKING_FILTER);
  const filterActive = !isDefaultFilter(filter);
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const gameTypeActive = gameType !== "regular";
  // 平均/合計（チーム版と同じ URL のキー mode。DESIGN.md 179章）
  const [displayMode, setDisplayMode] = useUrlState(DISPLAY_MODE_PARAM, "perGame");
  // Q別/前後半トグル。「試合」（既定値）選択時は追加の生データ取得を発生させず、既存の
  // PlayerSummary/PlayerGameLogベースの経路をそのまま使う。Q別/前後半選択時のみ、対象選手
  // 全員分の生データ（StoredGame）を一括取得する（useLeagueRawGames、DESIGN.md参照）
  const [period, setPeriod] = useUrlState(PERIOD_PARAM, "all");
  const periodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === period) ?? SEASON_BOX_PERIOD_OPTIONS[0]!;
  const periodActive = periodOption.periods !== null;
  // スタッツの条件（DESIGN.md 162章）。ブラウザバックで戻っても保持する
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);
  // シーズンで意味が変わるフィルタ（地区・月・期間指定・ポストシーズン）は、そのシーズンに無ければ外す（DESIGN.md 164・165章）
  useSeasonFilterCleanup({ season, filter, setFilter, gameType, setGameType });
  const conditionKeys = activeStatConditionKeys(statConditions);
  const conditionNeedsLogs = conditionKeys.some((k) => PLAYER_CONDITION_KEYS_NEEDING_LOGS.has(k));
  const conditionNeedsCareers = conditionKeys.some((k) => k.startsWith(CAREER_CONDITION_KEY_PREFIX));

  const { divisionHistory, opponentRecords, playerOwnTeamOf } = useLeagueSituationalContext(season);

  const [gameLogsByPlayer, setGameLogsByPlayer] = useState<Map<string, PlayerGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(false);
  const fetchedPlayerIdsRef = useRef<Set<string>>(new Set());

  const selectCategory = (next: PlayerRankCategory) => {
    setCategory(next);
    const nextKey = playerDefaultStatKey(next);
    setStatKey(nextKey);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[extraRuleKey(nextKey)]?.defaultValue ?? 0);
  };
  const selectStat = (next: string) => {
    setStatKey(next);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[extraRuleKey(next)]?.defaultValue ?? 0);
  };

  // 「キャリア」カテゴリを開いたときだけ取得する
  const careersNeeded = category === "career" || conditionNeedsCareers;
  const { data: careers, loading: careersLoading } = useJsonData(
    () => (careersNeeded ? fetchPlayerCareers() : Promise.resolve(null)),
    [careersNeeded],
  );
  const careerBySeason = careers?.seasons[season];
  // Profile・Career の対象に加える、試合に一度も名前が無い登録選手（DESIGN.md 173・175章）。どちらかを開いたときだけ取得する
  const registeredTarget = category === "profile" || category === "career";
  const { data: registeredPlayers, loading: registeredLoading } = useJsonData(
    () => (registeredTarget ? fetchRegisteredPlayers(season) : Promise.resolve(null)),
    [registeredTarget, season],
  );

  const registeredOnlyIds = useMemo(() => new Set((registeredPlayers ?? []).map((p) => p.playerId)), [registeredPlayers]);
  // 名簿から足した選手（このシーズンに個人ページが無い）の名前は、個人ページがある一番新しいシーズンへつなぐ（表示は待たない。DESIGN.md 174章）
  const { data: playerPageSeasons } = useJsonData(
    () => (registeredTarget ? fetchPlayerPageSeasons() : Promise.resolve(null)),
    [registeredTarget],
  );

  const eligible: PlayerSummary[] = useMemo(() => {
    if (!players || !teams) return [];
    const positionSet = new Set(positions);
    // Profile・Career: 掲載基準（出場率）を使わず、そのシーズンに登録していた選手全員（出場の有無を問わない。DESIGN.md 173・175章）
    if (registeredTarget) {
      return [...players, ...(registeredPlayers ?? [])].filter(
        (p) => matchesClassificationGroupFilter(p, selectedClassification) && matchesPositionFilter(p, positionSet),
      );
    }
    const base = filterEligiblePlayers(players, teams, gamesRatio, extraRuleKey(statKey), extraThreshold).filter(
      (p) => matchesClassificationGroupFilter(p, selectedClassification) && matchesPositionFilter(p, positionSet),
    );
    return category === "shooting" ? base.filter((p) => !!p.shotTypes) : base;
  }, [players, teams, gamesRatio, statKey, extraThreshold, selectedClassification, positions, category, registeredTarget, registeredPlayers]);

  // シーズンが変わったら取得済みキャッシュをリセットする
  useEffect(() => {
    fetchedPlayerIdsRef.current = new Set();
    setGameLogsByPlayer(null);
  }, [season]);

  // シチュエーション別フィルタ・レギュラー/プレーオフ切替が既定値以外、Misc/スコアリング
  // カテゴリ選択時（PlayByPlays由来の項目のみでシーズン集計に存在しない）、またはQ別/前後半
  // トグル選択時（対象試合のscheduleKey一覧・isHomeを得るのにPlayerGameLogが要る）だけ、
  // 対象選手（掲載基準・国籍区分フィルタ通過後）分のPlayerGameLogを取得する
  // （PlayersListPage.tsxの「全選手スタッツ」タブと同じ遅延取得方針）。出場率スライダー等で
  // 対象選手が増えても、既に取得済みの選手は再取得せず差分だけ追加する
  // シューティング・プロフィール・キャリアのカテゴリでは試合種別・シチュエーション別・Q別/前後半が効かない。
  // そのカテゴリを開いているときにスタッツの条件でボックススコアの項目を使うと、絞り込みの無いシーズンの値で判定する
  const filtersApply = category !== "shooting" && category !== "profile" && category !== "career";
  const effFilter: SituationalFilter = filtersApply ? filter : { range: { kind: "all" } };
  const effGameType: SeasonGameTypeFilter = filtersApply ? gameType : "regular";
  const effPeriodActive = filtersApply && periodActive;
  const needsGameLogRecompute =
    (filtersApply && (filterActive || gameTypeActive || periodActive)) || category === "misc" || category === "scoring" || conditionNeedsLogs;
  useEffect(() => {
    if (!needsGameLogRecompute || eligible.length === 0) return;
    const missing = eligible.filter((p) => !fetchedPlayerIdsRef.current.has(p.playerId));
    if (missing.length === 0) return;
    let cancelled = false;
    setGameLogsLoading(true);
    for (const p of missing) fetchedPlayerIdsRef.current.add(p.playerId);
    Promise.all(
      missing.map(async (p): Promise<readonly [string, PlayerGameLog[]]> => {
        try {
          return [p.playerId, await fetchPlayerGameLogs(season, p.playerId)] as const;
        } catch {
          return [p.playerId, [] as PlayerGameLog[]] as const;
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setGameLogsByPlayer((prev) => {
          const next = new Map(prev ?? []);
          for (const [id, logs] of results) next.set(id, logs);
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setGameLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [needsGameLogRecompute, eligible, season]);

  // USG%・%-shareスタッツ・個人ORtg/DRtgの分母（チーム総計）。gameLogsByTeamから選手側と
  // 同じシチュエーション別フィルタ・レギュラー/プレーオフ条件で組み立てる
  const teamTotalsByTeamId = useMemo<Map<string, TeamSeasonRawTotals> | null>(() => {
    if (!gameLogsByTeam) return null;
    const map = new Map<string, TeamSeasonRawTotals>();
    for (const [teamId, logs] of gameLogsByTeam) {
      const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => teamId);
      const scoped = filterByGameType(situational, effGameType);
      map.set(teamId, sumTeamGameLogsFor(scoped, new Set(scoped.map((g) => g.scheduleKey))));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameLogsByTeam, filtersApply, filter, gameType, opponentRecords, divisionHistory, season]);

  // Q別/前後半選択時のみ、対象選手全員分の生データ（StoredGame）を一括取得する。
  // 「試合」選択時はrequestedScheduleKeysが常に空配列のため、useLeagueRawGamesは何も取得しない。
  // gameLogsByPlayerが揃っていない間（fetch中）は一旦空扱いにし、揃い次第再計算される
  const requestedScheduleKeys = useMemo(() => {
    if (!effPeriodActive || !gameLogsByPlayer) return [];
    const keys = new Set<string>();
    for (const p of eligible) {
      const logs = gameLogsByPlayer.get(p.playerId) ?? [];
      const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
      const scoped = filterByGameType(situational, effGameType);
      for (const g of scoped) keys.add(g.scheduleKey);
    }
    return [...keys];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effPeriodActive, gameLogsByPlayer, eligible, filtersApply, filter, gameType, opponentRecords, divisionHistory, season, playerOwnTeamOf]);
  const { gamesByScheduleKey, loading: rawGamesLoading } = useLeagueRawGames(season, requestedScheduleKeys);
  const periodDataReady = !effPeriodActive || requestedScheduleKeys.every((k) => gamesByScheduleKey.has(k));

  const seasonStartYear = Number(season.split("-")[0]);
  const ctxByPlayer = useMemo<Map<string, SeasonBoxscoreCtx> | null>(() => {
    if (!teamTotalsByTeamId) return null;
    if (needsGameLogRecompute && !gameLogsByPlayer) return null;
    if (effPeriodActive && !periodDataReady) return null;
    const map = new Map<string, SeasonBoxscoreCtx>();
    for (const p of eligible) {
      if (effPeriodActive) {
        // Q別/前後半: 試合単位で生データから組み立てる（team総計もこの選手が出場した試合の
        // 期間限定値。個人詳細ページのQ別/前後半トグルと同じ設計、DESIGN.md参照）
        const logs = gameLogsByPlayer!.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
        const scoped = filterByGameType(situational, effGameType);
        const contributions: GamePeriodTotals[] = [];
        for (const log of scoped) {
          const game = gamesByScheduleKey.get(log.scheduleKey);
          if (!game) continue;
          const c = computeGamePeriodTotals(game, log.isHome, p.playerId, periodOption);
          if (c) contributions.push(c);
        }
        const { raw, team } = buildPeriodFilteredRawTotals(contributions);
        map.set(p.playerId, buildSeasonBoxscoreCtx(raw, team, "perGame", seasonStartYear));
        continue;
      }
      const team = teamTotalsByTeamId.get(p.teamId) ?? EMPTY_TEAM_TOTALS;
      if (needsGameLogRecompute) {
        const logs = gameLogsByPlayer!.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
        const scoped = filterByGameType(situational, effGameType);
        map.set(p.playerId, buildSeasonBoxscoreCtx(sumPlayerGameLogs(scoped), team, "perGame", seasonStartYear));
      } else {
        map.set(p.playerId, buildSeasonBoxscoreCtx(rawTotalsFromPlayerSummary(p), team, "perGame", seasonStartYear));
      }
    }
    return map;
  }, [
    teamTotalsByTeamId,
    needsGameLogRecompute,
    gameLogsByPlayer,
    eligible,
    filtersApply,
    filter,
    gameType,
    opponentRecords,
    divisionHistory,
    season,
    playerOwnTeamOf,
    seasonStartYear,
    effPeriodActive,
    periodDataReady,
    periodOption,
    gamesByScheduleKey,
  ]);

  // DD2・TD3 の回数と出場試合数（DESIGN.md 179章）。試合ログを読んでいるとき（シチュエーション別・レギュラー/ポストシーズン等）は
  // 絞り込んだ試合（出場した試合）から数え、読んでいないときは players.json のシーズンの値（レギュラーシーズン）を使う。
  // Q別/前後半を選んでも、達成は試合全体で判定する（DESIGN.md 60-4）
  const doublesByPlayer = useMemo(() => {
    const map = new Map<string, DoubleCounts>();
    for (const p of eligible) {
      if (needsGameLogRecompute && gameLogsByPlayer) {
        const logs = gameLogsByPlayer.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...effFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, playerOwnTeamOf);
        const played = filterByGameType(situational, effGameType).filter((g) => g.min > 0);
        const { dd, td } = countDoubleTripleDoubles(played);
        map.set(p.playerId, { dd, td, games: played.length });
      } else {
        map.set(p.playerId, { dd: p.totals.doubleDoubles, td: p.totals.tripleDoubles, games: p.gamesPlayed });
      }
    }
    return map;
    // effFilter・effGameType は filter・gameType・filtersApply から決まる
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, needsGameLogRecompute, gameLogsByPlayer, filtersApply, filter, gameType, opponentRecords, divisionHistory, season, playerOwnTeamOf]);

  // 平均/合計（DESIGN.md 179章）。割合の項目・Profile・Career では切り替えを無効にし、平均として扱う。
  // ctxByPlayer は1試合平均の値なので、合計のときはシーズン合計の値の ctx を作り直す
  // DD2・TD3 は試合全体の記録でしか判定できないため、Q別/前後半を選んでいるときは対象外にする（DESIGN.md 180章）
  const ddtdPeriodOff = effPeriodActive && (statKey === "dd2" || statKey === "td3");
  const modeApplies = displayModeApplies(category, statKey) && !ddtdPeriodOff;
  const rankMode: PlayerRankMode = modeApplies && displayMode === "total" ? "total" : "perGame";
  const totalCtxByPlayer = useMemo(() => {
    if (!ctxByPlayer) return null;
    const map = new Map<string, SeasonBoxscoreCtx>();
    for (const [id, c] of ctxByPlayer) map.set(id, buildSeasonBoxscoreCtx(c.raw, c.team, "total", c.seasonStartYear));
    return map;
  }, [ctxByPlayer]);
  const ctxFor = (p: PlayerSummary, mode: PlayerRankMode) => (mode === "total" ? totalCtxByPlayer : ctxByPlayer)?.get(p.playerId) ?? null;

  // シチュエーション別フィルタで対象試合が0件になった選手は、"0"のまま下位に並べず除外する
  // （旧situationalByPlayerが null を返していたときと同じ扱い）。シューティングカテゴリは
  // 常にシーズン集計（掲載基準通過者全員）をそのまま表示する
  const rows: PlayerSummary[] = useMemo(() => {
    if (category === "profile") return eligible.filter((p) => profileItemHasValue(p, statKey));
    if (category === "career") return eligible.filter((p) => (careerBySeason?.[p.playerId]?.[statKey as keyof PlayerCareerCounts] ?? 0) > 0);
    if (category === "shooting" || !ctxByPlayer) return eligible;
    const played = eligible.filter((p) => (ctxByPlayer.get(p.playerId)?.raw.gamesPlayed ?? 0) > 0);
    // DD2・TD3 は0回（0%）の選手を並べない（平均・合計とも。DESIGN.md 179章）
    if (statKey === "dd2" || statKey === "td3") {
      return played.filter((p) => {
        const c = doublesByPlayer.get(p.playerId);
        return !!c && (statKey === "dd2" ? c.dd : c.td) > 0;
      });
    }
    return played;
  }, [eligible, ctxByPlayer, category, statKey, careerBySeason, doublesByPlayer]);

  const shootingColumns = useMemo(
    () => shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, "perGame", (p) => p.gamesPlayed),
    [],
  );
  const shootingColumnsTotal = useMemo(
    () => shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, "total", (p) => p.gamesPlayed),
    [],
  );
  const currentItems: PlayerRankItem[] = useMemo(() => {
    if (category === "shooting") {
      return (rankMode === "total" ? shootingColumnsTotal : shootingColumns).map((c) => ({
        key: c.key,
        label: c.label,
        higherIsBetter: c.higherIsBetter,
        value: (p: PlayerSummary) => Number(c.sortValue(p)),
        format: (p: PlayerSummary) => (c.format ? c.format(p) : String(c.sortValue(p))),
      }));
    }
    if (category === "profile") return buildProfileItems(season);
    if (category === "career") return buildCareerItems((p) => careerBySeason?.[p.playerId]);
    const items = SEASON_BOX_COLUMNS_BY_TAB[category].map((col) => boxColumnItem(col, rankMode));
    if (category === "traditional") return [...items, ...doubleItems((p) => doublesByPlayer.get(p.playerId), rankMode)];
    return category === "advanced" ? [...items, ...EXTRA_ADVANCED_PLAYER_ITEMS] : items;
  }, [category, shootingColumns, shootingColumnsTotal, season, careerBySeason, rankMode, doublesByPlayer]);

  // スタッツの条件（DESIGN.md 162章）。今のタブに限らず全カテゴリの項目で、ランキングに出す行を絞り込む
  const conditionItems = useMemo(
    () =>
      buildStatConditionItems(
        buildPlayerConditionDefs(
          season,
          rankMode,
          (p, mode) => (mode === "total" ? totalCtxByPlayer : ctxByPlayer)?.get(p.playerId) ?? null,
          shootingColumns,
          shootingColumnsTotal,
          (p) => careers?.seasons[season]?.[p.playerId],
          (p) => doublesByPlayer.get(p.playerId),
          effPeriodActive,
        ),
        eligible,
        rankMode,
      ),
    [season, rankMode, ctxByPlayer, totalCtxByPlayer, shootingColumns, shootingColumnsTotal, careers, eligible, doublesByPlayer, effPeriodActive],
  );
  const conditionActive = hasActiveStatConditions(statConditions, conditionItems);
  const shownRows = useMemo(
    () => (conditionActive ? filterByStatConditions(rows, statConditions, conditionItems) : rows),
    [conditionActive, rows, statConditions, conditionItems],
  );
  // スマホ幅では名字だけ（同じ一覧で名字が重なる選手はフルネーム）
  const playerLabel = usePlayerLabel(shownRows.map((p) => p.name));
  const teamLabel = useTeamLabel();

  const selectedItem = currentItems.find((i) => i.key === statKey) ?? currentItems[0]!;
  const rankDef: RankableStat<PlayerSummary> = {
    key: selectedItem.key,
    label: selectedItem.label,
    higherIsBetter: selectedItem.higherIsBetter,
    value: (p) => selectedItem.value(p, ctxFor(p, rankMode)),
    format: (p) => selectedItem.format(p, ctxFor(p, rankMode)),
  };

  // 「プロフィール」カテゴリの年齢の基準日ラベル（表・画像出力に出す。そのシーズンの6月30日か今日の早い方。DESIGN.md 172章）。
  // 身長・体重は当時の値（補った値には＊。DESIGN.md 148章）なので基準日は出さない
  const profileBaseDateLabel = category === "profile" && selectedItem.key === "age" ? ageBaseDateLabel(season) : null;

  const extraRule = EXTRA_ELIGIBILITY_RULES[extraRuleKey(statKey)];
  const waitingForGameLogs =
    (needsGameLogRecompute && (gameLogsLoading || !gameLogsByPlayer)) ||
    !teamTotalsByTeamId ||
    !ctxByPlayer ||
    (effPeriodActive && (rawGamesLoading || !periodDataReady)) ||
    (careersNeeded && (careersLoading || !careers)) ||
    (registeredTarget && (registeredLoading || !registeredPlayers));

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;
  if (!players || players.length === 0) return <p className="empty-message">データがありません</p>;

  // 表・画像出力に出すタイトル。EFF/PER/PPPはシチュエーション・G・Q別の対象外（シーズン合計値を
  // そのまま表示している。上の注記と同じ条件）ため、いずれかの絞り込みが有効なときは実際の値の
  // 範囲（レギュラーシーズン・シーズン全体・試合全体）を出し、対象外である旨を添える
  const filterIgnoredForItem =
    category !== "shooting" &&
    ["eff", "per", "ppp"].includes(selectedItem.key) &&
    (filterActive || gameTypeActive || periodActive);
  const playerCategoryLabel =
    category === "shooting"
      ? CATEGORY_LABELS.shooting
      : category === "profile" || category === "career"
        ? CATEGORY_LABELS[category]
        : (SEASON_BOX_TABS.find((t) => t.key === category)?.label ?? category);
  const playerScopeLabels =
    category === "shooting"
      ? SEASON_TOTAL_ONLY_LABELS
      : category === "profile"
        ? []
        : category === "career"
          ? ["Bリーグ（2016-17）以降の累計"]
        : filterIgnoredForItem
          ? composeLabels(gameTypeLabels("regular", null), SITUATIONAL_DEFAULT_LABEL, "試合全体", "※この項目はフィルタ対象外")
          : composeLabels(gameTypeLabels(gameType, season), situationalFilterLabels(filter), periodLabels(periodOption));
  const playerTitle = makeRankingTitle(
    "個人",
    season,
    selectedItem.label,
    composeLabels(
      playerCategoryLabel,
      // 登録区分は選手名の下に書かないので、指定したときはタイトルの下の行に書く（「全選手」は書かない。DESIGN.md 170章）
      classificationLabels(selectedClassification),
      // ポジションは選択肢が9つだけなので、選んだものを省略せずに全部書く（「他N」にしない。DESIGN.md 178章）
      multiSelectLabels("ポジション", selectedPositionLabels(positionOptions, positions), "全ポジション", Infinity),
      // 平均/合計は初期値（平均）でも必ず書く（画像だけ見ても分かるように。初期値を書かないルールの例外。DESIGN.md 179章）。
      // 切り替えの対象外の項目（割合・Profile・Career）では書かない
      modeApplies ? displayModeLabels(rankMode) : [],
      playerScopeLabels,
      registeredTarget ? "登録選手" : eligibilityLabels({ gamesRatio, extra: extraRule, extraThreshold }),
      `上位${PLAYER_RANK_TOP_N}名`,
    ),
  );

  // フィルタバー（DESIGN.md 105章）。掲載基準（出場率＋項目固有の追加基準）はスライダーを
  // ポップオーバーに入れた軸として置く。シューティング・プロフィールは試合種別・S軸・Q別/前後半が対象外
  const playerFilterDisabledReason =
    category === "shooting"
      ? "このカテゴリはレギュラーシーズンの通算集計値のみ対応です（登録区分・掲載基準のみ連動します。2023-24シーズン以降のみ対応）。"
      : category === "profile"
        ? "このカテゴリは試合種別・シチュエーション別フィルタ・Q別/前後半の対象外です（登録区分・ポジションのみ適用されます）。"
        : category === "career"
          ? "このカテゴリは試合種別・シチュエーション別フィルタ・Q別/前後半の対象外です（登録区分・ポジションのみ適用されます）。"
        : undefined;
  const eligibilityDefaultExtra = extraRule?.defaultValue ?? 0;
  const eligibilitySummary = eligibilityLabels({ gamesRatio, extra: extraRule, extraThreshold }).join("・");
  const eligibilityAxis: FilterAxis = {
    kind: "popover",
    id: "eligibility",
    label: "掲載基準",
    tier: "primary",
    disabledReason: registeredTarget
      ? "このカテゴリは、このシーズンに登録していた選手全員が対象です（出場の有無を問わず、掲載基準は使いません）。"
      : undefined,
    value: `${Math.round(gamesRatio * 100)}|${extraRule ? extraThreshold : ""}`,
    defaultValue: `${Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100)}|${extraRule ? eligibilityDefaultExtra : ""}`,
    onChange: () => {
      setGamesRatio(MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
      setExtraThreshold(eligibilityDefaultExtra);
    },
    summary: eligibilitySummary,
    chipValue: eligibilitySummary,
    content: (
      <>
        <EligibilitySlider
          label="出場率"
          value={Math.round(gamesRatio * 100)}
          min={0}
          max={100}
          step={1}
          format={(v) => `${v}%`}
          onChange={(v) => setGamesRatio(v / 100)}
        />
        {extraRule && (
          <EligibilitySlider
            label={extraRule.label}
            value={extraThreshold}
            min={extraRule.min}
            max={extraRule.max}
            step={extraRule.step}
            format={(v) => `${v.toFixed(1)}${extraRule.unit}`}
            onChange={setExtraThreshold}
          />
        )}
      </>
    ),
  };
  const playerFilterAxes: FilterAxis[] = [
    classificationAxis(selectedClassification, setSelectedClassification),
    multiSelectAxis({
      id: "position",
      label: "ポジション",
      options: positionOptions,
      selected: positions,
      onChangeSelected: setPositions,
      allLabel: "全ポジション",
      maxShown: Infinity,
    }),
    gameTypeAxis(gameType, setGameType, season, { disabledReason: playerFilterDisabledReason }),
    // 対象外の項目では無効にし、平均のまま見せる（URL の mode は残すので、対象の項目に戻ると合計に戻る）
    displayModeAxis(rankMode, setDisplayMode, {
      disabledReason: modeApplies
        ? undefined
        : ddtdPeriodOff
          ? DDTD_PERIOD_REASON(selectedItem.label)
          : category === "profile" || category === "career"
          ? "このカテゴリは平均/合計の切り替えの対象外です。"
          : `「${selectedItem.label}」は割合・率（または試合数）の項目のため、平均/合計の切り替えの対象外です。`,
    }),
    periodAxis(period, setPeriod, SEASON_BOX_PERIOD_OPTIONS, { disabledReason: playerFilterDisabledReason }),
    ...situationalAxes(filter, setFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
      disabledReason: playerFilterDisabledReason,
    }),
    eligibilityAxis,
  ];
  const clearPlayerFilters = () => {
    setSelectedClassification("all");
    setPositions([]);
    setGameType("regular");
    setDisplayMode("perGame");
    setPeriod("all");
    setFilter({ range: { kind: "all" } });
    eligibilityAxis.onChange("");
    setStatConditions({ ...statConditions, conditions: [] });
  };

  return (
    <>
      <FilterBar
        axes={playerFilterAxes}
        stateKey="rankings:player"
        onClearAll={clearPlayerFilters}
        advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, conditionItems, { defaultKey: "min" })}
      />

      <div className="tab-bar">
        {SEASON_BOX_TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-button${category === t.key ? " active" : ""}`}
            onClick={() => selectCategory(t.key)}
            type="button"
          >
            {t.label}
          </button>
        ))}
        <button
          className={`tab-button${category === "shooting" ? " active" : ""}`}
          onClick={() => selectCategory("shooting")}
          type="button"
        >
          {CATEGORY_LABELS.shooting}
        </button>
        <button
          className={`tab-button${category === "profile" ? " active" : ""}`}
          onClick={() => selectCategory("profile")}
          type="button"
        >
          {CATEGORY_LABELS.profile}
        </button>
        <button
          className={`tab-button${category === "career" ? " active" : ""}`}
          onClick={() => selectCategory("career")}
          type="button"
        >
          {CATEGORY_LABELS.career}
        </button>
      </div>

      <FilterBar
        axes={[
          statItemAxis(
            category === "shooting"
              ? shootingStatItems(currentItems)
              : currentItems.map((i) =>
                  effPeriodActive && (i.key === "dd2" || i.key === "td3")
                    ? { ...i, label: `${i.label}（Q別・前後半は対象外）`, disabled: true }
                    : i,
                ),
            statKey,
            selectStat,
          ),
        ]}
        stateKey="rankings:player:stat"
        simple
        wide
      />

      <div className="filter-block">
        <p className="page-subtitle">
          対象{conditionActive ? shownRows.length : eligible.length}名中、上位{PLAYER_RANK_TOP_N}名を表示
          {conditionActive && "（スタッツの条件で絞り込んだ中での順位）"}
        </p>
        {(needsGameLogRecompute || periodActive) && ["eff", "per", "ppp"].includes(selectedItem.key) && (
          <p className="page-subtitle">
            「{selectedItem.label}」はシチュエーション別フィルタ・レギュラー/{postseasonLabel(season)}選択・Q別/前後半トグルの対象外のため、シーズン合計の値をそのまま表示しています
          </p>
        )}
      </div>

      {waitingForGameLogs ? (
        <p className="loading">読み込み中...</p>
      ) : ddtdPeriodOff ? (
        <p className="empty-message">Q別・前後半を選んでいるため、「{selectedItem.label}」の順位は表示しません。</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={playerTitle.filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle
              title={playerTitle.title}
              conditions={playerTitle.conditions}
              statConditions={statConditionsTitle(statConditions, conditionItems)}
            />
            {profileBaseDateLabel && <p className="rule-change-footnote ranking-base-date">{profileBaseDateLabel}</p>}
            <RankedList
              rows={shownRows}
              def={rankDef}
              rowKey={(p) => p.playerId}
              name={(p) => playerLabel(p.name)}
              // 選手名の下はチーム名とポジションだけ（登録区分はタイトルの下の行）。ポジションの「＊」（当時の値でない印）と注意書きは、
              // 身長・体重・年齢を並べる Profile でだけ出す（DESIGN.md 170章）
              subLabel={(p) => [teamLabel(p.teamId, p.teamName), category === "profile" ? positionText(p) : p.position].filter(Boolean).join("・")}
              linkTo={(p) => {
                if (!registeredOnlyIds.has(p.playerId)) return `/players/${p.playerId}`;
                const s = playerPageSeasons?.latestSeason[p.playerId];
                return s ? `/players/${p.playerId}?season=${s}` : undefined;
              }}
              teamColor={(p) => teamColors?.[p.teamId]?.primary}
              avatar={(p) => <PlayerPhoto playerId={p.playerId} size={56} className="player-cell-photo" placeholder />}
              limit={PLAYER_RANK_TOP_N}
              compact
            />
            {category === "profile" && <HeightWeightNote players={eligible} />}
            {/* 年齢の基準日の注意書きは、年齢を表示しているとき（Profile の年齢）と、スタッツの条件で年齢を使っているときだけ（DESIGN.md 172章） */}
            {((category === "profile" && selectedItem.key === "age") || conditionKeys.includes("age")) && (
              <p className="rule-change-footnote">※ {AGE_BASE_NOTE}</p>
            )}
            {category === "career" && <p className="rule-change-footnote">※ {CAREER_NOTE}</p>}
            {category === "misc" && isRuleChangeStatKey(selectedItem.key) && <RuleChangeFootnote seasons={[season]} />}
          </div>
        </>
      )}
    </>
  );
}

export function RankingsPage({ season }: { season: string }) {
  // チーム/個人はURLのクエリ（m=player）に持つ。切り替えたら前の側のフィルタのクエリは消す（DESIGN.md 163章）
  const [mode, setModeParam] = useUrlState(RANKING_MODE_PARAM, "team");
  const [kind, setKindParam] = useUrlState(RANKING_KIND_PARAM, "season");
  const [scope, setScopeParam] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const setMode = (next: Mode) => {
    if (next === mode) return;
    clearUrlParams();
    setModeParam(next);
  };
  // 種類を切り替えたら、前の種類のフィルタのクエリは消す（チーム／個人は残す）
  const setKind = (next: RankingKind) => {
    if (next === kind) return;
    clearUrlParams();
    setModeParam(mode);
    setKindParam(next);
  };
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  // 種類の切り替えは、対応している側だけ出す（段階1は個人のみ）
  const gameRecords = mode === "player" && kind === "game";
  const kinds: RankingKind[] = mode === "player" ? ["season", "game"] : ["season"];
  // 歴代はシーズンに依らないので、シーズンを出さない
  const allTimeRecords = gameRecords && scope === "allTime";

  return (
    <div data-design="v2">
      <h1>ランキング</h1>
      <p className="page-subtitle">{allTimeRecords ? "歴代" : `${season}シーズン`}</p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
          個人
        </button>
      </div>

      {kinds.length > 1 && (
        <div className="mode-toggle ranking-kind-toggle">
          {kinds.map((k) => (
            <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {RANKING_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      )}
      {gameRecords && (
        <div className="mode-toggle records-scope-toggle">
          {(
            [
              ["allTime", "歴代"],
              ["season", "シーズン"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={scope === key ? "active" : ""} onClick={() => setScopeParam(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* カテゴリのタブを「ページの主タブ」ではなく従のタブとして扱うため、ルート直下に置かない（v2のCSSは > .tab-bar だけを主タブにする） */}
      <div>
        {gameRecords ? (
          <PlayerGameRecordRanking season={season} teamColors={teamColors ?? undefined} />
        ) : mode === "team" ? (
          <TeamRankingSection season={season} teamColors={teamColors ?? undefined} />
        ) : (
          <PlayerRankingSection season={season} teamColors={teamColors ?? undefined} />
        )}
      </div>
    </div>
  );
}
