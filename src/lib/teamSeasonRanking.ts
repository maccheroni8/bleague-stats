import { rankDirectionProps } from "./rankDirection";
import { useMemo } from "react";
import { fetchTeams } from "./data";
import type { League } from "./league";
import { useJsonData } from "./useJsonData";
import { foulColumnsSplit } from "./ruleChange";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import type { Column } from "../components/SortableTable";
import type { RankableStat } from "../components/RankedList";
import { filterGameLogs, type SituationalFilter } from "./situational";
import {
  filterByGameType,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "./playerSeasonBoxscore";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildOppPtsColumn,
  buildTraditionalColumns,
  buildBsrColumn,
  buildEffColumn,
  buildOffFoulChargeColumns,
  buildLiveTovColumns,
  buildClassPointColumns,
  buildSplitClassPointShareColumns,
  buildPointsShareColumns,
  DEFAULT_SORT_KEY,
  sumTeamGameLogs,
  type AllTeamsRow,
  type TeamPerspective,
} from "./teamStatsColumns";
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeEntityColumns } from "./shotTypeBreakdown";
import { useAllTeamGameLogs, useLeagueSituationalContext } from "./teamRankingData";
import { seasonPeriodOption } from "./seasonPeriod";
import { OVERTIME_MIN_TEAM_GAMES_FOR_RANKING, sumTeamGameFoulTotals, sumTeamPeriodTotals, useTeamPeriodSource, type TeamPeriodValue } from "./teamPeriodTotals";
import { INDEX_UNAVAILABLE_COLUMN_KEYS } from "./teamSituationalPeriod";
import {
  buildStatConditionItems,
  filterByStatConditions,
  hasActiveStatConditions,
  type StatConditionsState,
} from "./statConditions";
import { buildTeamConditionDefs } from "./teamConditionItems";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import type { PeriodRangeValue } from "./periodRange";
import { scopedTurnovers } from "./teamTurnoverScoped";
import { classPeriodAvailable, CLASS_SPLIT_UNAVAILABLE_COLUMN_KEYS, maskClassSplitColumns, splitClassOfFilter, sumClassTotals, withOppMinutes, type TeamClassSelection } from "./teamClassSplit";
import { useClassSplitSource } from "./teamClassSplitLoad";
import { splitClassificationBlocked, splitClassificationSeason } from "./classificationFilter";
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
/** 列を足すときの、シーズンごとの前提（EFF の式は年度で違う。登録区分別の得点は区分を分けて記録しているシーズンだけ） */
export interface TeamColumnContext {
  seasonStartYear: number;
  classPointsSupported: boolean;
}
const DEFAULT_COLUMN_CONTEXT: TeamColumnContext = { seasonStartYear: 2026, classPointsSupported: true };

/** 列の並びの中で、キーが after の列の右に columns を差し込む（見つからなければ末尾） */
function insertAfter(list: Column<AllTeamsRow>[], after: string, columns: Column<AllTeamsRow>[]): Column<AllTeamsRow>[] {
  const at = list.findIndex((c) => c.key === after);
  return at < 0 ? [...list, ...columns] : [...list.slice(0, at + 1), ...columns, ...list.slice(at + 1)];
}

/**
 * ランキング（チーム・シーズン成績）の列。比較ページのチームの項目と同じタブ・同じ並びにそろえるため、全チームスタッツの列に次を足す（DESIGN.md 405章）:
 * Traditional＝BSR・EFF、Misc＝OFF FOUL・CHARGE・LIVETOV・LIVE TOV%・登録区分別の得点4つ（Scoring から移した）、
 * Scoring＝%外国籍 PTS・%帰化・アジア特別枠 PTS・%3P・%PoutP・%FT・%OPA
 */
export function buildTeamCategoryColumns(
  category: BoxscoreTabKey,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  paintSupported: boolean,
  classificationSupported: boolean,
  foulSplit: boolean,
  context: TeamColumnContext = DEFAULT_COLUMN_CONTEXT,
): Column<AllTeamsRow>[] {
  switch (category) {
    case "traditional": {
      let columns = buildTraditionalColumns(mode, perspective);
      columns = insertAfter(columns, "stocks", [buildBsrColumn(mode, perspective)]);
      columns = insertAfter(columns, "fd", [buildEffColumn(mode, perspective, context.seasonStartYear)]);
      if (perspective !== "own") return columns;
      // 自チーム視点だけ、PTS の右に失点（opp PTS）を足す
      return insertAfter(columns, "pts", [buildOppPtsColumn(mode)]);
    }
    case "advanced":
      return buildAdvancedColumns(mode, perspective);
    case "misc": {
      let columns = buildMiscColumns(mode, perspective, classificationSupported, foulSplit);
      columns = insertAfter(columns, "and1", buildOffFoulChargeColumns(mode, perspective));
      columns = insertAfter(columns, "astpct", buildLiveTovColumns(mode, perspective));
      return insertAfter(columns, "starterPts", buildClassPointColumns(mode, perspective, classificationSupported && context.classPointsSupported));
    }
    case "scoring": {
      // 登録区分別の得点（日本人 PTS など）は Misc に移した（比較ページと同じタブ）。割合は Scoring のまま
      const columns = buildScoringColumns(mode, perspective, paintSupported, classificationSupported).filter((c) => !MOVED_TO_MISC_KEYS.has(c.key));
      const withClassShare = insertAfter(columns, "pctinternational3", buildSplitClassPointShareColumns(perspective, classificationSupported && context.classPointsSupported));
      return [...withClassShare, ...buildPointsShareColumns(perspective)];
    }
  }
}
/** Scoring から Misc に移した列（URL に古いカテゴリ＋項目で書いてあるときの読み替えにも使う） */
export const MOVED_TO_MISC_KEYS: ReadonlySet<string> = new Set(["japanesePts3", "internationalPts3"]);
/** 状態の条件（スタッツの条件）の項目に出さない列。試合ログの合計だけでは値が決まらない（索引を読んで初めて入る）ため */
const CONDITION_EXCLUDED_KEYS: ReadonlySet<string> = new Set(["offfoul", "charge", "livetov", "livetovpct"]);

/** 区間（Q別・前後半・延長・クラッチ）を選んでいるときに値を出せない列（ライブ／デッドボールのターンオーバーは試合全体の記録だけ） */
const PERIOD_UNAVAILABLE_KEYS: ReadonlySet<string> = INDEX_UNAVAILABLE_COLUMN_KEYS;

/** keys に当てはまる列を「-」固定にする（順位は付かない） */
function maskColumns(columns: Column<AllTeamsRow>[], keys: ReadonlySet<string> | null): Column<AllTeamsRow>[] {
  if (!keys) return columns;
  return columns.map((c) => (keys.has(c.key) ? { key: c.key, label: c.label, sortValue: () => Number.NaN, format: () => "-", render: undefined, align: c.align } : c));
}

/** 登録区分別のランキングで選べない項目（全チームスタッツの区分で出せない列と、失点〔相手の得点は区分の選手の値ではない〕） */
export function isClassUnavailableStat(key: string): boolean {
  return key === "opppts" || CLASS_SPLIT_UNAVAILABLE_COLUMN_KEYS.has(key);
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
  /** 登録区分（cls。"all"＝全選手）。Traditional〜Scoring の4カテゴリだけで効く。全チームスタッツと同じ集計（teamClassSplit.ts） */
  classFilter?: string;
}

/**
 * チームランキング（シーズン成績）の集計。シーズンを引数に取り、選んだ項目の「行・値の定義・スタッツの条件の項目」までを返す。
 * 今のシーズンの表と、前シーズン比較の前季（DESIGN.md 218章）で同じ処理を使うため、ページから切り出した。
 * enabled が false の間は何も読み込まない（前季は、比較をオンにしたときだけ読む）
 */
export function useTeamSeasonRanking(
  season: string,
  params: TeamRankingParams,
  opts: {
    enabled?: boolean;
    skipConditionItems?: boolean;
    league?: League;
    /** OFF FOUL・CHARGE（試合ログに無く、ピリオド別の索引にだけある値）を試合全体の列に入れる。Misc でこの2つを使うときだけ true（索引を読むため） */
    foulIndex?: boolean;
  } = {},
) {
  const enabled = opts.enabled ?? true;
  const league: League = opts.league ?? "premier";
  const { category, statKey, displayMode, gameType, perspective, filter, turnoverDirection, period, statConditions } = params;
  const classFilter = params.classFilter ?? "all";
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(
    () => (enabled ? fetchTeams(season, league) : Promise.resolve(null)),
    [season, enabled, league],
  );
  // ペイント内外の内訳は、プレーバイプレーの公式の区分で数えるため全シーズンで出る（2026-09-26。DESIGN.md 155章）
  const paintSupported = true;

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, enabled ? teams : null, league);
  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season, enabled, league);

  // 区間（試合全体・1Q〜4Q・前半・後半・延長）。区間の値はチームのピリオド別の索引から出す（DESIGN.md 256章の段階2。以前は試合の生データを読んでいた）
  const periodOption = seasonPeriodOption(period);
  const periodActive = enabled && isBoxscoreCategory(category) && period !== "all";
  // 登録区分別（全チームスタッツと同じ。選手の1試合行の索引から区分ごとに足す）。区間とも一緒に選べる（その区間の選手の記録を区分ごとに足す）
  const classBlocked = enabled && isBoxscoreCategory(category) && splitClassificationBlocked(classFilter, season);
  const classActive = enabled && isBoxscoreCategory(category) && classFilter !== "all" && !classBlocked;
  const splitClass: TeamClassSelection = splitClassOfFilter(classFilter) ?? "jp";
  const { state: classState, retry: retryClass } = useClassSplitSource(season, classActive, league);
  const classSource = classActive && classState.status === "ready" ? classState.source : null;
  const classPeriodMissing = classActive && periodActive && !!classSource && !classPeriodAvailable(classSource);
  // 試合全体のまま OFF FOUL・CHARGE を出すときも、ピリオド別の索引を読む（試合ログに無い値）
  const foulIndexActive = enabled && !!opts.foulIndex && category === "misc" && period === "all" && !classActive;
  const { source: periodSource, loading: periodLoading, retry: retryPeriodSource } = useTeamPeriodSource(season, (periodActive && !classActive) || foulIndexActive, league);
  const foulIndexPending = foulIndexActive && periodLoading;
  const columnContext: TeamColumnContext = useMemo(
    () => ({ seasonStartYear: Number(season.split("-")[0]), classPointsSupported: splitClassificationSeason(season) }),
    [season],
  );
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
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => team.teamId, league);
      map.set(team.teamId, filterByGameType(situational, gameType));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season, league]);

  const periodDataReady = (!periodActive || classActive || !!periodSource) && !foulIndexPending;

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    if (periodActive && !classActive && !periodSource) return [];
    if (foulIndexPending) return [];
    if (classActive && (!classSource || classPeriodMissing)) return [];
    const all = teams.map((team) => {
      const scoped = scopedLogsByTeam.get(team.teamId) ?? [];
      // 登録区分を選んでいるときは、その区分の選手の合計（opp は相手の同じ区分の選手）。勝敗は試合の勝敗
      if (classActive && classSource) {
        const { games, totals } = sumClassTotals(classSource, scoped, splitClass, periodActive ? (period as TeamPeriodValue) : "all");
        const wins = games.filter((g) => g.win).length;
        return { team, gamesPlayed: games.length, wins, losses: games.length - wins, totals: perspective === "opp" ? withOppMinutes(totals) : totals };
      }
      // 区間を選んでいるときは、その区間の値がある試合（1Q〜後半は前後半5分の特別な試合を除く全試合、延長は延長のあった試合）の合計。勝敗は試合の勝敗のまま
      if (periodActive && periodSource) {
        const { games, totals } = sumTeamPeriodTotals(periodSource, scoped, period as TeamPeriodValue);
        const wins = games.filter((g) => g.win).length;
        return { team, gamesPlayed: games.length, wins, losses: games.length - wins, totals };
      }
      const wins = scoped.filter((g) => g.win).length;
      const logTotals = sumTeamGameLogs(scoped);
      // OFF FOUL・CHARGE は索引の値（読めなかった・古い索引のときは「-」）
      if (foulIndexActive) {
        const foul = periodSource ? sumTeamGameFoulTotals(periodSource, scoped) : null;
        return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals: foul ? { ...logTotals, ...foul } : { ...logTotals, offFoul: Number.NaN, charge: Number.NaN, oppOffFoul: Number.NaN, oppCharge: Number.NaN } };
      }
      return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals: logTotals };
    });
    // 延長のランキングは、延長のあった試合が3試合以上のチームだけ（256章の決定4）。クラッチも同じ（クラッチタイムになった試合が3試合以上。設計書375章）
    return periodActive && (period === "ot" || period === "clutch") ? all.filter((r) => r.gamesPlayed >= OVERTIME_MIN_TEAM_GAMES_FOR_RANKING) : all;
  }, [teams, gameLogsByTeam, scopedLogsByTeam, periodActive, periodSource, period, classActive, classSource, classPeriodMissing, splitClass, perspective, foulIndexActive, foulIndexPending]);

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
    const wanted = filter.ownDivisions;
    if (!wanted?.length) return rows;
    if (!divisionHistory) return [];
    return rows.filter((r) => {
      const d = teamDivisionForSeason(divisionHistory, r.team.teamId, season, league);
      return !!d && wanted.includes(d);
    });
  }, [rows, filter.ownDivisions, divisionHistory, season, league]);
  const conditionRows = isBoxscoreCategory(category) ? rowsInOwnDivision : seasonRows;
  const teamById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t])), [teams]);
  // 区間の値も登録区分別・ベンチ／スタメンの得点を持つ（チームの索引。256章の段階1）ので、区間でも出せる
  const conditionClassificationSupported = true;
  const conditionItems = useMemo(
    () =>
      opts.skipConditionItems
        ? []
        : buildStatConditionItems(
            buildTeamConditionDefs({
              mode: displayMode,
              columnsFor: (tab, mode, p) => {
                const cols = buildTeamCategoryColumns(tab, mode, p, paintSupported, conditionClassificationSupported, foulSplit, columnContext).filter((c) => !CONDITION_EXCLUDED_KEYS.has(c.key));
                return classActive ? maskClassSplitColumns(cols.filter((c) => c.key !== "opppts"), p === "diff") : cols;
              },
              sampleRows: conditionRows,
              shotTypesOf: (r) => teamById.get(r.team.teamId)?.shotTypes,
              shotGamesOf: (r) => teamById.get(r.team.teamId)?.gamesPlayed ?? 0,
              shotTypeKeys: SHOT_TYPE_DISPLAY_ORDER,
              includeShooting: league === "premier",
            }),
            conditionRows,
            displayMode,
          ),
    [opts.skipConditionItems, classActive, league, displayMode, paintSupported, conditionClassificationSupported, foulSplit, conditionRows, teamById, columnContext],
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
        ? maskColumns(buildTeamCategoryColumns(category, displayMode, perspective, paintSupported, true, foulSplit, columnContext), periodActive ? PERIOD_UNAVAILABLE_KEYS : null)
        : [],
    [category, displayMode, perspective, paintSupported, foulSplit, columnContext, periodActive],
  );
  const selectedColumn = columns.find((c) => c.key === statKey) ?? columns[0];
  const teamDef: RankableStat<AllTeamsRow> | null = selectedColumn
    ? {
        key: selectedColumn.key,
        label: selectedColumn.label,
        value: (row) => Number(selectedColumn.sortValue(row)),
        format: (row) => (selectedColumn.format ? selectedColumn.format(row) : String(selectedColumn.sortValue(row))),
        ...rankDirectionProps(selectedColumn.key, perspective),
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
        ...rankDirectionProps(selectedShootingColumn.key),
      }
    : null;

  // 強制ターンオーバーカテゴリ: teams.jsonのforcedTurnovers/turnoversCommitted
  // （Yahoo!スポーツplay-by-play由来、2023-24シーズン以降のみ）をそのまま使う
  // 選んだ条件（試合区分・試合の条件・地区）に当てはまる試合ログの合計から出す（DESIGN.md 339章）。試合ログに試合ごとの値が無い古いデータのときだけ teams.json の値
  const scopedTov = useMemo(
    () => (enabled && category === "forcedTurnovers" && teams && gameLogsByTeam ? scopedTurnovers(scopedLogsByTeam) : null),
    [enabled, category, teams, gameLogsByTeam, scopedLogsByTeam],
  );
  const teamsWithForcedTurnovers = useMemo(
    () => {
      if (scopedTov) {
        return (teams ?? []).flatMap((t): TeamSummary[] => {
          const r = scopedTov.teams.get(t.teamId);
          return r && passes(t.teamId) ? [{ ...t, gamesPlayed: r.games, forcedTurnovers: r.forced, turnoversCommitted: r.committed }] : [];
        });
      }
      return (teams ?? []).filter((t) => !!t.forcedTurnovers && !!t.turnoversCommitted && passes(t.teamId));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [teams, passingTeamIds, scopedTov],
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
    // 区間の索引の読み込み（名前は以前の生データの読み込みのまま。読めなかったときは1件の失敗として出す）
    rawGamesLoading: (periodActive && !classActive && periodLoading) || foulIndexPending,
    rawGamesFailedCount: periodActive && !classActive && !periodLoading && !periodSource ? 1 : 0,
    retryRawGames: retryPeriodSource,
    periodDataReady,
    classBlocked,
    classActive,
    classLoading: classActive && classState.status === "loading",
    classUnreadable: classActive && classState.status === "unreadable",
    classPeriodMissing,
    retryClass,
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
    forcedTurnoverScoped: !!scopedTov,
    scopedLogsByTeam,
  };
}
