import { useEffect, useRef, useState, type ReactNode } from "react";
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
import {
  fetchClubHonors,
  fetchGameSummaries,
  fetchPlayers,
  fetchSchedule,
  fetchSeasons,
  fetchTeamColors,
  fetchTeamGameLogs,
  fetchTeamHistory,
  fetchTeamLineups,
  fetchTeams,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import type { ClubHonor, GameSummary, GameType, PlayerSummary, TeamSummary, UpcomingGameEntry } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatRecord, formatSigned } from "../lib/format";
import { computeTeamSituationalStats, filterGameLogs, isDefaultFilter, type SituationalFilter } from "../lib/situational";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { safeDiv } from "../../shared/formulas";

// 出場時間がこれ未満のラインナップはサンプルが小さすぎてノイズが大きいため一覧から除外する
// （実データ確認: 4試合時点で3分(180秒)基準だとチームあたり4〜14組が該当。DESIGN.md参照）
const MIN_LINEUP_SECONDS = 180;
const MAX_LINEUP_ROWS = 10;

const LEADER_STAT_KEYS = ["pts", "reb", "ast", "stl", "blk"];
const LEADERS_PER_STAT = 3;

interface RadarStatDef {
  key: string;
  label: string;
  value: (t: TeamSummary) => number;
  format: (t: TeamSummary) => string;
  /** falseならDRtgのように値が小さいほど良い項目。パーセンタイル換算・順位算出の向きに使う */
  higherIsBetter: boolean;
}

// 他クラブ比較レーダーチャート用の8項目。多すぎると見づらいため主要項目のみに絞る
const RADAR_STAT_DEFS: RadarStatDef[] = [
  { key: "pts", label: "PTS", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
  { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
  { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
  { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
  { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
  {
    key: "efgPct",
    label: "eFG%",
    value: (t) => t.shooting.efgPct,
    format: (t) => formatPct(t.shooting.efgPct),
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

type PlayerStatMode = "basic" | "advanced";

const PLAYER_STAT_MODE_LABELS: Record<PlayerStatMode, string> = {
  basic: "基本",
  advanced: "アドバンスド",
};

const HONOR_CATEGORY_LABELS: Record<ClubHonor["category"], string> = {
  overall: "年間優勝",
  division: "地区優勝",
  international: "国際大会",
};
const HONOR_CATEGORY_ORDER: ClubHonor["category"][] = ["overall", "division", "international"];

type DetailTab = "overview" | "schedule" | "stats";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概要",
  schedule: "日程結果",
  stats: "スタッツ",
};

interface SeasonRecord {
  season: string;
  teamName: string;
  team: TeamSummary;
}

interface TeamScheduleRow {
  scheduleKey: string;
  date: string;
  opponentName: string;
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

function calculateAge(birthDate: string, asOf: Date = new Date()): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  let age = asOf.getFullYear() - y;
  const hadBirthdayThisYear = asOf.getMonth() + 1 > m || (asOf.getMonth() + 1 === m && asOf.getDate() >= d);
  if (!hadBirthdayThisYear) age -= 1;
  return age;
}

/** 選手名セル: サムネイル写真＋名前＋簡易プロフィール（ポジション・身長・体重）をまとめて表示する */
function playerProfileLine(p: PlayerSummary): string | null {
  const parts: string[] = [];
  if (p.position) parts.push(p.position);
  if (p.heightCm != null) parts.push(`${p.heightCm}cm`);
  if (p.weightKg != null) parts.push(`${p.weightKg}kg`);
  return parts.length > 0 ? parts.join("・") : null;
}

function buildPlayerColumns(mode: PlayerStatMode): Column<PlayerSummary>[] {
  const nameColumn: Column<PlayerSummary> = {
    key: "name",
    label: "選手",
    align: "left",
    sortValue: (p) => p.name,
    render: (p) => (
      <div className="player-cell">
        <PlayerPhoto playerId={p.playerId} size={32} className="player-cell-photo" />
        <div className="player-cell-info">
          <div className="player-cell-name">{p.name}</div>
          {playerProfileLine(p) && <div className="player-cell-profile">{playerProfileLine(p)}</div>}
        </div>
      </div>
    ),
  };
  const baseColumns: Column<PlayerSummary>[] = [
    nameColumn,
    { key: "gamesPlayed", label: "試合数", sortValue: (p) => p.gamesPlayed, format: (p) => String(p.gamesPlayed) },
    { key: "min", label: "MIN", sortValue: (p) => p.perGame.min, format: (p) => formatDecimal(p.perGame.min) },
  ];
  // 基本＝Bリーグ公式ボックススコアに基づく項目（source: "official"）、
  // アドバンスド＝NBA/Basketball-Reference流の補足・独自集計項目（source: "nba"/"custom"）。
  // statDefsのsourceフラグをそのまま切り替え軸に使う
  const statDefs = PLAYER_STAT_DEFS.filter((d) =>
    mode === "basic" ? d.source === "official" && d.key !== "min" : d.source !== "official",
  );
  const statColumns: Column<PlayerSummary>[] = statDefs.map((d) => ({
    key: d.key,
    label: d.label,
    sortValue: d.value,
    format: d.format,
  }));
  return [...baseColumns, ...statColumns];
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

export function TeamDetailPage({ season }: { season: string }) {
  const { teamId } = useParams<{ teamId: string }>();
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const { data: players, loading: playersLoading } = useJsonData(() => fetchPlayers(season), [season]);
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
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: summaries, loading: summariesLoading } = useJsonData(() => fetchGameSummaries(season), [season]);
  const { data: schedule, loading: scheduleLoading } = useJsonData(() => fetchSchedule(season), [season]);

  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = useState<DetailTab>("overview");
  const [playerStatMode, setPlayerStatMode] = useState<PlayerStatMode>("basic");

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
    if (tab !== "overview" || !teamId || !seasons || seasonHistoryFetchStartedRef.current) return;
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

  if (teamsLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;

  const team = teams?.find((t) => t.teamId === teamId);
  if (!team) return <p className="error-message">チームが見つかりませんでした</p>;

  const accentColor = teamColors?.[team.teamId]?.primary;
  const teamPlayers = (players ?? []).filter((p) => p.teamId === teamId);

  // 「スタメン選手」は現状このアプリに現在の先発5人という概念が無いため、シーズン中に
  // 1度でも先発出場した選手（gamesStarted > 0）を近似として使う
  const starters = teamPlayers.filter((p) => p.gamesStarted > 0);
  const avgHeightCm = averageOf(starters.flatMap((p) => (p.heightCm != null ? [p.heightCm] : [])));
  const avgWeightKg = averageOf(starters.flatMap((p) => (p.weightKg != null ? [p.weightKg] : [])));
  const avgAge = averageOf(starters.flatMap((p) => (p.birthDate ? [calculateAge(p.birthDate)] : [])));

  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter) : [];
  const situational = isDefaultFilter(filter) ? null : computeTeamSituationalStats(filteredLogs);

  const playerNameById = new Map((players ?? []).map((p) => [p.playerId, p.name]));
  const topLineups = (lineupsFile?.lineups ?? [])
    .filter((l) => l.secondsPlayed >= MIN_LINEUP_SECONDS)
    .slice(0, MAX_LINEUP_ROWS);

  const winPct = safeDiv(team.wins, team.wins + team.losses);

  const nameHistory = teamHistory?.find((h) => h.teamId === team.teamId)?.names ?? [];
  const honors = clubHonors?.[team.teamId] ?? [];

  const scheduleRows =
    summaries && teamId
      ? buildTeamScheduleRows(summaries, schedule?.upcomingGames ?? [], teamId, team.teamName)
      : [];

  const radarData = teams && teams.length > 1 ? buildRadarData(team, teams) : [];
  const playerColumns = buildPlayerColumns(playerStatMode);

  return (
    <div>
      <Link to="/teams" className="back-link">
        ← チーム一覧に戻る
      </Link>

      <div className="team-detail-header" style={accentColor ? { borderTopColor: accentColor } : undefined}>
        <TeamLogo teamId={team.teamId} size={56} />
        <div>
          <h1>{team.teamName}</h1>
          <p className="page-subtitle">
            {season}シーズン・{formatRecord(team.wins, team.losses)}
          </p>
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
        <>
          <h2>戦績</h2>
          <div className="stat-grid">
            <StatTile label="試合数" value={String(team.gamesPlayed)} />
            <StatTile label="勝敗" value={formatRecord(team.wins, team.losses)} />
            <StatTile label="勝率" value={formatPct(winPct)} />
          </div>

          <h2>他クラブ比較</h2>
          {radarData.length === 0 ? (
            <p className="empty-message">比較対象のチームがありません</p>
          ) : (
            <div className="radar-section">
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
              <div className="radar-rank-list">
                {radarData.map((d) => (
                  <div className="radar-rank-item" key={d.key}>
                    <span className="radar-rank-label">{d.label}</span>
                    <span className="radar-rank-value">
                      {d.rank}位/{d.total}（{d.actualValue}）
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <h2>シーズン別成績</h2>
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
          {seasonHistoryLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !seasonHistory || seasonHistory.length === 0 ? (
            <p className="empty-message">シーズン別成績がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">シーズン</th>
                    <th className="align-left">チーム名</th>
                    <th className="align-right">試合数</th>
                    <th className="align-right">勝敗</th>
                    <th className="align-right">勝率</th>
                    <th className="align-right">得点</th>
                    <th className="align-right">失点</th>
                    <th className="align-right">Net</th>
                    <th className="align-right">REB</th>
                    <th className="align-right">AST</th>
                    <th className="align-right">FG%</th>
                    <th className="align-right">3P%</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonHistory.map((r) => (
                    <tr key={r.season}>
                      <td className="align-left">
                        <RouterLink to={`/teams/${team.teamId}?season=${r.season}`} className="cell-link">
                          {r.season}
                        </RouterLink>
                      </td>
                      <td className="align-left">{r.teamName}</td>
                      <td className="align-right">{r.team.gamesPlayed}</td>
                      <td className="align-right">{formatRecord(r.team.wins, r.team.losses)}</td>
                      <td className="align-right">{formatPct(safeDiv(r.team.wins, r.team.wins + r.team.losses))}</td>
                      <td className="align-right">{formatDecimal(r.team.perGame.pts)}</td>
                      <td className="align-right">{formatDecimal(r.team.opponentPerGame.pts)}</td>
                      <td className="align-right">{formatSigned(r.team.netPerGame.pts)}</td>
                      <td className="align-right">{formatDecimal(r.team.perGame.reb)}</td>
                      <td className="align-right">{formatDecimal(r.team.perGame.ast)}</td>
                      <td className="align-right">{formatPct(r.team.shooting.fgPct)}</td>
                      <td className="align-right">{formatPct(r.team.shooting.tpPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>獲得タイトル</h2>
          {honors.length === 0 ? (
            <p className="empty-message">獲得タイトルの記録がありません</p>
          ) : (
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
                          {h.note && <span className="honor-note">（{h.note}）</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          <h2>チーム内リーダー</h2>
          {teamPlayers.length === 0 ? (
            <p className="empty-message">選手データがありません</p>
          ) : (
            <div className="team-leaders-grid">
              {LEADER_STAT_KEYS.map((key) => {
                const def = PLAYER_STAT_DEFS.find((d) => d.key === key);
                if (!def) return null;
                const top = [...teamPlayers].sort((a, b) => def.value(b) - def.value(a)).slice(0, LEADERS_PER_STAT);
                return (
                  <div className="team-leader-card" key={key}>
                    <div className="team-leader-stat-label">{def.label}</div>
                    {top.map((p) => (
                      <Link key={p.playerId} to={`/players/${p.playerId}`} className="team-leader-row">
                        <PlayerPhoto playerId={p.playerId} size={28} className="team-leader-photo" />
                        <span className="team-leader-name">{p.name}</span>
                        <span className="team-leader-value">{def.format(p)}</span>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "schedule" &&
        (summariesLoading || scheduleLoading ? (
          <p className="loading">読み込み中...</p>
        ) : scheduleRows.length === 0 ? (
          <p className="empty-message">日程データがありません</p>
        ) : (
          <div className="table-scroll">
            <table className="sortable-table schedule-table">
              <thead>
                <tr>
                  <th className="align-left">日付</th>
                  <th className="align-left">対戦相手</th>
                  <th className="align-right">結果</th>
                  <th className="align-left">会場</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((row) => (
                  <TeamScheduleRowView key={row.scheduleKey} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "stats" && (
        <>
          <SituationalFilterPicker filter={filter} onChange={setFilter} />

          {isDefaultFilter(filter) ? (
            <div className="stat-grid">
              <StatTile label="得点" value={formatDecimal(team.perGame.pts)} />
              <StatTile label="失点" value={formatDecimal(team.opponentPerGame.pts)} />
              <StatTile label="Net" value={formatSigned(team.netPerGame.pts)} />
              <StatTile label="REB" value={formatDecimal(team.perGame.reb)} />
              <StatTile label="AST" value={formatDecimal(team.perGame.ast)} />
              <StatTile label="STL" value={formatDecimal(team.perGame.stl)} />
              <StatTile label="BLK" value={formatDecimal(team.perGame.blk)} />
              <StatTile label="TOV" value={formatDecimal(team.perGame.tov)} />
              <StatTile label="FG%" value={formatPct(team.shooting.fgPct)} />
              <StatTile label="3P%" value={formatPct(team.shooting.tpPct)} />
              <StatTile label="FT%" value={formatPct(team.shooting.ftPct)} />
              <StatTile label="eFG%" value={formatPct(team.shooting.efgPct)} />
              <StatTile label="TS%" value={formatPct(team.shooting.tsPct)} />
            </div>
          ) : !situational ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="stat-grid">
              <StatTile label="試合数" value={String(situational.gamesPlayed)} />
              <StatTile label="得点" value={formatDecimal(situational.perGame.pts)} />
              <StatTile label="失点" value={formatDecimal(situational.perGame.oppPts)} />
              <StatTile label="Net" value={formatSigned(situational.perGame.net)} />
              <StatTile label="REB" value={formatDecimal(situational.perGame.reb)} />
              <StatTile label="AST" value={formatDecimal(situational.perGame.ast)} />
              <StatTile label="STL" value={formatDecimal(situational.perGame.stl)} />
              <StatTile label="BLK" value={formatDecimal(situational.perGame.blk)} />
              <StatTile label="TOV" value={formatDecimal(situational.perGame.tov)} />
              <StatTile label="FG%" value={formatPct(situational.shooting.fgPct)} />
              <StatTile label="3P%" value={formatPct(situational.shooting.tpPct)} />
              <StatTile label="FT%" value={formatPct(situational.shooting.ftPct)} />
              <StatTile label="eFG%" value={formatPct(situational.shooting.efgPct)} />
              <StatTile label="TS%" value={formatPct(situational.shooting.tsPct)} />
              <StatTile label="PACE" value={formatDecimal(situational.advanced.pace)} />
              <StatTile label="ORtg" value={formatDecimal(situational.advanced.offRtg)} />
              <StatTile label="DRtg" value={formatDecimal(situational.advanced.defRtg)} />
              <StatTile label="NetRtg" value={formatSigned(situational.advanced.netRtg)} />
            </div>
          )}

          {(avgHeightCm != null || avgWeightKg != null || avgAge != null) && (
            <>
              <h2>スタメン平均（先発出場経験のある選手）</h2>
              <div className="stat-grid">
                <StatTile label="平均身長" value={avgHeightCm != null ? `${formatDecimal(avgHeightCm)}cm` : "-"} />
                <StatTile label="平均体重" value={avgWeightKg != null ? `${formatDecimal(avgWeightKg)}kg` : "-"} />
                <StatTile label="平均年齢" value={avgAge != null ? `${formatDecimal(avgAge)}歳` : "-"} />
              </div>
            </>
          )}

          <h2>個人スタッツ</h2>
          {teamPlayers.length === 0 ? (
            <p className="empty-message">このチームの選手データがありません</p>
          ) : (
            <>
              <div className="mode-toggle">
                {(Object.keys(PLAYER_STAT_MODE_LABELS) as PlayerStatMode[]).map((m) => (
                  <button
                    key={m}
                    className={playerStatMode === m ? "active" : ""}
                    onClick={() => setPlayerStatMode(m)}
                  >
                    {PLAYER_STAT_MODE_LABELS[m]}
                  </button>
                ))}
              </div>
              <div className="table-scroll">
                <SortableTable
                  key={playerStatMode}
                  columns={playerColumns}
                  rows={teamPlayers}
                  rowKey={(p) => p.playerId}
                  defaultSortKey={playerStatMode === "basic" ? "pts" : "ftRate"}
                  linkTo={(p) => `/players/${p.playerId}`}
                />
              </div>
            </>
          )}

          <h2>よく使われるラインナップ</h2>
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
                      <th className="align-right">試合数</th>
                      <th className="align-right">出場時間</th>
                      <th className="align-right">得失点差</th>
                      <th className="align-right">Net Rating（推定）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topLineups.map((l) => (
                      <tr key={l.lineupKey}>
                        <td className="align-left">{l.playerIds.map((id) => playerNameById.get(id) ?? id).join(" / ")}</td>
                        <td className="align-right">{l.gamesPlayed}</td>
                        <td className="align-right">{formatDecimal(l.secondsPlayed / 60)}分</td>
                        <td className="align-right">{formatSigned(l.netPoints, 0)}</td>
                        <td className="align-right">{formatSigned(l.estimatedNetRtg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="page-subtitle">
                出場時間{MIN_LINEUP_SECONDS}秒未満の組み合わせは除外・上位{MAX_LINEUP_ROWS}組まで表示。Net
                Ratingはスティント単位の実ポゼッション数が無いため、チームのシーズン平均ペースから推定した参考値。
                試合数がまだ少ないため、いずれの数値もサンプルサイズが小さい点に留意
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}

function TeamScheduleRowView({ row }: { row: TeamScheduleRow }) {
  const linkTo = row.status === "upcoming" ? undefined : `/games/${row.scheduleKey}`;
  return (
    <tr className={`schedule-row status-${row.status}`}>
      <td className="align-left">{linkTo ? <RouterLink to={linkTo} className="cell-link">{row.date}</RouterLink> : row.date}</td>
      <td className="align-left">
        <MaybeLink to={linkTo}>
          {row.isHome ? "vs" : "@"} {row.opponentName}
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
      <td className="align-left">{row.venue ?? "-"}</td>
    </tr>
  );
}

function MaybeLink({ to, children }: { to?: string; children: ReactNode }) {
  return to ? (
    <RouterLink to={to} className="cell-link">
      {children}
    </RouterLink>
  ) : (
    <>{children}</>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
