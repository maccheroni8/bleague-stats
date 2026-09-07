import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, Navigate, useLocation } from "react-router-dom";
import {
  fetchClubHonors,
  fetchDivisionHistory,
  fetchGameSummaries,
  fetchLeagueTeamRankings,
  fetchSeasonRules,
  fetchSeasons,
  fetchTeamGameLogs,
  fetchTeams,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  ClubHonor,
  ClubHonorsFile,
  DivisionHistoryFile,
  GameSummary,
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
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import {
  buildRecordsBeforeGame,
  filterGameLogs,
  type RecordBeforeGame,
  type SituationalFilter,
} from "../lib/situational";
import {
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  filterByGameType,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "../lib/playerSeasonBoxscore";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import { formatDecimal, formatPct, formatPct100, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { efgPct, ftRate, offensiveRating, orbPct, pace, safeDiv, tovPct, tsPct } from "../../shared/formulas";
import { shotTypeEntityColumns, sortShotTypeKeys } from "../lib/shotTypeBreakdown";
import { CAREER_TOTAL_DEFS, TEAM_RECORD_STATS, currentStreak, type TeamStreak } from "../../shared/teamRecords";
import { ONE_TEAM_DIVISIONS, TEAM_DIVISIONS, TEAM_NAMES } from "../../scripts/lib/divisions";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  DEFAULT_SORT_KEY,
  sumTeamGameLogs,
  TEAM_PERSPECTIVE_LABELS,
  type AllTeamsRow,
  type TeamPerspective,
} from "../lib/teamStatsColumns";
import { useAllTeamGameLogs, useLeagueSituationalContext } from "../lib/teamRankingData";

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
    <div>
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
          歴代記録
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
        <LeagueRecordsTab />
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
const DISPLAY_MODE_OPTIONS: SeasonDisplayMode[] = ["perGame", "total"];

const teamColumn: Column<AllTeamsRow> = {
  key: "team",
  label: "チーム",
  align: "left",
  sortValue: (r) => r.team.teamName,
  render: (r) => (
    <span className="team-name-cell">
      <TeamLogo teamId={r.team.teamId} size={20} />
      {r.team.teamName}
    </span>
  ),
};

const gamesColumn: Column<AllTeamsRow> = {
  key: "g",
  label: "G",
  sortValue: (r) => r.gamesPlayed,
  format: (r) => String(r.gamesPlayed),
};

const recordColumn: Column<AllTeamsRow> = {
  key: "record",
  label: "勝敗",
  sortValue: (r) => r.wins - r.losses,
  format: (r) => formatRecord(r.wins, r.losses),
};

const winPctColumn: Column<AllTeamsRow> = {
  key: "winPct",
  label: "勝率",
  sortValue: (r) => safeDiv(r.wins, r.wins + r.losses),
  format: (r) => formatWinPct(safeDiv(r.wins, r.wins + r.losses)),
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
  const { coverage } = useSeasonCoverage(season);
  const paintSupported = isShotChartSupported(coverage);

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, teams);
  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season);

  const [boxTab, setBoxTab] = useState<BoxscoreTabKey | "shooting" | "forcedTurnovers">("traditional");
  const [displayMode, setDisplayMode] = useState<SeasonDisplayMode>("perGame");
  const [gameType, setGameType] = useState<SeasonGameTypeFilter>("regular");
  const [filter, setFilter] = useState<SituationalFilter>({ range: { kind: "all" } });
  const [teamPerspective, setTeamPerspective] = useState<TeamPerspective>("own");
  const [turnoverPerspective, setTurnoverPerspective] = useState<"forced" | "committed">("forced");

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const logs = gameLogsByTeam.get(team.teamId) ?? [];
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season);
      const scoped = filterByGameType(situational, gameType);
      const wins = scoped.filter((g) => g.win).length;
      return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals: sumTeamGameLogs(scoped) };
    });
  }, [teams, gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season]);

  const columns = useMemo(() => {
    switch (boxTab) {
      case "traditional":
        return [...LEADING_COLUMNS, ...buildTraditionalColumns(displayMode, teamPerspective)];
      case "advanced":
        return [...LEADING_COLUMNS, ...buildAdvancedColumns(displayMode, teamPerspective)];
      case "misc":
        return [...LEADING_COLUMNS, ...buildMiscColumns(displayMode, teamPerspective)];
      case "scoring":
        return [...LEADING_COLUMNS, ...buildScoringColumns(teamPerspective, paintSupported)];
      case "shooting":
      case "forcedTurnovers":
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
          <TeamLogo teamId={r.team.teamId} size={20} />
          {r.team.teamName}
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
  const turnoverColumns: Column<TurnoverRow>[] = [
    {
      key: "team",
      label: "チーム",
      align: "left",
      sortValue: (r) => r.team.teamName,
      render: (r) => (
        <span className="team-name-cell">
          <TeamLogo teamId={r.team.teamId} size={20} />
          {r.team.teamName}
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

  return (
    <div>
      <p className="page-subtitle">全{teams.length}チーム</p>

      <SituationalFilterPicker
        filter={filter}
        onChange={setFilter}
        opponentWinRateSupported={!!opponentRecords}
        hideGameTypeToggle
      />
      <div className="mode-toggle">
        {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
          <button key={g} className={g === gameType ? "active" : ""} onClick={() => setGameType(g)} type="button">
            {SEASON_GAME_TYPE_LABELS[g]}
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        {(["own", "opp", "diff"] as TeamPerspective[]).map((p) => (
          <button key={p} className={p === teamPerspective ? "active" : ""} onClick={() => setTeamPerspective(p)} type="button">
            {TEAM_PERSPECTIVE_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="tab-bar-with-toggle">
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
            シューティング
          </button>
          <button
            className={`tab-button${boxTab === "forcedTurnovers" ? " active" : ""}`}
            onClick={() => setBoxTab("forcedTurnovers")}
            type="button"
          >
            強制ターンオーバー
          </button>
        </div>
        <div className="mode-toggle">
          {DISPLAY_MODE_OPTIONS.map((m) => (
            <button key={m} className={m === displayMode ? "active" : ""} onClick={() => setDisplayMode(m)} type="button">
              {SEASON_DISPLAY_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {boxTab === "shooting" ? (
        !yahooPbpSupported ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <div className="table-scroll">
              <SortableTable
                columns={shootingColumns}
                rows={shootingRows}
                rowKey={(r) => r.team.teamId}
                defaultSortKey="team"
                defaultSortDir="asc"
                linkTo={(r) => `/teams/${r.team.teamId}`}
              />
            </div>
            <p className="page-subtitle">
              レギュラーシーズン・シーズン平均のみ（上部のシチュエーション別フィルタ・レギュラー/プレーオフ/合算・自チーム/opp/+/-とは連動しない）。シュートタイプ×2P/3P別に成功数（M）・試投数（A）・成功率（%）の3列に分けて表示する。列見出しクリックで並び替え
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
                相手から奪った（自チームが強制）
              </button>
              <button
                className={turnoverPerspective === "committed" ? "active" : ""}
                onClick={() => setTurnoverPerspective("committed")}
                type="button"
              >
                自チームが記録（相手に強制された）
              </button>
            </div>
            <div className="table-scroll">
              <SortableTable
                columns={turnoverColumns}
                rows={turnoverRows}
                rowKey={(r) => r.team.teamId}
                defaultSortKey="total"
                linkTo={(r) => `/teams/${r.team.teamId}`}
              />
            </div>
            <p className="page-subtitle">
              レギュラーシーズン・シーズン合計のみ（上部のシチュエーション別フィルタ・レギュラー/プレーオフ/合算・自チーム/opp/+/-とは連動しない）
            </p>
          </>
        )
      ) : gameLogsLoading || !gameLogsByTeam ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <div className="table-scroll">
            <SortableTable
              key={`${boxTab}-${teamPerspective}`}
              columns={columns}
              rows={rows}
              rowKey={(r) => r.team.teamId}
              defaultSortKey={DEFAULT_SORT_KEY[boxTab]}
              linkTo={(r) => `/teams/${r.team.teamId}`}
            />
          </div>
          <p className="page-subtitle">
            team-games/{"{teamId}"}.json（試合ログ）から選択中の条件で再集計した値。BSR（被ブロック）・EFF（貢献度）・LIVETOV/DEADTOVは、26チーム分を試合の生データから再集計すると通信量が大きくなりすぎるため、この一覧には含めていない（チーム詳細ページの「チームスタッツ」タブでは1チーム分に限り表示している）
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
type RecordsCategory = "career" | "clubRecord" | "seasonSpecial";

const RECORDS_CATEGORY_LABELS: Record<RecordsCategory, string> = {
  career: "通算成績",
  clubRecord: "クラブレコード",
  seasonSpecial: "シーズン記録",
};

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
  }
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
type LeagueVenue = "total" | "home" | "away";
const LEAGUE_VENUE_LABELS: Record<LeagueVenue, string> = { total: "トータル", home: "ホーム", away: "アウェイ" };

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

// TEAM_NAMES（scripts/lib/divisions.ts）は現行B.PREMIER26クラブのみを収録している
// （その出典・用途が26クラブに固定されているため）。過去在籍のみで現在はB.ONEに所属する
// 4クラブ（新潟・FE名古屋・越谷・ライジングゼファー福岡）の名称はここで補う
const EXTRA_TEAM_NAMES: Record<string, string> = {
  "695": "新潟アルビレックスBB",
  "717": "ファイティングイーグルス名古屋",
  "745": "越谷アルファーズ",
  "753": "ライジングゼファー福岡",
};

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

interface LeagueRecordRow {
  teamId: string;
  entry: LeagueTeamRankEntry;
}

function LeagueRecordsTab() {
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

  const entries = leagueEntriesFor(rankings, category, venue, gameType, statKey);
  const rows: LeagueRecordRow[] = entries
    ? Object.entries(entries)
        .map(([teamId, entry]) => ({ teamId, entry }))
        .sort((a, b) => a.entry.rank - b.entry.rank)
    : [];
  const totalTeams = Object.keys(rankings.career.regular.wins ?? {}).length;
  const activeLabel = statOptions.find((d) => d.key === statKey)?.label ?? statKey;

  return (
    <div>
      <p className="page-subtitle">
        過去在籍した全{totalTeams}クラブ横断のランキング（{rankings.generatedAt.slice(0, 10)}
        時点。手動バッチで随時更新）。チーム名の下は現在の所属カテゴリ
      </p>

      <div className="mode-toggle">
        {(Object.keys(RECORDS_CATEGORY_LABELS) as RecordsCategory[]).map((c) => (
          <button key={c} className={c === category ? "active" : ""} onClick={() => selectCategory(c)} type="button">
            {RECORDS_CATEGORY_LABELS[c]}
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        {(Object.keys(LEAGUE_VENUE_LABELS) as LeagueVenue[]).map((v) => (
          <button key={v} className={v === venue ? "active" : ""} onClick={() => setVenue(v)} type="button">
            {LEAGUE_VENUE_LABELS[v]}
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
          <button key={g} className={g === gameType ? "active" : ""} onClick={() => setGameType(g)} type="button">
            {SEASON_GAME_TYPE_LABELS[g]}
          </button>
        ))}
      </div>
      <div className="stat-picker">
        {statOptions.map((d) => (
          <button key={d.key} className={d.key === statKey ? "active" : ""} onClick={() => setStatKey(d.key)} type="button">
            {d.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty-message">この条件（ホーム/アウェイ/トータル・レギュラー/プレーオフ区分・項目）では該当クラブがありません</p>
      ) : (
        <div className="table-scroll">
          <table className="sortable-table rankings-table">
            <thead>
              <tr>
                <th className="align-right">#</th>
                <th className="align-left">チーム</th>
                <th className="align-right">{activeLabel}</th>
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
                          <span className="rank-name">{leagueTeamDisplayName(r.teamId)}</span>
                          <span className="rank-sublabel">{leagueTeamCurrentCategoryLabel(r.teamId)}</span>
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
        シーズン別の年間王者（Bリーグチャンピオンシップ優勝）年表。チーム名クリックでチーム詳細ページへ遷移できる
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
                <th className="align-right">PTS</th>
                <th className="align-right">REB</th>
                <th className="align-right">AST</th>
                <th className="align-right">FG%</th>
                <th className="align-right">3P%</th>
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
                              {leagueTeamDisplayName(champion.teamId)}
                            </span>
                          </TeamNavLink>
                          {champion.note && <span className="honor-note">（{champion.note}）</span>}
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
                          {leagueTeamDisplayName(champion.teamId)}
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
                          {leagueTeamDisplayName(h.teamId)}
                        </TeamNavLink>
                        {team && (
                          <span className="honor-note">
                            （{formatRecord(team.wins, team.losses)} {formatWinPct(safeDiv(team.wins, team.wins + team.losses))}）
                          </span>
                        )}
                        {"　"}
                        {h.competition}
                        {h.note && <span className="honor-note">（{h.note}）</span>}
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

function formatTeamStreak(streak: TeamStreak | null): string {
  if (!streak || streak.count === 0) return "-";
  return streak.type === "win" ? `${streak.count}連勝` : `${streak.count}連敗`;
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
      // 各対戦相手の「その試合時点までの」勝率を求め、単純平均する。対戦相手の消化試合数が
      // 0（記録が無い、または未消化）の試合は対象外にする（48-5章の対勝率別フィルタと同様、
      // 0試合を勝率0扱いにすると不当に低く出てしまうため）
      const oppWinPcts = recentLogs.flatMap((g) => {
        const rec = opponentRecords?.get(g.scheduleKey)?.get(g.opponentTeamId);
        if (!rec || rec.wins + rec.losses === 0) return [];
        return [safeDiv(rec.wins, rec.wins + rec.losses)];
      });
      const oppWinPctAvg = oppWinPcts.length > 0 ? safeDiv(oppWinPcts.reduce((s, v) => s + v, 0), oppWinPcts.length) : undefined;
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
          <TeamLogo teamId={r.team.teamId} size={20} />
          {r.team.teamName}
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
        プレーオフ合算）。ORtg/DRtg/NETRtgは直近{recentN}試合の合算値から算出。対戦相手の加重平均
        勝率は、直近{recentN}試合の各対戦相手のその試合時点までの勝率を単純平均したもの（対戦相手が
        未消化の試合は対象外）。連勝/連敗は直近{recentN}試合の絞り込みとは独立に、今シーズンの
        全試合を通して現在何連勝/連敗中かを示す
      </p>
      <div className="mode-toggle">
        {RECENT_FORM_N_OPTIONS.map((n) => (
          <button key={n} className={n === recentN ? "active" : ""} onClick={() => setRecentN(n)} type="button">
            直近{n}試合
          </button>
        ))}
      </div>
      {gameLogsLoading || !gameLogsByTeam ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
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
