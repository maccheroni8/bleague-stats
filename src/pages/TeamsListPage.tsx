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
import { useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  ClubHonor,
  ClubHonorsFile,
  DivisionHistoryFile,
  GameSummary,
  LeagueTeamRankEntry,
  LeagueTeamRankingsFile,
  SeasonRules,
  ShotTypeCounts,
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
import { formatShotTypeCell, shotTypeLabel, sortShotTypeKeys, sumShotTypeCounts } from "../lib/shotTypeBreakdown";
import { CAREER_TOTAL_DEFS, TEAM_RECORD_STATS } from "../../shared/teamRecords";
import { ONE_TEAM_DIVISIONS, TEAM_DIVISIONS, TEAM_NAMES } from "../../scripts/lib/divisions";

type TeamsPageTab = "list" | "stats" | "records" | "champions";

// 「チーム」ページのタブ構成。「一覧」は元々あったチーム一覧（ロゴ＋シーズン成績の表）、
// 「全チームスタッツ」は旧/teams/statsページを移設したもの、「歴代記録」は
// data/league-team-rankings.json（Phase H7）を使った過去在籍全クラブ横断のランキング、
// 「歴代王者」はdata/club-honors.jsonを使ったシーズン軸の年間王者年表。タブ切り替え自体は
// URLに同期しない（TeamDetailPage.tsxのタブと同じ、プレーンなuseStateのパターンを踏襲）が、
// 旧/teams/statsへのリンクから遷移してきた場合のみ、Navigateのstateで初期タブを
// 「全チームスタッツ」に指定する（下記TeamsStatsRedirect参照）
export function TeamsListPage({ season }: { season: string }) {
  const location = useLocation();
  const initialTab = (location.state as { tab?: TeamsPageTab } | null)?.tab ?? "list";
  const [tab, setTab] = useState<TeamsPageTab>(initialTab);

  return (
    <div>
      <h1>チーム</h1>
      <p className="page-subtitle">{season}シーズン</p>
      <div className="tab-bar">
        <button
          className={`tab-button${tab === "list" ? " active" : ""}`}
          onClick={() => setTab("list")}
          type="button"
        >
          一覧
        </button>
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
      </div>
      {tab === "list" ? (
        <TeamsOverviewTab season={season} />
      ) : tab === "stats" ? (
        <AllTeamsStatsTab season={season} />
      ) : tab === "records" ? (
        <LeagueRecordsTab />
      ) : (
        <ChampionsTab />
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

const overviewColumns: Column<TeamSummary>[] = [
  {
    key: "teamName",
    label: "チーム",
    sortValue: (t) => t.teamName,
    align: "left",
    render: (t) => (
      <span className="team-name-cell">
        <TeamLogo teamId={t.teamId} size={20} />
        {t.teamName}
      </span>
    ),
  },
  {
    key: "record",
    label: "勝敗",
    sortValue: (t) => t.wins - t.losses,
    render: (t) => formatRecord(t.wins, t.losses),
  },
  { key: "pts", label: "得点", sortValue: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts) },
  {
    key: "oppPts",
    label: "失点",
    sortValue: (t) => t.opponentPerGame.pts,
    format: (t) => formatDecimal(t.opponentPerGame.pts),
  },
  { key: "net", label: "Net", sortValue: (t) => t.netPerGame.pts, format: (t) => formatSigned(t.netPerGame.pts) },
  { key: "reb", label: "REB", sortValue: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb) },
  { key: "ast", label: "AST", sortValue: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast) },
  { key: "stl", label: "STL", sortValue: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl) },
  { key: "blk", label: "BLK", sortValue: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk) },
  { key: "tov", label: "TOV", sortValue: (t) => t.perGame.tov, format: (t) => formatDecimal(t.perGame.tov) },
  { key: "fgPct", label: "FG%", sortValue: (t) => t.shooting.fgPct, format: (t) => formatPct(t.shooting.fgPct) },
  { key: "tpPct", label: "3P%", sortValue: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct) },
  { key: "ftPct", label: "FT%", sortValue: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct) },
];

function TeamsOverviewTab({ season }: { season: string }) {
  const { data, loading, error } = useJsonData(() => fetchTeams(season), [season]);

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!data || data.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div className="table-scroll">
      <SortableTable
        columns={overviewColumns}
        rows={data}
        rowKey={(t) => t.teamId}
        defaultSortKey="pts"
        linkTo={(t) => `/teams/${t.teamId}`}
      />
    </div>
  );
}

// 全26チーム分の「チームスタッツ」一覧タブ。チーム詳細ページ「チームスタッツ」タブと同じ
// 項目（トラディショナル/アドバンスド/Misc/スコアリング、平均/合計、レギュラー/プレーオフ/合算）
// を全チーム横並びの表に展開する。ただし詳細ページのタブは試合の生データ（PlayByPlays込み）を
// 使って正確な値を出しているのに対し、26チーム分を毎回その方式で再集計すると通信量が
// 26倍近くに膨らみ実用的でないため、こちらはteam-games/{teamId}.json（TeamGameLog、既に
// 集計済みの軽量な試合ログ）だけで完結する項目に絞っている。BSR（被ブロック）・EFF（貢献度）・
// AND1・UFOUL/DQFOUL・被アシスト内訳・LIVETOV/DEADTOV・ペイント内外分割等、生データが無いと
// 算出できない項目はこの一覧には含めていない（DESIGN.md参照、既知の制約）
const BOX_TABS = BOXSCORE_TABS;
const DISPLAY_MODE_OPTIONS: SeasonDisplayMode[] = ["perGame", "total"];

interface TeamTotals {
  pts: number;
  oppPts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
  fd: number;
  min: number;
  poss: number;
  oppFgm: number;
  oppFga: number;
  oppTpm: number;
  oppTpa: number;
  oppFtm: number;
  oppFta: number;
  oppOreb: number;
  oppDreb: number;
  oppTov: number;
  oppAst: number;
  oppStl: number;
  oppBlk: number;
  oppPf: number;
  oppFd: number;
  pt2in: number;
  fb: number;
  pt2nd: number;
  pft: number;
  dunks: number;
}

const EMPTY_TOTALS: TeamTotals = {
  pts: 0,
  oppPts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  oreb: 0,
  dreb: 0,
  reb: 0,
  ast: 0,
  tov: 0,
  stl: 0,
  blk: 0,
  pf: 0,
  fd: 0,
  min: 0,
  poss: 0,
  oppFgm: 0,
  oppFga: 0,
  oppTpm: 0,
  oppTpa: 0,
  oppFtm: 0,
  oppFta: 0,
  oppOreb: 0,
  oppDreb: 0,
  oppTov: 0,
  oppAst: 0,
  oppStl: 0,
  oppBlk: 0,
  oppPf: 0,
  oppFd: 0,
  pt2in: 0,
  fb: 0,
  pt2nd: 0,
  pft: 0,
  dunks: 0,
};

function sumTeamGameLogs(logs: TeamGameLog[]): TeamTotals {
  return logs.reduce<TeamTotals>(
    (acc, g) => ({
      pts: acc.pts + g.teamScore,
      oppPts: acc.oppPts + g.opponentScore,
      fgm: acc.fgm + g.fgm,
      fga: acc.fga + g.fga,
      tpm: acc.tpm + g.tpm,
      tpa: acc.tpa + g.tpa,
      ftm: acc.ftm + g.ftm,
      fta: acc.fta + g.fta,
      oreb: acc.oreb + g.oreb,
      dreb: acc.dreb + g.dreb,
      reb: acc.reb + g.reb,
      ast: acc.ast + g.ast,
      tov: acc.tov + g.tov,
      stl: acc.stl + g.stl,
      blk: acc.blk + g.blk,
      pf: acc.pf + g.pf,
      fd: acc.fd + g.foulsDrawn,
      min: acc.min + g.min,
      poss: acc.poss + g.poss,
      oppFgm: acc.oppFgm + g.opponentFgm,
      oppFga: acc.oppFga + g.opponentFga,
      oppTpm: acc.oppTpm + g.opponentTpm,
      oppTpa: acc.oppTpa + g.opponentTpa,
      oppFtm: acc.oppFtm + g.opponentFtm,
      oppFta: acc.oppFta + g.opponentFta,
      oppOreb: acc.oppOreb + g.opponentOreb,
      oppDreb: acc.oppDreb + g.opponentDreb,
      oppTov: acc.oppTov + g.opponentTov,
      oppAst: acc.oppAst + g.opponentAst,
      oppStl: acc.oppStl + g.opponentStl,
      oppBlk: acc.oppBlk + g.opponentBlk,
      oppPf: acc.oppPf + g.opponentPf,
      oppFd: acc.oppFd + g.opponentFoulsDrawn,
      pt2in: acc.pt2in + g.pt2in,
      fb: acc.fb + g.fb,
      pt2nd: acc.pt2nd + g.pt2nd,
      pft: acc.pft + g.pft,
      dunks: acc.dunks + g.dunks,
    }),
    { ...EMPTY_TOTALS },
  );
}

interface AllTeamsRow {
  team: TeamSummary;
  gamesPlayed: number;
  totals: TeamTotals;
}

function scaledValue(total: number, gamesPlayed: number, mode: SeasonDisplayMode): number {
  return mode === "total" ? total : safeDiv(total, gamesPlayed);
}

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

function countColumn(
  key: string,
  label: string,
  pick: (t: TeamTotals) => number,
  mode: SeasonDisplayMode,
  digits = 1,
): Column<AllTeamsRow> {
  return {
    key,
    label,
    sortValue: (r) => scaledValue(pick(r.totals), r.gamesPlayed, mode),
    format: (r) => formatDecimal(scaledValue(pick(r.totals), r.gamesPlayed, mode), mode === "total" ? 0 : digits),
  };
}

function numberColumn(
  key: string,
  label: string,
  calc: (t: TeamTotals) => number,
  format: (v: number) => string,
): Column<AllTeamsRow> {
  return { key, label, sortValue: (r) => calc(r.totals), format: (r) => format(calc(r.totals)) };
}

function pctColumn(key: string, label: string, calc: (t: TeamTotals) => number): Column<AllTeamsRow> {
  return numberColumn(key, label, calc, (v) => formatPct(v));
}

function pct100Column(key: string, label: string, calc: (t: TeamTotals) => number): Column<AllTeamsRow> {
  return numberColumn(key, label, calc, (v) => formatPct100(v));
}

function buildTraditionalColumns(mode: SeasonDisplayMode): Column<AllTeamsRow>[] {
  return [
    teamColumn,
    gamesColumn,
    {
      key: "min",
      label: "MIN",
      sortValue: (r) => scaledValue(r.totals.min, r.gamesPlayed, mode),
      format: (r) => formatMinutesFromSeconds(Math.round(scaledValue(r.totals.min, r.gamesPlayed, mode) * 60)),
    },
    countColumn("pts", "PTS", (t) => t.pts, mode),
    countColumn("fgm", "FGM", (t) => t.fgm, mode),
    countColumn("fga", "FGA", (t) => t.fga, mode),
    pctColumn("fgpct", "FG%", (t) => safeDiv(t.fgm, t.fga)),
    countColumn("2pm", "2PM", (t) => t.fgm - t.tpm, mode),
    countColumn("2pa", "2PA", (t) => t.fga - t.tpa, mode),
    pctColumn("2ppct", "2P%", (t) => safeDiv(t.fgm - t.tpm, t.fga - t.tpa)),
    countColumn("3pm", "3PM", (t) => t.tpm, mode),
    countColumn("3pa", "3PA", (t) => t.tpa, mode),
    pctColumn("3ppct", "3P%", (t) => safeDiv(t.tpm, t.tpa)),
    countColumn("ftm", "FTM", (t) => t.ftm, mode),
    countColumn("fta", "FTA", (t) => t.fta, mode),
    pctColumn("ftpct", "FT%", (t) => safeDiv(t.ftm, t.fta)),
    pctColumn("efg", "eFG%", (t) => efgPct(t.fgm, t.tpm, t.fga)),
    numberColumn("ts", "TS%", (t) => tsPct(t.pts, t.fga, t.fta), (v) => formatPct(v)),
    countColumn("or", "OR", (t) => t.oreb, mode),
    countColumn("dr", "DR", (t) => t.dreb, mode),
    countColumn("tr", "TR", (t) => t.reb, mode),
    countColumn("ast", "AST", (t) => t.ast, mode),
    countColumn("tov", "TOV", (t) => t.tov, mode),
    numberColumn("asttov", "AST/TOV", (t) => safeDiv(t.ast, t.tov), (v) => v.toFixed(1)),
    countColumn("stl", "STL", (t) => t.stl, mode),
    countColumn("blk", "BLK", (t) => t.blk, mode),
    countColumn("f", "F", (t) => t.pf, mode),
    countColumn("fd", "FD", (t) => t.fd, mode),
    {
      key: "plusminus",
      label: "+/-",
      sortValue: (r) => scaledValue(r.totals.pts - r.totals.oppPts, r.gamesPlayed, mode),
      format: (r) =>
        formatSigned(scaledValue(r.totals.pts - r.totals.oppPts, r.gamesPlayed, mode), mode === "total" ? 0 : 1),
    },
  ];
}

function buildAdvancedColumns(mode: SeasonDisplayMode): Column<AllTeamsRow>[] {
  return [
    teamColumn,
    gamesColumn,
    pct100Column("tovpct", "TOV%", (t) => tovPct(t.tov, t.fga, t.fta)),
    numberColumn("ftr", "FTR", (t) => ftRate(t.fta, t.fga), (v) => formatDecimal(v, 3)),
    pct100Column("orbpct", "OR%", (t) => orbPct(t.oreb, t.oppDreb)),
    pctColumn("efg", "eFG%", (t) => efgPct(t.fgm, t.tpm, t.fga)),
    numberColumn("ts", "TS%", (t) => tsPct(t.pts, t.fga, t.fta), (v) => formatPct(v)),
    numberColumn("pps", "PPS", (t) => safeDiv(t.pts, t.fga), (v) => formatDecimal(v, 2)),
    {
      key: "poss",
      label: "POSS",
      sortValue: (r) => scaledValue(r.totals.poss, r.gamesPlayed, mode),
      format: (r) => formatDecimal(scaledValue(r.totals.poss, r.gamesPlayed, mode), mode === "total" ? 0 : 1),
    },
    numberColumn("pace", "PACE", (t) => pace(t.poss, t.min), (v) => formatDecimal(v)),
    numberColumn("ortg", "ORtg", (t) => offensiveRating(t.pts, t.poss), (v) => formatDecimal(v)),
    numberColumn("drtg", "DRtg", (t) => offensiveRating(t.oppPts, t.poss), (v) => formatDecimal(v)),
    numberColumn(
      "netrtg",
      "NetRtg",
      (t) => offensiveRating(t.pts, t.poss) - offensiveRating(t.oppPts, t.poss),
      (v) => formatSigned(v),
    ),
  ];
}

function buildMiscColumns(mode: SeasonDisplayMode): Column<AllTeamsRow>[] {
  return [
    teamColumn,
    gamesColumn,
    countColumn("pitp", "PITP", (t) => t.pt2in, mode),
    countColumn("fbps", "FBPS", (t) => t.fb, mode),
    countColumn("2ndpts", "2ND PTS", (t) => t.pt2nd, mode),
    countColumn("ptsofftov", "PTSOFFTO", (t) => t.pft, mode),
    countColumn("dunk", "DUNK", (t) => t.dunks, mode),
  ];
}

function buildScoringColumns(): Column<AllTeamsRow>[] {
  return [
    teamColumn,
    gamesColumn,
    pct100Column("pitppct", "PITP%", (t) => safeDiv(100 * t.pt2in, t.pts)),
    pct100Column("fbppct", "FBP%", (t) => safeDiv(100 * t.fb, t.pts)),
    pct100Column("2ndptspct", "2ND PTS%", (t) => safeDiv(100 * t.pt2nd, t.pts)),
    pct100Column("ptsofftovpct", "PTSOFFTO%", (t) => safeDiv(100 * t.pft, t.pts)),
  ];
}

const DEFAULT_SORT_KEY: Record<BoxscoreTabKey, string> = {
  traditional: "pts",
  advanced: "netrtg",
  misc: "pitp",
  scoring: "pitppct",
};

// 「シューティング（シュートタイプ別）」一覧用の行。TeamSummary.shotTypesをそのまま使う
// （2P/3Pを合算した1セルにまとめる。1チーム分の詳細ページのような2P/3P別の内訳表示は
// 列数が倍増し26チーム分の一覧としては見づらくなるため、こちらは合算のみ表示する）
interface ShootingRow {
  team: TeamSummary;
}

function combinedShotTypeCounts(team: TeamSummary, key: string): ShotTypeCounts | undefined {
  const split = team.shotTypes?.[key];
  if (!split) return undefined;
  return sumShotTypeCounts(split.twoPoint, split.threePoint);
}

function shotTypePct(team: TeamSummary, key: string): number {
  const counts = combinedShotTypeCounts(team, key);
  return counts && counts.attempted > 0 ? counts.made / counts.attempted : -1;
}

interface TurnoverRow {
  team: TeamSummary;
  data: TeamForcedTurnovers;
}

function turnoverTotal(data: TeamForcedTurnovers): number {
  return data.offensiveFoul + data.violation24sec + data.backcourtViolation + data.violation5sec + data.otherDead + data.live;
}

function AllTeamsStatsTab({ season }: { season: string }) {
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const { supported: yahooPbpSupported } = useYahooPbpCoverage(season);

  const [gameLogsByTeam, setGameLogsByTeam] = useState<Map<string, TeamGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(true);
  const [summaries, setSummaries] = useState<GameSummary[] | null>(null);
  const [divisionHistory, setDivisionHistory] = useState<DivisionHistoryFile | null>(null);

  useEffect(() => {
    if (!teams) return;
    let cancelled = false;
    setGameLogsLoading(true);
    setGameLogsByTeam(null);
    Promise.all(
      teams.map(async (t): Promise<readonly [string, TeamGameLog[]]> => {
        try {
          return [t.teamId, await fetchTeamGameLogs(season, t.teamId)] as const;
        } catch {
          return [t.teamId, []] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setGameLogsByTeam(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setGameLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [teams, season]);

  useEffect(() => {
    let cancelled = false;
    setSummaries(null);
    setDivisionHistory(null);
    Promise.all([fetchGameSummaries(season), fetchDivisionHistory()])
      .then(([s, d]) => {
        if (!cancelled) {
          setSummaries(s);
          setDivisionHistory(d);
        }
      })
      .catch(() => {
        // 対勝率別・地区フィルタが使えなくなるだけなので、失敗しても他の機能は継続する
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const [boxTab, setBoxTab] = useState<BoxscoreTabKey>("traditional");
  const [displayMode, setDisplayMode] = useState<SeasonDisplayMode>("perGame");
  const [gameType, setGameType] = useState<SeasonGameTypeFilter>("regular");
  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const [turnoverPerspective, setTurnoverPerspective] = useState<"forced" | "committed">("forced");

  const opponentRecords = useMemo<Map<string, Map<string, RecordBeforeGame>> | undefined>(
    () => (summaries ? buildRecordsBeforeGame(summaries) : undefined),
    [summaries],
  );

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const logs = gameLogsByTeam.get(team.teamId) ?? [];
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season);
      const scoped = filterByGameType(situational, gameType);
      return { team, gamesPlayed: scoped.length, totals: sumTeamGameLogs(scoped) };
    });
  }, [teams, gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season]);

  const columns = useMemo(() => {
    switch (boxTab) {
      case "traditional":
        return buildTraditionalColumns(displayMode);
      case "advanced":
        return buildAdvancedColumns(displayMode);
      case "misc":
        return buildMiscColumns(displayMode);
      case "scoring":
        return buildScoringColumns();
    }
  }, [boxTab, displayMode]);

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
    ...shotTypeKeys.map(
      (key): Column<ShootingRow> => ({
        key,
        label: shotTypeLabel(key),
        sortValue: (r) => shotTypePct(r.team, key),
        format: (r) => formatShotTypeCell(combinedShotTypeCounts(r.team, key)),
      }),
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
        </div>
        <div className="mode-toggle">
          {DISPLAY_MODE_OPTIONS.map((m) => (
            <button key={m} className={m === displayMode ? "active" : ""} onClick={() => setDisplayMode(m)} type="button">
              {SEASON_DISPLAY_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      {gameLogsLoading || !gameLogsByTeam ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            key={boxTab}
            columns={columns}
            rows={rows}
            rowKey={(r) => r.team.teamId}
            defaultSortKey={DEFAULT_SORT_KEY[boxTab]}
            linkTo={(r) => `/teams/${r.team.teamId}`}
          />
        </div>
      )}
      <p className="page-subtitle">
        team-games/{"{teamId}"}.json（試合ログ）から選択中の条件で再集計した値。BSR（被ブロック）・EFF（貢献度）・AND1・UFOUL/DQFOUL・被アシスト内訳・LIVETOV/DEADTOV・ペイント内外分割は、26チーム分を試合の生データから再集計すると通信量が大きくなりすぎるため、この一覧には含めていない（チーム詳細ページの「チームスタッツ」タブでは1チーム分に限り表示している）
      </p>

      <h2>シューティング（シュートタイプ別）</h2>
      {!yahooPbpSupported ? (
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
            レギュラーシーズン・シーズン平均のみ（上部の切り替えとは連動しない）。2P/3Pを合算した成功/試投/成功率を表示する
          </p>
        </>
      )}

      <h2>ターンオーバー強制/被強制（種類別）</h2>
      {!yahooPbpSupported ? (
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
          <p className="page-subtitle">レギュラーシーズン・シーズン合計のみ（上部の切り替えとは連動しない）</p>
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

function leagueEntriesFor(
  rankings: LeagueTeamRankingsFile | null,
  category: RecordsCategory,
  gameType: SeasonGameTypeFilter,
  statKey: string,
): Record<string, LeagueTeamRankEntry> | undefined {
  if (!rankings) return undefined;
  if (category === "seasonSpecial") {
    return statKey === "wins" || statKey === "streak" ? rankings.seasonSpecial[gameType][statKey] : undefined;
  }
  return rankings[category][gameType][statKey];
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

  const entries = leagueEntriesFor(rankings, category, gameType, statKey);
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
        <p className="empty-message">このレギュラー/プレーオフ区分・項目では該当クラブがありません</p>
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
                          <span className="rank-sublabel">現在: {leagueTeamCurrentCategoryLabel(r.teamId)}</span>
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

  const [teamsBySeason, setTeamsBySeason] = useState<Map<string, TeamSummary[]> | null>(null);
  const [teamsLoading, setTeamsLoading] = useState(true);

  useEffect(() => {
    if (championSeasons.length === 0) {
      setTeamsBySeason(new Map());
      setTeamsLoading(false);
      return;
    }
    let cancelled = false;
    setTeamsLoading(true);
    Promise.all(
      championSeasons.map(async (s): Promise<readonly [string, TeamSummary[]]> => {
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
  }, [championSeasons]);

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
                  {items.map((h, i) => (
                    <li key={`${h.teamId}-${h.season}-${h.competition}-${i}`} className="honor-item">
                      <span className="honor-season">{h.season}</span>
                      <TeamNavLink teamId={h.teamId} divisionHistory={divisionHistory} className="honor-team-link">
                        {leagueTeamDisplayName(h.teamId)}
                      </TeamNavLink>
                      {"　"}
                      {h.competition}
                      {h.note && <span className="honor-note">（{h.note}）</span>}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
