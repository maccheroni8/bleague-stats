import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Link as RouterLink } from "react-router-dom";
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
import { fetchPlayerGameLogs, fetchPlayerHistory, fetchPlayers, fetchSeasons, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import type { PlayerGameLog, PlayerSummary } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { safeDiv } from "../../shared/formulas";
import {
  computePlayerSituationalStats,
  filterGameLogs,
  isDefaultFilter,
  type PlayerSituationalStats,
  type SituationalFilter,
} from "../lib/situational";

const gameLogColumns: Column<PlayerGameLog>[] = [
  { key: "date", label: "日付", sortValue: (g) => g.date, align: "left" },
  {
    key: "opponent",
    label: "対戦相手",
    sortValue: (g) => g.opponentTeamName,
    align: "left",
    render: (g) => (
      <>
        {g.isHome ? "vs" : "@"} {g.opponentTeamName}
        {g.gameType === "playoff" && <span className="playoff-badge">PO</span>}
      </>
    ),
  },
  {
    key: "result",
    label: "結果",
    sortValue: (g) => (g.win ? 1 : 0),
    render: (g) => <span className={`result-badge ${g.win ? "win" : "loss"}`}>{g.win ? "W" : "L"}</span>,
  },
  { key: "min", label: "MIN", sortValue: (g) => g.min, format: (g) => formatDecimal(g.min) },
  { key: "pts", label: "PTS", sortValue: (g) => g.pts, format: (g) => String(g.pts) },
  { key: "reb", label: "REB", sortValue: (g) => g.reb, format: (g) => String(g.reb) },
  { key: "ast", label: "AST", sortValue: (g) => g.ast, format: (g) => String(g.ast) },
  { key: "stl", label: "STL", sortValue: (g) => g.stl, format: (g) => String(g.stl) },
  { key: "blk", label: "BLK", sortValue: (g) => g.blk, format: (g) => String(g.blk) },
  { key: "tov", label: "TOV", sortValue: (g) => g.tov, format: (g) => String(g.tov) },
  {
    key: "fg",
    label: "FG",
    sortValue: (g) => g.fgm,
    render: (g) => `${g.fgm}/${g.fga}`,
  },
  {
    key: "tp",
    label: "3P",
    sortValue: (g) => g.tpm,
    render: (g) => `${g.tpm}/${g.tpa}`,
  },
  {
    key: "ft",
    label: "FT",
    sortValue: (g) => g.ftm,
    render: (g) => `${g.ftm}/${g.fta}`,
  },
  {
    key: "plusMinus",
    label: "+/-",
    sortValue: (g) => g.plusMinus,
    format: (g) => formatSigned(g.plusMinus, 0),
  },
];

type DetailTab = "stats" | "gamelog" | "career" | "highs" | "compare";

const TAB_LABELS: Record<DetailTab, string> = {
  stats: "スタッツ",
  gamelog: "試合ログ",
  career: "通算成績",
  highs: "キャリアハイ",
  compare: "比較",
};

interface PlayerStatDef {
  key: string;
  label: string;
  value: (p: PlayerSummary) => number;
  format: (p: PlayerSummary) => string;
  /** falseならTOVのように値が小さいほど良い項目。パーセンタイル換算・順位算出の向きに使う */
  higherIsBetter: boolean;
}

/** (FGM-3PM)/(FGA-3PA)。ShootingStatsに2P%が無いため内訳から算出する */
function pt2Pct(p: PlayerSummary): number {
  return safeDiv(p.totals.fgm - p.totals.tpm, p.totals.fga - p.totals.tpa);
}

// ヘッダーのスタッツタイル用。レーダーチャートはこのうち一部（後述RADAR_STAT_KEYS）を流用する
const TILE_STAT_DEFS: PlayerStatDef[] = [
  {
    key: "min",
    label: "MIN",
    value: (p) => p.perGame.min,
    format: (p) => formatMinutesFromSeconds(Math.round(p.perGame.min * 60)),
    higherIsBetter: true,
  },
  { key: "pts", label: "PTS", value: (p) => p.perGame.pts, format: (p) => formatDecimal(p.perGame.pts), higherIsBetter: true },
  { key: "reb", label: "REB", value: (p) => p.perGame.reb, format: (p) => formatDecimal(p.perGame.reb), higherIsBetter: true },
  { key: "ast", label: "AST", value: (p) => p.perGame.ast, format: (p) => formatDecimal(p.perGame.ast), higherIsBetter: true },
  { key: "stl", label: "STL", value: (p) => p.perGame.stl, format: (p) => formatDecimal(p.perGame.stl), higherIsBetter: true },
  { key: "blk", label: "BLK", value: (p) => p.perGame.blk, format: (p) => formatDecimal(p.perGame.blk), higherIsBetter: true },
  { key: "tov", label: "TOV", value: (p) => p.perGame.tov, format: (p) => formatDecimal(p.perGame.tov), higherIsBetter: false },
  {
    key: "plusMinus",
    label: "+/-",
    value: (p) => p.perGame.plusMinus,
    format: (p) => formatSigned(p.perGame.plusMinus),
    higherIsBetter: true,
  },
  { key: "fgPct", label: "FG%", value: (p) => p.shooting.fgPct, format: (p) => formatPct(p.shooting.fgPct), higherIsBetter: true },
  { key: "tpPct", label: "3P%", value: (p) => p.shooting.tpPct, format: (p) => formatPct(p.shooting.tpPct), higherIsBetter: true },
  { key: "pt2Pct", label: "2P%", value: (p) => pt2Pct(p), format: (p) => formatPct(pt2Pct(p)), higherIsBetter: true },
  { key: "ftPct", label: "FT%", value: (p) => p.shooting.ftPct, format: (p) => formatPct(p.shooting.ftPct), higherIsBetter: true },
  { key: "efgPct", label: "eFG%", value: (p) => p.shooting.efgPct, format: (p) => formatPct(p.shooting.efgPct), higherIsBetter: true },
  { key: "tsPct", label: "TS%", value: (p) => p.shooting.tsPct, format: (p) => formatPct(p.shooting.tsPct), higherIsBetter: true },
];

// レーダーチャート用の10項目（MIN/PTS/REB/AST/STL/BLK/TOV/3P%/2P%/FT%）。TILE_STAT_DEFSの
// 定義済みaccessorをそのまま流用し、二重定義を避ける
const RADAR_STAT_KEYS = ["min", "pts", "reb", "ast", "stl", "blk", "tov", "tpPct", "pt2Pct", "ftPct"];
const RADAR_STAT_DEFS = TILE_STAT_DEFS.filter((d) => RADAR_STAT_KEYS.includes(d.key));

interface RankResult {
  rank: number;
  total: number;
}

/** リーグ全選手中でのplayerの順位を返す（1位=最良）。higherIsBetterがfalseの項目は昇順で評価する */
function rankAmong(player: PlayerSummary, allPlayers: PlayerSummary[], def: PlayerStatDef): RankResult {
  const total = allPlayers.length;
  const sorted = [...allPlayers].sort((a, b) => (def.higherIsBetter ? def.value(b) - def.value(a) : def.value(a) - def.value(b)));
  const rank = sorted.findIndex((p) => p.playerId === player.playerId) + 1;
  return { rank, total };
}

function formatRank({ rank, total }: RankResult): string {
  return `${rank}位/${total}人`;
}

interface RadarDataPoint {
  key: string;
  label: string;
  percentile: number;
  rank: number;
  total: number;
  actualValue: string;
}

/** リーグ全選手中でのplayerの各項目の順位を0〜100のパーセンタイルに変換する（TeamDetailPageの
 * buildRadarData()と同じ考え方を選手向けに転用したもの。TOV等は向きを反転） */
function buildPlayerRadarData(player: PlayerSummary, allPlayers: PlayerSummary[]): RadarDataPoint[] {
  const total = allPlayers.length;
  return RADAR_STAT_DEFS.map((def) => {
    const { rank } = rankAmong(player, allPlayers, def);
    const percentile = total > 1 ? (100 * (total - rank)) / (total - 1) : 50;
    return { key: def.key, label: def.label, percentile, rank, total, actualValue: def.format(player) };
  });
}

/** DD2(ダブルダブル数)/TD3(トリプルダブル数)。GameDetailPageのcomputeStatBadge()と同じ
 * 2桁到達数の閾値（2部門でDD、3部門でTD）を、選手個人の全試合ログに適用して数える。
 * リーグ内順位は非表示にしている（全選手分のgame logを取得しないと算出できず、Phase Aの
 * コストに見合わないため。DESIGN.md参照） */
function countDoubleTriples(logs: PlayerGameLog[]): { dd: number; td: number } {
  let dd = 0;
  let td = 0;
  for (const g of logs) {
    const doubleDigitCount = [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;
    // トリプルダブルは定義上ダブルダブルの条件も満たすため、DD2にはTD3の試合も含める
    // （NBA.com等の一般的な集計慣習。GameDetailPageのバッジ表示はTD優先の1つだけ選ぶ別ロジック）
    if (doubleDigitCount >= 2) dd += 1;
    if (doubleDigitCount >= 3) td += 1;
  }
  return { dd, td };
}

interface CareerSeasonLogs {
  season: string;
  logs: PlayerGameLog[];
}

interface CareerHighDef {
  key: string;
  label: string;
  value: (g: PlayerGameLog) => number;
}

const CAREER_HIGH_STATS: CareerHighDef[] = [
  { key: "pts", label: "PTS", value: (g) => g.pts },
  { key: "reb", label: "REB", value: (g) => g.reb },
  { key: "ast", label: "AST", value: (g) => g.ast },
  { key: "stl", label: "STL", value: (g) => g.stl },
  { key: "blk", label: "BLK", value: (g) => g.blk },
  { key: "tpm", label: "3P成功数", value: (g) => g.tpm },
];

function formatBirthDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${y}年${m}月${d}日`;
}

function calcAge(birthDate: string): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBirthdayThisYear = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

export function PlayerDetailPage({ season }: { season: string }) {
  const { playerId } = useParams<{ playerId: string }>();
  const {
    data: players,
    loading: playersLoading,
    error: playersError,
  } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: gameLogs, loading: logsLoading } = useJsonData(
    () => (playerId ? fetchPlayerGameLogs(season, playerId) : Promise.resolve([])),
    [season, playerId],
  );
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: playerHistory } = useJsonData(() => fetchPlayerHistory(), []);
  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = useState<DetailTab>("stats");
  const [careerData, setCareerData] = useState<CareerSeasonLogs[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);

  // careerLoading/careerDataをdeps配列に含めると、setCareerLoading(true)自体がeffectを
  // 再発火させcleanupで直前のfetchをcancelしてしまう（自己キャンセルのループ）。
  // そのためfetch開始済みかどうかはstateではなくrefで管理する
  const careerFetchStartedRef = useRef(false);

  useEffect(() => {
    setTab("stats");
    setCareerData(null);
    setCareerError(null);
    careerFetchStartedRef.current = false;
  }, [playerId]);

  useEffect(() => {
    if ((tab !== "career" && tab !== "highs") || !playerId || !seasons || careerFetchStartedRef.current) return;
    careerFetchStartedRef.current = true;
    setCareerLoading(true);
    setCareerError(null);
    Promise.all(
      seasons.map(async (s) => {
        try {
          const logs = await fetchPlayerGameLogs(s.season, playerId);
          return { season: s.season, logs };
        } catch {
          return { season: s.season, logs: [] as PlayerGameLog[] };
        }
      }),
    )
      .then((results) => {
        setCareerData(results.filter((r) => r.logs.length > 0));
      })
      .catch(() => {
        setCareerError("通算成績の取得に失敗しました");
      })
      .finally(() => {
        setCareerLoading(false);
      });
  }, [tab, playerId, seasons]);

  const seasonRows = useMemo(() => {
    if (!careerData) return [];
    return careerData
      .map((cd) => {
        const played = filterGameLogs(cd.logs, { kind: "all" });
        const stats = computePlayerSituationalStats(played);
        return stats ? { season: cd.season, stats } : null;
      })
      .filter((r): r is { season: string; stats: PlayerSituationalStats } => r !== null);
  }, [careerData]);

  const careerTotal = useMemo(() => {
    if (!careerData) return null;
    const allPlayed = careerData.flatMap((cd) => filterGameLogs(cd.logs, { kind: "all" }));
    return computePlayerSituationalStats(allPlayed);
  }, [careerData]);

  const careerHighs = useMemo(() => {
    if (!careerData) return [];
    const allGames = careerData.flatMap((cd) =>
      cd.logs.filter((g) => g.min > 0).map((g) => ({ ...g, season: cd.season })),
    );
    return CAREER_HIGH_STATS.map((def) => {
      const best = allGames.reduce<(typeof allGames)[number] | null>(
        (acc, g) => (acc === null || def.value(g) > def.value(acc) ? g : acc),
        null,
      );
      return best ? { ...def, game: best } : null;
    }).filter((r): r is CareerHighDef & { game: PlayerGameLog & { season: string } } => r !== null);
  }, [careerData]);

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;

  const player = players?.find((p) => p.playerId === playerId);
  if (!player) return <p className="error-message">選手が見つかりませんでした</p>;

  const accentColor = teamColors?.[player.teamId]?.primary;
  const nameHistory = playerHistory?.find((h) => h.playerId === player.playerId)?.names ?? [];
  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter) : [];
  const situational = isDefaultFilter(filter) ? null : computePlayerSituationalStats(filteredLogs);

  const radarData = players && players.length > 1 ? buildPlayerRadarData(player, players) : [];
  const ddTd = countDoubleTriples(gameLogs ?? []);

  return (
    <div>
      <Link to="/players" className="back-link">
        ← 個人一覧に戻る
      </Link>
      <div className="player-detail-header" style={accentColor ? { borderTopColor: accentColor } : undefined}>
        <PlayerPhoto playerId={player.playerId} size={112} />
        <div className="player-detail-header-info">
          <h1>{player.name}</h1>
          <p className="page-subtitle">
            {player.teamName}・{season}シーズン・{player.gamesPlayed}試合出場
          </p>
          {nameHistory.length > 1 && (
            <p className="page-subtitle">
              登録名変更履歴:{" "}
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
          <div className="player-profile-grid">
            {player.position && <ProfileItem label="ポジション" value={player.position} />}
            {player.classification && <ProfileItem label="登録区分" value={player.classification} />}
            {player.nationality && <ProfileItem label="国籍" value={player.nationality} />}
            {player.heightCm && <ProfileItem label="身長" value={`${player.heightCm}cm`} />}
            {player.weightKg && <ProfileItem label="体重" value={`${player.weightKg}kg`} />}
            {player.birthDate && (
              <ProfileItem
                label="生年月日"
                value={`${formatBirthDate(player.birthDate)}（${calcAge(player.birthDate)}歳）`}
              />
            )}
          </div>
        </div>
      </div>

      <h2>リーグ内比較</h2>
      {radarData.length === 0 ? (
        <p className="empty-message">比較対象の選手がいません</p>
      ) : (
        <div className="radar-section">
          <div className="radar-chart-wrapper">
            <ResponsiveContainer width="100%" height={280}>
              <RadarChart data={radarData} outerRadius="72%">
                <PolarGrid stroke="var(--border)" />
                <PolarAngleAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} />
                <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                <Radar
                  name={player.name}
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

      <div className="stat-grid">
        {TILE_STAT_DEFS.map((def) => (
          <StatTile
            key={def.key}
            label={def.label}
            value={def.format(player)}
            rank={players && players.length > 0 ? formatRank(rankAmong(player, players, def)) : undefined}
          />
        ))}
        <StatTile label="DD2" value={String(ddTd.dd)} />
        <StatTile label="TD3" value={String(ddTd.td)} />
      </div>

      <div className="tab-bar">
        {(Object.keys(TAB_LABELS) as DetailTab[]).map((t) => (
          <button
            key={t}
            className={`tab-button${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
            type="button"
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        <>
          <SituationalFilterPicker filter={filter} onChange={setFilter} />

          {isDefaultFilter(filter) ? (
            <div className="stat-grid">
              <StatTile label="MIN" value={formatDecimal(player.perGame.min)} />
              <StatTile label="PTS" value={formatDecimal(player.perGame.pts)} />
              <StatTile label="REB" value={formatDecimal(player.perGame.reb)} />
              <StatTile label="AST" value={formatDecimal(player.perGame.ast)} />
              <StatTile label="STL" value={formatDecimal(player.perGame.stl)} />
              <StatTile label="BLK" value={formatDecimal(player.perGame.blk)} />
              <StatTile label="TOV" value={formatDecimal(player.perGame.tov)} />
              <StatTile label="+/-" value={formatSigned(player.perGame.plusMinus)} />
              <StatTile label="FG%" value={formatPct(player.shooting.fgPct)} />
              <StatTile label="3P%" value={formatPct(player.shooting.tpPct)} />
              <StatTile label="FT%" value={formatPct(player.shooting.ftPct)} />
              <StatTile label="eFG%" value={formatPct(player.shooting.efgPct)} />
              <StatTile label="TS%" value={formatPct(player.shooting.tsPct)} />
            </div>
          ) : !situational ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="stat-grid">
              <StatTile label="試合数" value={String(situational.gamesPlayed)} />
              <StatTile label="MIN" value={formatDecimal(situational.perGame.min)} />
              <StatTile label="PTS" value={formatDecimal(situational.perGame.pts)} />
              <StatTile label="REB" value={formatDecimal(situational.perGame.reb)} />
              <StatTile label="AST" value={formatDecimal(situational.perGame.ast)} />
              <StatTile label="STL" value={formatDecimal(situational.perGame.stl)} />
              <StatTile label="BLK" value={formatDecimal(situational.perGame.blk)} />
              <StatTile label="TOV" value={formatDecimal(situational.perGame.tov)} />
              <StatTile label="+/-" value={formatSigned(situational.perGame.plusMinus)} />
              <StatTile label="FG%" value={formatPct(situational.shooting.fgPct)} />
              <StatTile label="3P%" value={formatPct(situational.shooting.tpPct)} />
              <StatTile label="FT%" value={formatPct(situational.shooting.ftPct)} />
              <StatTile label="eFG%" value={formatPct(situational.shooting.efgPct)} />
              <StatTile label="TS%" value={formatPct(situational.shooting.tsPct)} />
            </div>
          )}

          <section className="gd-card oncourt-card" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
            <h2>オンコート/オフコートスタッツ</h2>
            {coverageLoading ? (
              <p className="loading">読み込み中...</p>
            ) : !pbpSupported ? (
              <p className="empty-message">このシーズンのデータには対応していません</p>
            ) : (
              <div className="stat-grid">
                <StatTile label="オンコート+/-" value={formatSigned(player.advanced.onCourtNetPerGame)} />
                <StatTile label="オフコート+/-" value={formatSigned(player.advanced.offCourtNetPerGame)} />
              </div>
            )}
          </section>
        </>
      )}

      {tab === "gamelog" &&
        (logsLoading ? (
          <p className="loading">読み込み中...</p>
        ) : !gameLogs || gameLogs.length === 0 ? (
          <p className="empty-message">試合ログがありません</p>
        ) : (
          <div className="table-scroll">
            <SortableTable
              columns={gameLogColumns}
              rows={gameLogs}
              rowKey={(g) => g.scheduleKey}
              defaultSortKey="date"
              linkTo={(g) => `/games/${g.scheduleKey}`}
            />
          </div>
        ))}

      {tab === "career" &&
        (careerLoading ? (
          <p className="loading">読み込み中...</p>
        ) : careerError ? (
          <p className="error-message">{careerError}</p>
        ) : !careerData || seasonRows.length === 0 ? (
          <p className="empty-message">通算成績がありません</p>
        ) : (
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th className="align-left">シーズン</th>
                  <th className="align-right">試合数</th>
                  <th className="align-right">MIN</th>
                  <th className="align-right">PTS</th>
                  <th className="align-right">REB</th>
                  <th className="align-right">AST</th>
                  <th className="align-right">STL</th>
                  <th className="align-right">BLK</th>
                  <th className="align-right">TOV</th>
                  <th className="align-right">+/-</th>
                  <th className="align-right">FG%</th>
                  <th className="align-right">3P%</th>
                  <th className="align-right">FT%</th>
                  <th className="align-right">eFG%</th>
                  <th className="align-right">TS%</th>
                </tr>
              </thead>
              <tbody>
                {seasonRows.map((r) => (
                  <tr key={r.season}>
                    <td className="align-left">{r.season}</td>
                    <td className="align-right">{r.stats.gamesPlayed}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.min)}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.pts)}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.reb)}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.ast)}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.stl)}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.blk)}</td>
                    <td className="align-right">{formatDecimal(r.stats.perGame.tov)}</td>
                    <td className="align-right">{formatSigned(r.stats.perGame.plusMinus)}</td>
                    <td className="align-right">{formatPct(r.stats.shooting.fgPct)}</td>
                    <td className="align-right">{formatPct(r.stats.shooting.tpPct)}</td>
                    <td className="align-right">{formatPct(r.stats.shooting.ftPct)}</td>
                    <td className="align-right">{formatPct(r.stats.shooting.efgPct)}</td>
                    <td className="align-right">{formatPct(r.stats.shooting.tsPct)}</td>
                  </tr>
                ))}
                {careerTotal && (
                  <tr className="career-total-row">
                    <td className="align-left">通算</td>
                    <td className="align-right">{careerTotal.gamesPlayed}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.min)}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.pts)}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.reb)}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.ast)}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.stl)}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.blk)}</td>
                    <td className="align-right">{formatDecimal(careerTotal.perGame.tov)}</td>
                    <td className="align-right">{formatSigned(careerTotal.perGame.plusMinus)}</td>
                    <td className="align-right">{formatPct(careerTotal.shooting.fgPct)}</td>
                    <td className="align-right">{formatPct(careerTotal.shooting.tpPct)}</td>
                    <td className="align-right">{formatPct(careerTotal.shooting.ftPct)}</td>
                    <td className="align-right">{formatPct(careerTotal.shooting.efgPct)}</td>
                    <td className="align-right">{formatPct(careerTotal.shooting.tsPct)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ))}

      {tab === "highs" &&
        (careerLoading ? (
          <p className="loading">読み込み中...</p>
        ) : careerError ? (
          <p className="error-message">{careerError}</p>
        ) : !careerData || careerHighs.length === 0 ? (
          <p className="empty-message">キャリアハイのデータがありません</p>
        ) : (
          <div className="career-highs-grid">
            {careerHighs.map((h) => (
              <div className="career-high-card" key={h.key}>
                <div className="career-high-label">{h.label}</div>
                <div className="career-high-value">{h.value(h.game)}</div>
                <RouterLink to={`/games/${h.game.scheduleKey}?season=${h.game.season}`} className="career-high-game-link">
                  {h.game.date}　{h.game.isHome ? "vs" : "@"}
                  {h.game.opponentTeamName}
                </RouterLink>
              </div>
            ))}
          </div>
        ))}

      {tab === "compare" && <p className="empty-message">Phase Bで実装予定です</p>}
    </div>
  );
}

function ProfileItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="profile-item">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </span>
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
