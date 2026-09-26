import { useEffect, useMemo, useState, type ReactNode } from "react";
import { postseasonLabel } from "../../shared/gameType";
import { PERIOD_KEYS, PERIOD_LABELS, PERIOD_RECORD_KINDS, periodRecordStatKey } from "../../shared/teamPeriodRecords";
import { teamShortName } from "../../shared/teamNames";
import { useMediaQuery } from "../lib/useMediaQuery";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  fetchClubHonors,
  fetchDivisionHistory,
  fetchTeamHistory,
  fetchGameSummaries,
  fetchLeagueAverage,
  fetchLeagueTeamRankings,
  fetchSeasonRules,
  fetchSeasons,
  fetchTeamGameLogs,
  fetchTeams,
} from "../lib/data";
import { LEAGUE_TEAM_ID, LEAGUE_TEAM_NAME, averageTotals } from "../lib/leagueAverage";
import { useJsonData } from "../lib/useJsonData";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  ClubHonor,
  ClubHonorsFile,
  DivisionHistoryFile,
  GameSummary,
  LeagueRecordEntry,
  LeagueTeamRankEntry,
  LeagueTeamRankingsFile,
  SeasonRules,
  TeamForcedTurnovers,
  TeamGameLog,
  TeamSummary,
} from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { TeamLogo } from "../components/TeamLogo";
import { SeasonLink } from "../components/SeasonLink";
import { FilterBar } from "../components/FilterBar";
import { ConditionTitle } from "../components/ConditionTitle";
import { LeagueSeasonRecords } from "../components/LeagueSeasonRecords";
import { FGA_ORDER_LABELS, FgaCompositionChart, type FgaChartTeam, type FgaShareOrder } from "../components/FgaCompositionChart";
import { fgaShare } from "../lib/shareCharts";
import {
  displayModeAxis,
  gameTypeAxis,
  leagueVenueAxis,
  perspectiveAxis,
  simpleSelectAxis,
  situationalAxes,
  statItemAxis,
  type FilterAxis,
} from "../lib/filterAxes";
import { RuleChangeFootnote } from "../components/RuleChangeFootnote";
import {
  composeLabels,
  displayModeLabels,
  gameTypeLabels,
  leagueVenueLabels,
  perspectiveLabels,
  SEASON_TOTAL_ONLY_LABELS,
  situationalFilterLabels,
  type LeagueVenue,
} from "../lib/conditionLabels";
import {
  buildRecordsBeforeGame,
  computeOpponentWinPctAvg,
  filterGameLogs,
  type RecordBeforeGame,
  type SituationalFilter,
} from "../lib/situational";
import {
  filterByGameType,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "../lib/playerSeasonBoxscore";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import {
  FOREIGN_COURT_ORDER_LABELS,
  ForeignPlayerCourtTimeChart,
  type ForeignCourtOrder,
} from "../components/ForeignPlayerCourtTimeChart";
import { usePageState } from "../lib/pageStateCache";
import { SCORING_ORDER_LABELS, ScoringCompositionChart, type PointsShareOrder } from "../components/ScoringCompositionChart";
import {
  CLASSIFICATION_ORDER_LABELS,
  ClassificationCompositionChart,
  type ClassificationShareOrder,
} from "../components/ClassificationCompositionChart";
import { formatDecimal, formatPct, formatPct100, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { efgPct, ftRate, offensiveRating, orbPct, pace, safeDiv, tovPct, tsPct } from "../../shared/formulas";
import { shotTypeEntityColumns, sortShotTypeKeys } from "../lib/shotTypeBreakdown";
import {
  CAREER_TOTAL_DEFS,
  TEAM_RECORD_STATS,
  currentStreak,
  formatTeamStreak,
  type TeamStreak,
} from "../../shared/teamRecords";
import { ONE_TEAM_DIVISIONS, TEAM_DIVISIONS, TEAM_NAMES } from "../../scripts/lib/divisions";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  DEFAULT_SORT_KEY,
  sumTeamGameLogs,
  type AllTeamsRow,
  type TeamPerspective,
} from "../lib/teamStatsColumns";
import { statDescription } from "../lib/statDescriptions";
import { useAllTeamGameLogs, useLeagueSituationalContext } from "../lib/teamRankingData";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { teamNameInSeason, useNarrow, useTeamLabel, useTeamText } from "../lib/teamLabel";

type TeamsPageTab = "stats" | "records" | "champions" | "recent";

// 「チーム」ページのタブ構成。「全チームスタッツ」は元々の「一覧」（ロゴ＋シーズン成績の表）を
// 統合したもの（各行の先頭にロゴ・試合数・勝敗・勝率を置き、その後ろにトラディショナル/
// アドバンスド/Misc/スコアリングの項目を続ける、チーム詳細ページ「シーズン別成績」と同じ
// 載せ方）。「歴代記録」はdata/league-team-rankings.json（Phase H7）を使った過去在籍全クラブ
// 横断のランキング、「歴代王者」はdata/club-honors.jsonを使ったシーズン軸の年間王者年表、
// 「直近成績」は現行26クラブを対象に直近5/10試合の成績・ORtg/DRtg/NetRtg・現在の連勝/連敗で
// 順位付けする。
// タブ切り替え自体はURLに同期しない（TeamDetailPage.tsxのタブと同じ、プレーンなuseStateの
// パターンを踏襲）が、旧/teams/statsへのリンクから遷移してきた場合のみ、Navigateのstateで
// 初期タブを「全チームスタッツ」に指定する（下記TeamsStatsRedirect参照）
export function TeamsListPage({ season }: { season: string }) {
  const location = useLocation();
  const initialTab = (location.state as { tab?: TeamsPageTab } | null)?.tab ?? "stats";
  const [tab, setTab] = useState<TeamsPageTab>(initialTab);

  return (
    <div data-design="v2">
      <h1>チーム</h1>
      <p className="page-subtitle">{season}シーズン</p>
      <div className="tab-bar">
        <button
          className={`tab-button${tab === "stats" ? " active" : ""}`}
          onClick={() => setTab("stats")}
          type="button"
        >
          全チームスタッツ
        </button>
        <button
          className={`tab-button${tab === "records" ? " active" : ""}`}
          onClick={() => setTab("records")}
          type="button"
        >
          記録
        </button>
        <button
          className={`tab-button${tab === "champions" ? " active" : ""}`}
          onClick={() => setTab("champions")}
          type="button"
        >
          歴代王者
        </button>
        <button
          className={`tab-button${tab === "recent" ? " active" : ""}`}
          onClick={() => setTab("recent")}
          type="button"
        >
          直近成績
        </button>
      </div>
      {tab === "stats" ? (
        <AllTeamsStatsTab season={season} />
      ) : tab === "records" ? (
        <RecordsTab season={season} />
      ) : tab === "champions" ? (
        <ChampionsTab />
      ) : (
        <RecentFormTab season={season} />
      )}
    </div>
  );
}

// 旧/teams/statsへの既存リンク・ブックマークが壊れないようにするリダイレクト用ルート。
// ?season=等の既存クエリはそのまま引き継ぎ、Navigateのstateで「全チームスタッツ」タブを
// 初期表示するよう指定する
export function TeamsStatsRedirect() {
  const location = useLocation();
  return <Navigate to={`/teams${location.search}`} replace state={{ tab: "stats" satisfies TeamsPageTab }} />;
}

// 全26チーム分の「チームスタッツ」一覧タブ。元の「一覧」タブを統合し（各行の先頭にロゴ・
// 試合数・勝敗・勝率を置く、チーム詳細ページ「シーズン別成績」と同じ載せ方）、チーム詳細
// ページ「チームスタッツ」タブと同じ項目（トラディショナル/アドバンスド/Misc/スコアリング、
// 平均/合計、レギュラー/プレーオフ/合算、自チーム/opp/+/-）を全チーム横並びの表に展開する。
// ただし詳細ページのタブは試合の生データ（PlayByPlays込み）を使って正確な値を出しているのに
// 対し、26チーム分を毎回その方式で再集計すると通信量が26倍近くに膨らみ実用的でないため、
// こちらはteam-games/{teamId}.json（TeamGameLog、既に集計済みの軽量な試合ログ。相手チームの
// カウント統計も含む）だけで完結する項目に絞っている。BSR（被ブロック）・EFF（貢献度）・
// AND1・UFOUL/DQFOUL・被アシスト内訳・LIVETOV/DEADTOV・ペイント内外分割等、生データが無いと
// 算出できない項目はこの一覧には含めていない（DESIGN.md参照、既知の制約）。自チーム/opp/+/-
// トグルはチーム詳細ページ「チームスタッツ」タブと同じ3値の切り替えUIを再利用しつつ、値は
// この軽量な試合ログ（相手チームのカウント統計は既に持っている）から own-opp/own/oppを
// 計算する形にした（生データベースのbuildTeamMultiGameBoxTotalsを26チーム分呼ぶのは
// 上記と同じ理由で採用しない）
const BOX_TABS = BOXSCORE_TABS;

/** 「全チームスタッツ」タブの各カテゴリ（BOXSCORE_TABS＋専用ビュー）の表示名。タイトルに使う */
const TEAMS_STATS_CATEGORY_LABELS: Record<string, string> = CATEGORY_LABELS;

/** 強制ターンオーバーの視点トグル（ボタン表示とタイトルで共通） */
const TURNOVER_PERSPECTIVE_LABELS: Record<"forced" | "committed", string> = {
  forced: "相手から奪った（自チームが強制）",
  committed: "自チームが記録（相手に強制された）",
};

const teamColumn: Column<AllTeamsRow> = {
  key: "team",
  label: "チーム",
  align: "left",
  sortValue: (r) => r.team.teamName,
  render: (r) => (
    <span className="team-name-cell">
      {r.team.teamId !== LEAGUE_TEAM_ID && <TeamLogo teamId={r.team.teamId} size={20} />}
      <ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} />
    </span>
  ),
};

// リーグ平均の行（DESIGN.md 149章）は試合数・勝敗・勝率を出さない
const gamesColumn: Column<AllTeamsRow> = {
  key: "g",
  label: "G",
  sortValue: (r) => r.gamesPlayed,
  format: (r) => (r.team.teamId === LEAGUE_TEAM_ID ? "-" : String(r.gamesPlayed)),
};

const recordColumn: Column<AllTeamsRow> = {
  key: "record",
  label: "勝敗",
  sortValue: (r) => r.wins - r.losses,
  format: (r) => (r.team.teamId === LEAGUE_TEAM_ID ? "-" : formatRecord(r.wins, r.losses)),
};

const winPctColumn: Column<AllTeamsRow> = {
  key: "winPct",
  label: "勝率",
  sortValue: (r) => safeDiv(r.wins, r.wins + r.losses),
  format: (r) => (r.team.teamId === LEAGUE_TEAM_ID ? "-" : formatWinPct(safeDiv(r.wins, r.wins + r.losses))),
};

// 各行の先頭にロゴ・試合数・勝敗・勝率を置く（チーム詳細ページ「シーズン別成績」と同じ載せ方）
const LEADING_COLUMNS: Column<AllTeamsRow>[] = [teamColumn, gamesColumn, recordColumn, winPctColumn];

// 「シューティング（シュートタイプ別）」一覧用の行。TeamSummary.shotTypesをそのまま使う。
// 各シュートタイプを2P/3P別・成功数/試投数/成功率の6列に分けて表示する
// （個人詳細ページ・チーム詳細ページの内訳表示、ボックススコアのFG/2P/3P/FT分離と同じパターン）
interface ShootingRow {
  team: TeamSummary;
}

interface TurnoverRow {
  team: TeamSummary;
  data: TeamForcedTurnovers;
}

function turnoverTotal(data: TeamForcedTurnovers): number {
  return (
    data.offensiveFoul +
    data.violation24sec +
    data.backcourtViolation +
    data.violation5sec +
    data.violation8sec +
    data.otherDead +
    data.live
  );
}

function AllTeamsStatsTab({ season }: { season: string }) {
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const { supported: yahooPbpSupported } = useYahooPbpCoverage(season);
  // ペイント内外の内訳は、プレーバイプレーの公式の区分で数えるため全シーズンで出る（2026-09-26。DESIGN.md 155章）
  const paintSupported = true;

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, teams);
  // リーグ平均（data/{season}/league-average.json。シュートタイプ・強制TOV・棒グラフで使う。DESIGN.md 149章）
  const { data: leagueAverage } = useJsonData(() => fetchLeagueAverage(season).catch(() => null), [season]);
  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season);

  const [boxTab, setBoxTab] = useState<
    BoxscoreTabKey | "shooting" | "forcedTurnovers" | "foreignPlayers" | "scoringComposition"
  >("traditional");
  const [displayMode, setDisplayMode] = useState<SeasonDisplayMode>("perGame");
  const [gameType, setGameType] = useState<SeasonGameTypeFilter>("regular");
  const [filter, setFilter] = useState<SituationalFilter>({ range: { kind: "all" } });
  const [teamPerspective, setTeamPerspective] = useState<TeamPerspective>("own");
  const [turnoverPerspective, setTurnoverPerspective] = useState<"forced" | "committed">("forced");
  // On-Court Foreignの並び順（DESIGN.md 135章）。ブラウザバックで戻ったときも保持する（usePageState、シーズンをまたいで共通）
  const [storedForeignOrder, setForeignOrder] = usePageState<ForeignCourtOrder>("teams:foreignOrder", "foreignDesc");
  // 選択肢の変更（2026-09-25）より前に保持した値（foreignAsc）が残っていても、初期値に戻して扱う
  const foreignOrder: ForeignCourtOrder = storedForeignOrder in FOREIGN_COURT_ORDER_LABELS ? storedForeignOrder : "foreignDesc";
  // Scoring %（得点構成・得点構成（登録区分））の並び順（DESIGN.md 141章）。On-Court Foreign と同じく「並び順」の選択肢で選び、
  // ブラウザバックで戻ったときも保持する。得点構成と失点構成は同じ並び順を使う（失点構成の「得点（失点）が多い順」は失点が多い順）
  const [storedScoringOrder, setScoringOrder] = usePageState<PointsShareOrder>("teams:scoringOrder", "total");
  const scoringOrder: PointsShareOrder = storedScoringOrder in SCORING_ORDER_LABELS ? storedScoringOrder : "total";
  // FG試投構成の並び順（2026-09-27）。FG試投構成と opp FG試投構成は同じ並び順を使う
  const [storedFgaOrder, setFgaOrder] = usePageState<FgaShareOrder>("teams:fgaOrder", "total");
  const fgaOrder: FgaShareOrder = storedFgaOrder in FGA_ORDER_LABELS ? storedFgaOrder : "total";
  const [storedClassificationOrder, setClassificationOrder] = usePageState<ClassificationShareOrder>("teams:classificationOrder", "total");
  const classificationOrder: ClassificationShareOrder =
    storedClassificationOrder in CLASSIFICATION_ORDER_LABELS ? storedClassificationOrder : "total";
  // 並べ替えで規定上ありえない人数の区分を飛ばすため、シーズンごとのオンザコートの規定を読む
  const { data: foreignRules } = useJsonData(() => (boxTab === "foreignPlayers" ? fetchSeasonRules() : Promise.resolve(null)), [boxTab]);

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const logs = gameLogsByTeam.get(team.teamId) ?? [];
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => team.teamId);
      const scoped = filterByGameType(situational, gameType);
      const wins = scoped.filter((g) => g.win).length;
      return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals: sumTeamGameLogs(scoped) };
    });
  }, [teams, gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season]);

  // リーグ平均の行（DESIGN.md 149章）。選択中の条件で絞った全チームの合計から出す（割合は合計÷合計、1試合平均は合計÷延べ試合数）。
  // カウント系はチーム数で割り、「合計」表示では平均的な1チームの合計にする。自チームの視点のときだけ出す（opp・+/-では出さない）
  const leagueRow: AllTeamsRow | null = useMemo(() => {
    const played = rows.filter((r) => r.gamesPlayed > 0);
    if (played.length === 0) return null;
    return {
      team: { teamId: LEAGUE_TEAM_ID, teamName: LEAGUE_TEAM_NAME },
      gamesPlayed: played.reduce((sum, r) => sum + r.gamesPlayed, 0) / played.length,
      wins: 0,
      losses: 0,
      totals: averageTotals(played.map((r) => r.totals)),
    };
  }, [rows]);

  const columns = useMemo(() => {
    switch (boxTab) {
      case "traditional":
        return [...LEADING_COLUMNS, ...buildTraditionalColumns(displayMode, teamPerspective)];
      case "advanced":
        return [...LEADING_COLUMNS, ...buildAdvancedColumns(displayMode, teamPerspective)];
      case "misc":
        return [...LEADING_COLUMNS, ...buildMiscColumns(displayMode, teamPerspective)];
      case "scoring":
        return [...LEADING_COLUMNS, ...buildScoringColumns(displayMode, teamPerspective, paintSupported)];
      case "shooting":
      case "forcedTurnovers":
      case "foreignPlayers":
      case "scoringComposition":
        return [];
    }
  }, [boxTab, displayMode, teamPerspective, paintSupported]);

  const shootingRows: ShootingRow[] = (teams ?? []).filter((t) => t.shotTypes).map((team) => ({ team }));
  const shotTypeKeys = sortShotTypeKeys([...new Set(shootingRows.flatMap((r) => Object.keys(r.team.shotTypes ?? {})))]);
  const shootingColumns: Column<ShootingRow>[] = [
    {
      key: "team",
      label: "チーム",
      align: "left",
      sortValue: (r) => r.team.teamName,
      render: (r) => (
        <span className="team-name-cell">
          {r.team.teamId !== LEAGUE_TEAM_ID && <TeamLogo teamId={r.team.teamId} size={20} />}
          <ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} />
        </span>
      ),
    },
    ...shotTypeEntityColumns<ShootingRow>(
      shotTypeKeys,
      (r) => r.team.shotTypes,
      displayMode === "total" ? "total" : "perGame",
      (r) => r.team.gamesPlayed,
    ),
  ];

  const turnoverRows: TurnoverRow[] = (teams ?? []).flatMap((team) => {
    const data = turnoverPerspective === "forced" ? team.forcedTurnovers : team.turnoversCommitted;
    return data ? [{ team, data }] : [];
  });
  // FG試投構成（Scoring %）。teams.json にペイント内外の試投数が無いため、各チームの試合ログのレギュラーシーズン分を合計する
  // （ペイント内外はプレーバイプレーの公式の区分）。リーグ平均は全チームの合計を延べ試合数で割る
  const fgaTeams = useMemo(() => {
    if (!teams || !gameLogsByTeam) return null;
    const perTeam = teams.map((team) => {
      const logs = filterByGameType(gameLogsByTeam.get(team.teamId) ?? [], "regular");
      return { team, games: logs.length, totals: sumTeamGameLogs(logs) };
    });
    const build = (mode: "own" | "opponent"): FgaChartTeam[] => {
      const pick = (games: number, t: ReturnType<typeof sumTeamGameLogs>) =>
        mode === "own"
          ? { games, tpa: t.tpa, mid2a: t.mid2a, paint2a: t.paint2a }
          : { games, tpa: t.oppTpa, mid2a: t.oppMid2a, paint2a: t.oppPaint2a };
      const list = perTeam.map((r) => ({ teamId: r.team.teamId, teamName: r.team.teamName, share: fgaShare(pick(r.games, r.totals)) }));
      const league = perTeam.reduce(
        (acc, r) => {
          const v = pick(r.games, r.totals);
          return { games: acc.games + v.games, tpa: acc.tpa + v.tpa, mid2a: acc.mid2a + v.mid2a, paint2a: acc.paint2a + v.paint2a };
        },
        { games: 0, tpa: 0, mid2a: 0, paint2a: 0 },
      );
      return league.games > 0 ? [...list, { teamId: LEAGUE_TEAM_ID, teamName: LEAGUE_TEAM_NAME, share: fgaShare(league) }] : list;
    };
    return { own: build("own"), opponent: build("opponent") };
  }, [teams, gameLogsByTeam]);
  // 棒グラフ（On-Court Foreign・Scoring %）は、リーグ平均の棒を並び順の中の該当する位置に入れる（DESIGN.md 149章）
  const withLeague = (list: TeamSummary[] | null | undefined): TeamSummary[] =>
    leagueAverage ? [...(list ?? []), { ...leagueAverage.team, teamId: LEAGUE_TEAM_ID, teamName: LEAGUE_TEAM_NAME }] : (list ?? []);
  const leagueTurnoverData = leagueAverage
    ? turnoverPerspective === "forced"
      ? leagueAverage.team.forcedTurnovers
      : leagueAverage.team.turnoversCommitted
    : undefined;
  const leagueTurnoverRow: TurnoverRow | null = leagueAverage && leagueTurnoverData ? { team: leagueAverage.team, data: leagueTurnoverData } : null;
  const turnoverColumns: Column<TurnoverRow>[] = [
    {
      key: "team",
      label: "チーム",
      align: "left",
      sortValue: (r) => r.team.teamName,
      render: (r) => (
        <span className="team-name-cell">
          {r.team.teamId !== LEAGUE_TEAM_ID && <TeamLogo teamId={r.team.teamId} size={20} />}
          <ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} />
        </span>
      ),
    },
    { key: "offensiveFoul", label: "オフェンスファウル", sortValue: (r) => r.data.offensiveFoul, format: (r) => String(r.data.offensiveFoul) },
    { key: "violation24sec", label: "24秒バイオレーション", sortValue: (r) => r.data.violation24sec, format: (r) => String(r.data.violation24sec) },
    { key: "backcourtViolation", label: "バックコート", sortValue: (r) => r.data.backcourtViolation, format: (r) => String(r.data.backcourtViolation) },
    { key: "violation5sec", label: "5秒バイオレーション", sortValue: (r) => r.data.violation5sec, format: (r) => String(r.data.violation5sec) },
    { key: "violation8sec", label: "8秒バイオレーション", sortValue: (r) => r.data.violation8sec, format: (r) => String(r.data.violation8sec) },
    { key: "otherDead", label: "その他デッドボール", sortValue: (r) => r.data.otherDead, format: (r) => String(r.data.otherDead) },
    { key: "live", label: "ライブボール（参考）", sortValue: (r) => r.data.live, format: (r) => String(r.data.live) },
    { key: "total", label: "合計", sortValue: (r) => turnoverTotal(r.data), format: (r) => String(turnoverTotal(r.data)) },
    { key: "gamesWithData", label: "データあり試合数", sortValue: (r) => r.data.gamesWithData, format: (r) => String(r.data.gamesWithData) },
  ];

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  // フィルタバー（DESIGN.md 105章）。カテゴリによって効かない軸は操作不可にして理由を出す。
  // 通常4カテゴリ=全軸が有効、シューティング=表示（平均/合計）のみ有効、それ以外の専用ビュー=すべて対象外
  const isMainCategory = boxTab === "traditional" || boxTab === "advanced" || boxTab === "misc" || boxTab === "scoring";
  const seasonTotalOnlyReason = "このタブはシーズン通算値のみ対応のため、上の絞り込みは連動しません。";
  const filterDisabledReason = isMainCategory
    ? undefined
    : boxTab === "shooting"
      ? "このタブはシーズン通算値のみ対応です（表示の平均/合計だけ連動します）。"
      : seasonTotalOnlyReason;
  const displayDisabledReason = isMainCategory || boxTab === "shooting" ? undefined : seasonTotalOnlyReason;
  const filterAxes: FilterAxis[] = [
    gameTypeAxis(gameType, setGameType, season, { disabledReason: filterDisabledReason }),
    perspectiveAxis(teamPerspective, setTeamPerspective, { disabledReason: filterDisabledReason }),
    displayModeAxis(displayMode, setDisplayMode, { disabledReason: displayDisabledReason }),
    ...situationalAxes(filter, setFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
      disabledReason: filterDisabledReason,
    }),
  ];
  const clearAllFilters = () => {
    setGameType("regular");
    setTeamPerspective("own");
    setDisplayMode("perGame");
    setFilter({ range: { kind: "all" } });
  };

  // 主表の見出し。カテゴリごとに実際に効いている軸だけを条件として並べる（シューティング以降の
  // 専用ビューはシーズン通算値のみで、S・G・Vは対象外。その旨を固定ラベルで明示する）
  const statsTitle = {
    title: `${season}シーズン 全チームスタッツ：${TEAMS_STATS_CATEGORY_LABELS[boxTab]}`,
    conditions:
      boxTab === "traditional" || boxTab === "advanced" || boxTab === "misc" || boxTab === "scoring"
        ? composeLabels(
            displayModeLabels(displayMode),
            gameTypeLabels(gameType, season),
            perspectiveLabels(teamPerspective),
            situationalFilterLabels(filter),
          )
        : boxTab === "shooting"
          ? composeLabels(displayModeLabels(displayMode), SEASON_TOTAL_ONLY_LABELS)
          : boxTab === "forcedTurnovers"
            ? composeLabels(TURNOVER_PERSPECTIVE_LABELS[turnoverPerspective], SEASON_TOTAL_ONLY_LABELS)
            : boxTab === "foreignPlayers"
              ? composeLabels(SEASON_TOTAL_ONLY_LABELS, "在コート時間ベース")
              : composeLabels(SEASON_TOTAL_ONLY_LABELS),
  };

  return (
    <div>
      <p className="page-subtitle">全{teams.length}チーム</p>

      <FilterBar axes={filterAxes} stateKey="teams:stats" onClearAll={clearAllFilters} />
      <div>
        <div className="tab-bar">
          {BOX_TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-button${boxTab === t.key ? " active" : ""}`}
              onClick={() => setBoxTab(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
          <button
            className={`tab-button${boxTab === "shooting" ? " active" : ""}`}
            onClick={() => setBoxTab("shooting")}
            type="button"
          >
            {CATEGORY_LABELS.shooting}
          </button>
          <button
            className={`tab-button${boxTab === "forcedTurnovers" ? " active" : ""}`}
            onClick={() => setBoxTab("forcedTurnovers")}
            type="button"
          >
            {CATEGORY_LABELS.forcedTurnovers}
          </button>
          <button
            className={`tab-button${boxTab === "foreignPlayers" ? " active" : ""}`}
            onClick={() => setBoxTab("foreignPlayers")}
            type="button"
          >
            {CATEGORY_LABELS.foreignPlayers}
          </button>
          <button
            className={`tab-button${boxTab === "scoringComposition" ? " active" : ""}`}
            onClick={() => setBoxTab("scoringComposition")}
            type="button"
          >
            {CATEGORY_LABELS.scoringComposition}
          </button>
        </div>
      </div>

      <ConditionTitle title={statsTitle.title} conditions={statsTitle.conditions} />

      {boxTab === "shooting" ? (
        !yahooPbpSupported ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <div className="table-scroll">
              <SortableTable
                statScope="team"
                columns={shootingColumns}
                rows={shootingRows}
                rowKey={(r) => r.team.teamId}
                defaultSortKey="team"
                defaultSortDir="asc"
                linkTo={(r) => `/teams/${r.team.teamId}`}
                pinnedRows={leagueAverage?.team.shotTypes ? [{ team: leagueAverage.team }] : undefined}
              />
            </div>
            <p className="page-subtitle">
              レギュラーシーズンのみ（上部のシチュエーション別フィルタ・レギュラー/{postseasonLabel(season)}/合算・自チーム/opp/+/-とは連動しない。平均/合計のみ連動する）。シュートタイプ×2P/3P別に成功数（M）・試投数（A）・成功率（%）の3列に分けて表示する。列見出しクリックで並び替え
            </p>
          </>
        )
      ) : boxTab === "forcedTurnovers" ? (
        !yahooPbpSupported ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <div className="mode-toggle">
              <button
                className={turnoverPerspective === "forced" ? "active" : ""}
                onClick={() => setTurnoverPerspective("forced")}
                type="button"
              >
                {TURNOVER_PERSPECTIVE_LABELS.forced}
              </button>
              <button
                className={turnoverPerspective === "committed" ? "active" : ""}
                onClick={() => setTurnoverPerspective("committed")}
                type="button"
              >
                {TURNOVER_PERSPECTIVE_LABELS.committed}
              </button>
            </div>
            <div className="table-scroll">
              <SortableTable
                statScope="team"
                columns={turnoverColumns}
                rows={turnoverRows}
                rowKey={(r) => r.team.teamId}
                defaultSortKey="total"
                linkTo={(r) => `/teams/${r.team.teamId}`}
                pinnedRows={leagueTurnoverRow ? [leagueTurnoverRow] : undefined}
              />
            </div>
            <p className="page-subtitle">
              レギュラーシーズン・シーズン合計のみ（上部のシチュエーション別フィルタ・レギュラー/{postseasonLabel(season)}/合算・自チーム/opp/+/-とは連動しない）
            </p>
          </>
        )
      ) : boxTab === "foreignPlayers" ? (
        <>
          <FilterBar
            simple
            stateKey="teams:foreignOrder"
            axes={[
              simpleSelectAxis({
                id: "foreignOrder",
                label: "並び順",
                options: (Object.keys(FOREIGN_COURT_ORDER_LABELS) as ForeignCourtOrder[]).map((o) => ({
                  value: o,
                  label: FOREIGN_COURT_ORDER_LABELS[o],
                })),
                value: foreignOrder,
                defaultValue: "foreignDesc",
                onChange: (v) => setForeignOrder(v as ForeignCourtOrder),
              }),
            ]}
          />
          <ForeignPlayerCourtTimeChart
            teams={withLeague(teams)}
            order={foreignOrder}
            maxOnCourt={foreignRules?.find((r) => r.season === season)?.maxForeignOnCourt}
          />
          <p className="page-subtitle">
            レギュラーシーズン・シーズン合計の在コート時間から集計しています（上部のシチュエーション別フィルタ・レギュラー/{postseasonLabel(season)}/合算・自チーム/opp/+/-とは連動しません）。
            平均人数は、0〜4名それぞれの在コート時間の割合に人数を掛けて合計した値で、試合時間を通してコート上にいた外国籍・帰化・アジア特別枠の選手の平均人数です。
            登録区分が不明な選手を含むラインナップと、規定上ありえない人数の区間（公式記録の誤りと見られるもの）は集計から除外しているため、チームによっては集計できた合計時間が実際の総出場時間より短くなる場合があります
          </p>
        </>
      ) : boxTab === "scoringComposition" ? (
        <>
          <FilterBar
            simple
            stateKey="teams:scoringOrder"
            axes={[
              simpleSelectAxis({
                id: "scoringOrder",
                label: "得点構成の並び順",
                options: (Object.keys(SCORING_ORDER_LABELS) as PointsShareOrder[]).map((o) => ({ value: o, label: SCORING_ORDER_LABELS[o] })),
                value: scoringOrder,
                defaultValue: "total",
                onChange: (v) => setScoringOrder(v as PointsShareOrder),
              }),
              simpleSelectAxis({
                id: "fgaOrder",
                label: "FG試投構成の並び順",
                options: (Object.keys(FGA_ORDER_LABELS) as FgaShareOrder[]).map((o) => ({ value: o, label: FGA_ORDER_LABELS[o] })),
                value: fgaOrder,
                defaultValue: "total",
                onChange: (v) => setFgaOrder(v as FgaShareOrder),
              }),
              simpleSelectAxis({
                id: "classificationOrder",
                label: "登録区分の並び順",
                options: (Object.keys(CLASSIFICATION_ORDER_LABELS) as ClassificationShareOrder[]).map((o) => ({
                  value: o,
                  label: CLASSIFICATION_ORDER_LABELS[o],
                })),
                value: classificationOrder,
                defaultValue: "total",
                onChange: (v) => setClassificationOrder(v as ClassificationShareOrder),
              }),
            ]}
          />
          <h3>得点構成（総得点に占める割合）</h3>
          <ScoringCompositionChart teams={withLeague(teams)} mode="own" order={scoringOrder} />
          <h3>失点構成（このチームが奪われた得点の割合）</h3>
          <ScoringCompositionChart teams={withLeague(teams)} mode="opponent" order={scoringOrder} />
          <p className="page-subtitle">
            レギュラーシーズン・シーズン合計の値です（上部のシチュエーション別フィルタ・レギュラー/{postseasonLabel(season)}/合算・自チーム/opp/+/-とは連動しません）。ペイント内の得点はプレーバイプレーの記録から、ミッドレンジの得点は「2Pの得点−ペイント内の得点」として出しているため、全シーズンで表示できます。棒の中の数値は割合(%)と1試合平均の得点、右端は1試合平均の得点（失点構成は失点）です
          </p>
          <h3>FG試投構成（FGAに占める割合）</h3>
          {fgaTeams ? <FgaCompositionChart teams={fgaTeams.own} mode="own" order={fgaOrder} /> : <p className="loading">読み込み中...</p>}
          <h3>opp FG試投構成（相手のFGAに占める割合）</h3>
          {fgaTeams ? <FgaCompositionChart teams={fgaTeams.opponent} mode="opponent" order={fgaOrder} /> : <p className="loading">読み込み中...</p>}
          <p className="page-subtitle">
            レギュラーシーズン・シーズン合計の値です（上部のフィルタとは連動しません）。Paint・Mid-rangeはプレーバイプレーの公式の区分（ペイント内／ペイント外の2P）で、全シーズンで表示できます。棒の中の数値は割合(%)と1試合平均の試投数、右端は1試合平均のFGA（opp FG試投構成は相手のFGA）です
          </p>
          <h3>得点構成（登録区分）</h3>
          <ClassificationCompositionChart teams={withLeague(teams)} mode="own" order={classificationOrder} />
          <h3>失点構成（登録区分）</h3>
          <ClassificationCompositionChart teams={withLeague(teams)} mode="opponent" order={classificationOrder} />
          <p className="page-subtitle">
            レギュラーシーズン・シーズン合計の値です（上部のフィルタとは連動しません）。登録区分は現在の登録情報に基づく値です。登録区分が不明な選手の得点はどちらにも入れていないため、2つの合計が100%に満たない場合があります
          </p>
        </>
      ) : gameLogsLoading || !gameLogsByTeam ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <div className="table-scroll">
            <SortableTable
              statScope="team"
              key={`${boxTab}-${teamPerspective}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.team.teamId}
              defaultSortKey={DEFAULT_SORT_KEY[boxTab]}
              linkTo={(r) => `/teams/${r.team.teamId}`}
              pinnedRows={leagueRow && teamPerspective === "own" ? [leagueRow] : undefined}
            />
          </div>
          {boxTab === "misc" && <RuleChangeFootnote seasons={[season]} />}
          <p className="page-subtitle">
            各チームの試合ログから選択中の条件で再集計した値。BSR（被ブロック）・EFF（貢献度）・LIVETOV/DEADTOVは、26チーム分を試合の生データから再集計すると通信量が大きくなりすぎるため、この一覧には含めていない（チーム詳細ページの「チームスタッツ」タブでは1チーム分に限り表示している）
          </p>
        </>
      )}
    </div>
  );
}

// 「歴代記録」タブ。data/league-team-rankings.json（Phase H7）を使い、過去在籍した全30クラブ
// 横断で通算成績（CAREER_TOTAL_DEFS・27項目）・クラブレコード（TEAM_RECORD_STATS・29項目）・
// シーズン記録（最多勝利数・最多連勝・2項目）それぞれのランキングを表示する。順位・対象クラブ数は
// JSON側で既に算出済みのため、フロントエンドは項目・レギュラー/プレーオフ/合算を選んで該当の
// [statKey][teamId]テーブルをrank昇順に並べ替えるだけでよい
type RecordsCategory = "career" | "clubRecord" | "seasonSpecial" | "premierRecord" | "periodRecord";

const RECORDS_CATEGORY_LABELS: Record<RecordsCategory, string> = {
  career: "通算成績",
  clubRecord: "クラブレコード",
  seasonSpecial: "1シーズン記録",
  premierRecord: "B.PREMIER（旧B1）レコード",
  periodRecord: "クォーター別レコード",
};

/** クォーター別レコード（DESIGN.md 143章）の項目: 6区間×記録側の3種（最多得点・最少失点・最大得失点差）。キーは periodRecordStatKey */
const PERIOD_RECORD_STAT_OPTIONS: RecordsStatOption[] = PERIOD_KEYS.flatMap((period) =>
  PERIOD_RECORD_KINDS.filter((k) => k.mode === "record").map((k) => ({
    key: periodRecordStatKey(period, k.key),
    label: `${PERIOD_LABELS[period]} ${k.label}`,
  })),
);

interface RecordsStatOption {
  key: string;
  label: string;
}

const SEASON_SPECIAL_STAT_OPTIONS: RecordsStatOption[] = [
  { key: "wins", label: "最多勝利数（1シーズン）" },
  { key: "streak", label: "最多連勝（シーズン内）" },
];

function recordsStatOptions(category: RecordsCategory): RecordsStatOption[] {
  switch (category) {
    case "career":
      return CAREER_TOTAL_DEFS.map((d) => ({ key: d.key, label: d.label }));
    case "clubRecord":
      return TEAM_RECORD_STATS.map((d) => ({ key: d.key, label: d.label }));
    case "seasonSpecial":
      return SEASON_SPECIAL_STAT_OPTIONS;
    case "premierRecord":
      return [...TEAM_RECORD_STATS.map((d) => ({ key: d.key, label: d.label })), ...SEASON_SPECIAL_STAT_OPTIONS];
    case "periodRecord":
      return PERIOD_RECORD_STAT_OPTIONS;
  }
}

/** premierRecordカテゴリの選択中statKeyが、クラブレコード系（1試合単位）かシーズン記録系
 * （最多勝利数/最多連勝）かを判定する。TEAM_RECORD_STATSのkeyとSEASON_SPECIAL_STAT_OPTIONSの
 * key（wins/streak）は重複しないため、この2値だけで判別できる */
function isSeasonSpecialStatKey(statKey: string): statKey is "wins" | "streak" {
  return statKey === "wins" || statKey === "streak";
}

// クラブレコードの%系4項目（TeamDetailPage.tsxのTEAM_RECORD_PCT_FORMATSと同じ対象）のみ%表記、
// それ以外は桁区切り数値。通算成績は常に桁区切り数値、シーズン記録は「◯勝」「◯連勝」表記にする
const CLUB_RECORD_PCT_KEYS = new Set(["fgPct", "twoPct", "tpPct", "ftPct"]);

function formatLeagueRecordValue(category: RecordsCategory, statKey: string, value: number): string {
  if (category === "clubRecord" && CLUB_RECORD_PCT_KEYS.has(statKey)) return formatPct(value);
  if (category === "seasonSpecial") return statKey === "wins" ? `${value}勝` : `${value}連勝`;
  return value.toLocaleString();
}

// 「歴代記録」タブのホーム/アウェイ/トータル切り替え（2026-08-29）。トータルは既存の
// career/clubRecord/seasonSpecial、ホーム/アウェイはaggregate-league-rankings.tsが別途
// 算出済みのcareerHome/careerAway等（scripts参照）を参照するだけで、フロントエンド側の
// 追加集計は不要

function leagueEntriesFor(
  rankings: LeagueTeamRankingsFile | null,
  category: RecordsCategory,
  venue: LeagueVenue,
  gameType: SeasonGameTypeFilter,
  statKey: string,
): Record<string, LeagueTeamRankEntry> | undefined {
  if (!rankings) return undefined;
  if (category === "seasonSpecial") {
    if (statKey !== "wins" && statKey !== "streak") return undefined;
    const table = venue === "total" ? rankings.seasonSpecial : venue === "home" ? rankings.seasonSpecialHome : rankings.seasonSpecialAway;
    return table[gameType][statKey];
  }
  if (category === "career") {
    const table = venue === "total" ? rankings.career : venue === "home" ? rankings.careerHome : rankings.careerAway;
    return table[gameType][statKey];
  }
  const table = venue === "total" ? rankings.clubRecord : venue === "home" ? rankings.clubRecordHome : rankings.clubRecordAway;
  return table[gameType][statKey];
}

/** 「B.PREMIER（旧B1）レコード」（Batch 5）。ホーム/アウェイ限定版は対象外（トータルのみ） */
function premierRecordEntriesFor(
  rankings: LeagueTeamRankingsFile | null,
  gameType: SeasonGameTypeFilter,
  statKey: string,
): LeagueRecordEntry[] {
  if (!rankings) return [];
  if (isSeasonSpecialStatKey(statKey)) return rankings.seasonSpecialTop20[gameType][statKey];
  return rankings.clubRecordTop20[gameType][statKey] ?? [];
}

// TEAM_NAMES（scripts/lib/divisions.ts）は現行B.PREMIER26クラブのみを収録している
// （その出典・用途が26クラブに固定されているため）。過去在籍のみで現在はB.ONEに所属する
// 4クラブ（新潟・FE名古屋・越谷・ライジングゼファー福岡）の名称はここで補う
const EXTRA_TEAM_NAMES: Record<string, string> = {
  "695": "新潟アルビレックスBB",
  "717": "ファイティングイーグルス名古屋",
  "745": "越谷アルファーズ",
  "753": "ライジングゼファー福岡",
};

/** 歴代記録のファイルを最後に書き換えた日（日本時間）。内容に変化が無い日は書き換えないので、最後に順位や値が変わった日になる */
function formatRankingsUpdatedAt(iso: string): string {
  return new Date(iso).toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
}

function leagueTeamDisplayName(teamId: string): string {
  return TEAM_NAMES[teamId] ?? EXTRA_TEAM_NAMES[teamId] ?? teamId;
}

// 現在の所属カテゴリ（要件3: 降格済み・退会済みクラブと現行クラブを区別する注記）。
// TEAM_DIVISIONS/ONE_TEAM_DIVISIONSはいずれも2026-27シーズン基準の現行クラブ一覧
function leagueTeamCurrentCategoryLabel(teamId: string): string {
  if (teamId in TEAM_DIVISIONS) return "B.PREMIER";
  if (teamId in ONE_TEAM_DIVISIONS) return "B.ONE";
  return "対象外";
}

// 現行B.PREMIERクラブでないチーム（B.ONEへ降格済み等）は、現在選択中のシーズンに向けて
// リンクしても対象シーズンにそのクラブが存在せず「チームが見つかりませんでした」になってしまう
// （23章で確立された挙動）。そのため、そのクラブが最後にB.PREMIERに在籍していたシーズンを
// division-history.jsonから求め、明示的な?season=付きでリンクする
function lastPremierSeasonFor(divisionHistory: DivisionHistoryFile | null | undefined, teamId: string): string | undefined {
  if (!divisionHistory) return undefined;
  const seasons = Object.keys(divisionHistory.premier).filter(
    (s) => divisionHistory.premier[s]?.[teamId] !== undefined,
  );
  return seasons.sort().at(-1);
}

// 上記lastPremierSeasonForの結果に応じて、現行B.PREMIERクラブはSeasonLink（現在の?season=を
// 引き継ぐ）、それ以外は明示的な?season=付きのLinkでチーム詳細ページへ遷移する共通リンク。
// 「歴代記録」タブと「歴代王者」タブの両方から使う
function TeamNavLink({
  teamId,
  divisionHistory,
  className,
  children,
}: {
  teamId: string;
  divisionHistory: DivisionHistoryFile | null | undefined;
  className?: string;
  children: ReactNode;
}) {
  if (teamId in TEAM_DIVISIONS) {
    return (
      <SeasonLink to={`/teams/${teamId}`} className={className}>
        {children}
      </SeasonLink>
    );
  }
  const lastSeason = lastPremierSeasonFor(divisionHistory, teamId);
  return (
    <Link to={lastSeason ? `/teams/${teamId}?season=${lastSeason}` : `/teams/${teamId}`} className={className}>
      {children}
    </Link>
  );
}

type RecordsScope = "allTime" | "season";

/**
 * 「記録」タブ（2026-09-27、旧「歴代記録」）。範囲「歴代」は今までの全シーズン横断の記録、「シーズン」は選んだシーズンの中の記録。
 * タブの内部のキー（records）と絞り込みの保存キー（teams:records）は旧名のまま変えていない
 */
function RecordsTab({ season }: { season: string }) {
  const [scope, setScope] = usePageState<RecordsScope>("teams:records:scope", "allTime");
  return (
    <div>
      <div className="mode-toggle records-scope-toggle">
        {(
          [
            ["allTime", "歴代"],
            ["season", "シーズン"],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className={scope === key ? "active" : ""} onClick={() => setScope(key)}>
            {label}
          </button>
        ))}
      </div>
      {scope === "allTime" ? <LeagueRecordsTab /> : <LeagueSeasonRecords defaultSeason={season} />}
    </div>
  );
}

interface LeagueRecordRow {
  teamId: string;
  entry: LeagueTeamRankEntry;
}

function LeagueRecordsTab() {
  const teamLabel = useTeamLabel();
  const narrow = useNarrow();
  const { data: teamHistory } = useJsonData(() => fetchTeamHistory(), []);
  const seasonName = (teamId: string, season: string) => teamNameInSeason(teamHistory, teamId, season, leagueTeamDisplayName(teamId));
  // クラブ単位の一覧（クラブレコード・シーズン記録）は、記録を出したシーズンの名称。同じ値が名称の違う複数のシーズンにあれば今の名称。
  // 通算成績は今の名称（seasons が無い）
  const clubRowName = (teamId: string, seasons: string[] | undefined) => {
    const names = new Set((seasons ?? []).map((season) => seasonName(teamId, season)));
    return names.size === 1 ? [...names][0]! : leagueTeamDisplayName(teamId);
  };
  const {
    data: rankings,
    loading: rankingsLoading,
    error: rankingsError,
  } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);

  const [category, setCategory] = useState<RecordsCategory>("career");
  const [venue, setVenue] = useState<LeagueVenue>("total");
  const [gameType, setGameType] = useState<SeasonGameTypeFilter>("regular");
  const [statKey, setStatKey] = useState("wins");

  const statOptions = recordsStatOptions(category);

  const selectCategory = (next: RecordsCategory) => {
    setCategory(next);
    setStatKey(recordsStatOptions(next)[0]!.key);
  };

  if (rankingsLoading) return <p className="loading">読み込み中...</p>;
  if (rankingsError) return <p className="error-message">{rankingsError}</p>;
  if (!rankings) return <p className="empty-message">データがありません</p>;

  const isPremierRecord = category === "premierRecord";
  const isPeriodRecord = category === "periodRecord";
  const entries = isPremierRecord || isPeriodRecord ? undefined : leagueEntriesFor(rankings, category, venue, gameType, statKey);
  const rows: LeagueRecordRow[] = entries
    ? Object.entries(entries)
        .map(([teamId, entry]) => ({ teamId, entry }))
        .sort((a, b) => a.entry.rank - b.entry.rank || Number(a.teamId) - Number(b.teamId))
    : [];
  const premierRows: LeagueRecordEntry[] = isPremierRecord ? premierRecordEntriesFor(rankings, gameType, statKey) : [];
  const totalTeams = Object.keys(rankings.career.regular.wins ?? {}).length;
  const activeLabel = statOptions.find((d) => d.key === statKey)?.label ?? statKey;
  const valueCategory: "clubRecord" | "seasonSpecial" = isSeasonSpecialStatKey(statKey) ? "seasonSpecial" : "clubRecord";

  return (
    <div>
      <p className="page-subtitle">
        過去在籍した全{totalTeams}クラブ横断のランキング（毎日1回、前日までの試合結果を取り込んだあとに作り直します。最終更新
        {" "}{formatRankingsUpdatedAt(rankings.generatedAt)}）。チーム名の下は現在の所属カテゴリ
        {isPremierRecord &&
          "。「B.PREMIER（旧B1）レコード」はクラブ単位の自己ベストではなく、リーグ史上の個々の試合・シーズンをそのまま順位付けしたもの（同一クラブが複数回登場しうる）。ホーム/アウェイ限定版は対象外"}
      </p>

      <FilterBar
        simple
        stateKey="teams:records"
        axes={[
          simpleSelectAxis({
            id: "recordsCategory",
            label: "カテゴリ",
            options: (Object.keys(RECORDS_CATEGORY_LABELS) as RecordsCategory[]).map((c) => ({
              value: c,
              label: RECORDS_CATEGORY_LABELS[c],
            })),
            value: category,
            onChange: (v) => selectCategory(v as RecordsCategory),
          }),
          // B.PREMIERレコード・クォーター別レコードは会場別の集計が無い（ホーム/アウェイ限定版は対象外）ため会場の軸自体を出さない
          ...(isPremierRecord || isPeriodRecord ? [] : [leagueVenueAxis(venue, setVenue)]),
          gameTypeAxis(gameType, setGameType, null),
        ]}
      />
      <FilterBar axes={[statItemAxis(statOptions, statKey, setStatKey)]} stateKey="teams:records:stat" simple wide />

      <ConditionTitle
        title={`歴代記録 ${RECORDS_CATEGORY_LABELS[category]}：${activeLabel}`}
        conditions={composeLabels(!isPremierRecord && !isPeriodRecord && leagueVenueLabels(venue), gameTypeLabels(gameType, null))}
      />

      {isPeriodRecord ? (
        <PeriodRecordTables rankings={rankings} gameType={gameType} statKey={statKey} divisionHistory={divisionHistory} />
      ) : isPremierRecord ? (
        premierRows.length === 0 ? (
          <p className="empty-message">この条件（レギュラー/{postseasonLabel(null)}区分・項目）では該当記録がありません</p>
        ) : (
          <div className="table-scroll">
            <table className="sortable-table rankings-table">
              <thead>
                <tr>
                  <th className="align-right">#</th>
                  <th className="align-left">チーム</th>
                  <th className="align-right rank-value-head" title={statDescription(activeLabel, "team")}>{activeLabel}</th>
                  {!narrow && <th className="align-left">シーズン</th>}
                  <th className="align-left">試合</th>
                </tr>
              </thead>
              <tbody>
                {premierRows.map((r, i) => (
                  <tr key={`${r.rank}-${r.teamId}-${r.scheduleKey ?? r.season}-${i}`}>
                    <td className="align-right rank-cell">{r.rank}</td>
                    <td className="align-left">
                      <TeamNavLink teamId={r.teamId} divisionHistory={divisionHistory} className="cell-link">
                        <span className="team-name-cell">
                          <TeamLogo teamId={r.teamId} size={20} />
                          <span className="rank-name-cell">
                            <span className="rank-name">
                              <ResponsiveTeamName teamId={r.teamId} name={seasonName(r.teamId, r.season)} />
                            </span>
                          </span>
                        </span>
                      </TeamNavLink>
                    </td>
                    <td className="align-right rank-value">{formatLeagueRecordValue(valueCategory, statKey, r.value)}</td>
                    {!narrow && <td className="align-left record-season">{r.season}</td>}
                    <td className="align-left">
                      {r.scheduleKey ? (
                        <Link to={`/games/${r.scheduleKey}?season=${r.season}`} className="cell-link">
                          <span className="record-date">{r.date}</span>
                          {r.opponentTeamId && (
                            <span className="record-opponent">
                              {` ${r.isHome ? "vs" : "@"} ${teamLabel(r.opponentTeamId, seasonName(r.opponentTeamId, r.season))}`}
                            </span>
                          )}
                        </Link>
                      ) : (
                        "-"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件（ホーム/アウェイ/トータル・レギュラー/{postseasonLabel(null)}区分・項目）では該当クラブがありません</p>
      ) : (
        <div className="table-scroll">
          <table className="sortable-table rankings-table">
            <thead>
              <tr>
                <th className="align-right">#</th>
                <th className="align-left">チーム</th>
                <th className="align-right rank-value-head" title={statDescription(activeLabel, "team")}>{activeLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.teamId}>
                  <td className="align-right rank-cell">{r.entry.rank}</td>
                  <td className="align-left">
                    <TeamNavLink teamId={r.teamId} divisionHistory={divisionHistory} className="cell-link">
                      <span className="team-name-cell">
                        <TeamLogo teamId={r.teamId} size={20} />
                        <span className="rank-name-cell">
                          <span className="rank-name">
                              <ResponsiveTeamName teamId={r.teamId} name={clubRowName(r.teamId, r.entry.seasons)} />
                            </span>
                          {/* 今の所属リーグは、通算成績（クラブ単位）だけに出す。1試合・1シーズンの記録では当時のリーグと違うことがあるため */}
                          {category === "career" && <span className="rank-sublabel">{leagueTeamCurrentCategoryLabel(r.teamId)}</span>}
                        </span>
                      </span>
                    </TeamNavLink>
                  </td>
                  <td className="align-right rank-value">{formatLeagueRecordValue(category, statKey, r.entry.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** クォーター別レコードの値の表記。得失点差は符号付き */
function formatPeriodRecordValue(statKey: string, value: number): string {
  return statKey.endsWith("Diff") && value > 0 ? `+${value}` : String(value);
}

const PERIOD_TOP_COLLAPSED_ROWS = 20;

/**
 * 「歴代記録」のクォーター別レコード（DESIGN.md 143章。延長戦は含めない）: クラブごとの自己ベストの順位と、リーグ史上の試合の上位20位。
 * 上位20位は同じ記録をすべて含むので20件を超えることがあり、20件を超えた分は「ほか◯試合」にまとめて「すべて表示」で開く
 */
function PeriodRecordTables({
  rankings,
  gameType,
  statKey,
  divisionHistory,
}: {
  rankings: LeagueTeamRankingsFile;
  gameType: SeasonGameTypeFilter;
  statKey: string;
  divisionHistory: DivisionHistoryFile | null | undefined;
}) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [statKey, gameType]);
  // スマホ幅は短いチーム名・2桁の年・日付と相手の2行にして、表を画面幅に収める
  const narrow = useMediaQuery("(max-width: 560px)");
  const { data: teamHistory } = useJsonData(() => fetchTeamHistory(), []);
  const clubBests = Object.entries(rankings.periodRecord?.[gameType]?.[statKey] ?? {})
    .map(([teamId, entry]) => ({ teamId, entry }))
    .sort((a, b) => a.entry.rank - b.entry.rank || a.entry.date.localeCompare(b.entry.date));
  const top = rankings.periodRecordTop20?.[gameType]?.[statKey] ?? [];
  const visibleTop = showAll ? top : top.slice(0, PERIOD_TOP_COLLAPSED_ROWS);
  const hidden = top.length - visibleTop.length;
  if (!rankings.periodRecord) return <p className="empty-message">データがありません</p>;

  // チーム名は記録のシーズンの名称（スマホ幅は当時の略称）。今の所属リーグは当時のリーグと違うことがあるので出さない
  const seasonName = (teamId: string, season: string) => teamNameInSeason(teamHistory, teamId, season, leagueTeamDisplayName(teamId));
  const teamCell = (teamId: string, season: string) => (
    <TeamNavLink teamId={teamId} divisionHistory={divisionHistory} className="cell-link">
      <span className="team-name-cell">
        <TeamLogo teamId={teamId} size={20} />
        <span className="rank-name-cell">
          <span className="rank-name">{narrow ? teamShortName(teamId, seasonName(teamId, season)) : seasonName(teamId, season)}</span>
        </span>
      </span>
    </TeamNavLink>
  );
  const opponentName = (teamId: string, season: string) =>
    narrow ? teamShortName(teamId, seasonName(teamId, season)) : seasonName(teamId, season);
  const gameLink = (e: { scheduleKey?: string; season: string; date?: string; isHome?: boolean; opponentTeamId?: string }) =>
    e.scheduleKey ? (
      <Link to={`/games/${e.scheduleKey}?season=${e.season}`} className="cell-link">
        {narrow ? e.date?.replace(/-/g, "/").slice(2) : e.date?.replace(/-/g, "/")}
        {narrow ? <br /> : " "}
        {e.opponentTeamId && `${e.isHome ? "vs" : "@"} ${opponentName(e.opponentTeamId, e.season)}`}
      </Link>
    ) : (
      "-"
    );

  return (
    <>
      <h3 className="career-highs-subheading">クラブごとの自己ベスト</h3>
      <div className="table-scroll">
        <table className="sortable-table rankings-table period-league-table">
          <thead>
            <tr>
              <th className="align-right">#</th>
              <th className="align-left">チーム</th>
              <th className="align-right rank-value-head" title={statDescription(PERIOD_RECORD_STAT_OPTIONS.find((o) => o.key === statKey)?.label ?? "", "team")}>
                記録
              </th>
              <th className="align-right" title={statDescription("区間のスコア", "team")}>
                区間のスコア
              </th>
              <th className="align-left">試合</th>
            </tr>
          </thead>
          <tbody>
            {clubBests.map(({ teamId, entry }) => (
              <tr key={teamId}>
                <td className="align-right rank-cell">{entry.rank}</td>
                <td className="align-left">{teamCell(teamId, entry.season)}</td>
                <td className="align-right rank-value">{formatPeriodRecordValue(statKey, entry.value)}</td>
                <td className="align-right">
                  {entry.ownPoints}-{entry.oppPoints}
                </td>
                <td className="align-left">
                  {gameLink(entry)}
                  {entry.otherGames > 0 && <span className="rank-sublabel">（ほか{entry.otherGames}試合）</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="career-highs-subheading">リーグ史上の上位20位</h3>
      <div className="table-scroll">
        <table className="sortable-table rankings-table period-league-table">
          <thead>
            <tr>
              <th className="align-right">#</th>
              <th className="align-left">チーム</th>
              <th className="align-right rank-value-head" title={statDescription(PERIOD_RECORD_STAT_OPTIONS.find((o) => o.key === statKey)?.label ?? "", "team")}>
                記録
              </th>
              <th className="align-right" title={statDescription("区間のスコア", "team")}>
                区間のスコア
              </th>
              {!narrow && <th className="align-left">シーズン</th>}
              <th className="align-left">試合</th>
            </tr>
          </thead>
          <tbody>
            {visibleTop.map((r, i) => (
              <tr key={`${r.scheduleKey}-${r.teamId}-${i}`}>
                <td className="align-right rank-cell">{r.rank}</td>
                <td className="align-left">{teamCell(r.teamId, r.season)}</td>
                <td className="align-right rank-value">
                  {formatPeriodRecordValue(statKey, r.value)}
                  {r.fromPbp && <span title="公式のクォーター別スコアが欠けている試合のため、プレーバイプレーの得点から出した値">※</span>}
                </td>
                <td className="align-right">
                  {r.ownPoints}-{r.oppPoints}
                </td>
                {!narrow && <td className="align-left">{r.season}</td>}
                <td className="align-left">{gameLink(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {top.length > PERIOD_TOP_COLLAPSED_ROWS && (
        <button className="load-more-button" type="button" onClick={() => setShowAll((v) => !v)}>
          {showAll ? `上位${PERIOD_TOP_COLLAPSED_ROWS}件のみ表示` : `ほか${hidden}試合（すべて表示）`}
        </button>
      )}
      <p className="page-subtitle">
        1Q〜4Q・前半（1Q＋2Q）・後半（3Q＋4Q）の1試合の記録です。延長戦の得点は含めません。2016-17・2017-18のCSで行った前後半5分の試合は対象外です。
        「クラブごとの自己ベスト」は各クラブの最高記録で並べた順位（同じ記録の試合が複数あれば最も古い試合を表示）、
        「リーグ史上の上位20位」は個々の試合をそのまま並べたもので、同じ記録はすべて含みます。※は公式のクォーター別スコアが欠けている試合で、
        プレーバイプレーの得点から出した値です。
      </p>
    </>
  );
}

// 「歴代王者」タブ。data/club-honors.json（category="overall"）をシーズン軸の年表として表示する。
// 各シーズンの優勝チームには、そのシーズンのteams.json（通算成績）とdata/season-rules.json
// （オンザコートルールの変遷。eraLabelがDESIGN.md記載の4区分＝2016-17〜2017-18・2018-19〜
// 2019-20・2020-21〜2025-26・2026-27〜をそのまま表す）を併記する。地区優勝・天皇杯・国際大会は
// 別セクションとしてまとめて表示する（要件4で許容されている構成。国際大会の一部実績は
// "2019"のような暦年表記のシーズン値を持ち、B.LEAGUEシーズン軸の年表とは単位が異なるため、
// 無理に季キーへ正規化せず素直に別リストで示す）
const OTHER_HONOR_CATEGORY_LABELS: Record<Exclude<ClubHonor["category"], "overall">, string> = {
  emperors_cup: "天皇杯",
  division: "地区優勝",
  international: "国際大会",
};
const OTHER_HONOR_CATEGORY_ORDER: Exclude<ClubHonor["category"], "overall">[] = [
  "emperors_cup",
  "division",
  "international",
];

interface ChampionEntry {
  teamId: string;
  note?: string;
}

function championsBySeasonFrom(clubHonors: ClubHonorsFile): Map<string, ChampionEntry> {
  const map = new Map<string, ChampionEntry>();
  for (const [teamId, honors] of Object.entries(clubHonors)) {
    for (const h of honors) {
      if (h.category === "overall") map.set(h.season, { teamId, note: h.note });
    }
  }
  return map;
}

interface OtherHonorRow extends ClubHonor {
  teamId: string;
}

function otherHonorsFrom(clubHonors: ClubHonorsFile): OtherHonorRow[] {
  const rows: OtherHonorRow[] = [];
  for (const [teamId, honors] of Object.entries(clubHonors)) {
    for (const h of honors) {
      if (h.category !== "overall") rows.push({ ...h, teamId });
    }
  }
  return rows.sort((a, b) => (a.season < b.season ? 1 : a.season > b.season ? -1 : 0));
}

function ChampionsTab() {
  const teamText = useTeamText();
  // 優勝・表彰のクラブ名は、そのシーズンの名称（スマホ幅は当時の略称）
  const { data: teamHistory } = useJsonData(() => fetchTeamHistory(), []);
  const seasonName = (teamId: string, season: string) => teamNameInSeason(teamHistory, teamId, season, leagueTeamDisplayName(teamId));
  const {
    data: seasons,
    loading: seasonsLoading,
    error: seasonsError,
  } = useJsonData(() => fetchSeasons(), []);
  const {
    data: clubHonors,
    loading: honorsLoading,
    error: honorsError,
  } = useJsonData(() => fetchClubHonors(), []);
  const { data: seasonRules } = useJsonData(() => fetchSeasonRules(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);

  const championsBySeason = useMemo(
    () => (clubHonors ? championsBySeasonFrom(clubHonors) : new Map<string, ChampionEntry>()),
    [clubHonors],
  );
  const otherHonors = useMemo(() => (clubHonors ? otherHonorsFrom(clubHonors) : []), [clubHonors]);

  // 新しいシーズンを上に表示する
  const seasonsDesc = useMemo(
    () => (seasons ? [...seasons].map((s) => s.season).sort().reverse() : []),
    [seasons],
  );
  const championSeasons = useMemo(
    () => seasonsDesc.filter((s) => championsBySeason.has(s)),
    [seasonsDesc, championsBySeason],
  );
  // 地区優勝の各項目にそのシーズンの成績（勝敗・勝率）を併記するため、年間王者の対象シーズンに
  // 加えて地区優勝の対象シーズンもteams.jsonの取得対象に含める
  const neededSeasons = useMemo(
    () => [
      ...new Set([...championSeasons, ...otherHonors.filter((h) => h.category === "division").map((h) => h.season)]),
    ],
    [championSeasons, otherHonors],
  );

  const [teamsBySeason, setTeamsBySeason] = useState<Map<string, TeamSummary[]> | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);

  useEffect(() => {
    if (neededSeasons.length === 0) {
      setTeamsBySeason(new Map());
      setTeamsLoading(false);
      return;
    }
    let cancelled = false;
    setTeamsLoading(true);
    Promise.all(
      neededSeasons.map(async (s): Promise<readonly [string, TeamSummary[]]> => {
        try {
          return [s, await fetchTeams(s)] as const;
        } catch {
          return [s, []] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setTeamsBySeason(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setTeamsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [neededSeasons]);

  if (seasonsLoading || honorsLoading) return <p className="loading">読み込み中...</p>;
  if (seasonsError) return <p className="error-message">{seasonsError}</p>;
  if (honorsError) return <p className="error-message">{honorsError}</p>;
  if (!seasons || !clubHonors) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <p className="page-subtitle">
        シーズン別の年間王者（2025-26シーズンまではBリーグチャンピオンシップ〈CS〉、2026-27シーズンからはB.LEAGUE PREMIERプレーオフの優勝クラブ）年表。チーム名クリックでチーム詳細ページへ遷移できる
      </p>

      {teamsLoading && !teamsBySeason ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <div className="table-scroll">
          <table className="sortable-table champions-table">
            <thead>
              <tr>
                <th className="align-left">シーズン</th>
                <th className="align-left">優勝チーム</th>
                <th className="align-right">成績</th>
                <th className="align-right" title={statDescription("PTS", "team")}>PTS</th>
                <th className="align-right" title={statDescription("REB", "team")}>REB</th>
                <th className="align-right" title={statDescription("AST", "team")}>AST</th>
                <th className="align-right" title={statDescription("FG%", "team")}>FG%</th>
                <th className="align-right" title={statDescription("3P%", "team")}>3P%</th>
                <th className="align-left">オンザコートルール</th>
              </tr>
            </thead>
            <tbody>
              {seasonsDesc.map((season) => {
                const champion = championsBySeason.get(season);
                const team = champion
                  ? teamsBySeason?.get(season)?.find((t) => t.teamId === champion.teamId)
                  : undefined;
                const rule = seasonRules?.find((r) => r.season === season);
                return (
                  <tr key={season}>
                    <td className="align-left">{season}</td>
                    {champion && team ? (
                      <>
                        <td className="align-left">
                          <TeamNavLink teamId={champion.teamId} divisionHistory={divisionHistory} className="cell-link">
                            <span className="team-name-cell">
                              <TeamLogo teamId={champion.teamId} size={20} />
                              <ResponsiveTeamName teamId={champion.teamId} name={seasonName(champion.teamId, season)} />
                            </span>
                          </TeamNavLink>
                          {champion.note && <span className="honor-note">（{teamText(champion.note)}）</span>}
                        </td>
                        <td className="align-right">
                          {formatRecord(team.wins, team.losses)}（
                          {formatWinPct(safeDiv(team.wins, team.wins + team.losses))}）
                        </td>
                        <td className="align-right">{formatDecimal(team.perGame.pts)}</td>
                        <td className="align-right">{formatDecimal(team.perGame.reb)}</td>
                        <td className="align-right">{formatDecimal(team.perGame.ast)}</td>
                        <td className="align-right">{formatPct(team.shooting.fgPct)}</td>
                        <td className="align-right">{formatPct(team.shooting.tpPct)}</td>
                      </>
                    ) : champion ? (
                      <td className="align-left" colSpan={7}>
                        <span className="team-name-cell">
                          <TeamLogo teamId={champion.teamId} size={20} />
                          <ResponsiveTeamName teamId={champion.teamId} name={seasonName(champion.teamId, season)} />
                        </span>
                        <span className="honor-note">（成績データ取得中/未対応）</span>
                      </td>
                    ) : (
                      <td className="align-left" colSpan={7}>
                        <span className="rank-sublabel">
                          {season === "2019-20"
                            ? "優勝チームなし（新型コロナウイルスの影響でチャンピオンシップ中止）"
                            : "優勝チームなし"}
                        </span>
                      </td>
                    )}
                    <td className="align-left">{rule?.eraLabel ?? "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <h2>地区優勝・天皇杯・国際大会</h2>
      {otherHonors.length === 0 ? (
        <p className="empty-message">記録がありません</p>
      ) : (
        <div className="honors-groups">
          {OTHER_HONOR_CATEGORY_ORDER.map((category) => {
            const items = otherHonors.filter((h) => h.category === category);
            if (items.length === 0) return null;
            return (
              <div className="honors-group" key={category}>
                <h3>{OTHER_HONOR_CATEGORY_LABELS[category]}</h3>
                <ul>
                  {items.map((h, i) => {
                    const team =
                      category === "division" ? teamsBySeason?.get(h.season)?.find((t) => t.teamId === h.teamId) : undefined;
                    return (
                      <li key={`${h.teamId}-${h.season}-${h.competition}-${i}`} className="honor-item">
                        <span className="honor-season">{h.season}</span>
                        <TeamNavLink teamId={h.teamId} divisionHistory={divisionHistory} className="honor-team-link">
                          <ResponsiveTeamName teamId={h.teamId} name={seasonName(h.teamId, h.season)} />
                        </TeamNavLink>
                        {team && (
                          <span className="honor-note">
                            （{formatRecord(team.wins, team.losses)} {formatWinPct(safeDiv(team.wins, team.wins + team.losses))}）
                          </span>
                        )}
                        {"　"}
                        {h.competition}
                        {h.note && <span className="honor-note">（{teamText(h.note)}）</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// 「直近成績」タブ。現行26クラブ（過去在籍クラブは対象外、fetchTeams(season)が
// そのまま現行クラブのみを返すため追加のフィルタは不要）を対象に、直近5試合/直近10試合の
// 成績（situational.tsの「直近N試合」フィルタ＝{kind:"recent",n}をそのまま再利用。
// レギュラーシーズン・プレーオフを合算して「直近」を数える）でランキング表示する。
// ORtg/DRtg/NetRtgは、既存のチーム集計（teams.jsonのadvanced、6章のPOSS方式）と同じ
// 「試合単位で確定済みのPOSS値をそのまま合算してから式を1回だけ適用する」方針を、直近N試合
// の範囲に絞り込んだ上で再利用する（AllTeamsStatsTabのbuildAdvancedColumnsと同じ考え方）。
// 対戦相手の加重平均勝率は算出方法未確定のため未実装（別途対応）。現在の連勝/連敗は
// shared/teamRecords.tsのcurrentStreak()（longestWinStreak()と同じロジックを「シーズン最長」
// ではなく「末尾から遡った現在進行中の記録」に応用したもの）で、直近N試合の絞り込みとは
// 独立にそのチームの今シーズン全試合から算出する
const RECENT_FORM_N_OPTIONS = [5, 10] as const;
type RecentFormRecentN = (typeof RECENT_FORM_N_OPTIONS)[number];

interface RecentFormRow {
  team: TeamSummary;
  gamesPlayed: number;
  wins: number;
  losses: number;
  ptsAvg: number;
  oppPtsAvg: number;
  netAvg: number;
  ortg: number;
  drtg: number;
  netrtg: number;
  /** 対戦相手のその試合時点までの勝率の単純平均。算出対象の試合が1件も無ければundefined */
  oppWinPctAvg: number | undefined;
  streak: TeamStreak | null;
}

function RecentFormTab({ season }: { season: string }) {
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);

  const [recentN, setRecentN] = useState<RecentFormRecentN>(5);

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, teams);
  // 「対戦相手の加重平均勝率」用。既存のbuildRecordsBeforeGame()（対勝率別フィルタ・48章と
  // 同じロジック）をそのまま再利用し、各対戦相手のその試合時点までの勝敗数を求める
  const { opponentRecords } = useLeagueSituationalContext(season);

  const rows: RecentFormRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const logs = gameLogsByTeam.get(team.teamId) ?? [];
      const recentLogs = filterGameLogs(logs, { range: { kind: "recent", n: recentN }, includePlayoffs: true });
      const wins = recentLogs.filter((g) => g.win).length;
      const gamesPlayed = recentLogs.length;
      const ptsSum = recentLogs.reduce((s, g) => s + g.teamScore, 0);
      const oppPtsSum = recentLogs.reduce((s, g) => s + g.opponentScore, 0);
      const possSum = recentLogs.reduce((s, g) => s + g.poss, 0);
      const ptsAvg = safeDiv(ptsSum, gamesPlayed);
      const oppPtsAvg = safeDiv(oppPtsSum, gamesPlayed);
      const ortg = offensiveRating(ptsSum, possSum);
      const drtg = offensiveRating(oppPtsSum, possSum);
      const oppWinPctAvg = computeOpponentWinPctAvg(recentLogs, opponentRecords);
      return {
        team,
        gamesPlayed,
        wins,
        losses: gamesPlayed - wins,
        ptsAvg,
        oppPtsAvg,
        netAvg: ptsAvg - oppPtsAvg,
        ortg,
        drtg,
        netrtg: ortg - drtg,
        oppWinPctAvg,
        streak: currentStreak(logs),
      };
    });
  }, [teams, gameLogsByTeam, opponentRecords, recentN]);

  const columns: Column<RecentFormRow>[] = [
    {
      key: "team",
      label: "チーム",
      align: "left",
      sortValue: (r) => r.team.teamName,
      render: (r) => (
        <span className="team-name-cell">
          {r.team.teamId !== LEAGUE_TEAM_ID && <TeamLogo teamId={r.team.teamId} size={20} />}
          <ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} />
        </span>
      ),
    },
    { key: "g", label: "G", sortValue: (r) => r.gamesPlayed, format: (r) => String(r.gamesPlayed) },
    {
      key: "record",
      label: "勝敗",
      sortValue: (r) => r.wins - r.losses,
      format: (r) => formatRecord(r.wins, r.losses),
    },
    {
      key: "winPct",
      label: "勝率",
      sortValue: (r) => safeDiv(r.wins, r.wins + r.losses),
      format: (r) => formatWinPct(safeDiv(r.wins, r.wins + r.losses)),
    },
    { key: "pts", label: "平均得点", sortValue: (r) => r.ptsAvg, format: (r) => formatDecimal(r.ptsAvg) },
    { key: "oppPts", label: "平均失点", sortValue: (r) => r.oppPtsAvg, format: (r) => formatDecimal(r.oppPtsAvg) },
    { key: "net", label: "平均得失点", sortValue: (r) => r.netAvg, format: (r) => formatSigned(r.netAvg) },
    { key: "ortg", label: "ORtg", sortValue: (r) => r.ortg, format: (r) => formatDecimal(r.ortg) },
    { key: "drtg", label: "DRtg", sortValue: (r) => r.drtg, format: (r) => formatDecimal(r.drtg) },
    { key: "netrtg", label: "NETRtg", sortValue: (r) => r.netrtg, format: (r) => formatSigned(r.netrtg) },
    {
      key: "oppWinPct",
      label: "対戦相手の加重平均勝率",
      sortValue: (r) => r.oppWinPctAvg ?? -1,
      format: (r) => (r.oppWinPctAvg !== undefined ? formatWinPct(r.oppWinPctAvg) : "-"),
    },
    {
      key: "streak",
      label: "連勝/連敗",
      sortValue: (r) => (r.streak ? (r.streak.type === "win" ? r.streak.count : -r.streak.count) : 0),
      format: (r) => formatTeamStreak(r.streak),
    },
  ];

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <p className="page-subtitle">
        現行{teams.length}クラブの直近{recentN}試合の成績によるランキング（レギュラーシーズン・
        {postseasonLabel(season)}合算）。ORtg/DRtg/NETRtgは直近{recentN}試合の合算値から算出。対戦相手の加重平均
        勝率は、直近{recentN}試合の各対戦相手のその試合時点までの勝率を単純平均したもの（対戦相手が
        未消化の試合は対象外）。連勝/連敗は直近{recentN}試合の絞り込みとは独立に、今シーズンの
        全試合を通して現在何連勝/連敗中かを示す
      </p>
      <FilterBar
        simple
        stateKey="teams:recent"
        axes={[
          simpleSelectAxis({
            id: "recentN",
            label: "対象期間",
            options: RECENT_FORM_N_OPTIONS.map((n) => ({ value: String(n), label: `直近${n}試合` })),
            value: String(recentN),
            onChange: (v) => setRecentN(Number(v) as (typeof RECENT_FORM_N_OPTIONS)[number]),
          }),
        ]}
      />
      <ConditionTitle
        title={`${season}シーズン チーム直近成績`}
        conditions={composeLabels(`直近${recentN}試合`, gameTypeLabels("both", season))}
      />
      {gameLogsLoading || !gameLogsByTeam ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            statScope="team"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.team.teamId}
            defaultSortKey="winPct"
            linkTo={(r) => `/teams/${r.team.teamId}`}
          />
        </div>
      )}
    </div>
  );
}
