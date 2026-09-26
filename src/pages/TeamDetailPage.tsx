import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { EMPTY_TEAM_SEASON_MISC, sumTeamSeasonMisc, type TeamSeasonMiscTotals } from "../../shared/teamSeasonMisc";
import { postseasonLabel } from "../../shared/gameType";
import { useParams, Link as RouterLink } from "react-router-dom";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { SeasonLink as Link } from "../components/SeasonLink";
import { OpposedBarRow } from "../components/OpposedBar";
import { CompositionPieChart, type PieSegmentInput } from "../components/CompositionPieChart";
import { usePageState, useSkipFirstEffectRun } from "../lib/pageStateCache";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import {
  fetchClubHonors,
  fetchDivisionHistory,
  fetchGame,
  fetchGameSummaries,
  fetchLeagueCompare,
  fetchLeagueTeamRankings,
  fetchPlayerGameLogs,
  fetchPlayers,
  fetchPlayersMaster,
  fetchSchedule,
  fetchSeasons,
  fetchStandingsHistory,
  fetchTeamColors,
  fetchTeamGameLogs,
  fetchTeamHistory,
  fetchTeamLineups,
  fetchTeams,
  fetchYahooGamePbp,
  fetchPlayoffRace,
  fetchSeasonRules,
} from "../lib/data";
import { LEAGUE_COLOR, LEAGUE_SLOT_NOTE, LEAGUE_TEAM_NAME } from "../lib/leagueAverage";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  ClubHonor,
  DivisionHistoryFile,
  GameSummary,
  GameType,
  LeagueTeamRankEntry,
  LeagueTeamRankingsFile,
  PlayerGameLog,
  PlayerMasterEntry,
  PlayerSummary,
  ShotTypeBreakdown,
  StandingsSnapshot,
  StoredGame,
  TeamForcedTurnovers,
  TeamGameLog,
  TeamSummary,
  UpcomingGameEntry,
  YahooGamePbp,
  YahooTurnoverEvent,
} from "../../shared/types";
import { CompareSlotFilter } from "../components/CompareSlotFilter";
import { FilterBar } from "../components/FilterBar";
import {
  displayModeAxis,
  gameTypeAxis,
  periodAxis,
  perspectiveAxis,
  situationalAxes,
  simpleSelectAxis,
  type FilterAxis,
} from "../lib/filterAxes";
import { periodInRange, type PeriodRangeValue } from "../lib/periodRange";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatPct100, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import {
  buildBackToBackStatus,
  buildGameTeamsByScheduleKey,
  buildRecordsBeforeGame,
  computeOpponentWinPctAvg,
  filterGameLogs,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  resolveOwnTeam,
  type BackToBackGame,
  type GameTeamInfo,
  type RecordBeforeGame,
  type SituationalFilter,
  MARGIN_CONDITION_LABELS,
  matchesMargin,
  type MarginCondition,
} from "../lib/situational";
import { ConditionLine, ConditionTitle } from "../components/ConditionTitle";
import { RuleChangeFootnote } from "../components/RuleChangeFootnote";
import { HeightWeightNote } from "../components/HeightWeightNote";
import { AGE_BASE_NOTE, ageForSeason } from "../lib/age";
import { heightText, positionText, weightText } from "../lib/profileMark";
import {
  classificationLabels,
  composeLabels,
  displayModeLabels,
  eligibilityLabels,
  gameTypeLabels,
  joinLabels,
  perspectiveLabels,
  periodLabels,
  situationalFilterLabels,
} from "../lib/conditionLabels";
import { isWednesdayGame, isWeekdayGame } from "../lib/japaneseHolidays";
import { leaderStatLabel, PLAYER_STAT_DEFS } from "../lib/statDefs";
import { EXTRA_ELIGIBILITY_RULES, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, filterEligiblePlayers } from "../lib/playerRankingEligibility";
import { safeDiv } from "../../shared/formulas";
import {
  CAREER_TOTAL_DEFS,
  TEAM_AGAINST_RECORD_STATS as TEAM_AGAINST_RECORD_VALUE_DEFS,
  TEAM_RECORD_STATS as TEAM_RECORD_VALUE_DEFS,
  bestTeamSeasonRecord,
  buildTeamCareerTotals,
  longestWinStreak,
  type TeamSeasonSpecialAggregate,
} from "../../shared/teamRecords";
import {
  SEASON_BOX_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  buildTeamGameBoxTotals,
  buildTeamMultiGameBoxTotals,
  buildTeamPointsBreakdown,
  buildTeamSplitRowsForPeriod,
  countDoubleTripleDoubles,
  filterByGameType,
  sumTeamGameLogsFor,
  type SeasonBoxTabKey,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamGameBoxTotals,
  type TeamPointsBreakdown,
  type TeamPointsBreakdownResult,
} from "../lib/playerSeasonBoxscore";
import { BOXSCORE_TABS, COLUMNS_BY_TAB, type BoxscoreColumn, type BoxscoreTabKey, type ColumnCtx } from "../components/BoxscoreTable";
import { astToTovRatio, buildAssistPairs, formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import type { BoxscoreCounts } from "../lib/boxscoreAggregate";
import type { AssistPair } from "../../shared/assistedScoring";
import { ShotChartPanel } from "../components/ShotChart";
import { buildShotEvents, type ShotEvent } from "../lib/shotChart";
import {
  buildShotTypeBreakdown,
  formatShotTypeAttempted,
  formatShotTypeMade,
  formatShotTypePct,
  scaleShotTypeCounts,
  shotTypeEntityColumns,
  shotTypeLabel,
  sortShotTypeKeys,
  sumShotTypeCounts,
} from "../lib/shotTypeBreakdown";
import { ComparisonTable, type ComparisonRow } from "./ComparePage";
import { MobileCollapse } from "../components/MobileCollapse";
import { EligibilitySlider } from "../components/EligibilitySlider";
import { StickyHeaderScroll } from "../components/StickyHeaderScroll";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { teamShortName } from "../../shared/teamNames";
import { ClubPeriodRecords, SeasonPeriodAverages } from "../components/TeamPeriodRecords";
import { cleanNumericString, formatColumnDiff, teamCompareDefs, type TeamCompareColumnData } from "../lib/compareShared";
import { CLASSIFICATION_COLORS } from "../lib/classificationFilter";
import { statDescription } from "../lib/statDescriptions";
import { StatHeaderLabel } from "../components/StatHeaderLabel";
import { TeamSeasonForeignChart, TeamSeasonScoringCharts } from "../components/TeamSeasonShareCharts";
import { isRegularSeasonInProgress } from "../lib/shareCharts";
import { currentSeason } from "../lib/season";
import { computeTopRecordEntries, TOP_RECORD_WORST_BAD_N, type TopRecordEntry } from "../lib/topRecords";
import { ResponsivePlayerName } from "../components/ResponsivePlayerName";
import { PlayerNamePool } from "../components/PlayerNamePool";
import { usePlayerLabel } from "../lib/playerLabel";
import { useTeamLabel } from "../lib/teamLabel";

const TEAM_SHOOTING_TAB_TOOLTIP =
  "Yahoo!スポーツplay-by-play由来のシュートタイプ別成功/試投（チーム全選手合算、2023-24シーズン以降のみ）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「Jump Shot」に一括りになっている点に注意";

// 出場時間がこれ未満のラインナップはサンプルが小さすぎてノイズが大きいため一覧から除外する
// （実データ確認: 4試合時点で3分(180秒)基準だとチームあたり4〜14組が該当。DESIGN.md参照）
const MIN_LINEUP_SECONDS = 180;
// 上位20組を初期表示とし、それ以下は「全パターン表示」ボタンで展開する（DESIGN.md参照）
const MAX_LINEUP_ROWS = 20;
// アシストペア分析（チーム版）も同じ上位20件・展開方式を踏襲する
const MAX_ASSIST_PAIR_ROWS = 20;

/** 強制ターンオーバー表の列（種類別。「シーズン別成績」のForced TOVタブ用） */
const FORCED_TURNOVER_COLUMNS: { key: string; label: string; title?: string; value: (d: TeamForcedTurnovers) => number }[] = [
  {
    key: "offensiveFoul",
    label: "オフェンスファウル",
    title: "シュートファウル以外のオフェンスファウルによるターンオーバー",
    value: (d) => d.offensiveFoul,
  },
  { key: "violation24sec", label: "24秒バイオレーション", title: "24秒バイオレーションによるターンオーバー", value: (d) => d.violation24sec },
  { key: "backcourt", label: "バックコート", title: "バックコートバイオレーションによるターンオーバー", value: (d) => d.backcourtViolation },
  { key: "violation5sec", label: "5秒バイオレーション", title: "5秒バイオレーションによるターンオーバー", value: (d) => d.violation5sec },
  { key: "violation8sec", label: "8秒バイオレーション", title: "8秒バイオレーションによるターンオーバー", value: (d) => d.violation8sec },
  {
    key: "otherDead",
    label: "その他デッドボール",
    title: "トラベリング・ダブルドリブル・3秒バイオレーション・アウトオブバウンズ等、上記以外のデッドボールターンオーバー",
    value: (d) => d.otherDead,
  },
  {
    key: "live",
    label: "ライブボール（参考）",
    title: "スティール由来（バッドパス・ボールハンドリングロスト）のライブボールターンオーバー。参考値",
    value: (d) => d.live,
  },
  {
    key: "total",
    label: "合計",
    value: (d) => d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live,
  },
  {
    key: "gamesWithData",
    label: "データあり試合数",
    title: "Yahoo!スポーツplay-by-playが実際に取得できた試合数（分母の目安）",
    value: (d) => d.gamesWithData,
  },
];

const FORCED_TURNOVER_ROW_LABELS = {
  forced: "相手から奪った（自チームが強制）",
  committed: "自チームが記録（相手に強制された）",
} as const;

/**
 * 「シーズン別成績」の強制ターンオーバータブ。シーズンごとに「相手から奪った」「自チームが記録」の2行。
 * teams.json のシーズン別集計（Yahoo PBP由来）は2023-24シーズン以降のみのため、それ以前は非対応の行を出す
 * （値が出るシーズンの制約をそのまま見せる）。平均/合計トグルは効かない（種類別の合計件数のみ）
 */
function TeamSeasonForcedTurnoversTable({ rows }: { rows: SeasonRecord[] }) {
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead>
          <tr>
            <th className="align-left">シーズン</th>
            <th className="align-left">区分</th>
            {FORCED_TURNOVER_COLUMNS.map((col) => (
              <th key={col.key} className="align-right" title={col.title}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const { forcedTurnovers: forced, turnoversCommitted: committed } = r.team;
            if (!forced || !committed) {
              return (
                <tr key={r.season}>
                  <td className="align-left">{r.season}</td>
                  <td className="align-left season-unsupported-cell" colSpan={FORCED_TURNOVER_COLUMNS.length + 1}>
                    このシーズンのデータには対応していません（2023-24シーズン以降のみ）
                  </td>
                </tr>
              );
            }
            return (["forced", "committed"] as const).map((kind) => (
              <tr key={`${r.season}-${kind}`} className={kind === "committed" ? "season-row-cont" : undefined}>
                <td className="align-left">{r.season}</td>
                <td className="align-left">{FORCED_TURNOVER_ROW_LABELS[kind]}</td>
                {FORCED_TURNOVER_COLUMNS.map((col) => (
                  <td key={col.key} className="align-right">
                    {col.value(kind === "forced" ? forced : committed)}
                  </td>
                ))}
              </tr>
            ));
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * 「シーズン別成績」のシューティングタブ。シーズンごとに2P/3Pの2行（シュートタイプ別のM/A/%）。
 * シュートタイプ別の集計はYahoo PBP由来で2023-24シーズン以降のみのため、それ以前は非対応の行を出す。
 * 列は全シーズンに現れたシュートタイプの和集合。平均/合計トグルはシーズンの試合数で割る/割らない
 */
function TeamSeasonShotTypeTable({ rows, displayMode }: { rows: SeasonRecord[]; displayMode: SeasonDisplayMode }) {
  const keys = sortShotTypeKeys([...new Set(rows.flatMap((r) => Object.keys(r.team.shotTypes ?? {})))]);
  const digits = displayMode === "total" ? 0 : 1;
  return (
    <div className="table-scroll">
      <table className="stats-table">
        <thead>
          <tr>
            <th rowSpan={2} className="align-left">
              シーズン
            </th>
            <th rowSpan={2} className="align-left">
              区分
            </th>
            {keys.map((key) => (
              <th key={key} colSpan={3} title={statDescription(shotTypeLabel(key))}>
                {shotTypeLabel(key)}
              </th>
            ))}
            <th colSpan={3}>合計</th>
          </tr>
          <tr>
            {[...keys, "total"].map((key) => (
              <Fragment key={key}>
                <th className="align-right">M</th>
                <th className="align-right">A</th>
                <th className="align-right">%</th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const breakdown = r.team.shotTypes;
            if (!breakdown) {
              return (
                <tr key={r.season}>
                  <td className="align-left">{r.season}</td>
                  <td className="align-left season-unsupported-cell" colSpan={1 + (keys.length + 1) * 3}>
                    このシーズンのデータには対応していません（2023-24シーズン以降のみ）
                  </td>
                </tr>
              );
            }
            const factor = displayMode === "total" || r.team.gamesPlayed <= 0 ? 1 : 1 / r.team.gamesPlayed;
            return (["twoPoint", "threePoint"] as const).map((split) => {
              const total = scaleShotTypeCounts(
                Object.values(breakdown).reduce((acc, c) => sumShotTypeCounts(acc, c[split]), { made: 0, attempted: 0 }),
                factor,
              );
              return (
                <tr key={`${r.season}-${split}`} className={split === "threePoint" ? "season-row-cont" : undefined}>
                  <td className="align-left">{r.season}</td>
                  <td className="align-left">{split === "twoPoint" ? "2P" : "3P"}</td>
                  {keys.map((key) => {
                    const counts = breakdown[key];
                    if (!counts) {
                      return (
                        <Fragment key={key}>
                          <td className="align-right">-</td>
                          <td className="align-right">-</td>
                          <td className="align-right">-</td>
                        </Fragment>
                      );
                    }
                    const c = scaleShotTypeCounts(counts[split], factor);
                    return (
                      <Fragment key={key}>
                        <td className="align-right">{formatShotTypeMade(c, digits)}</td>
                        <td className="align-right">{formatShotTypeAttempted(c, digits)}</td>
                        <td className="align-right">{formatShotTypePct(c)}</td>
                      </Fragment>
                    );
                  })}
                  <td className="align-right">{formatShotTypeMade(total, digits)}</td>
                  <td className="align-right">{formatShotTypeAttempted(total, digits)}</td>
                  <td className="align-right">{formatShotTypePct(total)}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
    </div>
  );
}

// 得点構成の円グラフで使う配色（添付画像のFG試投割合の円グラフと同じ配色パターン。
// 3P=青・IP(ペイント内)=赤・OP(ペイント外)=黄、PTS構成のみFT=緑を追加）
const COMPOSITION_PIE_COLORS = {
  threeP: "#5b9bd5",
  paint: "#e06666",
  midRange: "#f6c453",
  ft: "#93c47d",
};

/**
 * FG試投割合の円グラフ用データ（自チーム/相手チーム）。3P試投・ペイント内試投・
 * ペイント外(ミッドレンジ)試投の3分割が基本形だが、paint2a（ペイント内試投数）は
 * ショットチャート座標由来のため2022-23シーズン以降のみ取得できる（DESIGN.md Batch3・
 * %IPA/%OPA参照）。それ以前のシーズン（shotChartSupported=false）は、ペイント内外を
 * 合算した2P／3Pの2分割にフォールバックする（完全非表示ではなく取得可能な粒度まで表示する、
 * Batch 4-2）。試投数ベースのため1試合あたり平均値をラベルに表示する
 */
function buildFgaCompositionSegments(logs: TeamGameLog[], perspective: "own" | "opp", shotChartSupported: boolean): PieSegmentInput[] {
  const games = logs.length || 1;
  const tpa = logs.reduce((s, g) => s + (perspective === "own" ? g.tpa : g.opponentTpa), 0);
  const fga = logs.reduce((s, g) => s + (perspective === "own" ? g.fga : g.opponentFga), 0);
  const twoA = Math.max(0, fga - tpa);
  if (!shotChartSupported) {
    return [
      { key: "3p", label: "3P", color: COMPOSITION_PIE_COLORS.threeP, value: tpa / games },
      { key: "2p", label: "2P", color: COMPOSITION_PIE_COLORS.paint, value: twoA / games },
    ];
  }
  const paintA = logs.reduce((s, g) => s + (perspective === "own" ? g.paint2a : g.opponentPaint2a), 0);
  const midA = Math.max(0, twoA - paintA);
  return [
    { key: "3p", label: "3P", color: COMPOSITION_PIE_COLORS.threeP, value: tpa / games },
    { key: "ip", label: "Paint", color: COMPOSITION_PIE_COLORS.paint, value: paintA / games },
    { key: "op", label: "Mid-range", color: COMPOSITION_PIE_COLORS.midRange, value: midA / games },
  ];
}

/**
 * 得点割合の円グラフ用データ（自チーム/相手チーム）。3P点・ペイント内(IP)点・
 * ペイント外(OP・ミッドレンジ)点・FT点の4分割。既存のteam.advanced.*SharePct
 * （Phase H10、PBPタグ集計ベースの構成比・全シーズン対応）をそのまま使い、
 * 1試合あたり平均得点＝perGame.pts × シェア比率でラベル用の実数値を逆算する
 */
function buildPtsCompositionSegments(team: TeamSummary, perspective: "own" | "opp"): PieSegmentInput[] {
  const totalPerGame = perspective === "own" ? team.perGame.pts : team.opponentPerGame.pts;
  const shares =
    perspective === "own"
      ? {
          threeP: team.advanced.threePointPointsSharePct,
          paint: team.advanced.paintPointsSharePct,
          midRange: team.advanced.midRangePointsSharePct,
          ft: team.advanced.ftPointsSharePct,
        }
      : {
          threeP: team.advanced.opponentThreePointPointsSharePct,
          paint: team.advanced.opponentPaintPointsSharePct,
          midRange: team.advanced.opponentMidRangePointsSharePct,
          ft: team.advanced.opponentFtPointsSharePct,
        };
  return [
    { key: "3p", label: "3P", color: COMPOSITION_PIE_COLORS.threeP, value: (shares.threeP / 100) * totalPerGame },
    { key: "ip", label: "Paint", color: COMPOSITION_PIE_COLORS.paint, value: (shares.paint / 100) * totalPerGame },
    { key: "op", label: "Mid-range", color: COMPOSITION_PIE_COLORS.midRange, value: (shares.midRange / 100) * totalPerGame },
    { key: "ft", label: "FT", color: COMPOSITION_PIE_COLORS.ft, value: (shares.ft / 100) * totalPerGame },
  ];
}


/**
 * 登録区分別得点割合の円グラフ用データ（自チーム/相手チーム）。日本人/外国籍・帰化・アジアの
 * 2分割（src/lib/classificationFilter.ts参照）。team.advanced.japanesePointsPerGame等
 * （internationalはforeignPointsPerGame+naturalizedOrAsianPointsPerGameを合算して導出）を使う
 */
function buildClassificationPtsCompositionSegments(team: TeamSummary, perspective: "own" | "opp"): PieSegmentInput[] {
  const japanese = perspective === "own" ? team.advanced.japanesePointsPerGame : team.advanced.opponentJapanesePointsPerGame;
  const international =
    perspective === "own"
      ? team.advanced.foreignPointsPerGame + team.advanced.naturalizedOrAsianPointsPerGame
      : team.advanced.opponentForeignPointsPerGame + team.advanced.opponentNaturalizedOrAsianPointsPerGame;
  return [
    { key: "jp", label: "日本人", color: CLASSIFICATION_COLORS.japanese, value: japanese },
    { key: "international", label: "外国籍・帰化・アジア", color: CLASSIFICATION_COLORS.international, value: international },
  ];
}

/**
 * 得点構成/失点構成（Batch 4、2026-09-08）。対向バーから円グラフ形式に作り直した
 * （添付画像＝FG試投割合の円グラフと同じ形式）。FG試投構成（3P/IP/OP）・得点構成
 * （3P/IP/OP/FT）それぞれ自チーム・相手チームの円グラフを横に並べて表示する
 */
function ScoringCompositionSection({ team, gameLogs, shotChartSupported }: { team: TeamSummary; gameLogs: TeamGameLog[]; shotChartSupported: boolean }) {
  const regularLogs = useMemo(() => gameLogs.filter((g) => g.gameType === "regular"), [gameLogs]);
  const ownFga = useMemo(() => buildFgaCompositionSegments(regularLogs, "own", shotChartSupported), [regularLogs, shotChartSupported]);
  const oppFga = useMemo(() => buildFgaCompositionSegments(regularLogs, "opp", shotChartSupported), [regularLogs, shotChartSupported]);
  const ownPts = useMemo(() => buildPtsCompositionSegments(team, "own"), [team]);
  const oppPts = useMemo(() => buildPtsCompositionSegments(team, "opp"), [team]);
  const ownClassificationPts = useMemo(() => buildClassificationPtsCompositionSegments(team, "own"), [team]);
  const oppClassificationPts = useMemo(() => buildClassificationPtsCompositionSegments(team, "opp"), [team]);

  return (
    <div className="key-stats-card">
      <h3>得点構成 / 失点構成</h3>
      <p className="page-subtitle">
        レギュラーシーズンベース。FG試投割合は1試合あたり平均試投数、得点割合は1試合あたり平均得点。各セグメントに割合(%)と実数値を表示
        {!shotChartSupported && "（このシーズンはペイント内外の分割データが無いため2P/3Pの2分割で表示）"}
      </p>
      <h4 className="composition-pie-group-title">シュート試投構成</h4>
      <div className="composition-pie-row">
        <CompositionPieChart title="FG 試投割合" segments={ownFga} />
        <CompositionPieChart title="opp FG 試投割合" segments={oppFga} />
      </div>
      <h4 className="composition-pie-group-title">得点構成</h4>
      <div className="composition-pie-row">
        <CompositionPieChart title="得点割合" segments={ownPts} />
        <CompositionPieChart title="opp 得点割合" segments={oppPts} />
      </div>
      <h4 className="composition-pie-group-title">得点構成（登録区分）</h4>
      <p className="page-subtitle">※現在の登録情報に基づく参考値</p>
      <div className="composition-pie-row">
        <CompositionPieChart title="得点割合" segments={ownClassificationPts} />
        <CompositionPieChart title="opp 得点割合" segments={oppClassificationPts} />
      </div>
    </div>
  );
}

// 「チーム内リーダー」（Phase H3②）。ホーム画面の「シーズンスタッツリーダー」個人モードと
// 同じ構成（各項目トップ5・1位のみ写真付き）・同じ12項目をチームの選手のみに絞って表示する。
// 掲載基準はランキングページ選手版と同じ出場率85%以上＋3P%等の試投数基準
// （src/lib/playerRankingEligibility.ts、2026-09にホーム画面リーダーと合わせて適用）
const TEAM_INTERNAL_LEADER_STAT_KEYS = ["pts", "reb", "ast", "blk", "stl", "fgPct", "tpPct", "twoPct", "ftPct", "min", "efgPct", "per"];
const TEAM_LEADERS_TOP_N = 5;
// スマホ幅で既定表示するリーダー項目数（TEAM_INTERNAL_LEADER_STAT_KEYSの先頭＝PTS/REB/AST）
const TEAM_LEADERS_MOBILE_DEFAULT_COUNT = 3;

interface RadarStatDef {
  key: string;
  label: string;
  value: (t: TeamSummary) => number;
  format: (t: TeamSummary) => string;
  /** falseならDRtgのように値が小さいほど良い項目。パーセンタイル換算・順位算出の向きに使う */
  higherIsBetter: boolean;
}

// ヘッダーのレーダーチャート用の16項目（0時の位置から時計回り: 得点/リバウンド/アシスト/
// スティール/ブロック/2P%/3P%/FT%/失点/eFG%/TOV%/FTR/OR%/ORtg/DRtg/NETRtg）
const RADAR_STAT_DEFS: RadarStatDef[] = [
  { key: "pts", label: "PTS", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
  { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
  { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
  { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
  { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
  { key: "pt2Pct", label: "2P%", value: (t) => t.shooting.pt2Pct, format: (t) => formatPct(t.shooting.pt2Pct), higherIsBetter: true },
  { key: "tpPct", label: "3P%", value: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct), higherIsBetter: true },
  { key: "ftPct", label: "FT%", value: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct), higherIsBetter: true },
  {
    key: "oppPts",
    label: "oppPTS",
    value: (t) => t.opponentPerGame.pts,
    format: (t) => formatDecimal(t.opponentPerGame.pts),
    higherIsBetter: false,
  },
  {
    key: "efgPct",
    label: "eFG%",
    value: (t) => t.shooting.efgPct,
    format: (t) => formatPct(t.shooting.efgPct),
    higherIsBetter: true,
  },
  {
    key: "tovPct",
    label: "TOV%",
    value: (t) => t.advanced.tovPct,
    format: (t) => formatPct100(t.advanced.tovPct),
    higherIsBetter: false,
  },
  {
    key: "ftRate",
    label: "FTR",
    value: (t) => t.shooting.ftRate,
    format: (t) => formatPct(t.shooting.ftRate),
    higherIsBetter: true,
  },
  {
    key: "orbPct",
    label: "OR%",
    value: (t) => t.advanced.orbPct,
    format: (t) => formatPct100(t.advanced.orbPct),
    higherIsBetter: true,
  },
  {
    key: "offRtg",
    label: "ORtg",
    value: (t) => t.advanced.offRtg,
    format: (t) => formatDecimal(t.advanced.offRtg),
    higherIsBetter: true,
  },
  {
    key: "defRtg",
    label: "DRtg",
    value: (t) => t.advanced.defRtg,
    format: (t) => formatDecimal(t.advanced.defRtg),
    higherIsBetter: false,
  },
  {
    key: "netRtg",
    label: "NETRtg",
    value: (t) => t.advanced.netRtg,
    format: (t) => formatSigned(t.advanced.netRtg),
    higherIsBetter: true,
  },
];

interface RadarDataPoint {
  key: string;
  label: string;
  percentile: number;
  rank: number;
  total: number;
  actualValue: string;
}

/** リーグ全チーム中でのteamの各項目の順位を0〜100のパーセンタイルに変換する（DRtg等は向きを反転） */
function buildRadarData(team: TeamSummary, allTeams: TeamSummary[]): RadarDataPoint[] {
  const total = allTeams.length;
  return RADAR_STAT_DEFS.map((def) => {
    const sorted = [...allTeams].sort((a, b) =>
      def.higherIsBetter ? def.value(b) - def.value(a) : def.value(a) - def.value(b),
    );
    const rank = sorted.findIndex((t) => t.teamId === team.teamId) + 1;
    const percentile = total > 1 ? (100 * (total - rank)) / (total - 1) : 50;
    return { key: def.key, label: def.label, percentile, rank, total, actualValue: def.format(team) };
  });
}

interface TeamHeaderStatDef {
  key: string;
  label: string;
  value: (t: TeamSummary) => number;
  format: (t: TeamSummary) => string;
  /** falseなら値が小さいほど良い項目（oppPTS等）。順位算出の向きに使う。
   * oppTOVのみ「相手に強制したターンオーバー」の意味なので例外的にtrue */
  higherIsBetter: boolean;
}

// ヘッダーのスタッツタイル（Phase H8で4段9列に並べ替え。1〜2段目が自チーム、3〜4段目が
// 相手＝opp）。シーズン合計（フィルタなし）固定で表示し、各タイルにリーグ内順位を併記する。
// スタメン/ベンチ得点比率・国籍区分別得点はBatch 1でタイルから削除し、「シーズン別成績」
// 「当該シーズン成績」「シチュエーション別成績」の列に移設した（DESIGN.md参照）
const TEAM_HEADER_STAT_ROWS: TeamHeaderStatDef[][] = [
  [
    { key: "pts", label: "PTS", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
    { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
    { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
    { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
    { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
    { key: "tov", label: "TOV", value: (t) => t.perGame.tov, format: (t) => formatDecimal(t.perGame.tov), higherIsBetter: false },
    {
      key: "benchPts",
      label: "BENCH PTS",
      value: (t) => t.advanced.benchPointsPerGame,
      format: (t) => formatDecimal(t.advanced.benchPointsPerGame),
      higherIsBetter: true,
    },
    { key: "offRtg", label: "ORtg", value: (t) => t.advanced.offRtg, format: (t) => formatDecimal(t.advanced.offRtg), higherIsBetter: true },
    { key: "netRtg", label: "NETRtg", value: (t) => t.advanced.netRtg, format: (t) => formatSigned(t.advanced.netRtg), higherIsBetter: true },
  ],
  [
    { key: "fgPct", label: "FG%", value: (t) => t.shooting.fgPct, format: (t) => formatPct(t.shooting.fgPct), higherIsBetter: true },
    { key: "tpPct", label: "3P%", value: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct), higherIsBetter: true },
    { key: "pt2Pct", label: "2P%", value: (t) => t.shooting.pt2Pct, format: (t) => formatPct(t.shooting.pt2Pct), higherIsBetter: true },
    { key: "ftPct", label: "FT%", value: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct), higherIsBetter: true },
    { key: "tsPct", label: "TS%", value: (t) => t.shooting.tsPct, format: (t) => formatPct(t.shooting.tsPct), higherIsBetter: true },
    { key: "efgPct", label: "eFG%", value: (t) => t.shooting.efgPct, format: (t) => formatPct(t.shooting.efgPct), higherIsBetter: true },
    { key: "ftr", label: "FTR", value: (t) => t.shooting.ftRate, format: (t) => formatPct(t.shooting.ftRate), higherIsBetter: true },
    { key: "tovPct", label: "TOV%", value: (t) => t.advanced.tovPct, format: (t) => formatPct100(t.advanced.tovPct), higherIsBetter: false },
    { key: "orbPct", label: "OR%", value: (t) => t.advanced.orbPct, format: (t) => formatPct100(t.advanced.orbPct), higherIsBetter: true },
  ],
  [
    { key: "oppPts", label: "oppPTS", value: (t) => t.opponentPerGame.pts, format: (t) => formatDecimal(t.opponentPerGame.pts), higherIsBetter: false },
    { key: "oppReb", label: "oppREB", value: (t) => t.opponentPerGame.reb, format: (t) => formatDecimal(t.opponentPerGame.reb), higherIsBetter: false },
    { key: "oppAst", label: "oppAST", value: (t) => t.opponentPerGame.ast, format: (t) => formatDecimal(t.opponentPerGame.ast), higherIsBetter: false },
    { key: "oppStl", label: "oppSTL", value: (t) => t.opponentPerGame.stl, format: (t) => formatDecimal(t.opponentPerGame.stl), higherIsBetter: false },
    { key: "oppBlk", label: "oppBLK", value: (t) => t.opponentPerGame.blk, format: (t) => formatDecimal(t.opponentPerGame.blk), higherIsBetter: false },
    { key: "oppTov", label: "oppTOV", value: (t) => t.opponentPerGame.tov, format: (t) => formatDecimal(t.opponentPerGame.tov), higherIsBetter: true },
    {
      key: "oppBenchPts",
      label: "oppBENCH PTS",
      value: (t) => t.advanced.opponentBenchPointsPerGame,
      format: (t) => formatDecimal(t.advanced.opponentBenchPointsPerGame),
      higherIsBetter: false,
    },
    { key: "defRtg", label: "DRtg", value: (t) => t.advanced.defRtg, format: (t) => formatDecimal(t.advanced.defRtg), higherIsBetter: false },
    { key: "pace", label: "PACE", value: (t) => t.advanced.pace, format: (t) => formatDecimal(t.advanced.pace), higherIsBetter: true },
  ],
  [
    { key: "oppFgPct", label: "opp FG%", value: (t) => t.opponentShooting.fgPct, format: (t) => formatPct(t.opponentShooting.fgPct), higherIsBetter: false },
    { key: "oppTpPct", label: "opp 3P%", value: (t) => t.opponentShooting.tpPct, format: (t) => formatPct(t.opponentShooting.tpPct), higherIsBetter: false },
    { key: "oppPt2Pct", label: "opp 2P%", value: (t) => t.opponentShooting.pt2Pct, format: (t) => formatPct(t.opponentShooting.pt2Pct), higherIsBetter: false },
    { key: "oppFtPct", label: "opp FT%", value: (t) => t.opponentShooting.ftPct, format: (t) => formatPct(t.opponentShooting.ftPct), higherIsBetter: false },
    { key: "oppTsPct", label: "opp TS%", value: (t) => t.opponentShooting.tsPct, format: (t) => formatPct(t.opponentShooting.tsPct), higherIsBetter: false },
    { key: "oppEfgPct", label: "opp eFG%", value: (t) => t.opponentShooting.efgPct, format: (t) => formatPct(t.opponentShooting.efgPct), higherIsBetter: false },
    {
      key: "oppFtr",
      label: "opp FTR",
      value: (t) => t.opponentShooting.ftRate,
      format: (t) => formatPct(t.opponentShooting.ftRate),
      higherIsBetter: false,
    },
    {
      key: "oppTovPct",
      label: "opp TOV%",
      value: (t) => t.advanced.opponentTovPct,
      format: (t) => formatPct100(t.advanced.opponentTovPct),
      higherIsBetter: true,
    },
    {
      key: "oppOrbPct",
      label: "opp OR%",
      value: (t) => t.advanced.opponentOrbPct,
      format: (t) => formatPct100(t.advanced.opponentOrbPct),
      higherIsBetter: false,
    },
  ],
];

interface TeamRankResult {
  rank: number;
  total: number;
}

/** リーグ全チーム中でのteamの順位を返す（1位=最良）。higherIsBetterがfalseの項目は昇順で評価する */
/** そのシーズンのリーグ内順位。同じ値は同じ順位にし、次の順位はその分飛ばす（1位・2位・2位・4位。歴代記録と同じ。DESIGN.md 143-3） */
function rankAmongTeams(team: TeamSummary, allTeams: TeamSummary[], def: TeamHeaderStatDef): TeamRankResult {
  const total = allTeams.length;
  const value = def.value(team);
  const better = allTeams.filter((t) => (def.higherIsBetter ? def.value(t) > value : def.value(t) < value)).length;
  return { rank: better + 1, total };
}

function formatTeamRank({ rank, total }: TeamRankResult): string {
  return `${rank}位/${total}チーム`;
}

const DIVISION_LABELS: Record<string, string> = {
  east: "東地区",
  west: "西地区",
  north: "北地区",
  central: "中地区",
  south: "南地区",
};

// ヘッダーの試合数/勝敗/勝率+順位の1行表示（例:「60試合45勝15敗.750 東地区1位 全体2位」）。
// 地区順位・全体順位は既存のstandings-history.json（順位表ページと同じデータ源）から引く
function buildTeamRecordLine(team: TeamSummary, standingsHistory: StandingsSnapshot[] | null | undefined): string {
  const winPct = safeDiv(team.wins, team.wins + team.losses);
  let line = `${team.gamesPlayed}試合${team.wins}勝${team.losses}敗${formatWinPct(winPct)}`;

  const latest = standingsHistory && standingsHistory.length > 0 ? standingsHistory[standingsHistory.length - 1] : undefined;
  const entry = latest?.teams.find((t) => t.teamId === team.teamId);
  if (entry) {
    if (entry.division && entry.divisionRank) {
      const divisionLabel = DIVISION_LABELS[entry.division] ?? entry.division;
      line += ` ${divisionLabel}${entry.divisionRank}位`;
    }
    line += ` 全体${entry.rank}位`;
  }
  return line;
}

// 「チームスタッツ」タブの自チーム／opp／+/-トグル（ヘッダーの自チーム行/opp行の対比構造
// ＝TEAM_HEADER_STAT_ROWSと同じ考え方）。「日程結果」「比較」タブとも共有する汎用の型・ラベル
type TeamPerspective = "own" | "opp" | "diff";


const HONOR_CATEGORY_LABELS: Record<ClubHonor["category"], string> = {
  overall: "年間優勝",
  emperors_cup: "天皇杯",
  division: "地区優勝",
  international: "国際大会",
};
const HONOR_CATEGORY_ORDER: ClubHonor["category"][] = ["overall", "emperors_cup", "division", "international"];

// Phase H4（2026-08-29）: 「スタッツ」タブを「チームスタッツ」に改名し、概要と選手スタッツの間に
// 移動した。オブジェクトのキー順序がそのままタブバーの表示順になる（DetailTabの並びに準拠）
type DetailTab = "overview" | "teamStats" | "playerStats" | "schedule" | "career" | "clubRecord" | "compare";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概要",
  teamStats: "チームスタッツ",
  playerStats: "選手スタッツ",
  schedule: "日程結果",
  career: "通算成績",
  clubRecord: "クラブレコード",
  compare: "比較",
};

/** タイトルに出すカテゴリ名（BOXSCORE_TABS＋シューティング・強制ターンオーバー） */
function teamBoxCategoryLabel(key: string): string {
  if (key === "shooting") return CATEGORY_LABELS.shooting;
  if (key === "forcedTurnovers") return CATEGORY_LABELS.forcedTurnovers;
  if (key === "foreignPlayers") return CATEGORY_LABELS.foreignPlayers;
  if (key === "scoringComposition") return CATEGORY_LABELS.scoringComposition;
  return BOXSCORE_TABS.find((t) => t.key === key)?.label ?? key;
}

interface SeasonRecord {
  season: string;
  teamName: string;
  team: TeamSummary;
}


interface TeamSeasonBoxColumn {
  key: string;
  label: string;
  format: (r: SeasonRecord, misc: TeamSeasonMiscTotals, mode: SeasonDisplayMode, perspective: TeamPerspective) => string;
}

// カウント系の値（1シーズン合計値total・1試合平均perGameのペア）を、平均/合計トグルの
// 選択に応じてformatDecimalで整形する。合計モードは他の箇所（シューティング等）の既存の
// 「合計モードは整数表示」という慣例に揃え、桁数を0にする
function formatTeamSeasonCount(total: number, gamesPlayed: number, mode: SeasonDisplayMode): string {
  return mode === "total" ? formatDecimal(total, 0) : formatDecimal(safeDiv(total, gamesPlayed));
}

// 自チーム/opp/+/-トグル（Phase H8-2）。own/oppの値ペアを受け取り、選択中のperspectiveに
// 応じた値を返す（own-opp=+/-）。「チームスタッツ」「日程結果」タブのTeamPerspective/
// perspectiveValue（own/opp/diff）と同じ考え方
function teamSeasonPerspectiveValue(own: number, opp: number, perspective: TeamPerspective): number {
  return perspective === "own" ? own : perspective === "opp" ? opp : own - opp;
}

// カウント系own/opp/+/-（平均/合計トグルにも従う）
function formatTeamSeasonCountPerspective(
  ownTotal: number,
  oppTotal: number,
  gamesPlayed: number,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  const { digits = 1, signed = false } = opts;
  const ownScaled = mode === "total" ? ownTotal : safeDiv(ownTotal, gamesPlayed);
  const oppScaled = mode === "total" ? oppTotal : safeDiv(oppTotal, gamesPlayed);
  const v = teamSeasonPerspectiveValue(ownScaled, oppScaled, perspective);
  const d = mode === "total" ? 0 : digits;
  return signed || perspective === "diff" ? formatSigned(v, d) : formatDecimal(v, d);
}

// 比率系own/opp/+/-（mode非依存）
function formatTeamSeasonRatioPerspective(
  ownVal: number,
  oppVal: number,
  perspective: TeamPerspective,
  format: (v: number) => string,
  diffFormat: (v: number) => string,
): string {
  const v = teamSeasonPerspectiveValue(ownVal, oppVal, perspective);
  return perspective === "diff" ? diffFormat(v) : format(v);
}

function formatTeamSeasonPct(ownVal: number, oppVal: number, perspective: TeamPerspective): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatPct(v), (v) => `${formatSigned(v * 100, 1)}%`);
}

function formatTeamSeasonPct100(ownVal: number, oppVal: number, perspective: TeamPerspective): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatPct100(v), (v) => `${formatSigned(v, 1)}%`);
}

function formatTeamSeasonDecimal(ownVal: number, oppVal: number, perspective: TeamPerspective, digits = 1): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatDecimal(v, digits), (v) => formatSigned(v, digits));
}

function formatTeamSeasonSigned(ownVal: number, oppVal: number, perspective: TeamPerspective, digits = 1): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatSigned(v, digits), (v) => formatSigned(v, digits));
}

/** ショットチャート座標（X/Y/AreaCD）が存在するシーズンかどうか（2022-23シーズン以降のみ、
 * playerSeasonBoxscore.tsのMIN_SHOT_CHART_SEASON_START_YEARと同じ閾値）。「シーズン別成績」の
 * 各行は`r.season`（文字列）を持つだけで、他タブのようにuseSeasonCoverage()の結果を都度
 * 参照できないため、開始年の数値比較で簡易判定する */
const TEAM_SEASON_MIN_SHOT_CHART_YEAR = 2022;
function seasonRecordSupportsShotChart(season: string): boolean {
  return Number(season.split("-")[0]) >= TEAM_SEASON_MIN_SHOT_CHART_YEAR;
}

// 「シーズン別成績」の4カテゴリタブ（Phase H3①）。既存のSEASON_BOX_COLUMNS（選手向け、
// PlayerGameLog由来）とは別に、チーム向けの列定義をここで新設する。トラディショナル/
// アドバンスドはTeamSummary（seasonHistory、既に取得済みのシーズン集計）だけで完結する
// （新規バックエンド集計は不要）。MiscはTeamGameLog（careerData）側のPITP/FBPS/2ND PTS/
// PTSOFFTO/DUNKに加え、2026-08-29にTF/UFOUL/DQFOUL/AND1・被アシスト内訳（AST2M/AST3M/
// ASTFTM/AST%）もTeamGameLogへ追加集計した（DESIGN.md参照。以前は「試合単位のPlayByPlaysから
// のみ算出できチーム単位のシーズン集計としては永続化していない」という制約があったが解消済み）。
// LIVETOV/DEADTOVのみ、Yahoo!スポーツPBP由来でチーム単位の永続化対象に含めていないため
// 引き続き列を設けていない。スコアリングタブは%-share（個人の数値／チームの数値）という概念が
// チーム自身の行には適用できないため、「得点の内訳構成比」（PITP/FBPS/2ND PTS/PTSOFFTOが
// チーム総得点に占める割合）に加え、2026-08-29に「シュート選択構成比」（%3PM/%3PA/%PAINT2M/
// %PAINT2A/%MID2M/%MID2A、いずれもチーム自身の全FGAに占める割合）を追加した。
// %PAINT2M/%PAINT2A/%MID2M/%MID2Aのみショットチャート座標由来のため2022-23シーズン以降限定
// （seasonRecordSupportsShotChart()、それ以前は「-」）。
// 平均/合計トグル: カウント系の列（MIN〜+/-）は選択に応じて値を切り替え、%系・比率系
// （FG%等、AST/TOV、POSS以外のアドバンスド指標、スコアリングタブ全項目）は総量に対する比率・
// 100ポゼッションあたり等の正規化済み指標のため両モードで同じ値のまま変化しない。
// 自チーム/opp/+/-トグル（Phase H8-2）: G・MIN・POSS・PACEは両チーム共通の値（試合数・
// 試合時間・ポゼッション・ペースはどちらのチーム視点でも同一）のためトグルの影響を受けない。
// EFFはBリーグ公式式にテクニカルファウルの重み付け（TF項）が必要だが、相手チームの
// テクニカルファウル数はTeamGameLogに永続化していないため正確な相手視点の値を算出できない。
// 近似式を黙って採用しないという方針（CLAUDE.md）に従い、EFFのみ自チームの値のまま固定する
const TEAM_SEASON_TRADITIONAL_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "min",
    label: "MIN",
    format: (r, _m, mode) =>
      formatMinutesFromSeconds(Math.round((mode === "total" ? r.team.totals.min : r.team.perGame.min) * 60)),
  },
  {
    key: "pts",
    label: "PTS",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.pts, m.oppPts, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fgm",
    label: "FGM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.fgm, m.oppFgm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fga",
    label: "FGA",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.fga, m.oppFga, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fgpct",
    label: "FG%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.fgPct, r.team.opponentShooting.fgPct, p),
  },
  {
    key: "2pm",
    label: "2PM",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.fgm - r.team.totals.tpm, m.oppFgm - m.oppTpm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "2pa",
    label: "2PA",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.fga - r.team.totals.tpa, m.oppFga - m.oppTpa, r.team.gamesPlayed, mode, p),
  },
  {
    key: "2ppct",
    label: "2P%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.pt2Pct, r.team.opponentShooting.pt2Pct, p),
  },
  {
    key: "3pm",
    label: "3PM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.tpm, m.oppTpm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "3pa",
    label: "3PA",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.tpa, m.oppTpa, r.team.gamesPlayed, mode, p),
  },
  {
    key: "3ppct",
    label: "3P%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.tpPct, r.team.opponentShooting.tpPct, p),
  },
  {
    key: "ftm",
    label: "FTM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.ftm, m.oppFtm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fta",
    label: "FTA",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.fta, m.oppFta, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ftpct",
    label: "FT%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.ftPct, r.team.opponentShooting.ftPct, p),
  },
  {
    key: "or",
    label: "OR",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.oreb, m.oppOreb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "dr",
    label: "DR",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.dreb, m.oppDreb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "tr",
    label: "TR",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.reb, m.oppOreb + m.oppDreb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ast",
    label: "AST",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.ast, m.oppAst, r.team.gamesPlayed, mode, p),
  },
  {
    key: "tov",
    label: "TOV",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.tov, m.oppTov, r.team.gamesPlayed, mode, p),
  },
  {
    key: "asttov",
    label: "AST/TOV",
    format: (r, m, _mode, p) =>
      formatTeamSeasonDecimal(
        astToTovRatio(r.team.totals.ast, r.team.totals.tov),
        astToTovRatio(m.oppAst, m.oppTov),
        p,
      ),
  },
  {
    key: "stl",
    label: "STL",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.stl, m.oppStl, r.team.gamesPlayed, mode, p),
  },
  {
    key: "blk",
    label: "BLK",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.blk, m.oppBlk, r.team.gamesPlayed, mode, p),
  },
  {
    key: "bsr",
    label: "BSR",
    // opp視点のBSR（相手チームの被ブロック数）＝自チームのブロック数（totals.blk）。
    // TeamGameLogに「相手の被ブロック数」という専用フィールドは無いが、自チームが
    // ブロックした本数＝相手からすれば被ブロックされた本数という表裏の関係で導出できる
    format: (r, _m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.blockedAgainst, r.team.totals.blk, r.team.gamesPlayed, mode, p),
  },
  {
    key: "f",
    label: "F",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.pf, m.oppPf, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fd",
    label: "FD",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.foulsDrawn, m.oppFoulsDrawn, r.team.gamesPlayed, mode, p),
  },
  {
    key: "eff",
    label: "EFF",
    format: (r, _m, mode) =>
      formatDecimal(
        mode === "total" ? r.team.advanced.eff * r.team.gamesPlayed : r.team.advanced.eff,
        mode === "total" ? 0 : 1,
      ),
  },
  {
    key: "plusminus",
    label: "+/-",
    format: (r, _m, mode, p) => {
      const ownTotal = r.team.netPerGame.pts * r.team.gamesPlayed;
      return formatTeamSeasonCountPerspective(ownTotal, -ownTotal, r.team.gamesPlayed, mode, p, { signed: true });
    },
  },
];

const TEAM_SEASON_ADVANCED_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "tovpct",
    label: "TOV%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct100(r.team.advanced.tovPct, r.team.advanced.opponentTovPct, p),
  },
  {
    key: "ftr",
    label: "FTR",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.ftRate, r.team.opponentShooting.ftRate, p),
  },
  {
    key: "orbpct",
    label: "OR%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct100(r.team.advanced.orbPct, r.team.advanced.opponentOrbPct, p),
  },
  {
    key: "efg",
    label: "eFG%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.efgPct, r.team.opponentShooting.efgPct, p),
  },
  {
    key: "ts",
    label: "TS%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.tsPct, r.team.opponentShooting.tsPct, p),
  },
  {
    key: "pps",
    label: "PPS",
    format: (r, m, _mode, p) =>
      formatTeamSeasonDecimal(safeDiv(r.team.totals.pts, r.team.totals.fga), safeDiv(m.oppPts, m.oppFga), p, 2),
  },
  {
    key: "poss",
    label: "POSS",
    format: (r, _m, mode) =>
      mode === "total"
        ? formatDecimal(r.team.advanced.poss, 0)
        : formatDecimal(safeDiv(r.team.advanced.poss, r.team.gamesPlayed)),
  },
  { key: "pace", label: "PACE", format: (r) => formatDecimal(r.team.advanced.pace) },
  {
    key: "ortg",
    label: "ORtg",
    // opp視点のORtg＝自チームのDRtg（同じPOSSを分母にした「相手の得点効率」という意味で、
    // 「チームスタッツ」「日程結果」タブのopp視点ORtg/DRtg入れ替えと同じ考え方）
    format: (r, _m, _mode, p) => formatTeamSeasonDecimal(r.team.advanced.offRtg, r.team.advanced.defRtg, p),
  },
  {
    key: "drtg",
    label: "DRtg",
    format: (r, _m, _mode, p) => formatTeamSeasonDecimal(r.team.advanced.defRtg, r.team.advanced.offRtg, p),
  },
  {
    key: "netrtg",
    label: "NetRtg",
    format: (r, _m, _mode, p) => formatTeamSeasonSigned(r.team.advanced.netRtg, -r.team.advanced.netRtg, p),
  },
];

const TEAM_SEASON_MISC_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "pitp",
    label: "PITP",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.pt2in, m.oppPt2in, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fbps",
    label: "FBPS",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.fb, m.oppFb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "2ndpts",
    label: "2ND PTS",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.pt2nd, m.oppPt2nd, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.pft, m.oppPft, r.team.gamesPlayed, mode, p),
  },
  {
    key: "dunk",
    label: "DUNK",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.dunks, m.oppDunks, r.team.gamesPlayed, mode, p),
  },
  // ベンチ/スタメン得点・国籍区分別得点（Batch 1でヘッダータイルから移設）。r.team.advancedに
  // 既にシーズン平均値が集計済みのため、+/-列と同じ「perGame×gamesPlayedで合計値を復元する」
  // 方式でmode（平均/合計）・perspective（own/opp/diff）に対応する
  {
    key: "benchPts",
    label: "BENCH PTS",
    format: (r, _m, mode, p) =>
      formatTeamSeasonCountPerspective(
        r.team.advanced.benchPointsPerGame * r.team.gamesPlayed,
        r.team.advanced.opponentBenchPointsPerGame * r.team.gamesPlayed,
        r.team.gamesPlayed,
        mode,
        p,
      ),
  },
  {
    key: "starterPts",
    label: "STARTER PTS",
    format: (r, _m, mode, p) =>
      formatTeamSeasonCountPerspective(
        r.team.advanced.starterPointsPerGame * r.team.gamesPlayed,
        r.team.advanced.opponentStarterPointsPerGame * r.team.gamesPlayed,
        r.team.gamesPlayed,
        mode,
        p,
      ),
  },
  {
    key: "japanesePts",
    label: "日本人 PTS",
    format: (r, _m, mode, p) =>
      formatTeamSeasonCountPerspective(
        r.team.advanced.japanesePointsPerGame * r.team.gamesPlayed,
        r.team.advanced.opponentJapanesePointsPerGame * r.team.gamesPlayed,
        r.team.gamesPlayed,
        mode,
        p,
      ),
  },
  {
    key: "internationalPts",
    label: "外国籍・帰化・アジア PTS",
    format: (r, _m, mode, p) =>
      formatTeamSeasonCountPerspective(
        r.team.advanced.internationalPointsPerGame * r.team.gamesPlayed,
        r.team.advanced.opponentInternationalPointsPerGame * r.team.gamesPlayed,
        r.team.gamesPlayed,
        mode,
        p,
      ),
  },
  {
    key: "tf",
    label: "TF",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.technicalFouls, m.oppTechnicalFouls, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ufoul",
    label: "UFOUL",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(m.unsportsmanlikeFouls, m.oppUnsportsmanlikeFouls, r.team.gamesPlayed, mode, p),
  },
  {
    key: "dqfoul",
    label: "DQFOUL",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(m.disqualifyingFouls, m.oppDisqualifyingFouls, r.team.gamesPlayed, mode, p),
  },
  {
    key: "and1",
    label: "AND1",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.basketCounts, m.oppBasketCounts, r.team.gamesPlayed, mode, p),
  },
  {
    key: "astpct",
    label: "AST%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * r.team.totals.ast, r.team.totals.fgm), safeDiv(100 * m.oppAst, m.oppFgm), p),
  },
];

const TEAM_SEASON_SCORING_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "pitppct",
    label: "PITP%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.pt2in, r.team.totals.pts), safeDiv(100 * m.oppPt2in, m.oppPts), p),
  },
  {
    key: "fbppct",
    label: "FBP%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.fb, r.team.totals.pts), safeDiv(100 * m.oppFb, m.oppPts), p),
  },
  {
    key: "2ndptspct",
    label: "2ND PTS%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.pt2nd, r.team.totals.pts), safeDiv(100 * m.oppPt2nd, m.oppPts), p),
  },
  {
    key: "ptsofftovpct",
    label: "PTSOFFTO%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.pft, r.team.totals.pts), safeDiv(100 * m.oppPft, m.oppPts), p),
  },
  // アシストからの得点（得点の内訳のまとまりとしてMiscから移設。DESIGN.md 140章）
  {
    key: "ast2m",
    label: "AST2M",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.assisted2m, m.oppAssisted2m, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ast3m",
    label: "AST3M",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.assisted3m, m.oppAssisted3m, r.team.gamesPlayed, mode, p),
  },
  {
    key: "astftm",
    label: "ASTFTM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.assistedFtm, m.oppAssistedFtm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "pctptsasted",
    label: "%PTS ASTED",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(
        safeDiv(100 * (m.assisted2m * 2 + m.assisted3m * 3 + m.assistedFtm), r.team.totals.pts),
        safeDiv(100 * (m.oppAssisted2m * 2 + m.oppAssisted3m * 3 + m.oppAssistedFtm), m.oppPts),
        p,
      ),
  },
  // %BENCH PTS・%STARTER PTSは自チームの得点構成比のみを意味のある指標として扱い、
  // EFF列（TEAM_SEASON_TRADITIONAL_COLUMNS）と同じくperspectiveの選択に関わらず常に
  // 自チームの値を表示する（opp/diff版は設けない。Batch 1でヘッダータイルから移設）
  {
    key: "benchptspct",
    label: "%BENCH PTS",
    format: (r) => formatPct100(r.team.advanced.benchPointsSharePct),
  },
  {
    key: "starterptspct",
    label: "%STARTER PTS",
    format: (r) => formatPct100(r.team.advanced.starterPointsSharePct),
  },
  // Batch 3（2026-09-08）: 得点傾向の%系（総得点に対する割合）。own/opp/diffに対応する
  // シーズン合計値ベースの構成比（Phase H10・85章で追加済みのteam.advanced.*SharePct、
  // PBPタグ集計方式のためショットチャート座標に依存せず全シーズン対応）
  {
    key: "pct3p",
    label: "%3P",
    format: (r, _m, _mode, p) =>
      formatTeamSeasonPct100(r.team.advanced.threePointPointsSharePct, r.team.advanced.opponentThreePointPointsSharePct, p),
  },
  {
    key: "pctpinp",
    label: "%PinP",
    format: (r, _m, _mode, p) =>
      formatTeamSeasonPct100(r.team.advanced.paintPointsSharePct, r.team.advanced.opponentPaintPointsSharePct, p),
  },
  {
    key: "pctpoutp",
    label: "%PoutP",
    format: (r, _m, _mode, p) =>
      formatTeamSeasonPct100(r.team.advanced.midRangePointsSharePct, r.team.advanced.opponentMidRangePointsSharePct, p),
  },
  {
    key: "pctft",
    label: "%FT",
    format: (r, _m, _mode, p) => formatTeamSeasonPct100(r.team.advanced.ftPointsSharePct, r.team.advanced.opponentFtPointsSharePct, p),
  },
  // 登録区分別得点（日本人/外国籍・帰化・アジアの2分割）。team.advanced.foreignPointsPerGame等
  // （旧3分割版の内部フィールド）を合算して2区分に統一する（src/lib/classificationFilter.ts参照）
  {
    key: "japanesePts3",
    label: "日本人 PTS",
    format: (r, _m, mode, p) =>
      formatTeamSeasonCountPerspective(
        r.team.advanced.japanesePointsPerGame * r.team.gamesPlayed,
        r.team.advanced.opponentJapanesePointsPerGame * r.team.gamesPlayed,
        r.team.gamesPlayed,
        mode,
        p,
      ),
  },
  {
    key: "internationalPts3",
    label: "外国籍・帰化・アジア PTS",
    format: (r, _m, mode, p) =>
      formatTeamSeasonCountPerspective(
        (r.team.advanced.foreignPointsPerGame + r.team.advanced.naturalizedOrAsianPointsPerGame) * r.team.gamesPlayed,
        (r.team.advanced.opponentForeignPointsPerGame + r.team.advanced.opponentNaturalizedOrAsianPointsPerGame) *
          r.team.gamesPlayed,
        r.team.gamesPlayed,
        mode,
        p,
      ),
  },
  {
    key: "pctjapanese3",
    label: "%日本人 PTS",
    format: (r, _m, _mode, p) =>
      formatTeamSeasonPct100(r.team.advanced.japanesePointsSharePct, r.team.advanced.opponentJapanesePointsSharePct, p),
  },
  {
    key: "pctinternational3",
    label: "%外国籍・帰化・アジア PTS",
    format: (r, _m, _mode, p) =>
      formatTeamSeasonPct100(
        r.team.advanced.foreignPointsSharePct + r.team.advanced.naturalizedOrAsianPointsSharePct,
        r.team.advanced.opponentForeignPointsSharePct + r.team.advanced.opponentNaturalizedOrAsianPointsSharePct,
        p,
      ),
  },
  // ここから下は「自チーム/相手チームの全FGAに対する割合」（シュート選択構成比）。
  // 上記PITP%等（総得点に対する割合）とは分母が異なる別系統の指標
  {
    key: "pct3pm",
    label: "%3PM",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * r.team.totals.tpm, r.team.totals.fga), safeDiv(100 * m.oppTpm, m.oppFga), p),
  },
  {
    key: "pct3pa",
    label: "%3PA",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * r.team.totals.tpa, r.team.totals.fga), safeDiv(100 * m.oppTpa, m.oppFga), p),
  },
  {
    key: "pct2pm",
    label: "%2PM",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(
        safeDiv(100 * (r.team.totals.fgm - r.team.totals.tpm), r.team.totals.fga),
        safeDiv(100 * (m.oppFgm - m.oppTpm), m.oppFga),
        p,
      ),
  },
  {
    key: "pct2pa",
    label: "%2PA",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(
        safeDiv(100 * (r.team.totals.fga - r.team.totals.tpa), r.team.totals.fga),
        safeDiv(100 * (m.oppFga - m.oppTpa), m.oppFga),
        p,
      ),
  },
  // Batch 3（2026-09-08）: %IPA（ペイント内試投割合）・%OPA（ペイント外試投割合）。
  // ペイント内試投数（m.paint2a）自体がショットチャート座標由来のため2022-23シーズン以降限定
  {
    key: "pctipa",
    label: "%IPA",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.paint2a, r.team.totals.fga), safeDiv(100 * m.oppPaint2a, m.oppFga), p)
        : "-",
  },
  {
    key: "pctopa",
    label: "%OPA",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(
            safeDiv(100 * (r.team.totals.fga - m.paint2a), r.team.totals.fga),
            safeDiv(100 * (m.oppFga - m.oppPaint2a), m.oppFga),
            p,
          )
        : "-",
  },
  {
    key: "pctpaint2m",
    label: "%PAINT2M",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.paint2m, r.team.totals.fga), safeDiv(100 * m.oppPaint2m, m.oppFga), p)
        : "-",
  },
  {
    key: "pctpaint2a",
    label: "%PAINT2A",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.paint2a, r.team.totals.fga), safeDiv(100 * m.oppPaint2a, m.oppFga), p)
        : "-",
  },
  {
    key: "pctmid2m",
    label: "%MID2M",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.mid2m, r.team.totals.fga), safeDiv(100 * m.oppMid2m, m.oppFga), p)
        : "-",
  },
  {
    key: "pctmid2a",
    label: "%MID2A",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.mid2a, r.team.totals.fga), safeDiv(100 * m.oppMid2a, m.oppFga), p)
        : "-",
  },
];

const TEAM_SEASON_BOX_COLUMNS: Record<SeasonBoxTabKey, TeamSeasonBoxColumn[]> = {
  traditional: TEAM_SEASON_TRADITIONAL_COLUMNS,
  advanced: TEAM_SEASON_ADVANCED_COLUMNS,
  misc: TEAM_SEASON_MISC_COLUMNS,
  scoring: TEAM_SEASON_SCORING_COLUMNS,
};

// ---- 「シチュエーション別勝敗」（Phase H3③、概要タブ） ----

const SITUATIONAL_RECORD_STATUS_LABELS: Record<"lead" | "tie" | "behind", string> = {
  lead: "リード",
  tie: "同点",
  behind: "ビハインド",
};

interface SituationalRecordRow {
  key: string;
  label: string;
  /** rawGameが必要な区分（延長・Q別リード状況）は、未取得の試合に対してはこの関数を呼ばない
   * （呼び出し側でrawGames.has(scheduleKey)の試合だけに絞り込んでから呼ぶ） */
  predicate: (g: TeamGameLog, rawGame: StoredGame | undefined) => boolean;
}

interface SituationalRecordGroupDef {
  key: string;
  label: string;
  /** trueの区分は試合の生データ（quarterScores）が無いと判定できないため、rawGamesに
   * 存在する試合だけを母集団にする（DESIGN.md参照。日程結果/スタッツタブと同じstatsRawGamesを再利用） */
  needsRawGame?: boolean;
  rows: SituationalRecordRow[];
}

/** 1ポゼッションあたりの平均得点（両チーム合計点 / (POSS×2)）。「点差決着」グループの
 * 1POS/2POS差以内判定では現在使用していない（2026-08-29、固定点差方式に変更したため。
 * 下記marginWithinPossessions()参照）。他の用途で再利用する可能性があるため残してある */
function pointsPerPossession(g: TeamGameLog): number {
  return safeDiv(g.teamScore + g.opponentScore, 2 * g.poss);
}

/** その試合の実際のPOSSデータから算出したポゼッション差判定（現在未使用。2026-08-29、
 * 「点差決着」グループの1POS/2POS差以内は固定点差（3点/6点）方式に変更したため、
 * marginWithinFixedPoints()に置き換えた。関数自体は削除せず残してある） */
function marginWithinPossessions(g: TeamGameLog, n: number): boolean {
  const ppp = pointsPerPossession(g);
  if (ppp <= 0) return false;
  return Math.abs(g.teamScore - g.opponentScore) <= Math.round(ppp * n);
}

/** 1POS/2POS差以内の判定基準（固定点差）。ユーザー指定により2026-08-29、POSSベースの
 * marginWithinPossessions()から固定点差方式に変更した: 1POS差=3点差以内、2POS差=6点差以内 */
function marginWithinFixedPoints(g: TeamGameLog, points: number): boolean {
  return Math.abs(g.teamScore - g.opponentScore) <= points;
}

function cumulativeQuarterScore(scores: number[], throughQuarter: number): number {
  return scores.slice(0, throughQuarter).reduce((a, b) => a + b, 0);
}

/** 指定Q終了時点でのリード/同点/ビハインドを、rawGame.quarterScores（既存の試合詳細ページの
 * スコアボードと同じデータ）から判定する。rawGame未取得ならundefined（呼び出し側で除外） */
function statusAtCheckpoint(
  g: TeamGameLog,
  rawGame: StoredGame | undefined,
  throughQuarter: number,
): "lead" | "tie" | "behind" | undefined {
  if (!rawGame) return undefined;
  const home = cumulativeQuarterScore(rawGame.quarterScores.home, throughQuarter);
  const away = cumulativeQuarterScore(rawGame.quarterScores.away, throughQuarter);
  const own = g.isHome ? home : away;
  const opp = g.isHome ? away : home;
  if (own > opp) return "lead";
  if (own < opp) return "behind";
  return "tie";
}

function buildSituationalRecordGroups(
  logs: TeamGameLog[],
  teamId: string,
  backToBack: Map<string, Map<string, BackToBackGame>> | undefined,
  opponentRecords: Map<string, Map<string, RecordBeforeGame>> | undefined,
  divisionHistory: DivisionHistoryFile | null | undefined,
  season: string,
): SituationalRecordGroupDef[] {
  const monthsWithData = new Set(logs.map((g) => Number(g.date.slice(5, 7))));
  return [
    {
      key: "venue",
      label: "会場",
      rows: [
        { key: "home", label: "ホーム", predicate: (g) => g.isHome },
        { key: "away", label: "アウェイ", predicate: (g) => !g.isHome },
      ],
    },
    {
      key: "division",
      label: "地区",
      rows: [
        { key: "east", label: "対東地区", predicate: (g) => matchesDivision(g, "east", divisionHistory, season) },
        { key: "west", label: "対西地区", predicate: (g) => matchesDivision(g, "west", divisionHistory, season) },
      ],
    },
    {
      key: "weekday",
      label: "曜日",
      rows: [{ key: "wed", label: "水曜開催", predicate: (g) => isWednesdayGame(g.date) }],
    },
    {
      key: "month",
      label: "月別",
      rows: Array.from({ length: 12 }, (_, i) => ((i + 8) % 12) + 1)
        .filter((m) => monthsWithData.has(m))
        .map((m) => ({ key: `m${m}`, label: `${m}月`, predicate: (g: TeamGameLog) => matchesMonth(g, m) })),
    },
    {
      key: "opponentStrength",
      label: "対戦相手の強さ",
      rows: opponentRecords
        ? (
            [
              ["under50", "対5割未満"],
              ["atLeast50", "対5割以上"],
              ["atLeast60", "対6割以上"],
            ] as const
          ).map(([tier, label]) => ({
            key: tier,
            label,
            predicate: (g: TeamGameLog) => matchesOpponentWinRateTier(g, tier, opponentRecords),
          }))
        : [],
    },
    {
      key: "backToBack",
      label: "連戦",
      rows: backToBack
        ? (["GAME1", "GAME2"] as const).map((status) => ({
            key: status,
            label: status,
            predicate: (g: TeamGameLog) => backToBack.get(g.scheduleKey)?.get(teamId) === status,
          }))
        : [],
    },
    {
      key: "foreignPlayerCount",
      label: "自チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `own${n}`,
        label: `${n}人`,
        predicate: (g: TeamGameLog) => g.foreignPlayerCount === n,
      })),
    },
    {
      key: "score",
      label: "得点/失点",
      rows: [
        { key: "score80plus", label: "80得点以上", predicate: (g: TeamGameLog) => g.teamScore >= 80 },
        { key: "score80under", label: "80得点未満", predicate: (g: TeamGameLog) => g.teamScore < 80 },
        { key: "allow80under", label: "80失点未満", predicate: (g: TeamGameLog) => g.opponentScore < 80 },
        { key: "allow80plus", label: "80失点以上", predicate: (g: TeamGameLog) => g.opponentScore >= 80 },
        {
          key: "both80plus",
          label: "お互い80点以上",
          predicate: (g: TeamGameLog) => g.teamScore >= 80 && g.opponentScore >= 80,
        },
        {
          key: "both80under",
          label: "お互い80点未満",
          predicate: (g: TeamGameLog) => g.teamScore < 80 && g.opponentScore < 80,
        },
        { key: "century", label: "100点ゲーム", predicate: (g: TeamGameLog) => g.teamScore >= 100 || g.opponentScore >= 100 },
      ],
    },
    {
      key: "margin",
      label: "点差決着",
      rows: [
        { key: "margin10", label: "10点差以上", predicate: (g: TeamGameLog) => Math.abs(g.teamScore - g.opponentScore) >= 10 },
        { key: "margin20", label: "20点差以上", predicate: (g: TeamGameLog) => Math.abs(g.teamScore - g.opponentScore) >= 20 },
        { key: "poss1", label: "1POS差以内", predicate: (g: TeamGameLog) => marginWithinFixedPoints(g, 3) },
        { key: "poss2", label: "2POS差以内", predicate: (g: TeamGameLog) => marginWithinFixedPoints(g, 6) },
      ],
    },
    // 試合中の最大リード・最大ビハインド（延長戦を含む。DESIGN.md 150章）。同じ試合が複数の行に入ることがある
    {
      key: "inGameMargin",
      label: "試合中の点差",
      rows: (Object.keys(MARGIN_CONDITION_LABELS) as MarginCondition[]).map((c) => ({
        key: c,
        label: MARGIN_CONDITION_LABELS[c],
        predicate: (g: TeamGameLog) => matchesMargin(g, c),
      })),
    },
    {
      key: "overtime",
      label: "延長",
      needsRawGame: true,
      rows: [
        { key: "ot", label: "OT試合", predicate: (_g, raw) => !!raw && raw.quarterScores.home.length > 4 },
        { key: "regulation", label: "レギュレーション決着", predicate: (_g, raw) => !!raw && raw.quarterScores.home.length <= 4 },
      ],
    },
    {
      key: "q1status",
      label: "Q1終了時点",
      needsRawGame: true,
      rows: (["lead", "tie", "behind"] as const).map((status) => ({
        key: status,
        label: SITUATIONAL_RECORD_STATUS_LABELS[status],
        predicate: (g, raw) => statusAtCheckpoint(g, raw, 1) === status,
      })),
    },
    {
      key: "halfStatus",
      label: "前半終了時点",
      needsRawGame: true,
      rows: (["lead", "tie", "behind"] as const).map((status) => ({
        key: status,
        label: SITUATIONAL_RECORD_STATUS_LABELS[status],
        predicate: (g, raw) => statusAtCheckpoint(g, raw, 2) === status,
      })),
    },
    {
      key: "q3status",
      label: "3Q終了時点",
      needsRawGame: true,
      rows: (["lead", "tie", "behind"] as const).map((status) => ({
        key: status,
        label: SITUATIONAL_RECORD_STATUS_LABELS[status],
        predicate: (g, raw) => statusAtCheckpoint(g, raw, 3) === status,
      })),
    },
  ];
}

interface SituationalRecordStats {
  key: string;
  label: string;
  games: number;
  wins: number;
  losses: number;
  winPct: number;
}

/** 勝率に応じた背景色（緑=高勝率〜赤=低勝率のグラデーション）。h2h-win/h2h-lossと同じ
 * 基調色（緑#2e7d32・赤系var(--accent)）をcolor-mix()で連続的に補間する */
function winPctBackground(winPct: number): string {
  const greenPct = Math.round(Math.max(0, Math.min(1, winPct)) * 100);
  return `color-mix(in srgb, color-mix(in srgb, #2e7d32 ${greenPct}%, var(--accent) ${100 - greenPct}%) 22%, transparent)`;
}

interface TeamScheduleRow {
  scheduleKey: string;
  date: string;
  opponentName: string;
  /** 略称表示（スマホ幅）に使う。未消化の試合（UpcomingGameEntry）はチーム名しか持たないため未設定 */
  opponentTeamId?: string;
  isHome: boolean;
  status: "final" | "live" | "upcoming";
  teamScore?: number;
  opponentScore?: number;
  venue?: string;
  gameType?: GameType;
}

function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** 選手名セル: サムネイル写真＋名前＋簡易プロフィール（ポジション・身長・体重）をまとめて表示する */
function playerProfileLine(p: PlayerSummary): string | null {
  const parts: string[] = [];
  const position = positionText(p);
  const height = heightText(p);
  const weight = weightText(p);
  if (position) parts.push(position);
  if (height) parts.push(height);
  if (weight) parts.push(weight);
  return parts.length > 0 ? parts.join("・") : null;
}

function buildTeamScheduleRows(
  summaries: GameSummary[],
  upcoming: UpcomingGameEntry[],
  teamId: string,
  teamName: string,
): TeamScheduleRow[] {
  const summaryKeys = new Set(summaries.map((g) => g.scheduleKey));
  const finishedRows: TeamScheduleRow[] = summaries
    .filter((g) => g.homeTeamId === teamId || g.awayTeamId === teamId)
    .map((g) => {
      const isHome = g.homeTeamId === teamId;
      return {
        scheduleKey: g.scheduleKey,
        date: g.date,
        opponentName: isHome ? g.awayTeamName : g.homeTeamName,
        opponentTeamId: isHome ? g.awayTeamId : g.homeTeamId,
        isHome,
        status: g.gameEndedFlg ? "final" : "live",
        teamScore: isHome ? g.homeScore : g.awayScore,
        opponentScore: isHome ? g.awayScore : g.homeScore,
        venue: g.venue,
        gameType: g.gameType,
      };
    });
  const upcomingRows: TeamScheduleRow[] = upcoming
    .filter((g) => !summaryKeys.has(g.scheduleKey) && (g.homeTeamName === teamName || g.awayTeamName === teamName))
    .map((g) => {
      const isHome = g.homeTeamName === teamName;
      return {
        scheduleKey: g.scheduleKey,
        date: g.date,
        opponentName: isHome ? g.awayTeamName : g.homeTeamName,
        isHome,
        status: "upcoming",
        venue: g.venue,
      };
    });
  return [...finishedRows, ...upcomingRows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey),
  );
}

/**
 * 「シチュエーション別成績」（チーム版）の1グループ（会場・地区・曜日・時期・月別・
 * 対戦相手の強さ・連戦・外国籍人数）。個人詳細ページの同名セクションと違い、チームの
 * TeamGameLogは既にそのチーム自身の試合ログ（シーズン内移籍のような「所属チームの動的解決」が
 * 不要）なので、行はpredicateで絞った試合の生データからbuildTeamMultiGameBoxTotalsを直接
 * 呼ぶだけでよい（Phase H4④、上部集計表と同じCOLUMNS_BY_TAB/カテゴリタブに変更）
 */
interface TeamSituationalRowDef {
  key: string;
  label: string;
  predicate: (g: TeamGameLog) => boolean;
}
interface TeamSituationalGroupDef {
  key: string;
  label: string;
  rows: TeamSituationalRowDef[];
}
interface TeamSituationalStatsRow {
  key: string;
  label: string;
  gamesPlayed: number;
  boxTotals: TeamGameBoxTotals;
  /** シューティングタブ用: この行に属する試合のscheduleKey一覧 */
  scheduleKeys: string[];
  /** この行に属する試合の、対戦相手の「その試合時点までの」勝率の単純平均（相手の強さの目安）。
   * buildRecordsBeforeGame()の結果が無い、または算出対象の試合が0件ならundefined */
  oppWinPctAvg: number | undefined;
  /** ベンチ/スタメン得点・国籍区分別得点（Batch 1、Miscタブ末尾に列として表示）。boxTotalsと
   * 同じ試合集合から算出する */
  points: TeamPointsBreakdownResult | null;
}
interface TeamSituationalStatsGroup {
  key: string;
  label: string;
  rows: TeamSituationalStatsRow[];
}

// 「通算成績」タブ（Phase TF）・「クラブレコード」タブ（Phase TG）の値関数（TeamCareerTotals/
// buildTeamCareerTotals/longestWinStreak/CAREER_TOTAL_DEFS/TEAM_RECORD_STATS/
// bestTeamSeasonRecord）は、歴代クラブ横断の順位算出バッチ（scripts/aggregate-league-rankings.ts、
// Phase H7）からも同じ定義を参照する必要があるため、shared/teamRecords.tsに移設した
// （二重管理を避けるため。DESIGN.md参照）。TEAM_RECORD_STATSのみ、フロントエンド表示専用の
// %フォーマット（format）をこのファイル側で追加でマージしている（shared側はvalue/filterのみで
// 完結させ、表示整形の関心事を持ち込まないようにした）

/**
 * 「クラブレコード」タブ（Phase TG）: 個人詳細ページのキャリアハイ/ワースト（CareerHighGame/
 * CAREER_HIGH_STATS）と同じ方式をチーム版に転用したもの。1試合単位の最高/最低記録を扱う
 */
type TeamRecordGame = TeamGameLog & { season: string };

interface TeamRecordDef {
  key: string;
  label: string;
  value: (g: TeamRecordGame) => number;
  format?: (v: number) => string;
  worstEligible?: boolean;
  filter?: (g: TeamRecordGame) => boolean;
  lowerIsBetter?: boolean;
  topNEligible?: boolean;
}

const TEAM_RECORD_PCT_FORMATS: Partial<Record<string, (v: number) => string>> = {
  fgPct: formatPct,
  twoPct: formatPct,
  tpPct: formatPct,
  ftPct: formatPct,
};

const TEAM_RECORD_STATS: TeamRecordDef[] = TEAM_RECORD_VALUE_DEFS.map((d) => ({
  ...d,
  format: TEAM_RECORD_PCT_FORMATS[d.key],
}));

/** 「被記録」（Phase H8）: TEAM_RECORD_STATSと同じ%フォーマットのマージだけを行う */
const TEAM_AGAINST_RECORD_STATS: TeamRecordDef[] = TEAM_AGAINST_RECORD_VALUE_DEFS.map((d) => ({
  ...d,
  format: TEAM_RECORD_PCT_FORMATS[d.key],
}));

/** 同じ記録値の試合が複数ある場合、新しい順（日付降順）に並べる（個人版と同じ方式） */
function sortTeamRecordGamesByDateDesc(games: TeamRecordGame[]): TeamRecordGame[] {
  return [...games].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 「◯位/◯チーム」表示。formatTeamRank()と同じフォーマット規則（rankAmongTeamsとは別に
 * データ自体に順位が既に含まれているLeagueTeamRankEntry用） */
function formatLeagueRank(entry: LeagueTeamRankEntry | undefined): string | undefined {
  return entry ? `${entry.rank}位/${entry.totalTeams}チーム` : undefined;
}

/**
 * 「比較」タブ（Phase TH）: 個人詳細ページの比較タブ（describeSituationalFilter）と同じ
 * ラベル生成ロジック。チーム版はシーズン前半戦/後半戦フィルタに対応していない
 * （チーム詳細の比較スロットがseasonHalfBoundaryを渡していないため、
 * dateRangeは常に「期間指定」/日付範囲表記になる）。2026-08-29、複数選択（AND条件）対応に伴い、
 * range＋AND条件の各軸で同時に選択されている全ての部分を「・」区切りで列挙する形に変更した
 * （1つも選択が無ければ「シーズン全体」）
 */
function describeTeamSituationalFilter(filter: SituationalFilter): string {
  return joinLabels(situationalFilterLabels(filter, { includePlayoffs: true }));
}

interface TeamCompareSlotState {
  season: string;
  filter: SituationalFilter;
  /** true のとき、このチームではなくリーグ平均（シーズン全体。シチュエーションの絞り込みは無し。DESIGN.md 149章） */
  league?: boolean;
}

function defaultTeamCompareSlots(season: string): [TeamCompareSlotState, TeamCompareSlotState] {
  return [
    { season, filter: { range: { kind: "all" } } },
    { season: "", filter: { range: { kind: "all" } } },
  ];
}

/**
 * 「当該シーズン成績」（チームスタッツタブ上部集計表）・「シチュエーション別成績」（チーム版）の
 * Misc/スコアリングタブ末尾に追加するベンチ/スタメン得点・国籍区分別得点の列（Batch 1・2）。
 * COLUMNS_BY_TAB自体（試合詳細ページ等と共有）は変更せず、この2箇所でだけ手動で追加描画する。
 * kind: "count"は自チーム/opp/+/-トグルに従う実数値、"sharePct"は常に自チームの値のみ%表示する
 * （%BENCH PTS等と同じ既存方針。Batch 2で追加した国籍区分別%列もこの方針を踏襲）
 */
interface TeamPointsExtraColumn {
  key: string;
  label: string;
  value: (b: TeamPointsBreakdown) => number;
  kind: "count" | "sharePct";
}

const TEAM_POINTS_MISC_COLUMNS: TeamPointsExtraColumn[] = [
  { key: "benchPts", label: "BENCH PTS", value: (b) => b.bench, kind: "count" },
  { key: "starterPts", label: "STARTER PTS", value: (b) => b.starter, kind: "count" },
  { key: "japanesePts", label: "日本人 PTS", value: (b) => b.japanese, kind: "count" },
  { key: "internationalPts", label: "外国籍・帰化・アジア PTS", value: (b) => b.international, kind: "count" },
];

// %BENCH PTS・%STARTER PTSは自チームの得点構成比のみを意味のある指標として扱い、
// ヘッダータイル時代・「シーズン別成績」と同じくown/opp/diffの切り替え対象外にする。
// 登録区分別得点（日本人/外国籍・帰化・アジアの2分割）を実数値＋割合(%)で追加
const TEAM_POINTS_SHARE_COLUMNS: TeamPointsExtraColumn[] = [
  { key: "benchPtsShare", label: "%BENCH PTS", value: (b) => safeDiv(100 * b.bench, b.bench + b.starter), kind: "sharePct" },
  { key: "starterPtsShare", label: "%STARTER PTS", value: (b) => safeDiv(100 * b.starter, b.bench + b.starter), kind: "sharePct" },
  { key: "japanesePts3", label: "日本人 PTS", value: (b) => b.japanese, kind: "count" },
  { key: "internationalPts3", label: "外国籍・帰化・アジア PTS", value: (b) => b.international, kind: "count" },
  {
    key: "japanesePtsShare3",
    label: "%日本人 PTS",
    value: (b) => safeDiv(100 * b.japanese, b.bench + b.starter),
    kind: "sharePct",
  },
  {
    key: "internationalPtsShare3",
    label: "%外国籍・帰化・アジア PTS",
    value: (b) => safeDiv(100 * b.international, b.bench + b.starter),
    kind: "sharePct",
  },
];

function teamPointsExtraColumnsForTab(tab: BoxscoreTabKey | "shooting" | "forcedTurnovers"): TeamPointsExtraColumn[] {
  return tab === "misc" ? TEAM_POINTS_MISC_COLUMNS : tab === "scoring" ? TEAM_POINTS_SHARE_COLUMNS : [];
}

function formatTeamPointsCount(
  result: TeamPointsBreakdownResult | null,
  col: TeamPointsExtraColumn,
  perspective: TeamPerspective,
  mode: SeasonDisplayMode,
): string {
  if (!result) return "-";
  const digits = mode === "total" ? 0 : 1;
  const ownVal = col.value(result.own);
  const oppVal = col.value(result.opp);
  return perspective === "own" ? formatDecimal(ownVal, digits) : perspective === "opp" ? formatDecimal(oppVal, digits) : formatSigned(ownVal - oppVal, digits);
}

// %BENCH PTS・%STARTER PTS・国籍区分別%は常に自チームの値を表示する（EFF列・「シーズン別成績」と同じ扱い）
function formatTeamPointsSharePct(result: TeamPointsBreakdownResult | null, col: TeamPointsExtraColumn): string {
  return result ? formatPct100(col.value(result.own)) : "-";
}

// Scoring/Miscタブの追加列を、列ごとのkindに応じてcount/sharePctいずれかの表示関数へ振り分ける
function formatTeamPointsExtraColumn(
  result: TeamPointsBreakdownResult | null,
  col: TeamPointsExtraColumn,
  perspective: TeamPerspective,
  mode: SeasonDisplayMode,
): string {
  return col.kind === "sharePct" ? formatTeamPointsSharePct(result, col) : formatTeamPointsCount(result, col, perspective, mode);
}

export function TeamDetailPage({ season }: { season: string }) {
  const { teamId } = useParams<{ teamId: string }>();
  // ブラウザバック等で本コンポーネントが一度アンマウント・再マウントされても、直前の
  // フィルタ条件を復元するためのキャッシュキー（src/lib/pageStateCache.ts参照。
  // 個人詳細ページと同じ仕組み）
  const pk = (field: string) => `team:${teamId}:${field}`;
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const { data: players, loading: playersLoading } = useJsonData(() => fetchPlayers(season), [season]);
  // スマホ幅では名字だけ（同じチームで名字が重なる選手はフルネーム）。表の中の ResponsivePlayerName は PlayerNamePool で同じ一覧を受け取る
  const teamLabel = useTeamLabel();
  const playerLabel = usePlayerLabel((players ?? []).filter((p) => p.teamId === teamId).map((p) => p.name));
  const { data: gameLogs, loading: gameLogsLoading } = useJsonData(
    () => (teamId ? fetchTeamGameLogs(season, teamId) : Promise.resolve([])),
    [season, teamId],
  );
  const { data: lineupsFile } = useJsonData(
    () => (teamId ? fetchTeamLineups(season, teamId) : Promise.resolve(null)),
    [season, teamId],
  );
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const { data: teamHistory } = useJsonData(() => fetchTeamHistory(), []);
  const { data: clubHonors } = useJsonData(() => fetchClubHonors(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);
  // 「当該シーズン成績」「シチュエーション別成績」のBENCH PTS等（Batch 1）の国籍区分別集計用。
  // 季非依存の単一ファイルのため、クラブ・シーズンを問わず1回だけ取得する
  const { data: playersMaster } = useJsonData(() => fetchPlayersMaster(), []);
  const masterById = useMemo(() => new Map((playersMaster ?? []).map((p) => [p.playerId, p])), [playersMaster]);
  // 通算成績・クラブレコードの歴代クラブ横断順位（Phase H7）。scripts/aggregate-league-rankings.tsが
  // 夜間実行で作り直す単一ファイル。ファイルが未生成でもfetchJsonが
  // エラーを投げるだけでページ全体は壊れない（leagueRankingsがnullのまま＝順位バッジ非表示になる）
  const { data: leagueRankings } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  // GameSummary自体にはseasonが無いため、どのシーズンの取得結果かをここで付けておく。useJsonDataは
  // 依存（season）が変わっても新しい取得が終わるまで古いdataを保持するため、その間に走る副作用が
  // 旧シーズンのsummariesを新シーズンのものと取り違えないよう、副作用側でsummariesSeasonを照合する
  const { data: summariesTagged, loading: summariesLoading } = useJsonData(
    () => fetchGameSummaries(season).then((list) => ({ season, list })),
    [season],
  );
  const summaries = summariesTagged?.list ?? null;
  const summariesSeason = summariesTagged?.season;
  const { data: schedule, loading: scheduleLoading } = useJsonData(() => fetchSchedule(season), [season]);
  // ヘッダーの地区順位・全体順位表示用（既存の順位表ページと同じstandings-history.jsonを再利用）
  const { data: standingsHistory } = useJsonData(() => fetchStandingsHistory(season), [season]);
  // シチュエーション別フィルタの「対勝率別」用（対戦相手のその試合時点までの勝率が必要）
  const opponentRecords = useMemo(() => (summaries ? buildRecordsBeforeGame(summaries) : undefined), [summaries]);

  // 「ショットチャート」専用の詳細フィルタ（試合種別・Q別/前後半とともに、シチュエーション別成績とは独立して持つ）
  const [teamShotChartFilter, setTeamShotChartFilter] = usePageState<SituationalFilter>(pk("teamShotChartFilter"), { range: { kind: "all" } });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = usePageState<DetailTab>(pk("tab"), "overview");
  // 「シーズン別成績」のカテゴリ切り替え（Phase H3①）。トラディショナル/アドバンスド/Misc/
  // スコアリングの4タブは既存の選手スタッツ/日程結果タブと同じSEASON_BOX_TABS/SeasonBoxTabKeyを
  // 再利用するが、列自体はTeamSummary（seasonHistory）＋TeamGameLog（careerData、Misc用）から
  // 直接組み立てる専用の列定義（TEAM_SEASON_*_COLUMNS）を使う（DESIGN.md参照）
  const [seasonBoxTab, setSeasonBoxTab] = usePageState<
    SeasonBoxTabKey | "shooting" | "forcedTurnovers" | "foreignPlayers" | "scoringComposition"
  >(pk("seasonBoxTab"), "traditional");
  // On-Court Foreign・Scoring % のシーズン別推移（DESIGN.md 141章）: 規定の上限人数と、今のシーズンがレギュラーシーズンの途中か
  const seasonShareTab = seasonBoxTab === "foreignPlayers" || seasonBoxTab === "scoringComposition";
  const { data: seasonRulesForTrend } = useJsonData(
    () => (seasonShareTab ? fetchSeasonRules() : Promise.resolve(null)),
    [seasonShareTab],
  );
  const { data: currentRace } = useJsonData(
    () => (seasonShareTab ? fetchPlayoffRace(currentSeason()).catch(() => null) : Promise.resolve(null)),
    [seasonShareTab],
  );

  // 「通算成績」タブ（Phase TF）: 個人詳細ページのcareerDataと同じパターンで、このチームが
  // 存在する全シーズン分のTeamGameLogをタブを開いたときだけ遅延取得する
  const [careerData, setCareerData] = useState<{ season: string; logs: TeamGameLog[] }[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);
  const careerFetchStartedRef = useRef(false);
  const [careerGameTypeFilter, setCareerGameTypeFilter] = usePageState<SeasonGameTypeFilter>(pk("careerGameTypeFilter"), "regular");

  useEffect(() => {
    if (
      (tab !== "teamStats" && tab !== "career" && tab !== "clubRecord" && tab !== "compare") ||
      !teamId ||
      !seasons ||
      careerFetchStartedRef.current
    )
      return;
    careerFetchStartedRef.current = true;
    setCareerLoading(true);
    setCareerError(null);
    Promise.all(
      seasons.map(async (s) => {
        try {
          const logs = await fetchTeamGameLogs(s.season, teamId);
          return { season: s.season, logs };
        } catch {
          return { season: s.season, logs: [] as TeamGameLog[] };
        }
      }),
    )
      .then((results) => setCareerData(results.filter((r) => r.logs.length > 0)))
      .catch(() => setCareerError("通算成績の取得に失敗しました"))
      .finally(() => setCareerLoading(false));
  }, [tab, teamId, seasons]);

  // 「シーズン別成績」Miscタブ用（Phase H3①）。シーズンごとにレギュラーシーズンの
  // TeamGameLogだけを合算する（careerDataは「チームスタッツ」タブで通算成績等と同じものを取得済みのため追加取得なし）
  const teamSeasonMiscBySeason = useMemo(
    () => new Map((careerData ?? []).map((cd) => [cd.season, sumTeamSeasonMisc(cd.logs)])),
    [careerData],
  );

  const careerFilteredLogs = useMemo(
    () => (careerData ? filterByGameType(careerData.flatMap((cd) => cd.logs), careerGameTypeFilter) : []),
    [careerData, careerGameTypeFilter],
  );
  const careerTotals = useMemo(() => buildTeamCareerTotals(careerFilteredLogs), [careerFilteredLogs]);
  const careerLongestWinStreak = useMemo(() => longestWinStreak(careerFilteredLogs), [careerFilteredLogs]);

  // 「クラブレコード」タブ（Phase TG）: 「通算成績」タブと同じcareerData・careerGameTypeFilter
  // を共有する（個人詳細ページのキャリアハイ/通算成績タブが1つのトグルを共有するのと同じ方針）
  const [expandedClubRecordTieCards, setExpandedClubRecordTieCards] = usePageState<Set<string>>(pk("expandedClubRecordTieCards"), new Set());
  const toggleClubRecordTieCard = (key: string) => {
    setExpandedClubRecordTieCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // クラブレコードの項目名クリックで展開するトップ10（Batch 3、2026-09-16）の開閉状態。
  // 既存の「他◯試合」展開（expandedClubRecordTieCards、同値タイの他試合展開）とは別の動線
  const [expandedTopNRecordCards, setExpandedTopNRecordCards] = usePageState<Set<string>>(
    pk("expandedTopNRecordCards"),
    () => new Set(),
  );
  const toggleTopNRecordCard = (key: string) => {
    setExpandedTopNRecordCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clubRecordAllGames = useMemo<TeamRecordGame[]>(() => {
    if (!careerData) return [];
    return filterByGameType(
      careerData.flatMap((cd) => cd.logs.map((g) => ({ ...g, season: cd.season }))),
      careerGameTypeFilter,
    );
  }, [careerData, careerGameTypeFilter]);

  const clubRecords = useMemo(() => {
    return TEAM_RECORD_STATS.map((def) => {
      const pool = def.filter ? clubRecordAllGames.filter(def.filter) : clubRecordAllGames;
      let bestValue: number | null = null;
      for (const g of pool) {
        const v = def.value(g);
        if (bestValue === null || (def.lowerIsBetter ? v < bestValue : v > bestValue)) bestValue = v;
      }
      if (bestValue === null) return null;
      const matches = sortTeamRecordGamesByDateDesc(pool.filter((g) => def.value(g) === bestValue));
      const [game, ...otherGames] = matches;
      const topEntries =
        def.topNEligible === false ? [] : computeTopRecordEntries(pool, def.value, def.lowerIsBetter ?? false);
      return { ...def, game, otherGames, topEntries, display: def.format ? def.format(bestValue) : String(bestValue) };
    }).filter(
      (
        r,
      ): r is TeamRecordDef & {
        game: TeamRecordGame;
        otherGames: TeamRecordGame[];
        topEntries: TopRecordEntry<TeamRecordGame>[];
        display: string;
      } => r !== null,
    );
  }, [clubRecordAllGames]);

  // クラブワーストのトップ◯展開（Batch 3拡張、2026-09-16）: oppPts/TOV/PF
  // （lowerIsBetter: true、「多い方が悪い」項目）はワースト方向がMAXになるため、
  // 展開件数もトップ10ではなくトップ5にする（ユーザー指定）
  const clubWorsts = useMemo(() => {
    return TEAM_RECORD_STATS.filter((def) => def.worstEligible !== false)
      .map((def) => {
        const pool = def.filter ? clubRecordAllGames.filter(def.filter) : clubRecordAllGames;
        let worstValue: number | null = null;
        for (const g of pool) {
          const v = def.value(g);
          if (worstValue === null || (def.lowerIsBetter ? v > worstValue : v < worstValue)) worstValue = v;
        }
        if (worstValue === null) return null;
        const matches = sortTeamRecordGamesByDateDesc(pool.filter((g) => def.value(g) === worstValue));
        const [game, ...otherGames] = matches;
        const topEntries = computeTopRecordEntries(
          pool,
          def.value,
          !(def.lowerIsBetter ?? false),
          def.lowerIsBetter ? TOP_RECORD_WORST_BAD_N : undefined,
        );
        return { ...def, game, otherGames, topEntries, display: def.format ? def.format(worstValue) : String(worstValue) };
      })
      .filter(
        (
          r,
        ): r is TeamRecordDef & {
          game: TeamRecordGame;
          otherGames: TeamRecordGame[];
          topEntries: TopRecordEntry<TeamRecordGame>[];
          display: string;
        } => r !== null,
      );
  }, [clubRecordAllGames]);

  // 「被記録」（Phase H8）: 「対戦相手の多かった試合」＝TEAM_AGAINST_RECORD_STATS（TeamGameLogの
  // opponent*フィールド）についても最大値を求める。clubRecordsと同じロジックだが対象defsが異なる。
  // トップ◯展開（Batch 3拡張、2026-09-16）も同じベスト方向（MAX）でトップ10まで対象にする
  const clubAgainstRecords = useMemo(() => {
    return TEAM_AGAINST_RECORD_STATS.map((def) => {
      const pool = def.filter ? clubRecordAllGames.filter(def.filter) : clubRecordAllGames;
      let bestValue: number | null = null;
      for (const g of pool) {
        const v = def.value(g);
        if (bestValue === null || v > bestValue) bestValue = v;
      }
      if (bestValue === null) return null;
      const matches = sortTeamRecordGamesByDateDesc(pool.filter((g) => def.value(g) === bestValue));
      const [game, ...otherGames] = matches;
      const topEntries = def.topNEligible === false ? [] : computeTopRecordEntries(pool, def.value, false);
      return { ...def, game, otherGames, topEntries, display: def.format ? def.format(bestValue) : String(bestValue) };
    }).filter(
      (
        r,
      ): r is TeamRecordDef & {
        game: TeamRecordGame;
        otherGames: TeamRecordGame[];
        topEntries: TopRecordEntry<TeamRecordGame>[];
        display: string;
      } => r !== null,
    );
  }, [clubRecordAllGames]);

  // シーズン単位の特殊集計（最多勝利数・最多連勝）。既存のlongestWinStreak()をシーズンごとの
  // 試合ログに絞って呼ぶだけで「シーズン内」の記録になる（シーズンをまたいだ通算成績タブの
  // 最多連勝＝careerLongestWinStreakとは別の値）
  const clubSeasonAggregates = useMemo<TeamSeasonSpecialAggregate[]>(() => {
    if (!careerData) return [];
    return careerData
      .map((cd) => {
        const filtered = filterByGameType(cd.logs, careerGameTypeFilter);
        return { season: cd.season, wins: filtered.filter((g) => g.win).length, streak: longestWinStreak(filtered), games: filtered.length };
      })
      .filter((s) => s.games > 0);
  }, [careerData, careerGameTypeFilter]);

  const mostWinsSeasonRecord = useMemo(
    () => bestTeamSeasonRecord(clubSeasonAggregates, (a) => a.wins),
    [clubSeasonAggregates],
  );
  const longestStreakSeasonRecord = useMemo(
    () => bestTeamSeasonRecord(clubSeasonAggregates, (a) => a.streak),
    [clubSeasonAggregates],
  );

  // 歴代クラブ横断順位（Phase H7）: leagueRankingsは[gameType][statKey][teamId]のルックアップ構造
  // （scripts/aggregate-league-rankings.ts参照）。「通算成績」「クラブレコード」タブは同じ
  // careerGameTypeFilterを共有しているため、gameTypeの取り違えが起きない
  const careerRank = (statKey: string): LeagueTeamRankEntry | undefined =>
    teamId ? leagueRankings?.career[careerGameTypeFilter]?.[statKey]?.[teamId] : undefined;
  const clubRecordRank = (statKey: string): LeagueTeamRankEntry | undefined =>
    teamId ? leagueRankings?.clubRecord[careerGameTypeFilter]?.[statKey]?.[teamId] : undefined;
  const seasonSpecialRank = (statKey: "wins" | "streak"): LeagueTeamRankEntry | undefined =>
    teamId ? leagueRankings?.seasonSpecial[careerGameTypeFilter]?.[statKey]?.[teamId] : undefined;

  // 「比較」タブ（Phase TH）: 個人詳細ページの比較タブと同じ構成をチーム版に転用したもの。
  // careerData（通算成績/クラブレコードタブと共有、全シーズン分のTeamGameLog）から
  // スロットごとに選んだシーズンの試合ログを取り出し、シチュエーション別フィルタで絞り込む。
  // 自チーム/opp/+/-トグル・トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブは
  // 「日程結果」タブと同じCOLUMNS_BY_TAB/buildTeamGameBoxTotals系を再利用する
  const [compareSlots, setCompareSlots] = usePageState<[TeamCompareSlotState, TeamCompareSlotState]>(pk("compareSlots"), () =>
    defaultTeamCompareSlots(season),
  );
  // usePageStateで復元した直後の値を、このチームの初回マウント時に上書きしてしまわないよう
  // スキップする（src/lib/pageStateCache.ts参照）。実際にチームが変わった2回目以降の発火では
  // 通常通りリセットする
  const skipFirstCompareSlotsReset = useSkipFirstEffectRun(teamId);
  useEffect(() => {
    if (skipFirstCompareSlotsReset()) return;
    setCompareSlots(defaultTeamCompareSlots(season));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);
  const [comparePerspective, setComparePerspective] = usePageState<TeamPerspective>(pk("comparePerspective"), "own");
  const [compareGameType, setCompareGameType] = usePageState<SeasonGameTypeFilter>(pk("compareGameType"), "regular");
  const [compareTab, setCompareTab] = usePageState<BoxscoreTabKey>(pk("compareTab"), "traditional");

  // 各スロットの「対勝率別」フィルタ用（対戦相手のその試合時点までの勝率が必要）。
  // スロットごとに異なるシーズンを選べるため、個人詳細ページの比較タブと同様、
  // 配列化せず2つ個別にuseJsonDataを呼ぶ。「比較」タブを開いている間だけ取得する
  const { data: compareSummaries0 } = useJsonData(
    () => (tab === "compare" && compareSlots[0].season ? fetchGameSummaries(compareSlots[0].season) : Promise.resolve(null)),
    [tab, compareSlots[0].season],
  );
  const { data: compareSummaries1 } = useJsonData(
    () => (tab === "compare" && compareSlots[1].season ? fetchGameSummaries(compareSlots[1].season) : Promise.resolve(null)),
    [tab, compareSlots[1].season],
  );
  const compareOpponentRecords = [
    useMemo(() => (compareSummaries0 ? buildRecordsBeforeGame(compareSummaries0) : undefined), [compareSummaries0]),
    useMemo(() => (compareSummaries1 ? buildRecordsBeforeGame(compareSummaries1) : undefined), [compareSummaries1]),
  ];

  // トラディショナル/アドバンスド/Misc/スコアリングの全列（PTSOFFTO・DUNK・被アシスト内訳・
  // ライブ/デッドTOV・ペイント内外分割等）を出すには、シーズン集計済みのTeamGameLogだけでは
  // 足りず生データ（StoredGame）・Yahoo PBPが必要（「日程結果」タブ・DESIGN.md 64章と同じ理由）。
  // スロットが選んだシーズン単位でまとめて取得し（situational filterでの絞り込みは
  // クライアント側で行うため、フィルタを変えるたびの再取得は発生しない）、scheduleKeyで
  // 一意なので両スロットのキャッシュを共有する
  const compareRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [compareRawGames, setCompareRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [compareRawGamesLoading, setCompareRawGamesLoading] = useState(false);
  const compareYahooPbpRequestedRef = useRef<Set<string>>(new Set());
  const [compareYahooPbp, setCompareYahooPbp] = useState<Map<string, YahooGamePbp>>(new Map());
  const [compareYahooPbpLoading, setCompareYahooPbpLoading] = useState(false);

  useEffect(() => {
    compareRawGamesRequestedRef.current = new Set();
    setCompareRawGames(new Map());
    compareYahooPbpRequestedRef.current = new Set();
    setCompareYahooPbp(new Map());
  }, [teamId]);

  useEffect(() => {
    if (tab !== "compare" || !careerData) return;
    const pairs: { season: string; scheduleKey: string }[] = [];
    for (const slot of compareSlots) {
      if (!slot.season || slot.league) continue;
      const logs = careerData.find((cd) => cd.season === slot.season)?.logs ?? [];
      for (const g of logs) {
        if (g.min > 0 && !compareRawGamesRequestedRef.current.has(g.scheduleKey)) {
          pairs.push({ season: slot.season, scheduleKey: g.scheduleKey });
        }
      }
    }
    const needed = [...new Map(pairs.map((p) => [p.scheduleKey, p])).values()];
    if (needed.length === 0) return;
    for (const p of needed) compareRawGamesRequestedRef.current.add(p.scheduleKey);
    setCompareRawGamesLoading(true);
    Promise.all(
      needed.map(async ({ season: s, scheduleKey }) => {
        try {
          return [scheduleKey, await fetchGame(s, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setCompareRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setCompareRawGamesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, careerData, compareSlots[0].season, compareSlots[1].season]);

  useEffect(() => {
    if (tab !== "compare" || !careerData || !seasons) return;
    const pairs: { season: string; scheduleKey: string }[] = [];
    for (const slot of compareSlots) {
      if (!slot.season || slot.league) continue;
      if (!(seasons.find((s) => s.season === slot.season)?.yahooPbp ?? false)) continue;
      const logs = careerData.find((cd) => cd.season === slot.season)?.logs ?? [];
      for (const g of logs) {
        if (g.min > 0 && !compareYahooPbpRequestedRef.current.has(g.scheduleKey)) {
          pairs.push({ season: slot.season, scheduleKey: g.scheduleKey });
        }
      }
    }
    const needed = [...new Map(pairs.map((p) => [p.scheduleKey, p])).values()];
    if (needed.length === 0) return;
    for (const p of needed) compareYahooPbpRequestedRef.current.add(p.scheduleKey);
    setCompareYahooPbpLoading(true);
    Promise.all(
      needed.map(async ({ season: s, scheduleKey }) => {
        try {
          return [scheduleKey, await fetchYahooGamePbp(s, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setCompareYahooPbp((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r && r[1]) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setCompareYahooPbpLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, careerData, seasons, compareSlots[0].season, compareSlots[1].season]);

  const compareDataLoading = compareRawGamesLoading || compareYahooPbpLoading;

  // 「リーグ平均」を選んだ枠のデータ（data/{season}/league-compare.json）。枠は2つで固定なので2つ呼ぶ
  const compareLeague0 = useJsonData(
    () => (tab === "compare" && compareSlots[0].league && compareSlots[0].season ? fetchLeagueCompare(compareSlots[0].season) : Promise.resolve(null)),
    [tab, compareSlots[0].league, compareSlots[0].season],
  );
  const compareLeague1 = useJsonData(
    () => (tab === "compare" && compareSlots[1].league && compareSlots[1].season ? fetchLeagueCompare(compareSlots[1].season) : Promise.resolve(null)),
    [tab, compareSlots[1].league, compareSlots[1].season],
  );
  const compareLeagueFiles = [compareLeague0.data, compareLeague1.data] as const;

  const compareRows: ComparisonRow<TeamCompareColumnData>[] = useMemo(() => {
    return ([0, 1] as const)
      .map((i): ComparisonRow<TeamCompareColumnData> | null => {
        const slot = compareSlots[i];
        if (slot.league) {
          const file = compareLeagueFiles[i];
          const totals = file && file.season === slot.season ? file.totals[compareGameType] : null;
          if (!slot.season || !file || !totals) return null;
          return {
            item: { key: `slot${i}`, label: LEAGUE_TEAM_NAME, boxTotals: totals, gamesCount: file.games[compareGameType], isLeague: true },
            season: slot.season,
          };
        }
        if (!slot.season || !careerData) return null;
        const logs = careerData.find((cd) => cd.season === slot.season)?.logs;
        if (!logs) return null;
        const gameTypeScoped = filterByGameType(logs, compareGameType);
        const filtered = filterGameLogs(
          gameTypeScoped,
          { ...slot.filter, includePlayoffs: true },
          compareOpponentRecords[i],
          divisionHistory,
          slot.season,
          () => teamId,
        );
        const entries = filtered
          .map((g) => {
            const game = compareRawGames.get(g.scheduleKey);
            return game ? { game, isHome: g.isHome } : null;
          })
          .filter((e): e is { game: StoredGame; isHome: boolean } => e !== null);
        if (entries.length === 0) return null;
        const shotChartSupported = seasons?.find((s) => s.season === slot.season)?.coverage === "full";
        const yahooPbpSupported = seasons?.find((s) => s.season === slot.season)?.yahooPbp ?? false;
        const yahooTurnoversByScheduleKey = new Map(
          entries.map(({ game }) => [game.scheduleKey, compareYahooPbp.get(game.scheduleKey)?.turnovers ?? []]),
        );
        const boxTotals = buildTeamMultiGameBoxTotals(entries, yahooTurnoversByScheduleKey, shotChartSupported, yahooPbpSupported);
        if (!boxTotals) return null;
        return {
          item: { key: `slot${i}`, label: describeTeamSituationalFilter(slot.filter), boxTotals, gamesCount: entries.length },
          season: slot.season,
        };
      })
      .filter((r): r is ComparisonRow<TeamCompareColumnData> => r !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareSlots, careerData, compareGameType, compareOpponentRecords, compareRawGames, compareYahooPbp, seasons, teamId, divisionHistory, compareLeague0.data, compareLeague1.data]);

  // 「チームスタッツ」タブの「シチュエーション別成績」（チーム版）専用の自チーム/opp/+/-トグル・Q別/前後半トグル。
  // 「ショットチャート」のQ別/前後半（teamShotChartPeriod）とは独立して持つ（旧・概要タブの選択シーズン集計表と
  // 共有していた絞り込みは、集計表を削除した際にそれぞれ専用の状態へ分けた。DESIGN.md 118章）。
  // 「試合」選択時は追加取得不要だが、Q別/前後半選択時のみ生データを遅延取得する
  const [situationalTeamPerspective, setSituationalTeamPerspective] = usePageState<TeamPerspective>(pk("situationalTeamPerspective"), "own");
  const [situationalTeamPeriod, setSituationalTeamPeriod] = usePageState<PeriodRangeValue>(pk("situationalTeamPeriod"), "all");
  const situationalTeamPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === situationalTeamPeriod);
  // 「ショットチャート」専用のQ別/前後半
  const [teamShotChartPeriod, setTeamShotChartPeriod] = usePageState<PeriodRangeValue>(pk("teamShotChartPeriod"), "all");
  const teamShotChartPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === teamShotChartPeriod);
  const [situationalTeamBoxTab, setSituationalTeamBoxTab] = usePageState<BoxscoreTabKey | "shooting">(pk("situationalTeamBoxTab"), "traditional");
  // 「選手スタッツ」タブのカテゴリタブ（シューティングを含む）。シューティングタブ選択時のみ
  // teamYahooPbpの遅延取得をトリガーする必要があるため、親（このコンポーネント）で状態を持つ
  // （BoxscoreTable.tsxのactiveTab/onTabChangeと同じパターン。DESIGN.md参照）
  const [playerStatsBoxTab, setPlayerStatsBoxTab] = usePageState<SeasonBoxTabKey | "shooting">(pk("playerStatsBoxTab"), "traditional");
  // 「ショットチャート」専用のレギュラー/プレーオフ/合算トグル（Phase H4②）。FilterBarの
  // 試合種別は専用のteamShotChartGameTypeで持ち、詳細フィルタには常にincludePlayoffs: trueを渡した上で
  // filterByGameTypeで絞り込む（個人・チーム双方の「比較」タブと同じ設計）
  const [teamShotChartGameType, setTeamShotChartGameType] = usePageState<SeasonGameTypeFilter>(pk("teamShotChartGameType"), "regular");
  const statsRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [statsRawGames, setStatsRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [statsRawGamesLoading, setStatsRawGamesLoading] = useState(false);
  // 「チーム内リーダー」（概要タブ、Phase H3②）専用のチーム全体/日本人選手限定トグル
  const [teamLeadersJpOnly, setTeamLeadersJpOnly] = usePageState(pk("teamLeadersJpOnly"), false);
  // 「チーム内リーダー」の掲載基準（出場率）。ランキングページの掲載基準スライダーと同じ部品・同じ既定値（85%）。
  // 3P%等の追加基準（試投/成功数）は項目ごとの既定値のまま（スライダーは出場率のみ）
  const [teamLeadersGamesRatio, setTeamLeadersGamesRatio] = usePageState(pk("teamLeadersGamesRatio"), MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
  // 「シチュエーション別成績」（チーム版）専用のレギュラー/プレーオフ/合算トグル。
  // ショットチャートのteamShotChartGameTypeとは独立（個人詳細ページの同名セクションと同じ設計）
  const [situationalTeamGameType, setSituationalTeamGameType] = usePageState<SeasonGameTypeFilter>(pk("situationalTeamGameType"), "regular");
  // 「シチュエーション別勝敗」（概要タブ、Phase H3③）専用のレギュラー/プレーオフ/合算トグル。
  // 他のシチュエーション別セクションと同じく独立した状態を持つ
  const [situationalRecordGameType, setSituationalRecordGameType] = usePageState<SeasonGameTypeFilter>(pk("situationalRecordGameType"), "regular");

  // 「シーズン別成績」（概要タブ）の平均/合計トグル。個人詳細ページのSeasonBreakdownTableと
  // 同じ仕組み（TeamSeasonBoxColumn.formatにmodeを渡す）を再利用する
  const [seasonBoxDisplayMode, setSeasonBoxDisplayMode] = usePageState<SeasonDisplayMode>(pk("seasonBoxDisplayMode"), "perGame");
  // 「シーズン別成績」の自チーム/opp/+/-トグル（Phase H8-2）。「チームスタッツ」「日程結果」
  // タブと同じTeamPerspective型・同じ3値切り替えの仕組みを再利用する
  const [seasonBoxPerspective, setSeasonBoxPerspective] = usePageState<TeamPerspective>(pk("seasonBoxPerspective"), "own");
  // 「シチュエーション別成績」（チーム版）の平均/合計トグル
  const [situationalTeamDisplayMode, setSituationalTeamDisplayMode] = usePageState<SeasonDisplayMode>(pk("situationalTeamDisplayMode"), "perGame");
  // 「シューティング」セクション用: Q別/前後半選択時・非デフォルトフィルタ選択時のみ、
  // このチームの全試合のYahoo PBPを遅延取得する（既定の「試合」×フィルタ無しはteams.jsonの
  // shotTypesを0コストで使うため取得不要。DESIGN.md参照）
  const { supported: yahooPbpSupported } = useYahooPbpCoverage(season);
  const teamYahooPbpRequestedRef = useRef<Set<string>>(new Set());
  const [teamYahooPbp, setTeamYahooPbp] = useState<Map<string, YahooGamePbp>>(new Map());
  const [teamYahooPbpLoading, setTeamYahooPbpLoading] = useState(false);

  // 「ショットチャート」セクション: 個人詳細ページの季集計ショットチャートと同じく、
  // 開いたときだけ生データ（PlayByPlays込み）を遅延取得する。取得自体はstatsRawGames
  // （Q別/前後半トグルと共有するキャッシュ）を再利用する
  const [teamShotChartExpanded, setTeamShotChartExpanded] = usePageState(pk("teamShotChartExpanded"), false);
  // 「よく使われるラインナップ」「アシストペア分析」の上位◯件表示/全パターン表示トグル（Batch 1・2）
  const [lineupsExpanded, setLineupsExpanded] = usePageState(pk("lineupsExpanded"), false);
  const [assistPairsExpanded, setAssistPairsExpanded] = usePageState(pk("assistPairsExpanded"), false);
  // 「シチュエーション別勝敗」（概要タブ）の延長・Q1/前半/3Q終了時点のリード状況は
  // quarterScores（試合の生データ）が必要なため、ショットチャートと同じ折りたたみ式にし、
  // 展開したときだけstatsRawGamesを取得する（DESIGN.md参照。初回表示時の通信を抑える）
  const [situationalRecordRawExpanded, setSituationalRecordRawExpanded] = usePageState(pk("situationalRecordRawExpanded"), false);
  // 「シチュエーション別勝敗」（概要タブ）「シチュエーション別成績」（チームスタッツタブ）の
  // 各グループの説明文。個人詳細ページの同名セクションと同じ「デフォルト非表示・▶説明ボタンで
  // 開閉」の仕組みをそのまま踏襲する
  const [situationalRecordLegendExpanded, setSituationalRecordLegendExpanded] = usePageState(pk("situationalRecordLegendExpanded"), false);
  const [situationalTeamLegendExpanded, setSituationalTeamLegendExpanded] = usePageState(pk("situationalTeamLegendExpanded"), false);

  // 「日程結果」タブ: 自チーム/opp/+/-トグル・レギュラー/プレーオフ/合算トグル・Q別/前後半トグル・
  // トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブ（試合詳細ページのボックススコアと
  // 全く同じCOLUMNS_BY_TAB/ColumnCtxをbuildTeamGameBoxTotals経由で再利用する。DESIGN.md参照）。
  // 「選手スタッツ」タブ（60章）と同様、このタブ専用の独立したトグル状態を持つ（「チームスタッツ」
  // タブのfilter/statsPeriodとは連動しない）。ゲーム種別トグルの既定は「合算」にし、既存の日程結果タブの
  // 見た目（予定を含む全試合表示）を変えないようにしている点が他のトグルと異なる。
  // Misc/スコアリングタブのPBPタグ集計・座標ゾーン分割はQ別/前後半に関わらず生データが必要なため、
  // このタブが開いている間は常にstatsRawGames/teamYahooPbpを取得する（0コストの高速経路は無い）
  const [scheduleTeamPerspective, setScheduleTeamPerspective] = usePageState<TeamPerspective>(pk("scheduleTeamPerspective"), "own");
  const [scheduleGameType, setScheduleGameType] = usePageState<SeasonGameTypeFilter>(pk("scheduleGameType"), "both");
  const [schedulePeriod, setSchedulePeriod] = usePageState<PeriodRangeValue>(pk("schedulePeriod"), "all");
  const schedulePeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === schedulePeriod);
  const [scheduleBoxTab, setScheduleBoxTab] = usePageState<BoxscoreTabKey>(pk("scheduleBoxTab"), "traditional");

  useEffect(() => {
    statsRawGamesRequestedRef.current = new Set();
    setStatsRawGames(new Map());
    teamYahooPbpRequestedRef.current = new Set();
    setTeamYahooPbp(new Map());
    setTeamShotChartExpanded(false);
    setSituationalRecordRawExpanded(false);
  }, [teamId, season]);

  useEffect(() => {
    // 「概要」タブの「シチュエーション別勝敗」のうち延長・Q1/前半/3Q終了時点のリード状況は
    // quarterScores（試合の生データ）が無いと判定できないため、他タブと同じstatsRawGamesを
    // このタブでも取得する。ショットチャートと同じ折りたたみ式にしてあり、展開したときだけ
    // 取得する（DESIGN.md参照。初回表示時に自動で通信が走らないようにする判断）
    // 「選手スタッツ」タブの「アシストペア分析」（Batch 1）は選手個人ではなくチーム全体の
    // PlayByPlaysを必要とするため、日程結果/チームスタッツと同じstatsRawGamesをこのタブでも
    // 常時取得する（64-1章で確立済みの「Misc系の正確性を優先し0コスト経路は設けない」方針を踏襲）
    const needsRawGames =
      teamShotChartExpanded ||
      tab === "schedule" ||
      tab === "teamStats" ||
      tab === "playerStats" ||
      (tab === "overview" && situationalRecordRawExpanded);
    if ((tab !== "teamStats" && tab !== "schedule" && tab !== "overview" && tab !== "playerStats") || !needsRawGames || !gameLogs) return;
    const needed = [
      ...new Set(
        gameLogs.filter((g) => g.min > 0 && !statsRawGamesRequestedRef.current.has(g.scheduleKey)).map((g) => g.scheduleKey),
      ),
    ];
    if (needed.length === 0) return;
    for (const k of needed) statsRawGamesRequestedRef.current.add(k);
    setStatsRawGamesLoading(true);
    Promise.all(
      needed.map(async (scheduleKey) => {
        try {
          return [scheduleKey, await fetchGame(season, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setStatsRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setStatsRawGamesLoading(false));
  }, [tab, gameLogs, season, teamShotChartExpanded, situationalRecordRawExpanded]);

  useEffect(() => {
    // 「チームスタッツ」タブ（シチュエーション別成績）はMiscタブの
    // LIVETOV/DEADTOV等でYahoo PBPが常に必要なため、「日程結果」タブと同じく無条件で取得する
    // （0コストの高速経路は無い。DESIGN.md参照）。「選手スタッツ」タブはシューティングタブを
    // 選んだ時だけ遅延取得する（既存のロースター候補取得と同じ「必要になってから取る」方針）
    const playerStatsNeedsShots = tab === "playerStats" && playerStatsBoxTab === "shooting";
    if ((tab !== "teamStats" && tab !== "schedule" && !playerStatsNeedsShots) || !yahooPbpSupported || !gameLogs) return;
    const needed = [
      ...new Set(
        gameLogs.filter((g) => g.min > 0 && !teamYahooPbpRequestedRef.current.has(g.scheduleKey)).map((g) => g.scheduleKey),
      ),
    ];
    if (needed.length === 0) return;
    for (const k of needed) teamYahooPbpRequestedRef.current.add(k);
    setTeamYahooPbpLoading(true);
    Promise.all(
      needed.map(async (scheduleKey) => {
        try {
          return [scheduleKey, await fetchYahooGamePbp(season, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setTeamYahooPbp((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r && r[1]) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setTeamYahooPbpLoading(false));
  }, [tab, playerStatsBoxTab, yahooPbpSupported, gameLogs, season]);

  // careerLoading/careerDataをdeps配列に含めると自己キャンセルのループになるため
  // （PlayerDetailPageと同じ理由）、fetch開始済みかどうかはrefで管理する
  const seasonHistoryFetchStartedRef = useRef(false);
  const [seasonHistory, setSeasonHistory] = useState<SeasonRecord[] | null>(null);
  const [seasonHistoryLoading, setSeasonHistoryLoading] = useState(false);

  useEffect(() => {
    seasonHistoryFetchStartedRef.current = false;
    setSeasonHistory(null);
  }, [teamId]);

  useEffect(() => {
    if (tab !== "teamStats" || !teamId || !seasons || seasonHistoryFetchStartedRef.current) return;
    seasonHistoryFetchStartedRef.current = true;
    setSeasonHistoryLoading(true);
    Promise.all(
      seasons.map(async (s) => {
        try {
          const teamsOfSeason = await fetchTeams(s.season);
          const found = teamsOfSeason.find((t) => t.teamId === teamId);
          return found ? { season: s.season, teamName: found.teamName, team: found } : null;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setSeasonHistory(results.filter((r): r is SeasonRecord => r !== null));
      })
      .finally(() => {
        setSeasonHistoryLoading(false);
      });
  }, [tab, teamId, seasons]);

  // 「選手スタッツ」タブ: そのシーズン、このチームで一度でもプレーした選手の一覧
  // （シーズン内移籍選手も含む）。lineupsFile（在コート復元済みのラインナップ、既に
  // このページで取得済み）に登場する全playerIdの和集合をロースター候補として使う
  // （プレー時間ゼロなら在コート区間自体に一切登場しないため、「一度でもプレーした」の
  // 判定として使える。DESIGN.md参照）。候補ごとに個人の試合ログ・所属チーム解決結果だけを
  // 先に取得しておき（レギュラー/プレーオフ/合算トグル・Q別/前後半トグルの切り替えで
  // 再フェッチしなくて済むように）、最終的な表示行は下のuseMemoで組み立てる
  const playerStatsCandidatesFetchKeyRef = useRef<string | null>(null);
  const [playerStatsCandidates, setPlayerStatsCandidates] = useState<PlayerStatsCandidate[] | null>(null);
  const [playerStatsCandidatesLoading, setPlayerStatsCandidatesLoading] = useState(false);
  const [playerStatsGameType, setPlayerStatsGameType] = usePageState<SeasonGameTypeFilter>(pk("playerStatsGameType"), "regular");
  // 「選手スタッツ」タブの平均/合計トグル。ctx.scaledがbuildTeamSplitRowsForPeriod呼び出し時の
  // modeで確定するため、render時にcol.format(ctx, mode)へ渡すだけでは反映されない
  // （SeasonBoxscoreCtx.scaledは構築時に1回だけ計算される）。playerStatsRowsのuseMemo側で
  // このstateを使ってctxを再構築する必要があるため、TeamPlayerStatsTable内のローカルstateでは
  // なく親コンポーネントで持つ
  const [playerStatsDisplayMode, setPlayerStatsDisplayMode] = usePageState<SeasonDisplayMode>(pk("playerStatsDisplayMode"), "perGame");
  // Q別/前後半トグル（既存のbuildPeriodRangeOptionsをOT無しで固定した共通オプション）。
  // 「試合」選択時は追加取得不要（既存のTeamGameLog/PlayerGameLog永続集計をそのまま使う）だが、
  // Q別/前後半選択時のみ、必要な試合の生データ（PlayByPlays込み）を遅延取得する
  const [playerStatsPeriod, setPlayerStatsPeriod] = usePageState<PeriodRangeValue>(pk("playerStatsPeriod"), "all");
  // シチュエーション別フィルタ（シーズン全体/直近N試合/勝敗別/期間指定/ホーム・アウェイ/
  // 対東西地区/月別/年明け前後/平日開催/対勝率別）。FilterBar（situationalAxes）で
  // 絞り込み、、選手一覧の全選手に一括で適用する（個別選手ごとの選択ではない）。レギュラー/
  // プレーオフ/合算は既存のplayerStatsGameType（3値トグル）に一本化するため、
  // filterGameLogsへは常にincludePlayoffs: trueを渡す（比較タブ・43章と同じパターン）
  const [playerStatsFilter, setPlayerStatsFilter] = usePageState<SituationalFilter>(pk("playerStatsFilter"), { range: { kind: "all" } });
  const playerStatsRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [playerStatsRawGames, setPlayerStatsRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [playerStatsRawGamesLoading, setPlayerStatsRawGamesLoading] = useState(false);
  const playerStatsPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === playerStatsPeriod);

  // 切り替え直後、新しいデータの取得完了を待つ間に前のシーズン・チームの候補を出し続けないよう破棄する。
  // fetchKeyも消しておく（消さないと、別タブにいる間に A→B→A と戻った場合に「取得済み」と
  // 誤判定して候補がnullのまま残る）。取得中だった前の結果は下の.thenでキー照合して捨てる
  useEffect(() => {
    playerStatsCandidatesFetchKeyRef.current = null;
    setPlayerStatsCandidates(null);
  }, [season, teamId]);

  useEffect(() => {
    if (tab !== "playerStats" || !teamId || !pbpSupported || !lineupsFile || !summaries) return;
    // season/teamIdの切り替え直後は、lineupsFile・summariesがまだ前のシーズン・チームのままの間に
    // この副作用が走る。その状態で候補選手を確定するとfetchKeyが新しい値で固定され、新しいデータが
    // 届いても再取得されず「選手スタッツがありません」のままになるため、両方が現在の
    // season/teamIdのものに揃うまで待つ（DESIGN.md 103章）
    if (lineupsFile.season !== season || lineupsFile.teamId !== teamId || summariesSeason !== season) return;
    const fetchKey = `${season}|${teamId}`;
    if (playerStatsCandidatesFetchKeyRef.current === fetchKey) return;
    playerStatsCandidatesFetchKeyRef.current = fetchKey;
    setPlayerStatsCandidatesLoading(true);
    setPlayerStatsCandidates(null);
    setPlayerStatsRawGames(new Map());
    playerStatsRawGamesRequestedRef.current = new Set();
    const candidateIds = [...new Set(lineupsFile.lineups.flatMap((l) => l.playerIds))];
    const gameTeams = buildGameTeamsByScheduleKey(summaries);
    Promise.all(
      candidateIds.map(async (playerId): Promise<PlayerStatsCandidate | null> => {
        try {
          const logs = await fetchPlayerGameLogs(season, playerId);
          const ownTeamByScheduleKey = new Map<string, GameTeamInfo>();
          for (const log of logs) {
            if (log.min <= 0) continue;
            const own = resolveOwnTeam(log, gameTeams);
            if (own) ownTeamByScheduleKey.set(log.scheduleKey, own);
          }
          const playsForThisTeam = [...ownTeamByScheduleKey.values()].some((t) => t.teamId === teamId);
          if (!playsForThisTeam) return null;
          return { playerId, logs, ownTeamByScheduleKey };
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        if (playerStatsCandidatesFetchKeyRef.current !== fetchKey) return;
        setPlayerStatsCandidates(results.filter((r): r is PlayerStatsCandidate => r !== null));
      })
      .finally(() => {
        if (playerStatsCandidatesFetchKeyRef.current === fetchKey) setPlayerStatsCandidatesLoading(false);
      });
  }, [tab, teamId, season, pbpSupported, lineupsFile, summaries, summariesSeason]);

  // Q別/前後半選択時のみ、このチームに関係する試合（候補選手の誰かがこのチーム所属として
  // 出場した試合）の生データを遅延取得する。同じチームの選手はほぼ同じ試合群を共有するため、
  // scheduleKey単位で重複排除すれば選手数に関わらずチームの試合数分（〜60試合程度）で済む
  useEffect(() => {
    if (!playerStatsPeriodOption || playerStatsPeriodOption.periods === null || !playerStatsCandidates || !teamId) return;
    const neededKeys = new Set<string>();
    for (const c of playerStatsCandidates) {
      for (const [scheduleKey, own] of c.ownTeamByScheduleKey) {
        if (own.teamId === teamId && !playerStatsRawGamesRequestedRef.current.has(scheduleKey)) neededKeys.add(scheduleKey);
      }
    }
    if (neededKeys.size === 0) return;
    for (const k of neededKeys) playerStatsRawGamesRequestedRef.current.add(k);
    setPlayerStatsRawGamesLoading(true);
    Promise.all(
      [...neededKeys].map(async (scheduleKey) => {
        try {
          return [scheduleKey, await fetchGame(season, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setPlayerStatsRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setPlayerStatsRawGamesLoading(false));
  }, [playerStatsPeriodOption, playerStatsCandidates, teamId, season]);

  const playerStatsRows = useMemo((): TeamPlayerStatsRow[] | null => {
    if (!playerStatsCandidates || !players || !gameLogs || !teamId) return null;
    const seasonStartYear = Number(season.split("-")[0]);
    const playerById = new Map(players.map((p) => [p.playerId, p]));
    const rows: TeamPlayerStatsRow[] = [];
    for (const c of playerStatsCandidates) {
      const gameTypeFilteredLogs = filterByGameType(c.logs, playerStatsGameType);
      const situationalFilteredLogs = filterGameLogs(
        gameTypeFilteredLogs,
        { ...playerStatsFilter, includePlayoffs: true },
        opponentRecords,
        divisionHistory,
        season,
        (g) => c.ownTeamByScheduleKey.get(g.scheduleKey)?.teamId,
      );
      const scheduleKeys = new Set(
        situationalFilteredLogs
          .filter((g) => g.min > 0 && c.ownTeamByScheduleKey.get(g.scheduleKey)?.teamId === teamId)
          .map((g) => g.scheduleKey),
      );
      if (scheduleKeys.size === 0) continue;
      const teamTotals = sumTeamGameLogsFor(gameLogs, scheduleKeys);
      const splitRows = buildTeamSplitRowsForPeriod(
        c.playerId,
        situationalFilteredLogs,
        c.ownTeamByScheduleKey,
        new Map([[teamId, teamTotals]]),
        playerStatsDisplayMode,
        seasonStartYear,
        c.playerId,
        playerStatsPeriodOption,
        playerStatsRawGames,
      );
      const row = splitRows.find((r) => r.teamId === teamId);
      const player = playerById.get(c.playerId);
      if (!row || !player) continue;
      rows.push({ player, ctx: row.ctx, ddtd: countDoubleTripleDoubles(row.logs), logs: row.logs });
    }
    return rows;
  }, [
    playerStatsCandidates,
    players,
    gameLogs,
    teamId,
    season,
    playerStatsGameType,
    playerStatsFilter,
    opponentRecords,
    divisionHistory,
    playerStatsDisplayMode,
    playerStatsPeriodOption,
    playerStatsRawGames,
  ]);

  // 「スタメン平均」見出しに追記する、当該シーズン（レギュラーシーズンのみ、avgHeightCm等と
  // 同じ基準）で実際に起用されたスタメン5人の組み合わせ種類数。playerStatsCandidates
  // （「選手スタッツ」タブ用に既に取得済みのPlayerGameLog、isStarterを持つ）から
  // scheduleKeyごとのスタメン集合を組み立て、正規化キーの種類数を数える
  const startingLineupComboCount = useMemo(() => {
    if (!playerStatsCandidates || !teamId) return null;
    const startersByGame = new Map<string, Set<string>>();
    for (const c of playerStatsCandidates) {
      for (const log of c.logs) {
        if (!log.isStarter || log.gameType !== "regular") continue;
        if (c.ownTeamByScheduleKey.get(log.scheduleKey)?.teamId !== teamId) continue;
        if (!startersByGame.has(log.scheduleKey)) startersByGame.set(log.scheduleKey, new Set());
        startersByGame.get(log.scheduleKey)!.add(c.playerId);
      }
    }
    const combos = new Set([...startersByGame.values()].map((ids) => [...ids].sort().join(",")));
    return combos.size;
  }, [playerStatsCandidates, teamId]);

  // アシストペア分析（チーム版、Batch 1）: レギュラーシーズンの取得済み生データ（statsRawGames）
  // からPlayByPlaysを集め、buildAssistPairs()（18章）をチーム全試合分合算する。
  // buildAssistPairsは試合全体（両チーム分）のペアを返すため、g.isHomeから該当試合の
  // 自チーム側Boxscore（HomeBoxscores/AwayBoxscores）を特定し、assisterId・scorerIdが
  // 両方ともそのPlayerID集合に含まれるペアだけを採用する（相手チーム内のアシスト連鎖が
  // 混入しないようにするための修正。アシストは常にチームメイト間で成立するため、
  // 片方だけがこのチームというケースは無い）
  const teamAssistPairs = useMemo((): AssistPair[] => {
    if (!teamId || !gameLogs) return [];
    const merged = new Map<string, AssistPair>();
    for (const g of gameLogs) {
      if (g.gameType !== "regular") continue;
      const game = statsRawGames.get(g.scheduleKey);
      if (!game) continue;
      const ownBoxscores = g.isHome ? game.raw.HomeBoxscores : game.raw.AwayBoxscores;
      const ownPlayerIds = new Set(ownBoxscores.map((r) => r.PlayerID));
      for (const pair of buildAssistPairs(game.raw.PlayByPlays, undefined)) {
        if (!ownPlayerIds.has(pair.assisterId) || !ownPlayerIds.has(pair.scorerId)) continue;
        const existing = merged.get(`${pair.assisterId}:${pair.scorerId}`);
        if (existing) {
          existing.count += pair.count;
          existing.assisted2m += pair.assisted2m;
          existing.assisted3m += pair.assisted3m;
          existing.assistedFtm += pair.assistedFtm;
        } else {
          merged.set(`${pair.assisterId}:${pair.scorerId}`, { ...pair });
        }
      }
    }
    return [...merged.values()].sort((a, b) => b.count - a.count);
  }, [teamId, gameLogs, statsRawGames]);

  // 得点選手（scorerId）ごとの全アシスト被数・被得点（Batch 1）。teamAssistPairs自体を
  // scorerId単位で合算するだけで求まる（アシストは常にチームメイト間で成立するため、
  // teamAssistPairsに含まれる特定scorerIdの行を全て合算すれば、そのscorerIdの選手が
  // 受けた全アシストの合計になる）
  const teamAssistScorerTotals = useMemo(() => {
    const totals = new Map<string, { count: number; points: number }>();
    for (const p of teamAssistPairs) {
      const points = p.assisted2m * 2 + p.assisted3m * 3 + p.assistedFtm;
      const entry = totals.get(p.scorerId) ?? { count: 0, points: 0 };
      entry.count += p.count;
      entry.points += points;
      totals.set(p.scorerId, entry);
    }
    return totals;
  }, [teamAssistPairs]);

  if (teamsLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;

  const team = teams?.find((t) => t.teamId === teamId);
  if (!team) return <p className="error-message">チームが見つかりませんでした</p>;

  const accentColor = teamColors?.[team.teamId]?.primary;
  const teamPlayers = (players ?? []).filter((p) => p.teamId === teamId);
  const teamLeadersPool = teamLeadersJpOnly ? teamPlayers.filter((p) => p.classification === "日本人") : teamPlayers;

  // 「スタメン選手」は現状このアプリに現在の先発5人という概念が無いため、シーズン中に
  // 1度でも先発出場した選手（gamesStarted > 0）を近似として使う
  const starters = teamPlayers.filter((p) => p.gamesStarted > 0);
  const avgHeightCm = averageOf(starters.flatMap((p) => (p.heightCm != null ? [p.heightCm] : [])));
  const avgWeightKg = averageOf(starters.flatMap((p) => (p.weightKg != null ? [p.weightKg] : [])));
  const avgAge = averageOf(starters.flatMap((p) => (p.birthDate ? [ageForSeason(p.birthDate, season)] : [])));

  // Phase H4②: 「ショットチャート」のレギュラー/プレーオフ/合算は専用のteamShotChartGameTypeで管理する。
  // 詳細フィルタには常にincludePlayoffs: trueを渡して「地区/月別等の絞り込みだけ適用した全試合」を得た上で、
  // filterByGameTypeで最終的なレギュラー/プレーオフ/合算の絞り込みを行う（個人・チーム双方の「比較」タブと同じ設計）
  const filteredLogs = gameLogs
    ? filterByGameType(
        filterGameLogs(gameLogs, { ...teamShotChartFilter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => teamId),
        teamShotChartGameType,
      )
    : [];
  const teamStatsShotChartSupported = isShotChartSupported(coverage);
  const yahooTurnoversByScheduleKey = new Map([...teamYahooPbp].map(([k, v]) => [k, v.turnovers] as const));

  // 「ショットチャート」セクション: 全選手のショットをteamId一致で合算する（個人詳細ページの
  // シーズン集計ショットチャートと同じ生データ・同じbuildShotEvents()を再利用し、選手個別の
  // フィルタを外しただけ）。ショットチャート専用の絞り込み（試合種別・Q別/前後半・詳細フィルタ）に連動する
  const teamShotEvents: ShotEvent[] = teamShotChartExpanded
    ? filteredLogs
        .filter((g) => g.min > 0)
        .flatMap((g) => {
          const game = statsRawGames.get(g.scheduleKey);
          if (!game) return [];
          return buildShotEvents(game.raw.PlayByPlays)
            .filter((s) => s.teamId === team.teamId)
            .filter((s) => periodInRange(teamShotChartPeriodOption, s.period));
        })
    : [];
  const teamShotChartPlayerOptions = teamPlayers.map((p) => ({ PlayerID: p.playerId, PlayerNameJ: p.name }));

  // 「シチュエーション別勝敗」（概要タブ、Phase H3③）。延長・Q1/前半/3Q終了時点の区分は
  // 試合の生データ（quarterScores）が必要なため、ショットチャートと同じ折りたたみ式にし、
  // 展開したときだけstatsRawGamesを取得する（DESIGN.md参照）。それ以外の区分（会場・地区・
  // 月別等）はgameLogsだけで完結するため常に表示する
  const situationalRecordScopedLogs = gameLogs ? filterByGameType(gameLogs, situationalRecordGameType) : [];
  const situationalRecordBackToBack = summaries ? buildBackToBackStatus(summaries) : undefined;
  const situationalRecordGroupDefs = teamId
    ? buildSituationalRecordGroups(
        situationalRecordScopedLogs,
        teamId,
        situationalRecordBackToBack,
        opponentRecords,
        divisionHistory,
        season,
      )
    : [];
  const situationalRecordRawGamesReady =
    situationalRecordScopedLogs.length > 0 && situationalRecordScopedLogs.every((g) => statsRawGames.has(g.scheduleKey));
  const situationalRecordAllGroups = situationalRecordGroupDefs
    .map((group) => {
      const pool = group.needsRawGame
        ? situationalRecordScopedLogs.filter((g) => statsRawGames.has(g.scheduleKey))
        : situationalRecordScopedLogs;
      const rows: SituationalRecordStats[] = group.rows.flatMap((row) => {
        const matched = pool.filter((g) => row.predicate(g, statsRawGames.get(g.scheduleKey)));
        if (matched.length === 0) return [];
        const wins = matched.filter((g) => g.win).length;
        return [
          {
            key: row.key,
            label: row.label,
            games: matched.length,
            wins,
            losses: matched.length - wins,
            winPct: safeDiv(wins, matched.length),
          },
        ];
      });
      return { key: group.key, label: group.label, needsRawGame: group.needsRawGame, rows };
    })
    .filter((group) => group.rows.length > 0);
  const situationalRecordGroups = situationalRecordAllGroups.filter((g) => !g.needsRawGame);
  const situationalRecordRawGroups = situationalRecordAllGroups.filter((g) => g.needsRawGame);

  // 「シチュエーション別成績」（チーム版）: 会場・地区・曜日・時期・月別・対戦相手の強さ・連戦・
  // 外国籍人数の8グループ。チームのTeamGameLogは既にそのチーム自身の試合ログのため、
  // 個人詳細ページのようなシーズン内移籍の動的チーム解決（resolveOwnTeam等）は不要
  const situationalTeamScopedLogs = gameLogs ? filterByGameType(gameLogs, situationalTeamGameType) : [];
  const situationalTeamBackToBack = summaries ? buildBackToBackStatus(summaries) : undefined;
  const situationalTeamMonthsWithData = new Set(
    situationalTeamScopedLogs.filter((g) => g.min > 0).map((g) => Number(g.date.slice(5, 7))),
  );
  const situationalTeamPlayedLogs = situationalTeamScopedLogs.filter((g) => g.min > 0);
  const situationalTeamRecentKeys = new Map(
    [5, 10].map((n) => [n, new Set(situationalTeamPlayedLogs.slice(-n).map((g) => g.scheduleKey))] as const),
  );
  const situationalTeamGroupDefs: TeamSituationalGroupDef[] = [
    {
      key: "result",
      label: "勝敗",
      rows: [
        { key: "win", label: "勝った試合", predicate: (g) => g.win },
        { key: "loss", label: "負けた試合", predicate: (g) => !g.win },
      ],
    },
    // 試合中の最大リード・最大ビハインド（延長戦を含む。DESIGN.md 150章）。同じ試合が複数の行に入ることがある
    {
      key: "inGameMargin",
      label: "試合中の点差",
      rows: (Object.keys(MARGIN_CONDITION_LABELS) as MarginCondition[]).map((c) => ({
        key: c,
        label: MARGIN_CONDITION_LABELS[c],
        predicate: (g) => matchesMargin(g, c),
      })),
    },
    {
      key: "recent",
      label: "直近試合",
      rows: [5, 10].map((n) => ({
        key: `recent${n}`,
        label: `直近${n}試合`,
        predicate: (g: TeamGameLog) => situationalTeamRecentKeys.get(n)?.has(g.scheduleKey) ?? false,
      })),
    },
    {
      key: "venue",
      label: "会場",
      rows: [
        { key: "home", label: "ホーム", predicate: (g) => g.isHome },
        { key: "away", label: "アウェイ", predicate: (g) => !g.isHome },
      ],
    },
    {
      key: "division",
      label: "地区",
      rows: [
        { key: "east", label: "対東地区", predicate: (g) => matchesDivision(g, "east", divisionHistory, season) },
        { key: "west", label: "対西地区", predicate: (g) => matchesDivision(g, "west", divisionHistory, season) },
      ],
    },
    {
      key: "weekday",
      label: "曜日",
      rows: [
        { key: "weekday", label: "平日開催", predicate: (g) => isWeekdayGame(g.date) },
        { key: "holiday", label: "休日開催", predicate: (g) => !isWeekdayGame(g.date) },
      ],
    },
    {
      key: "timing",
      label: "時期",
      rows: [
        { key: "before", label: "年明け前", predicate: (g) => matchesNewYearHalf(g, "before") },
        { key: "after", label: "年明け後", predicate: (g) => matchesNewYearHalf(g, "after") },
      ],
    },
    {
      key: "month",
      label: "月別",
      rows: Array.from({ length: 12 }, (_, i) => ((i + 8) % 12) + 1)
        .filter((m) => situationalTeamMonthsWithData.has(m))
        .map((m) => ({ key: `m${m}`, label: `${m}月`, predicate: (g: TeamGameLog) => matchesMonth(g, m) })),
    },
    {
      key: "opponentStrength",
      label: "対戦相手の強さ",
      rows: opponentRecords
        ? (
            [
              ["under50", "対5割未満"],
              ["atLeast50", "対5割以上"],
              ["atLeast60", "対6割以上"],
            ] as const
          ).map(([tier, label]) => ({
            key: tier,
            label,
            predicate: (g: TeamGameLog) => matchesOpponentWinRateTier(g, tier, opponentRecords),
          }))
        : [],
    },
    {
      key: "backToBack",
      label: "連戦",
      rows: situationalTeamBackToBack
        ? (["GAME1", "GAME2"] as const).map((status) => ({
            key: status,
            label: status,
            predicate: (g: TeamGameLog) => situationalTeamBackToBack.get(g.scheduleKey)?.get(team.teamId) === status,
          }))
        : [],
    },
    {
      key: "foreignPlayerCount",
      label: "自チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `own${n}`,
        label: `${n}人`,
        predicate: (g: TeamGameLog) => g.foreignPlayerCount === n,
      })),
    },
    {
      key: "opponentForeignPlayerCount",
      label: "相手チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `opp${n}`,
        label: `${n}人`,
        predicate: (g: TeamGameLog) => g.opponentForeignPlayerCount === n,
      })),
    },
  ];
  const situationalTeamGroups: TeamSituationalStatsGroup[] = situationalTeamGroupDefs
    .map((group) => ({
      key: group.key,
      label: group.label,
      rows: group.rows.flatMap((row) => {
        const matched = situationalTeamScopedLogs.filter(row.predicate);
        const entries = matched
          .map((g) => {
            const game = statsRawGames.get(g.scheduleKey);
            return game ? { game, isHome: g.isHome } : null;
          })
          .filter((e): e is { game: StoredGame; isHome: boolean } => e !== null);
        const boxTotals = buildTeamMultiGameBoxTotals(
          entries,
          yahooTurnoversByScheduleKey,
          teamStatsShotChartSupported,
          yahooPbpSupported,
          situationalTeamPeriodOption,
          situationalTeamDisplayMode,
        );
        return boxTotals
          ? [
              {
                key: row.key,
                label: row.label,
                gamesPlayed: matched.length,
                boxTotals,
                scheduleKeys: matched.map((g) => g.scheduleKey),
                oppWinPctAvg: computeOpponentWinPctAvg(matched, opponentRecords),
                points: buildTeamPointsBreakdown(entries, masterById, situationalTeamDisplayMode),
              },
            ]
          : [];
      }),
    }))
    .filter((group) => group.rows.length > 0);

  // シチュエーション別成績（チーム版）のシューティングタブ: 各行のscheduleKeysからteamYahooPbpの
  // ショットを引いてShotTypeBreakdownを組み立てる（行キーはグループ横断で重複しない設計。DESIGN.md参照）
  const situationalTeamShotBreakdownByRowKey = new Map<string, ShotTypeBreakdown>();
  if (situationalTeamBoxTab === "shooting") {
    for (const group of situationalTeamGroups) {
      for (const row of group.rows) {
        const shots = row.scheduleKeys
          .flatMap((sk) => teamYahooPbp.get(sk)?.shots ?? [])
          .filter((s) => s.teamId === team.teamId && periodInRange(situationalTeamPeriodOption, s.period));
        situationalTeamShotBreakdownByRowKey.set(row.key, buildShotTypeBreakdown(shots));
      }
    }
  }
  const situationalTeamShotTypeKeys =
    situationalTeamBoxTab === "shooting"
      ? sortShotTypeKeys([...new Set([...situationalTeamShotBreakdownByRowKey.values()].flatMap((b) => Object.keys(b)))])
      : [];
  const situationalTeamShotColumns = shotTypeEntityColumns<TeamSituationalStatsRow>(
    situationalTeamShotTypeKeys,
    (r) => situationalTeamShotBreakdownByRowKey.get(r.key),
    situationalTeamDisplayMode === "total" ? "total" : "perGame",
    (r) => r.gamesPlayed,
  );
  // ベンチ/スタメン得点・国籍区分別得点（Batch 1）。Misc/スコアリングタブのみ末尾に追加する
  const situationalTeamPointsColumns = teamPointsExtraColumnsForTab(situationalTeamBoxTab);

  const playerNameById = new Map((players ?? []).map((p) => [p.playerId, p.name]));
  const eligibleLineups = (lineupsFile?.lineups ?? []).filter((l) => l.secondsPlayed >= MIN_LINEUP_SECONDS);
  const topLineups = eligibleLineups.slice(0, MAX_LINEUP_ROWS);
  const displayedLineups = lineupsExpanded ? eligibleLineups : topLineups;

  const topAssistPairs = teamAssistPairs.slice(0, MAX_ASSIST_PAIR_ROWS);
  const displayedAssistPairs = assistPairsExpanded ? teamAssistPairs : topAssistPairs;
  const assistPairsDataReady =
    !!gameLogs && gameLogs.filter((g) => g.gameType === "regular" && g.min > 0).every((g) => statsRawGames.has(g.scheduleKey));

  const winPct = safeDiv(team.wins, team.wins + team.losses);
  const recordLine = buildTeamRecordLine(team, standingsHistory);

  const nameHistory = teamHistory?.find((h) => h.teamId === team.teamId)?.names ?? [];
  const honors = clubHonors?.[team.teamId] ?? [];

  const scheduleRows =
    summaries && teamId
      ? buildTeamScheduleRows(summaries, schedule?.upcomingGames ?? [], teamId, team.teamName)
      : [];
  // 「日程結果」タブのレギュラー/プレーオフ/合算トグル用: scheduleKey→TeamGameLogの引き当て
  // （未消化・進行中の試合はTeamGameLogが存在しないため「合算」選択時以外は自然に除外される）
  const gameLogsByScheduleKey = new Map((gameLogs ?? []).map((g) => [g.scheduleKey, g]));
  const scheduleFilteredRows =
    scheduleGameType === "both"
      ? scheduleRows
      : scheduleRows.filter((row) => gameLogsByScheduleKey.get(row.scheduleKey)?.gameType === scheduleGameType);
  // 「日程結果」タブのカテゴリタブ用の列定義。試合詳細ページのボックススコアと完全に同じ配列
  const scheduleBoxColumns = COLUMNS_BY_TAB[scheduleBoxTab];
  const scheduleShotChartSupported = isShotChartSupported(coverage);
  // Misc/スコアリングタブのPBPタグ集計にはYahoo PBPも必要。season対応でも該当試合の取得が
  // 終わっていない間は誤って「0件」と表示しないよう、読み込み中はテーブル全体を「読み込み中」にする
  const scheduleDataLoading = statsRawGamesLoading || (yahooPbpSupported && teamYahooPbpLoading);

  // 各タブの表・セクションに出す「選択中の条件」（Batch 3、DESIGN.md 97章）。
  // 軸ごとのラベル関数（src/lib/conditionLabels.ts）を、セクションごとに実際に効いている軸だけ並べて合成する。
  // 効かない軸（シーズン通算値のみのセクション等）は固定ラベルで明示する
  const seasonLabel = `${season}シーズン`;
  // 「シーズン別成績」は新しいシーズンから順に表示する（seasons.json由来の並びは古い順）
  const seasonHistoryDesc = seasonHistory ? [...seasonHistory].sort((a, b) => b.season.localeCompare(a.season)) : null;
  const seasonBoxConditions = composeLabels(
    teamBoxCategoryLabel(seasonBoxTab),
    seasonBoxTab !== "forcedTurnovers" && !seasonShareTab && displayModeLabels(seasonBoxDisplayMode),
    seasonBoxTab !== "shooting" && seasonBoxTab !== "forcedTurnovers" && !seasonShareTab && perspectiveLabels(seasonBoxPerspective),
    gameTypeLabels("regular", null),
  );
  const teamLeadersConditions = composeLabels(
    seasonLabel,
    classificationLabels(teamLeadersJpOnly ? "日本人" : "all"),
    gameTypeLabels("regular", null),
    ...eligibilityLabels({ gamesRatio: teamLeadersGamesRatio }),
  );
  const situationalRecordConditions = composeLabels(seasonLabel, gameTypeLabels(situationalRecordGameType, season));
  // 「チーム内リーダー」の掲載基準（出場率）。ランキングページと同じ popover＋EligibilitySlider
  const teamLeadersEligibilitySummary = eligibilityLabels({ gamesRatio: teamLeadersGamesRatio }).join("・");
  const teamLeadersEligibilityAxis: FilterAxis = {
    kind: "popover",
    id: "teamLeadersEligibility",
    label: "掲載基準",
    tier: "primary",
    value: String(Math.round(teamLeadersGamesRatio * 100)),
    defaultValue: String(Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100)),
    onChange: () => setTeamLeadersGamesRatio(MIN_GAMES_PLAYED_RATIO_FOR_RANKING),
    summary: teamLeadersEligibilitySummary,
    chipValue: teamLeadersEligibilitySummary,
    content: (
      <EligibilitySlider
        label="出場率"
        value={Math.round(teamLeadersGamesRatio * 100)}
        min={0}
        max={100}
        step={1}
        format={(v) => `${v}%`}
        onChange={(v) => setTeamLeadersGamesRatio(v / 100)}
      />
    ),
  };
  // 「シチュエーション別成績」: 行がシチュエーション自体のため、S軸（詳細フィルタ）は持たない
  const situationalTeamConditions = composeLabels(
    seasonLabel,
    teamBoxCategoryLabel(situationalTeamBoxTab),
    displayModeLabels(situationalTeamDisplayMode),
    gameTypeLabels(situationalTeamGameType, season),
    situationalTeamBoxTab !== "shooting" && perspectiveLabels(situationalTeamPerspective),
    periodLabels(situationalTeamPeriodOption),
  );
  // フィルタバー（DESIGN.md 105章 B4）。ショットチャート専用の絞り込み（旧・チームスタッツの共有バーから独立させた。118章）
  const teamShotChartFilterAxes: FilterAxis[] = [
    gameTypeAxis(teamShotChartGameType, setTeamShotChartGameType, season),
    periodAxis(teamShotChartPeriod, setTeamShotChartPeriod, SEASON_BOX_PERIOD_OPTIONS),
    ...situationalAxes(teamShotChartFilter, setTeamShotChartFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
    }),
  ];
  const clearTeamShotChartFilters = () => {
    setTeamShotChartGameType("regular");
    setTeamShotChartPeriod("all");
    setTeamShotChartFilter({ range: { kind: "all" } });
  };
  const playerStatsShooting = playerStatsBoxTab === "shooting";
  const playerStatsFilterAxes: FilterAxis[] = [
    gameTypeAxis(playerStatsGameType, setPlayerStatsGameType, season),
    displayModeAxis(playerStatsDisplayMode, setPlayerStatsDisplayMode),
    periodAxis(playerStatsPeriod, setPlayerStatsPeriod, SEASON_BOX_PERIOD_OPTIONS, {
      disabledReason: playerStatsShooting ? `${CATEGORY_LABELS.shooting}はQ別/前後半の対象外です。` : undefined,
    }),
    ...situationalAxes(playerStatsFilter, setPlayerStatsFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
    }),
  ];
  const clearPlayerStatsFilters = () => {
    setPlayerStatsGameType("regular");
    setPlayerStatsDisplayMode("perGame");
    setPlayerStatsPeriod("all");
    setPlayerStatsFilter({ range: { kind: "all" } });
  };
  const teamShotChartConditions = composeLabels(
    seasonLabel,
    gameTypeLabels(teamShotChartGameType, season),
    situationalFilterLabels(teamShotChartFilter),
    periodLabels(teamShotChartPeriodOption),
  );
  // シューティングタブは試合単位のシュートを集計するだけでQ別/前後半に対応していないため、
  // Q別/前後半が選ばれているときはその旨を明示する（試合全体のときは通常どおりP軸を出す）
  const playerStatsTitle = {
    title: `${seasonLabel} 選手スタッツ：${teamBoxCategoryLabel(playerStatsBoxTab)}`,
    conditions: composeLabels(
      displayModeLabels(playerStatsDisplayMode),
      gameTypeLabels(playerStatsGameType, season),
      situationalFilterLabels(playerStatsFilter),
      playerStatsBoxTab === "shooting" && playerStatsPeriodOption?.periods
        ? `※${CATEGORY_LABELS.shooting}はQ別/前後半の対象外`
        : periodLabels(playerStatsPeriodOption),
    ),
  };
  const scheduleTitle = {
    title: `${seasonLabel} 日程結果：${teamBoxCategoryLabel(scheduleBoxTab)}`,
    conditions: composeLabels(
      perspectiveLabels(scheduleTeamPerspective),
      gameTypeLabels(scheduleGameType, season),
      periodLabels(schedulePeriodOption),
    ),
  };
  const careerRangeLabel =
    careerData && careerData.length > 0 ? `${careerData[0]!.season}〜${careerData[careerData.length - 1]!.season}シーズン` : null;
  const careerConditions = composeLabels(careerRangeLabel, gameTypeLabels(careerGameTypeFilter, null));
  // 「比較」タブ: 各スロットの選択内容（シーズン・シチュエーション）をタイトルに、共通の軸（カテゴリ・V・G）を条件行に出す
  const compareSlotDescriptions = compareSlots
    .filter((slot) => slot.season)
    .map((slot) => (slot.league ? `${LEAGUE_TEAM_NAME} ${slot.season}` : `${slot.season}（${joinLabels(situationalFilterLabels(slot.filter))}）`));
  const compareTitle = {
    title: `${team.teamName} 比較：${compareSlotDescriptions.join(" vs ")}`,
    conditions: composeLabels(
      teamBoxCategoryLabel(compareTab),
      perspectiveLabels(comparePerspective),
      gameTypeLabels(compareGameType, null),
    ),
  };

  const radarData = teams && teams.length > 1 ? buildRadarData(team, teams) : [];

  return (
    <PlayerNamePool names={teamPlayers.map((p) => p.name)}>
    <div className="team-detail-page" data-design="v2">
      <Link to="/teams" className="back-link">
        ← チーム一覧に戻る
      </Link>

      <div className="team-detail-header" style={accentColor ? { borderTopColor: accentColor } : undefined}>
        <TeamLogo teamId={team.teamId} size={56} />
        <div>
          <h1>{team.teamName}</h1>
          <p className="page-subtitle">
            {season}シーズン・{recordLine}
          </p>
        </div>
      </div>

      <div className="team-header-columns">
        <div className="team-header-info">
          {honors.length > 0 && (
            <div className="honors-groups">
              {HONOR_CATEGORY_ORDER.map((category) => {
                const items = honors.filter((h) => h.category === category);
                if (items.length === 0) return null;
                return (
                  <div className="honors-group" key={category}>
                    <h3>{HONOR_CATEGORY_LABELS[category]}</h3>
                    <ul>
                      {items.map((h, i) => (
                        <li key={`${h.season}-${h.competition}-${i}`} className="honor-item">
                          <span className="honor-season">{h.season}</span>
                          {h.competition}
                          {h.note && category !== "international" && category !== "emperors_cup" && (
                            <span className="honor-note">（{h.note}）</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="team-header-radar">
          {radarData.length === 0 ? (
            <p className="empty-message">比較対象のチームがありません</p>
          ) : (
            <div className="radar-chart-wrapper">
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar
                    name={team.teamName}
                    dataKey="percentile"
                    stroke={accentColor ?? "var(--accent)"}
                    fill={accentColor ?? "var(--accent)"}
                    fillOpacity={0.35}
                  />
                  <RechartsTooltip
                    formatter={(_value: number, _name, props: { payload?: RadarDataPoint }) => {
                      const point = props.payload;
                      return point ? [`${point.rank}位/${point.total}（${point.actualValue}）`, point.label] : ["", ""];
                    }}
                    contentStyle={{ background: "var(--bg)", border: "1px solid var(--border)", color: "var(--fg)" }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      <div className="tab-bar">
        {(Object.keys(TAB_LABELS) as DetailTab[]).map((t) => (
          <button key={t} className={`tab-button${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="team-tab-panel">
          {TEAM_HEADER_STAT_ROWS.map((row, i) => (
            <div className="stat-grid team-header-stat-grid" key={i}>
              {row.map((def) => (
                <StatTile
                  key={def.key}
                  label={def.label}
                  value={def.format(team)}
                  rank={teams && teams.length > 0 ? formatTeamRank(rankAmongTeams(team, teams, def)) : undefined}
                />
              ))}
            </div>
          ))}

          <MobileCollapse label="円グラフ">
            <ScoringCompositionSection team={team} gameLogs={gameLogs ?? []} shotChartSupported={isShotChartSupported(coverage)} />
          </MobileCollapse>

          <ConditionTitle section title="チーム内リーダー" conditions={teamLeadersConditions} />
          <FilterBar
            simple
            stateKey={pk("teamLeadersFilter")}
            axes={[
              simpleSelectAxis({
                id: "teamLeadersScope",
                label: "対象選手",
                options: [
                  { value: "all", label: "チーム全体" },
                  { value: "jp", label: "日本人選手限定" },
                ],
                value: teamLeadersJpOnly ? "jp" : "all",
                onChange: (v) => setTeamLeadersJpOnly(v === "jp"),
              }),
              teamLeadersEligibilityAxis,
            ]}
          />
          {teamLeadersPool.length === 0 ? (
            <p className="empty-message">選手データがありません</p>
          ) : (
            <div className="leaders-grid">
              {(() => {
                const cards = TEAM_INTERNAL_LEADER_STAT_KEYS.map((key) => {
                const def = PLAYER_STAT_DEFS.find((d) => d.key === key);
                if (!def) return null;
                const extraThreshold = EXTRA_ELIGIBILITY_RULES[key]?.defaultValue ?? 0;
                const eligiblePool = filterEligiblePlayers(
                  teamLeadersPool,
                  teams ?? [],
                  teamLeadersGamesRatio,
                  key,
                  extraThreshold,
                );
                const top = [...eligiblePool].sort((a, b) => def.value(b) - def.value(a)).slice(0, TEAM_LEADERS_TOP_N);
                const leader = top[0];
                if (!leader) return null;
                return (
                  <div key={key} className="leader-card">
                    <div className="leader-stat-label">{leaderStatLabel(def)}</div>
                    <Link to={`/players/${leader.playerId}`} className="leader-top1">
                      <PlayerPhoto playerId={leader.playerId} size={56} className="leader-photo" />
                      <div className="leader-info">
                        <div className="leader-value">{def.format(leader)}</div>
                        <div className="leader-name">
                          <ResponsivePlayerName name={leader.name} />
                        </div>
                      </div>
                    </Link>
                    {top.length > 1 && (
                      <div className="leader-rest-list">
                        {top.slice(1).map((p, i) => (
                          <div key={p.playerId} className="leader-rest-item">
                            <Link to={`/players/${p.playerId}`} className="leader-rest-item-link">
                              <span className="leader-rest-rank">{i + 2}</span>
                              <span className="leader-rest-name">
                                <ResponsivePlayerName name={p.name} />
                              </span>
                            </Link>
                            <span className="leader-rest-value">{def.format(p)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
                });
                // スマホ幅では PTS/REB/AST の3項目だけを既定で出し、残りはボタンで展開する（広い画面は全項目）
                return (
                  <>
                    {cards.slice(0, TEAM_LEADERS_MOBILE_DEFAULT_COUNT)}
                    <MobileCollapse label="その他の項目">{cards.slice(TEAM_LEADERS_MOBILE_DEFAULT_COUNT)}</MobileCollapse>
                  </>
                );
              })()}
            </div>
          )}

          <ConditionTitle section title="シチュエーション別勝敗" conditions={situationalRecordConditions} />
          <FilterBar
            simple
            stateKey={pk("situationalRecordFilter")}
            axes={[gameTypeAxis(situationalRecordGameType, setSituationalRecordGameType, season)]}
          />
          {gameLogsLoading ? (
            <p className="loading">読み込み中...</p>
          ) : situationalRecordGroups.length === 0 ? (
            <p className="empty-message">対象試合がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">区分</th>
                    <th className="align-right" title={statDescription("試合数")}>試合数</th>
                    <th className="align-right" title={statDescription("勝敗")}>勝敗</th>
                    <th className="align-right" title={statDescription("勝率")}>勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {situationalRecordGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td colSpan={4}>{group.label}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="align-left">{row.label}</td>
                          <td className="align-right">{row.games}</td>
                          <td className="align-right">{formatRecord(row.wins, row.losses)}</td>
                          <td className="align-right" style={{ background: winPctBackground(row.winPct) }}>
                            {formatWinPct(row.winPct)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3
            className="collapsible-heading"
            onClick={() => setSituationalRecordRawExpanded((v) => !v)}
          >
            {situationalRecordRawExpanded ? "▼ " : "▶ "}
            延長・Q別リード状況
          </h3>
          {situationalRecordRawExpanded && <ConditionLine conditions={situationalRecordConditions} />}
          {!situationalRecordRawExpanded ? null : statsRawGamesLoading || !situationalRecordRawGamesReady ? (
            <p className="loading">読み込み中...</p>
          ) : situationalRecordRawGroups.length === 0 ? (
            <p className="empty-message">対象試合がありません</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th className="align-left">区分</th>
                      <th className="align-right" title={statDescription("試合数")}>試合数</th>
                      <th className="align-right" title={statDescription("勝敗")}>勝敗</th>
                      <th className="align-right" title={statDescription("勝率")}>勝率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {situationalRecordRawGroups.map((group) => (
                      <Fragment key={group.key}>
                        <tr className="situational-group-heading">
                          <td colSpan={4}>{group.label}</td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={row.key}>
                            <td className="align-left">{row.label}</td>
                            <td className="align-right">{row.games}</td>
                            <td className="align-right">{formatRecord(row.wins, row.losses)}</td>
                            <td className="align-right" style={{ background: winPctBackground(row.winPct) }}>
                              {formatWinPct(row.winPct)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="page-subtitle">
                各試合のクォーター別得点から判定しているため、展開時にこのチームの当該シーズン全試合を読み込む
              </p>
            </>
          )}

          <div className="situational-groups-legend">
            <h3
              className="collapsible-heading"
              onClick={() => setSituationalRecordLegendExpanded((v) => !v)}
            >
              {situationalRecordLegendExpanded ? "▼ " : "▶ "}
              説明
            </h3>
            {situationalRecordLegendExpanded && (
            <dl>
              <dt>会場</dt>
              <dd>ホーム開催／アウェイ開催の試合を分けて集計します。</dd>
              <dt>地区</dt>
              <dd>対戦相手の所属地区（東地区／西地区）別の成績です。シーズンごとの実際の地区分けを反映しています。</dd>
              <dt>曜日</dt>
              <dd>水曜開催の試合のみを集計します。</dd>
              <dt>月別</dt>
              <dd>開催月ごとの成績です。試合が無い月は表示されません。</dd>
              <dt>対戦相手の強さ</dt>
              <dd>
                その試合に入る時点での対戦相手の勝率（対5割未満／対5割以上／対6割以上）別の成績です。
                相手の消化試合数が5試合未満の対戦は、勝率が極端な値になりやすいため集計から除外しています。
              </dd>
              <dt>連戦</dt>
              <dd>中1日以内の間隔で連続して試合を行った場合の、1試合目（GAME1）／2試合目以降（GAME2）別の成績です。</dd>
              <dt>自チーム外国籍人数</dt>
              <dd>
                その試合で自チームが最も長くコートに立たせていた、外国籍・帰化選手・アジア特別枠選手の
                同時出場人数（0〜3人）別の成績です。
              </dd>
              <dt>得点/失点</dt>
              <dd>自チームの得点・相手チームの得点（失点）がそれぞれ80点/100点を超えたかどうかで分けた成績です。</dd>
              <dt>点差決着</dt>
              <dd>
                最終的な得失点差が10点差／20点差以上だったか、僅差（1ポゼッション差＝3点差以内／
                2ポゼッション差＝6点差以内）だったかで分けた成績です。
              </dd>
              <dt>延長</dt>
              <dd>延長（OT）にもつれた試合と、レギュレーション（4Q）で決着した試合を分けた成績です。</dd>
              <dt>Q1終了時点／前半終了時点／3Q終了時点</dt>
              <dd>各チェックポイント時点でリード・同点・ビハインドのいずれだったかで分けた成績です。</dd>
            </dl>
            )}
          </div>
        </div>
      )}

      {tab === "schedule" &&
        (summariesLoading || scheduleLoading ? (
          <p className="loading">読み込み中...</p>
        ) : scheduleRows.length === 0 ? (
          <p className="empty-message">日程データがありません</p>
        ) : (
          <div className="team-tab-panel">
            <FilterBar
              simple
              stateKey={pk("scheduleFilter")}
              axes={[
                perspectiveAxis(scheduleTeamPerspective, setScheduleTeamPerspective),
                gameTypeAxis(scheduleGameType, setScheduleGameType, season, { defaultValue: "both" }),
                periodAxis(schedulePeriod, setSchedulePeriod, SEASON_BOX_PERIOD_OPTIONS),
              ]}
            />
            <div className="tab-bar">
              {BOXSCORE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-button${scheduleBoxTab === t.key ? " active" : ""}`}
                  onClick={() => setScheduleBoxTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <ConditionTitle title={scheduleTitle.title} conditions={scheduleTitle.conditions} />
            {scheduleDataLoading && <p className="loading">読み込み中...</p>}
            {scheduleFilteredRows.length === 0 ? (
              <p className="empty-message">該当する試合がありません</p>
            ) : (
              <div className="table-scroll">
                <table className="sortable-table schedule-table">
                  <thead>
                    <tr>
                      <th className="align-left">日付</th>
                      <th className="align-left">対戦相手</th>
                      <th className="align-right">結果</th>
                      {scheduleBoxColumns.map((col) => (
                        <th key={col.key} className="align-right" title={statDescription(col.label, "team")}>
                          <StatHeaderLabel label={col.label} />
                        </th>
                      ))}
                      <th className="align-left">会場</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleFilteredRows.map((row) => {
                      const game = statsRawGames.get(row.scheduleKey);
                      const boxTotals = game
                        ? buildTeamGameBoxTotals(
                            game,
                            row.isHome,
                            schedulePeriodOption,
                            teamYahooPbp.get(row.scheduleKey)?.turnovers ?? [],
                            scheduleShotChartSupported,
                            yahooPbpSupported,
                          )
                        : null;
                      return (
                        <TeamScheduleRowView
                          key={row.scheduleKey}
                          row={row}
                          perspective={scheduleTeamPerspective}
                          columns={scheduleBoxColumns}
                          boxTotals={boxTotals}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {scheduleBoxTab === "misc" && scheduleFilteredRows.length > 0 && <RuleChangeFootnote seasons={[season]} />}
            <p className="page-subtitle">
              各列は試合詳細ページのボックススコアと同じ算出ロジック（自チーム/opp/+/-切り替え可）。上部のレギュラー/{postseasonLabel(season)}・Q別/前後半トグルと連動する。未消化・進行中の試合は「-」表示になる
            </p>
          </div>
        ))}

      {tab === "career" && (
        <div className="team-tab-panel">
          <FilterBar
            simple
            stateKey={pk("careerFilter")}
            axes={[gameTypeAxis(careerGameTypeFilter, setCareerGameTypeFilter, null)]}
          />
          {careerLoading && !careerData ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerData || careerData.length === 0 ? (
            <p className="empty-message">通算成績のデータがありません</p>
          ) : (
            <>
              <ConditionTitle title="通算成績" conditions={careerConditions} />
              <div className="stat-grid">
                {CAREER_TOTAL_DEFS.map((def) => (
                  <StatTile
                    key={def.key}
                    label={def.label}
                    value={def.value(careerTotals).toLocaleString()}
                    rank={formatLeagueRank(careerRank(def.key))}
                  />
                ))}
                <StatTile label="最多連勝" value={`${careerLongestWinStreak}連勝`} />
              </div>
              <p className="page-subtitle">
                {careerData[0]?.season}〜{careerData[careerData.length - 1]?.season}シーズンの合計値（PITP/FBPS/2ND
                PTS/PTSOFFTOはPBPタグ集計による得点ベースの値。ホーム来場者数はホーム開催試合のみの合計）。項目名の
                下の順位は過去在籍した全クラブ横断（シーズンをまたいだ連勝は対象外。詳細はクラブレコード
                タブの「最多連勝（シーズン内）」参照）
              </p>

              <h3 className="career-highs-subheading">クォーター別・前後半別の1試合平均</h3>
              <SeasonPeriodAverages
                teamId={teamId ?? ""}
                careerData={careerData}
                gameType={careerGameTypeFilter}
                leagueRankings={leagueRankings}
                stateKey={pk("periodAverages")}
              />
              <p className="page-subtitle">
                1Q〜4Q・前半（1Q＋2Q）・後半（3Q＋4Q）の、シーズンごとの1試合平均です。延長戦の得点は含めません。
                数値の下はそのシーズンのリーグ内の順位（通算の行は過去在籍した全クラブの中での順位）です。
              </p>
            </>
          )}
        </div>
      )}

      {tab === "clubRecord" && (
        <div className="team-tab-panel">
          <FilterBar
            simple
            stateKey={pk("careerFilter")}
            axes={[gameTypeAxis(careerGameTypeFilter, setCareerGameTypeFilter, null)]}
          />
          {careerLoading && !careerData ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerData || careerData.length === 0 ? (
            <p className="empty-message">クラブレコードのデータがありません</p>
          ) : (
            <>
              <ConditionTitle title="クラブレコード" conditions={careerConditions} />
              <h3 className="career-highs-subheading">シーズン記録</h3>
              <div className="career-highs-grid">
                {mostWinsSeasonRecord && (
                  <SeasonRecordCard
                    teamId={teamId ?? ""}
                    tieKey="season:wins"
                    label="最多勝利数（1シーズン）"
                    display={`${mostWinsSeasonRecord.value}勝`}
                    season={mostWinsSeasonRecord.season}
                    otherSeasons={mostWinsSeasonRecord.otherSeasons}
                    rank={formatLeagueRank(seasonSpecialRank("wins"))}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                  />
                )}
                {longestStreakSeasonRecord && (
                  <SeasonRecordCard
                    teamId={teamId ?? ""}
                    tieKey="season:streak"
                    label="最多連勝（シーズン内）"
                    display={`${longestStreakSeasonRecord.value}連勝`}
                    season={longestStreakSeasonRecord.season}
                    otherSeasons={longestStreakSeasonRecord.otherSeasons}
                    rank={formatLeagueRank(seasonSpecialRank("streak"))}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                  />
                )}
              </div>

              <h3 className="career-highs-subheading">クラブレコード</h3>
              <div className="career-highs-grid">
                {clubRecords.map((r) => (
                  <ClubRecordCard
                    key={r.key}
                    tieKey={`high:${r.key}`}
                    label={r.label}
                    display={r.display}
                    game={r.game}
                    otherGames={r.otherGames}
                    rank={formatLeagueRank(clubRecordRank(r.key))}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                    topEntries={r.topEntries}
                    format={r.format}
                    topNExpandedKeys={expandedTopNRecordCards}
                    onToggleTopN={toggleTopNRecordCard}
                  />
                ))}
              </div>

              <h3 className="career-highs-subheading">クラブワースト</h3>
              <div className="career-highs-grid">
                {clubWorsts.map((r) => (
                  <ClubRecordCard
                    key={r.key}
                    tieKey={`worst:${r.key}`}
                    label={r.label}
                    display={r.display}
                    game={r.game}
                    otherGames={r.otherGames}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                    topEntries={r.topEntries}
                    format={r.format}
                    topNExpandedKeys={expandedTopNRecordCards}
                    onToggleTopN={toggleTopNRecordCard}
                  />
                ))}
              </div>

              <h3 className="career-highs-subheading">被記録</h3>
              <div className="career-highs-grid">
                {clubAgainstRecords.map((r) => (
                  <ClubRecordCard
                    key={r.key}
                    tieKey={`against:${r.key}`}
                    label={r.label}
                    display={r.display}
                    game={r.game}
                    otherGames={r.otherGames}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                    topEntries={r.topEntries}
                    format={r.format}
                    topNExpandedKeys={expandedTopNRecordCards}
                    onToggleTopN={toggleTopNRecordCard}
                  />
                ))}
              </div>
              <p className="page-subtitle">
                {careerData[0]?.season}〜{careerData[careerData.length - 1]?.season}シーズンの中での1試合の最高/最低記録
                （PITP/FBPS/2ND PTS/PTSOFFTOはPBPタグ集計による得点ベースの値。ホーム来場者数はホーム開催試合のみが対象）。
                %系の指標はクラブワーストの対象外。項目名クリックでトップ10（TOV・失点・ファウル等「多い方が悪い」
                項目はワースト側のみトップ5）を展開できます。項目名の下の順位は過去在籍した全クラブ横断。
                クラブワーストは順位算出の対象外。「被記録」は対戦相手がこのチーム相手に記録した最多値
                （来場者数を除く28項目。歴代順位の算出対象外）
              </p>

              <h3 className="career-highs-subheading">クォーター別レコード</h3>
              <ClubPeriodRecords games={clubRecordAllGames} stateKey={pk("periodRecords")} />
              <p className="page-subtitle">
                1Q〜4Q・前半（1Q＋2Q）・後半（3Q＋4Q）の1試合の記録です。延長戦の得点は含めません。
                2016-17・2017-18のCSで行った前後半5分の試合は対象外です。
                ※は公式のクォーター別スコアが欠けている試合で、プレーバイプレーの得点から出した値です。
              </p>
            </>
          )}
        </div>
      )}

      {tab === "teamStats" && (
        <div className="team-tab-panel">
          <ConditionTitle section title="シーズン別成績" conditions={seasonBoxConditions} />
          {nameHistory.length > 1 && (
            <p className="page-subtitle">
              名称変更履歴:{" "}
              {nameHistory.map((n, i) => (
                <span key={n.name}>
                  {i > 0 && " → "}
                  {n.name}
                  {n.fromSeason || n.toSeason ? (
                    <>
                      （{n.fromSeason ?? ""}
                      {n.fromSeason && n.toSeason ? "〜" : ""}
                      {n.toSeason ?? (n.fromSeason ? "〜" : "")}）
                    </>
                  ) : null}
                </span>
              ))}
            </p>
          )}
          <FilterBar
            simple
            stateKey={pk("seasonBoxFilter")}
            axes={[
              perspectiveAxis(seasonBoxPerspective, setSeasonBoxPerspective, {
                disabledReason:
                  seasonBoxTab === "shooting"
                    ? `${CATEGORY_LABELS.shooting}は自チームの値のみです。`
                    : seasonBoxTab === "forcedTurnovers"
                      ? `${CATEGORY_LABELS.forcedTurnovers}は種類別の通算件数のみで、視点は連動しません。`
                      : seasonShareTab
                        ? `${teamBoxCategoryLabel(seasonBoxTab)}のグラフは自チームの値で、視点は連動しません。`
                        : undefined,
              }),
              displayModeAxis(seasonBoxDisplayMode, setSeasonBoxDisplayMode, {
                disabledReason:
                  seasonBoxTab === "forcedTurnovers"
                    ? `${CATEGORY_LABELS.forcedTurnovers}は種類別の通算件数のみで、平均/合計は連動しません。`
                    : seasonShareTab
                      ? `${teamBoxCategoryLabel(seasonBoxTab)}のグラフは割合で、平均/合計は連動しません。`
                      : undefined,
              }),
            ]}
          />
          <div className="tab-bar">
            {SEASON_BOX_TABS.map((t) => (
              <button
                key={t.key}
                className={`tab-button${seasonBoxTab === t.key ? " active" : ""}`}
                onClick={() => setSeasonBoxTab(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
            <button
              className={`tab-button${seasonBoxTab === "shooting" ? " active" : ""}`}
              onClick={() => setSeasonBoxTab("shooting")}
              title={TEAM_SHOOTING_TAB_TOOLTIP}
              type="button"
            >
              {CATEGORY_LABELS.shooting}
            </button>
            <button
              className={`tab-button${seasonBoxTab === "forcedTurnovers" ? " active" : ""}`}
              onClick={() => setSeasonBoxTab("forcedTurnovers")}
              type="button"
            >
              {CATEGORY_LABELS.forcedTurnovers}
            </button>
            <button
              className={`tab-button${seasonBoxTab === "foreignPlayers" ? " active" : ""}`}
              onClick={() => setSeasonBoxTab("foreignPlayers")}
              type="button"
            >
              {CATEGORY_LABELS.foreignPlayers}
            </button>
            <button
              className={`tab-button${seasonBoxTab === "scoringComposition" ? " active" : ""}`}
              onClick={() => setSeasonBoxTab("scoringComposition")}
              type="button"
            >
              {CATEGORY_LABELS.scoringComposition}
            </button>
          </div>
          {seasonHistoryLoading || careerLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !seasonHistoryDesc || seasonHistoryDesc.length === 0 ? (
            <p className="empty-message">シーズン別成績がありません</p>
          ) : seasonBoxTab === "shooting" ? (
            <TeamSeasonShotTypeTable rows={seasonHistoryDesc} displayMode={seasonBoxDisplayMode} />
          ) : seasonBoxTab === "forcedTurnovers" ? (
            <TeamSeasonForcedTurnoversTable rows={seasonHistoryDesc} />
          ) : seasonBoxTab === "foreignPlayers" ? (
            <TeamSeasonForeignChart
              rows={seasonHistoryDesc}
              rules={seasonRulesForTrend ?? null}
              inProgressSeason={isRegularSeasonInProgress(currentSeason(), currentSeason(), currentRace, team.teamId) ? currentSeason() : null}
            />
          ) : seasonBoxTab === "scoringComposition" ? (
            <TeamSeasonScoringCharts
              rows={seasonHistoryDesc}
              inProgressSeason={isRegularSeasonInProgress(currentSeason(), currentSeason(), currentRace, team.teamId) ? currentSeason() : null}
            />
          ) : (
            <>
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">シーズン</th>
                    <th className="align-left">チーム名</th>
                    <th className="align-right" title={statDescription("試合数")}>試合数</th>
                    <th className="align-right" title={statDescription("勝敗")}>勝敗</th>
                    <th className="align-right" title={statDescription("勝率")}>勝率</th>
                    {TEAM_SEASON_BOX_COLUMNS[seasonBoxTab].map((c) => (
                      <th className="align-right" key={c.key} title={statDescription(c.label, "team")}>
                        <StatHeaderLabel label={c.label} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasonHistoryDesc.map((r) => {
                    const misc = teamSeasonMiscBySeason.get(r.season) ?? EMPTY_TEAM_SEASON_MISC;
                    return (
                      <tr key={r.season}>
                        <td className="align-left">
                          <RouterLink to={`/teams/${team.teamId}?season=${r.season}`} className="cell-link">
                            {r.season}
                          </RouterLink>
                        </td>
                        <td className="align-left">
                          <ResponsiveTeamName teamId={team.teamId} name={r.teamName} />
                        </td>
                        <td className="align-right">{r.team.gamesPlayed}</td>
                        <td className="align-right">{formatRecord(r.team.wins, r.team.losses)}</td>
                        <td className="align-right">{formatWinPct(safeDiv(r.team.wins, r.team.wins + r.team.losses))}</td>
                        {TEAM_SEASON_BOX_COLUMNS[seasonBoxTab].map((c) => (
                          <td className="align-right" key={c.key}>
                            {c.format(r, misc, seasonBoxDisplayMode, seasonBoxPerspective)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {seasonBoxTab === "misc" && <RuleChangeFootnote seasons={seasonHistoryDesc.map((r) => r.season)} />}
            </>
          )}

          <ConditionTitle section title="シチュエーション別成績" conditions={situationalTeamConditions} />
          {statsRawGamesLoading && <p className="loading">読み込み中...</p>}
          <FilterBar
            simple
            stateKey={pk("situationalTeamFilter")}
            axes={[
              gameTypeAxis(situationalTeamGameType, setSituationalTeamGameType, season),
              perspectiveAxis(situationalTeamPerspective, setSituationalTeamPerspective, {
                disabledReason:
                  situationalTeamBoxTab === "shooting" ? `${CATEGORY_LABELS.shooting}は自チームの値のみです。` : undefined,
              }),
              displayModeAxis(situationalTeamDisplayMode, setSituationalTeamDisplayMode),
              periodAxis(situationalTeamPeriod, setSituationalTeamPeriod, SEASON_BOX_PERIOD_OPTIONS),
            ]}
          />
          <div className="tab-bar">
            {BOXSCORE_TABS.map((t) => (
              <button
                key={t.key}
                className={`tab-button${situationalTeamBoxTab === t.key ? " active" : ""}`}
                onClick={() => setSituationalTeamBoxTab(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
            <button
              className={`tab-button${situationalTeamBoxTab === "shooting" ? " active" : ""}`}
              onClick={() => setSituationalTeamBoxTab("shooting")}
              title={TEAM_SHOOTING_TAB_TOOLTIP}
              type="button"
            >
              {CATEGORY_LABELS.shooting}
            </button>
          </div>
          {situationalTeamBoxTab === "shooting" && teamYahooPbpLoading ? (
            <p className="loading">読み込み中...</p>
          ) : situationalTeamGroups.length === 0 ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : situationalTeamBoxTab === "shooting" && situationalTeamShotTypeKeys.length === 0 ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <StickyHeaderScroll>
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">区分</th>
                    <th className="align-right" title={statDescription("試合数")}>試合数</th>
                    <th className="align-right" title={statDescription("対戦相手勝率")}>
                      対戦相手勝率
                    </th>
                    {(situationalTeamBoxTab === "shooting" ? situationalTeamShotColumns : COLUMNS_BY_TAB[situationalTeamBoxTab]).map(
                      (col) => (
                        <th key={col.key} className="align-right" title={statDescription(col.label, "team")}>
                          <StatHeaderLabel label={col.label} />
                        </th>
                      ),
                    )}
                    {situationalTeamPointsColumns.map((col) => (
                      <th key={col.key} className="align-right" title={statDescription(col.label, "team")}>
                        <StatHeaderLabel label={col.label} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {situationalTeamGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td
                          colSpan={
                            (situationalTeamBoxTab === "shooting" ? situationalTeamShotColumns : COLUMNS_BY_TAB[situationalTeamBoxTab])
                              .length +
                            situationalTeamPointsColumns.length +
                            3
                          }
                        >
                          <span className="sticky-group-label">{group.label}</span>
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="align-left">{row.label}</td>
                          <td className="align-right">{row.gamesPlayed}</td>
                          <td className="align-right">
                            {row.oppWinPctAvg !== undefined ? formatWinPct(row.oppWinPctAvg) : "-"}
                          </td>
                          {situationalTeamBoxTab === "shooting"
                            ? situationalTeamShotColumns.map((col) => (
                                <td key={col.key} className="align-right">
                                  {col.format!(row)}
                                </td>
                              ))
                            : COLUMNS_BY_TAB[situationalTeamBoxTab].map((col) => (
                                <td key={col.key} className="align-right">
                                  {situationalTeamPerspective === "own"
                                    ? cleanNumericString(col.format(row.boxTotals.own, row.boxTotals.ownCtx))
                                    : situationalTeamPerspective === "opp"
                                      ? cleanNumericString(col.format(row.boxTotals.opp, row.boxTotals.oppCtx))
                                      : formatColumnDiff(
                                          col,
                                          row.boxTotals.own,
                                          row.boxTotals.ownCtx,
                                          row.boxTotals.opp,
                                          row.boxTotals.oppCtx,
                                        )}
                                </td>
                              ))}
                          {situationalTeamPointsColumns.map((col) => (
                            <td key={col.key} className="align-right">
                              {formatTeamPointsExtraColumn(row.points, col, situationalTeamPerspective, situationalTeamDisplayMode)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </StickyHeaderScroll>
          )}
          {situationalTeamBoxTab === "misc" && situationalTeamGroups.length > 0 && <RuleChangeFootnote seasons={[season]} />}

          <div className="situational-groups-legend">
            <h3
              className="collapsible-heading"
              onClick={() => setSituationalTeamLegendExpanded((v) => !v)}
            >
              {situationalTeamLegendExpanded ? "▼ " : "▶ "}
              説明
            </h3>
            {situationalTeamLegendExpanded && (
            <dl>
              <dt>勝敗</dt>
              <dd>勝った試合／負けた試合を分けて集計します。</dd>
              <dt>直近試合</dt>
              <dd>選択中のシーズン・レギュラー/{postseasonLabel(season)}絞り込みの範囲内で、直近5試合／直近10試合を分けて集計します。</dd>
              <dt>会場</dt>
              <dd>ホーム開催／アウェイ開催の試合を分けて集計します。</dd>
              <dt>地区</dt>
              <dd>対戦相手の所属地区（東地区／西地区）別の成績です。シーズンごとの実際の地区分けを反映しています。</dd>
              <dt>曜日</dt>
              <dd>平日開催／休日開催（土日・祝日）の試合を分けて集計します。</dd>
              <dt>時期</dt>
              <dd>年明け（1月）を境に、シーズン前半・後半の試合を分けて集計します。</dd>
              <dt>月別</dt>
              <dd>開催月ごとの成績です。試合が無い月は表示されません。</dd>
              <dt>対戦相手の強さ</dt>
              <dd>
                その試合に入る時点での対戦相手の勝率（対5割未満／対5割以上／対6割以上）別の成績です。
                相手の消化試合数が5試合未満の対戦は、勝率が極端な値になりやすいため集計から除外しています。
              </dd>
              <dt>連戦</dt>
              <dd>中1日以内の間隔で連続して試合を行った場合の、1試合目（GAME1）／2試合目以降（GAME2）別の成績です。</dd>
              <dt>自チーム外国籍人数</dt>
              <dd>
                その試合で自チームが最も長くコートに立たせていた、外国籍・帰化選手・アジア特別枠選手の
                同時出場人数（0〜3人）別の成績です。
              </dd>
              <dt>相手チーム外国籍人数</dt>
              <dd>上記を相手チーム視点で見た成績です。</dd>
              <dt>対戦相手勝率</dt>
              <dd>
                その行に属する各試合について、対戦相手の「その試合時点までの」勝率を求め単純平均した値です
                （対戦相手の強さの目安。「対戦相手の勝率」フィルタと同じ計算）。
              </dd>
            </dl>
            )}
          </div>

          <h2
            className={isShotChartSupported(coverage) ? "collapsible-heading" : undefined}
            onClick={isShotChartSupported(coverage) ? () => setTeamShotChartExpanded((v) => !v) : undefined}
          >
            {isShotChartSupported(coverage) ? (teamShotChartExpanded ? "▼ " : "▶ ") : ""}
            ショットチャート
          </h2>
          {isShotChartSupported(coverage) && teamShotChartExpanded && <ConditionLine conditions={teamShotChartConditions} />}
          {isShotChartSupported(coverage) && teamShotChartExpanded && (
            <FilterBar axes={teamShotChartFilterAxes} stateKey={pk("teamShotChartFilterBar")} onClearAll={clearTeamShotChartFilters} />
          )}
          {!isShotChartSupported(coverage) ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : !teamShotChartExpanded ? null : statsRawGamesLoading ? (
            <p className="loading">読み込み中...</p>
          ) : (
            <>
              <div className="shot-chart-grid shot-chart-grid-single">
                <ShotChartPanel
                  teamName={team.teamName}
                  shortName={teamShortName(team.teamId, team.teamName)}
                  players={teamShotChartPlayerOptions}
                  shots={teamShotEvents}
                  color={accentColor ?? "var(--accent)"}
                  accentColor={accentColor}
                />
              </div>
              <p className="page-subtitle">
                チームの全選手が出場した各試合のショット位置の記録を合算したもの（2022-23シーズン以降のみ対応）。個別ショット/エリア別成功率の切り替え、選手セレクタでの個人絞り込みができる。上の絞り込み（試合種別・Q別/前後半・詳細フィルタ）に連動する
              </p>
            </>
          )}

        </div>
      )}

      {tab === "playerStats" && (
        <div className="team-tab-panel">
          {coverageLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !pbpSupported ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <>
              <FilterBar axes={playerStatsFilterAxes} stateKey={pk("playerStatsFilter")} onClearAll={clearPlayerStatsFilters} />
              {playerStatsRawGamesLoading && <p className="loading">この期間の再集計中...</p>}
              {playerStatsCandidatesLoading || !playerStatsRows ? (
                <p className="loading">読み込み中...</p>
              ) : (
                <>
                <ConditionTitle title={playerStatsTitle.title} conditions={playerStatsTitle.conditions} />
                <TeamPlayerStatsTable
                  rows={playerStatsRows}
                  displayMode={playerStatsDisplayMode}
                  activeTab={playerStatsBoxTab}
                  onTabChange={setPlayerStatsBoxTab}
                  teamYahooPbp={teamYahooPbp}
                  teamYahooPbpLoading={teamYahooPbpLoading}
                />
                {playerStatsRows.length > 0 && <HeightWeightNote players={players} />}
                {playerStatsBoxTab === "misc" && <RuleChangeFootnote seasons={[season]} />}
                </>
              )}
            </>
          )}

          {(avgHeightCm != null || avgWeightKg != null || avgAge != null) && (
            <>
              <h2>
                スタメン平均（先発出場経験のある選手
                {startingLineupComboCount != null && `・今シーズン${startingLineupComboCount}通りの組み合わせを起用`}）
              </h2>
              <div className="stat-grid">
                <StatTile label="平均身長" value={avgHeightCm != null ? `${formatDecimal(avgHeightCm)}cm` : "-"} />
                <StatTile label="平均体重" value={avgWeightKg != null ? `${formatDecimal(avgWeightKg)}kg` : "-"} />
                <StatTile label="平均年齢" value={avgAge != null ? `${formatDecimal(avgAge)}歳` : "-"} />
              </div>
              {(avgHeightCm != null || avgWeightKg != null) && <HeightWeightNote players={players} />}
              {avgAge != null && <p className="rule-change-footnote">※ {AGE_BASE_NOTE}</p>}
            </>
          )}

          <ConditionTitle
            section
            title="よく使われるラインナップ"
            conditions={composeLabels(seasonLabel, gameTypeLabels("both", season), `出場時間${MIN_LINEUP_SECONDS}秒以上`)}
          />
          {coverageLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !pbpSupported ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : topLineups.length === 0 ? (
            <p className="empty-message">
              {(lineupsFile?.lineups.length ?? 0) === 0
                ? "ラインナップデータがありません"
                : `出場時間${MIN_LINEUP_SECONDS}秒以上の組み合わせがまだありません（試合数が増えると表示されます）`}
            </p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="sortable-table">
                  <thead>
                    <tr>
                      <th className="align-left">5人の組み合わせ</th>
                      <th className="align-right" title={statDescription("試合数")}>試合数</th>
                      <th className="align-right" title={statDescription("出場時間")}>出場時間</th>
                      <th className="align-right" title={statDescription("得点")}>得点</th>
                      <th className="align-right" title={statDescription("失点")}>失点</th>
                      <th className="align-right" title={statDescription("得失点")}>得失点</th>
                      <th className="align-right" title={statDescription("ORtg（推定）")}>ORtg（推定）</th>
                      <th className="align-right" title={statDescription("DRtg（推定）")}>DRtg（推定）</th>
                      <th className="align-right" title={statDescription("NetRtg（推定）")}>NetRtg（推定）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedLineups.map((l) => (
                      <tr key={l.lineupKey}>
                        <td className="align-left">{l.playerIds.map((id) => playerNameById.get(id) ?? id).join(" / ")}</td>
                        <td className="align-right">{l.gamesPlayed}</td>
                        <td className="align-right">{formatDecimal(l.secondsPlayed / 60)}分</td>
                        <td className="align-right">{l.ownPoints}</td>
                        <td className="align-right">{l.oppPoints}</td>
                        <td className="align-right">{formatSigned(l.netPoints, 0)}</td>
                        <td className="align-right">{formatDecimal(l.estimatedOffRtg)}</td>
                        <td className="align-right">{formatDecimal(l.estimatedDefRtg)}</td>
                        <td className="align-right">{formatSigned(l.estimatedNetRtg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {eligibleLineups.length > MAX_LINEUP_ROWS && (
                <button className="load-more-button" type="button" onClick={() => setLineupsExpanded((v) => !v)}>
                  {lineupsExpanded ? `上位${MAX_LINEUP_ROWS}組のみ表示` : `全パターン表示（全${eligibleLineups.length}組）`}
                </button>
              )}
              <p className="page-subtitle">
                出場時間{MIN_LINEUP_SECONDS}秒未満の組み合わせは除外。ORtg/DRtg/Net
                Ratingはスティント単位の実ポゼッション数が無いため、チームのシーズン平均ペースから推定した参考値。
                試合数がまだ少ないため、いずれの数値もサンプルサイズが小さい点に留意
              </p>
            </>
          )}

          <ConditionTitle
            section
            title="アシスト経由の得点パターン"
            conditions={composeLabels(seasonLabel, gameTypeLabels("regular", null), periodLabels(undefined))}
          />
          {coverageLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !pbpSupported ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : !assistPairsDataReady ? (
            <p className="loading">読み込み中...</p>
          ) : teamAssistPairs.length === 0 ? (
            <p className="empty-message">アシスト経由の得点パターンがありません</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="sortable-table">
                  <thead>
                    <tr>
                      <th className="align-left">アシスト元選手</th>
                      <th className="align-left">得点選手</th>
                      <th className="align-right" title={statDescription("アシスト回数")}>アシスト回数</th>
                      <th className="align-right" title={statDescription("回数割合")}>回数割合</th>
                      <th className="align-right" title={statDescription("アシスト経由得点数")}>アシスト経由得点数</th>
                      <th className="align-right" title={statDescription("得点割合")}>得点割合</th>
                      <th className="align-right" title={statDescription("2P成功数")}>2P成功数</th>
                      <th className="align-right" title={statDescription("2P割合")}>2P割合</th>
                      <th className="align-right" title={statDescription("3P成功数")}>3P成功数</th>
                      <th className="align-right" title={statDescription("3P割合")}>3P割合</th>
                      <th className="align-right" title={statDescription("FT成功数")}>FT成功数</th>
                      <th className="align-right" title={statDescription("FT割合")}>FT割合</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayedAssistPairs.map((p) => {
                      const points = p.assisted2m * 2 + p.assisted3m * 3 + p.assistedFtm;
                      const scorerTotal = teamAssistScorerTotals.get(p.scorerId);
                      const countSharePct = scorerTotal && scorerTotal.count > 0 ? (100 * p.count) / scorerTotal.count : null;
                      const pointsSharePct = scorerTotal && scorerTotal.points > 0 ? (100 * points) / scorerTotal.points : null;
                      return (
                        <tr key={`${p.assisterId}:${p.scorerId}`}>
                          <td className="align-left">{playerLabel(playerNameById.get(p.assisterId) ?? p.assisterId)}</td>
                          <td className="align-left">{playerLabel(playerNameById.get(p.scorerId) ?? p.scorerId)}</td>
                          <td className="align-right">{p.count}</td>
                          <td className="align-right">{countSharePct != null ? formatPct100(countSharePct) : "-"}</td>
                          <td className="align-right">{points}</td>
                          <td className="align-right">{pointsSharePct != null ? formatPct100(pointsSharePct) : "-"}</td>
                          <td className="align-right">{p.assisted2m}</td>
                          <td className="align-right">{formatPct100((100 * p.assisted2m) / p.count)}</td>
                          <td className="align-right">{p.assisted3m}</td>
                          <td className="align-right">{formatPct100((100 * p.assisted3m) / p.count)}</td>
                          <td className="align-right">{p.assistedFtm}</td>
                          <td className="align-right">{formatPct100((100 * p.assistedFtm) / p.count)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {teamAssistPairs.length > MAX_ASSIST_PAIR_ROWS && (
                <button className="load-more-button" type="button" onClick={() => setAssistPairsExpanded((v) => !v)}>
                  {assistPairsExpanded
                    ? `上位${MAX_ASSIST_PAIR_ROWS}パターンのみ表示`
                    : `全パターン表示（全${teamAssistPairs.length}パターン）`}
                </button>
              )}
              <p className="page-subtitle">
                レギュラーシーズンの全試合のプレーバイプレー（試合経過の記録）から、アシスト元選手→得点選手のペア単位で集計。
                「2P割合」「3P割合」「FT割合」はそのペアのアシスト回数に対する2P/3P/FTそれぞれの成功数の割合。
                「回数割合」「得点割合」は、得点選手が受けた全アシスト回数・全アシスト経由得点のうち、そのアシスト元選手からの割合
              </p>
            </>
          )}
        </div>
      )}

      {tab === "compare" && (
        <div className="team-tab-panel">
          <div className="player-compare-slots">
            {([0, 1] as const).map((i) => {
              const slot = compareSlots[i];
              const updateSlot = (patch: Partial<TeamCompareSlotState>) =>
                setCompareSlots((prev) => {
                  const next: [TeamCompareSlotState, TeamCompareSlotState] = [...prev];
                  next[i] = { ...next[i], ...patch };
                  return next;
                });
              return (
                <div className="player-compare-slot" key={i}>
                  <CompareSlotFilter
                    stateKey={pk(`compareSlot${i}`)}
                    selects={[
                      {
                        id: "target",
                        label: "対象",
                        value: slot.league ? "league" : "team",
                        options: [
                          { value: "team", label: teamLabel(team.teamId, team.teamName) },
                          { value: "league", label: LEAGUE_TEAM_NAME },
                        ],
                        onChange: (v) => updateSlot({ league: v === "league", filter: { range: { kind: "all" } } }),
                      },
                      {
                        id: "season",
                        label: "シーズン",
                        value: slot.season,
                        options: [
                          { value: "", label: "未選択" },
                          ...[...(careerData ?? [])]
                            .map((cd) => cd.season)
                            .reverse()
                            .map((s) => ({ value: s, label: `${s}シーズン` })),
                        ],
                        onChange: (nextSeason) => updateSlot({ season: nextSeason, filter: { range: { kind: "all" } } }),
                      },
                    ]}
                    enabled={!!slot.season}
                    disabledNote="シーズンを選択してください"
                    filter={slot.filter}
                    onFilter={(f) => updateSlot({ filter: f })}
                    opponentWinRateSupported={!!compareOpponentRecords[i]}
                    ownTeamDivisionSupported={!!divisionHistory}
                    {...(slot.league ? { situationalDisabledNote: LEAGUE_SLOT_NOTE } : {})}
                  />
                </div>
              );
            })}
          </div>
          <FilterBar
            simple
            stateKey={pk("compareCommon")}
            axes={[
              gameTypeAxis(compareGameType, setCompareGameType, null),
              perspectiveAxis(comparePerspective, setComparePerspective),
            ]}
          />
          <div className="tab-bar">
            {BOXSCORE_TABS.map((t) => (
              <button
                key={t.key}
                className={`tab-button${compareTab === t.key ? " active" : ""}`}
                onClick={() => setCompareTab(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>
          {compareSlotDescriptions.length > 0 && (
            <ConditionTitle title={compareTitle.title} conditions={compareTitle.conditions} />
          )}
          {compareDataLoading && <p className="loading">データ取得中...</p>}
          {careerLoading && !careerData ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : (
            <ComparisonTable
              statScope="team"
              rows={compareRows}
              defs={teamCompareDefs(compareTab, comparePerspective)}
              rowKey={(r) => r.key}
              name={(r) => r.label}
              linkTo={(r) => (r.isLeague ? undefined : `/teams/${teamId}`)}
              teamColor={(r) => (r.isLeague ? LEAGUE_COLOR : accentColor)}
            />
          )}
          {compareTab === "misc" && (
            <RuleChangeFootnote seasons={compareSlots.map((slot) => slot.season).filter((s): s is string => !!s)} />
          )}
          <p className="page-subtitle">
            各列は「日程結果」タブと同じボックススコア列定義（自チーム/opp/+/-切り替え可）を、選択中のシチュエーション別フィルタで絞り込んだ試合の1試合あたり平均値として算出する
          </p>
        </div>
      )}
    </div>
    </PlayerNamePool>
  );
}

function TeamScheduleRowView({
  row,
  perspective,
  columns,
  boxTotals,
}: {
  row: TeamScheduleRow;
  perspective: TeamPerspective;
  columns: BoxscoreColumn[];
  boxTotals: TeamGameBoxTotals | null;
}) {
  const linkTo = row.status === "upcoming" ? undefined : `/games/${row.scheduleKey}`;
  return (
    <tr className={`schedule-row status-${row.status}`}>
      <td className="align-left">{linkTo ? <Link to={linkTo} className="cell-link">{row.date}</Link> : row.date}</td>
      <td className="align-left">
        <MaybeLink to={linkTo}>
          {row.isHome ? "vs" : "@"}{" "}
          {row.opponentTeamId ? <ResponsiveTeamName teamId={row.opponentTeamId} name={row.opponentName} /> : row.opponentName}
          {row.gameType === "playoff" && <span className="playoff-badge">PO</span>}
        </MaybeLink>
      </td>
      <td className="align-right">
        <MaybeLink to={linkTo}>
          {row.status === "final" && (
            <span className={`result-badge ${(row.teamScore ?? 0) > (row.opponentScore ?? 0) ? "win" : "loss"}`}>
              {row.teamScore}-{row.opponentScore}
            </span>
          )}
          {row.status === "live" && <span className="live-badge">進行中</span>}
          {row.status === "upcoming" && <span className="upcoming-badge">予定</span>}
        </MaybeLink>
      </td>
      {columns.map((col) => (
        <td key={col.key} className="align-right">
          {!boxTotals
            ? "-"
            : perspective === "own"
              ? col.format(boxTotals.own, boxTotals.ownCtx)
              : perspective === "opp"
                ? col.format(boxTotals.opp, boxTotals.oppCtx)
                : formatColumnDiff(col, boxTotals.own, boxTotals.ownCtx, boxTotals.opp, boxTotals.oppCtx)}
        </td>
      ))}
      <td className="align-left">{row.venue ?? "-"}</td>
    </tr>
  );
}

function MaybeLink({ to, children }: { to?: string; children: ReactNode }) {
  return to ? (
    <Link to={to} className="cell-link">
      {children}
    </Link>
  ) : (
    <>{children}</>
  );
}

function StatTile({ label, value, rank }: { label: string; value: string; rank?: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {rank && <div className="rank">{rank}</div>}
    </div>
  );
}

/**
 * 「クラブレコード」タブの1試合記録カード。個人詳細ページのCareerHighCardと同じ方式
 * （同値タイの試合が複数ある場合、代表試合〔最新〕を主表示にし、残りを「他◯試合」で展開する）。
 * `topEntries`が渡された場合（クラブレコード・クラブワースト・被記録の全て、Batch 3・
 * 2026-09-16にクラブレコード以外へも拡大）、項目名自体をクリックするとトップ◯（同値タイの
 * 末尾は全員含む。件数は呼び出し側が決める。TOV・失点等「多い方が悪い」項目のワースト側は
 * トップ5、それ以外はトップ10）が別途展開できる。デフォルトは非表示
 */
function ClubRecordCard({
  tieKey,
  label,
  display,
  game,
  otherGames,
  rank,
  expandedKeys,
  onToggle,
  topEntries = [],
  format,
  topNExpandedKeys,
  onToggleTopN,
}: {
  tieKey: string;
  label: string;
  display: string;
  game: TeamRecordGame;
  otherGames: TeamRecordGame[];
  /** 歴代クラブ横断順位（Phase H7）。「◯位/◯チーム」形式。未算出（league-team-rankings.json
   * 未生成、またはクラブワースト等の非対象項目）の場合は表示しない */
  rank?: string;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
  topEntries?: TopRecordEntry<TeamRecordGame>[];
  format?: (v: number) => string;
  topNExpandedKeys?: Set<string>;
  onToggleTopN?: (key: string) => void;
}) {
  const expanded = expandedKeys.has(tieKey);
  const topNExpanded = topNExpandedKeys?.has(tieKey) ?? false;
  const topNAvailable = topEntries.length > 1 && !!onToggleTopN;
  return (
    <div className="career-high-card">
      {topNAvailable ? (
        <button
          type="button"
          className="career-high-label career-high-label-clickable"
          onClick={() => onToggleTopN(tieKey)}
        >
          {label}
          {topNExpanded ? " ▲" : " ▼"}
        </button>
      ) : (
        <div className="career-high-label">{label}</div>
      )}
      <div className="career-high-value">{display}</div>
      {rank && <div className="career-high-rank">{rank}</div>}
      <RouterLink to={`/games/${game.scheduleKey}?season=${game.season}`} className="career-high-game-link">
        {game.date}　{game.isHome ? "vs" : "@"}
        <ResponsiveTeamName teamId={game.opponentTeamId} name={game.opponentTeamName} always />
      </RouterLink>
      {otherGames.length > 0 && (
        <>
          <button type="button" className="career-high-others-toggle" onClick={() => onToggle(tieKey)}>
            {expanded ? "閉じる" : `他${otherGames.length}試合`}
          </button>
          {expanded && (
            <ul className="career-high-others-list">
              {otherGames.map((g) => (
                <li key={g.scheduleKey}>
                  <RouterLink to={`/games/${g.scheduleKey}?season=${g.season}`} className="career-high-game-link">
                    {g.date}　{g.isHome ? "vs" : "@"}
                    <ResponsiveTeamName teamId={g.opponentTeamId} name={g.opponentTeamName} always />
                  </RouterLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {topNAvailable && topNExpanded && (
        <table className="career-top-n-table">
          <tbody>
            {topEntries.map((e) => (
              <tr key={`${e.rank}-${e.game.scheduleKey}`}>
                <td>{e.rank}</td>
                <td>{format ? format(e.value) : String(e.value)}</td>
                <td>
                  <RouterLink to={`/games/${e.game.scheduleKey}?season=${e.game.season}`} className="career-high-game-link">
                    {e.game.date}　{e.game.isHome ? "vs" : "@"}
                    <ResponsiveTeamName teamId={e.game.opponentTeamId} name={e.game.opponentTeamName} always />
                  </RouterLink>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * 「クラブレコード」タブのシーズン単位記録カード（最多勝利数・最多連勝）。ClubRecordCardと同じ
 * タイ表示方式だが、試合ではなくシーズン単位（同値タイの他シーズンを展開）で扱う
 */
function SeasonRecordCard({
  teamId,
  tieKey,
  label,
  display,
  season,
  otherSeasons,
  rank,
  expandedKeys,
  onToggle,
}: {
  teamId: string;
  tieKey: string;
  label: string;
  display: string;
  season: string;
  otherSeasons: string[];
  /** 歴代クラブ横断順位（Phase H7）。「◯位/◯チーム」形式 */
  rank?: string;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const expanded = expandedKeys.has(tieKey);
  return (
    <div className="career-high-card">
      <div className="career-high-label">{label}</div>
      <div className="career-high-value">{display}</div>
      {rank && <div className="career-high-rank">{rank}</div>}
      <RouterLink to={`/teams/${teamId}?season=${season}`} className="career-high-game-link">
        {season}シーズン
      </RouterLink>
      {otherSeasons.length > 0 && (
        <>
          <button type="button" className="career-high-others-toggle" onClick={() => onToggle(tieKey)}>
            {expanded ? "閉じる" : `他${otherSeasons.length}シーズン`}
          </button>
          {expanded && (
            <ul className="career-high-others-list">
              {otherSeasons.map((s) => (
                <li key={s}>
                  <RouterLink to={`/teams/${teamId}?season=${s}`} className="career-high-game-link">
                    {s}シーズン
                  </RouterLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface PlayerStatsCandidate {
  playerId: string;
  logs: PlayerGameLog[];
  ownTeamByScheduleKey: Map<string, GameTeamInfo>;
}

interface TeamPlayerStatsRow {
  player: PlayerSummary;
  ctx: SeasonBoxscoreCtx;
  ddtd: { dd: number; td: number };
  /** シューティングタブ用: この行（選手×このチーム在籍分）に属する試合ログ */
  logs: PlayerGameLog[];
}

/**
 * 「選手スタッツ」タブ: 選択中シーズンに一度でもこのチームでプレーした選手の一覧
 * （シーズン内移籍選手は移籍前後どちらのチームでも、そのチーム在籍分のみのスタッツで表示する。
 * 集計自体は個人詳細ページ「シーズン別成績」と同じbuildTeamSplitRowsForPeriodを再利用し、
 * 対象チームの行だけを抽出している。呼び出し元のfetch・行構築ロジック参照）。カテゴリタブ切り替え・
 * 列ヘッダーソートは個人詳細ページのSeasonBreakdownTableと同じ方式を踏襲する。
 * レギュラー/プレーオフ/合算・Q別/前後半・表示は親のFilterBarで選ぶ
 */
function TeamPlayerStatsTable({
  rows,
  displayMode,
  activeTab: controlledActiveTab,
  onTabChange,
  teamYahooPbp,
  teamYahooPbpLoading,
}: {
  rows: TeamPlayerStatsRow[];
  /** 試合種別・表示・Q別/前後半・S軸は親のFilterBarで選ぶ（このコンポーネントは表示モードを読むだけ） */
  displayMode: SeasonDisplayMode;
  /** カテゴリタブ（シューティングを含む）を外部から制御する（BoxscoreTable.tsxのactiveTab/
   * onTabChangeと同じパターン。DESIGN.md参照）。シューティングタブ選択時のteamYahooPbp遅延取得を
   * 親コンポーネント側でトリガーする必要があるため */
  activeTab?: SeasonBoxTabKey | "shooting";
  onTabChange?: (tab: SeasonBoxTabKey | "shooting") => void;
  teamYahooPbp: Map<string, YahooGamePbp>;
  teamYahooPbpLoading: boolean;
}) {
  const [internalTab, setInternalTab] = useState<SeasonBoxTabKey | "shooting">("traditional");
  const tab = controlledActiveTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const columns = tab === "shooting" ? [] : SEASON_BOX_COLUMNS[tab];

  // シューティングタブ: 各行（選手×このチーム在籍分）に属する試合のscheduleKeyから
  // teamYahooPbpのショットを引いてShotTypeBreakdownを組み立てる
  const shotBreakdownByPlayerId = new Map<string, ShotTypeBreakdown>();
  if (tab === "shooting") {
    for (const r of rows) {
      const shots = r.logs
        .flatMap((l) => teamYahooPbp.get(l.scheduleKey)?.shots ?? [])
        .filter((s) => s.playerId === r.player.playerId);
      shotBreakdownByPlayerId.set(r.player.playerId, buildShotTypeBreakdown(shots));
    }
  }
  const shotTypeKeys =
    tab === "shooting"
      ? sortShotTypeKeys([...new Set([...shotBreakdownByPlayerId.values()].flatMap((b) => Object.keys(b)))])
      : [];
  const shotColumns = shotTypeEntityColumns<TeamPlayerStatsRow>(
    shotTypeKeys,
    (r) => shotBreakdownByPlayerId.get(r.player.playerId),
    displayMode === "total" ? "total" : "perGame",
    (r) => r.ctx.raw.gamesPlayed,
  );

  const rowSortValue = (r: TeamPlayerStatsRow, key: string): number | string => {
    switch (key) {
      case "player":
        return r.player.name;
      case "dd2":
        return r.ddtd.dd;
      case "td3":
        return r.ddtd.td;
      default: {
        if (tab === "shooting") {
          const col = shotColumns.find((c) => c.key === key);
          return col ? col.sortValue(r) : 0;
        }
        const col = columns.find((c) => c.key === key);
        return col ? col.value(r.ctx, displayMode) : 0;
      }
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = rowSortValue(a, sortKey);
      const bv = rowSortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir, columns, displayMode, tab, shotColumns, shotBreakdownByPlayerId]);

  const handleHeaderClick = (key: string) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const sortIndicator = (key: string) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const sortAria = (key: string) => (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined);

  return (
    <>
      {rows.length === 0 ? (
        <p className="empty-message">選手スタッツがありません</p>
      ) : (
        <>
          <div className="tab-bar">
            {SEASON_BOX_TABS.map((t) => (
              <button key={t.key} className={`tab-button${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)} type="button">
                {t.label}
              </button>
            ))}
            <button
              className={`tab-button${tab === "shooting" ? " active" : ""}`}
              onClick={() => setTab("shooting")}
              title={TEAM_SHOOTING_TAB_TOOLTIP}
              type="button"
            >
              {CATEGORY_LABELS.shooting}
            </button>
          </div>
          {tab === "shooting" && teamYahooPbpLoading ? (
            <p className="loading">読み込み中...</p>
          ) : tab === "shooting" && shotTypeKeys.length === 0 ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left sortable-col" onClick={() => handleHeaderClick("player")} aria-sort={sortAria("player")}>
                      選手{sortIndicator("player")}
                    </th>
                    {(tab === "shooting" ? shotColumns : columns).map((col) => (
                      <th
                        key={col.key}
                        className="align-right sortable-col"
                        title={statDescription(col.label)}
                        onClick={() => handleHeaderClick(col.key)}
                        aria-sort={sortAria(col.key)}
                      >
                        {col.label}
                        {sortIndicator(col.key)}
                      </th>
                    ))}
                    <th className="align-right sortable-col" title={statDescription("DD2")} onClick={() => handleHeaderClick("dd2")} aria-sort={sortAria("dd2")}>
                      DD2{sortIndicator("dd2")}
                    </th>
                    <th className="align-right sortable-col" title={statDescription("TD3")} onClick={() => handleHeaderClick("td3")} aria-sort={sortAria("td3")}>
                      TD3{sortIndicator("td3")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr key={r.player.playerId}>
                      <td className="align-left">
                        <Link to={`/players/${r.player.playerId}`} className="cell-link">
                          <div className="player-cell">
                            <PlayerPhoto playerId={r.player.playerId} size={32} className="player-cell-photo" />
                            <div className="player-cell-info">
                              <div className="player-cell-name">
                                <ResponsivePlayerName name={r.player.name} />
                              </div>
                              {playerProfileLine(r.player) && <div className="player-cell-profile">{playerProfileLine(r.player)}</div>}
                            </div>
                          </div>
                        </Link>
                      </td>
                      {tab === "shooting"
                        ? shotColumns.map((col) => (
                            <td key={col.key} className="align-right">
                              {col.format!(r)}
                            </td>
                          ))
                        : columns.map((col) => (
                            <td key={col.key} className="align-right">
                              {col.format(r.ctx, displayMode)}
                            </td>
                          ))}
                      <td className="align-right">{r.ddtd.dd}</td>
                      <td className="align-right">{r.ddtd.td}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
