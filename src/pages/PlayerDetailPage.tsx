import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Link as RouterLink } from "react-router-dom";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchPlayerGameLogs, fetchPlayers, fetchSeasons, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import type { PlayerGameLog } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
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

type DetailTab = "season" | "career" | "highs";

const TAB_LABELS: Record<DetailTab, string> = {
  season: "シーズン成績",
  career: "通算成績",
  highs: "キャリアハイ",
};

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
  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = useState<DetailTab>("season");
  const [careerData, setCareerData] = useState<CareerSeasonLogs[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);

  // careerLoading/careerDataをdeps配列に含めると、setCareerLoading(true)自体がeffectを
  // 再発火させcleanupで直前のfetchをcancelしてしまう（自己キャンセルのループ）。
  // そのためfetch開始済みかどうかはstateではなくrefで管理する
  const careerFetchStartedRef = useRef(false);

  useEffect(() => {
    setTab("season");
    setCareerData(null);
    setCareerError(null);
    careerFetchStartedRef.current = false;
  }, [playerId]);

  useEffect(() => {
    if (tab === "season" || !playerId || !seasons || careerFetchStartedRef.current) return;
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
  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter) : [];
  const situational = isDefaultFilter(filter) ? null : computePlayerSituationalStats(filteredLogs);

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

      {tab === "season" && (
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

          <h2>試合ログ</h2>
          {logsLoading ? (
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
          )}
        </>
      )}

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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
    </div>
  );
}
