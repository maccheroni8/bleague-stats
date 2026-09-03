import { useEffect, useMemo, useState } from "react";
import {
  fetchDivisionHistory,
  fetchGameSummaries,
  fetchTeamGameLogs,
  fetchTeams,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  DivisionHistoryFile,
  GameSummary,
  ShotTypeCounts,
  TeamForcedTurnovers,
  TeamGameLog,
  TeamSummary,
} from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { TeamLogo } from "../components/TeamLogo";
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
import { formatDecimal, formatPct, formatPct100, formatSigned } from "../lib/format";
import { formatAstToRatio, formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { efgPct, ftRate, offensiveRating, orbPct, pace, safeDiv, tovPct, tsPct } from "../../shared/formulas";
import { formatShotTypeCell, shotTypeLabel, sortShotTypeKeys, sumShotTypeCounts } from "../lib/shotTypeBreakdown";

// 全26チーム分の「チームスタッツ」一覧ページ。チーム詳細ページ「チームスタッツ」タブと同じ
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

export function AllTeamsStatsPage({ season }: { season: string }) {
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
      <h1>全チームスタッツ</h1>
      <p className="page-subtitle">{season}シーズン・全{teams.length}チーム</p>

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
