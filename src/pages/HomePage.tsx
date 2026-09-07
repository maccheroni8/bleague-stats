import { useState } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGameSummaries, fetchPlayers, fetchStandingsHistory, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS, TEAM_STAT_DEFS, type StatDef } from "../lib/statDefs";
import { EXTRA_ELIGIBILITY_RULES, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, filterEligiblePlayers } from "../lib/playerRankingEligibility";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDateHeading } from "../lib/format";
import { teamShortName } from "../../shared/teamNames";
import type { GameSummary, PlayerSummary, StandingsTeamSnapshot, TeamSummary } from "../../shared/types";

type LeaderMode = "player" | "team";

// B.PREMIERは26チーム÷2で同日最大13試合になりうる。直近日の試合が13に満たない場合は
// 同じ横1列の枠内でより古い日程の試合を足して埋める（date desc, scheduleKey descの上位を
// そのまま並べれば、直近日の試合がまとまり、足りない分だけ自然に1つ前の日程が続く）
const RECENT_GAMES_COUNT = 13;
const LEADER_TOP_N = 5;
// 1行3項目×4行（得点/REB/AST、BLK/STL/FG%、3P%/2P%/FT%、MIN/eFG%/PER）
const LEADER_STAT_KEYS = ["pts", "reb", "ast", "blk", "stl", "fgPct", "tpPct", "twoPct", "ftPct", "min", "efgPct", "per"];
// 1行3項目×5行（得点/REB/AST、BLK/STL/FG%、3P%/2P%/FT%、eFG%/失点/ベンチポイント、ORtg/DRtg/NetRtg）
const TEAM_LEADER_STAT_KEYS = [
  "pts",
  "reb",
  "ast",
  "blk",
  "stl",
  "fgPct",
  "tpPct",
  "twoPct",
  "ftPct",
  "efgPct",
  "oppPts",
  "benchPoints",
  "offRtg",
  "defRtg",
  "netRtg",
];

function recentFinishedGames(summaries: GameSummary[]): GameSummary[] {
  return [...summaries]
    .filter((g) => g.gameEndedFlg)
    .sort((a, b) => (a.date === b.date ? b.scheduleKey.localeCompare(a.scheduleKey) : b.date.localeCompare(a.date)))
    .slice(0, RECENT_GAMES_COUNT);
}

/** DRtg・失点のようにhigherIsBetter=falseの項目は昇順（数値が小さい方が上位）でソートする */
function compareByStat<T>(def: StatDef<T>, a: T, b: T): number {
  return def.higherIsBetter === false ? def.value(a) - def.value(b) : def.value(b) - def.value(a);
}

/**
 * ランキングページ選手版と同じ掲載基準（出場率85%以上＋3P%等の試投数基準、
 * src/lib/playerRankingEligibility.ts）を適用してから上位N人を返す（2026-09、全項目に適用）。
 * 閾値はスライダーを持たないため、EXTRA_ELIGIBILITY_RULESのdefaultValueをそのまま使う
 */
function topPlayersForStat(
  players: PlayerSummary[],
  teams: TeamSummary[],
  def: StatDef<PlayerSummary>,
  count: number,
): PlayerSummary[] {
  const extraThreshold = EXTRA_ELIGIBILITY_RULES[def.key]?.defaultValue ?? 0;
  const pool = filterEligiblePlayers(players, teams, MIN_GAMES_PLAYED_RATIO_FOR_RANKING, def.key, extraThreshold);
  return [...pool].sort((a, b) => compareByStat(def, a, b)).slice(0, count);
}

function topTeamsForStat(teams: TeamSummary[], def: StatDef<TeamSummary>, count: number): TeamSummary[] {
  return [...teams].sort((a, b) => compareByStat(def, a, b)).slice(0, count);
}

export function HomePage({ season }: { season: string }) {
  const [leaderMode, setLeaderMode] = useState<LeaderMode>("player");
  const {
    data: games,
    loading: gamesLoading,
    error: gamesError,
  } = useJsonData(() => fetchGameSummaries(season), [season]);
  const {
    data: players,
    loading: playersLoading,
    error: playersError,
  } = useJsonData(() => fetchPlayers(season), [season]);
  const {
    data: teams,
    loading: teamsLoading,
    error: teamsError,
  } = useJsonData(() => fetchTeams(season), [season]);
  const {
    data: history,
    loading: standingsLoading,
    error: standingsError,
  } = useJsonData(() => fetchStandingsHistory(season), [season]);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);

  const recentGames = games ? recentFinishedGames(games) : [];
  const latestSnapshot = history && history.length > 0 ? history[history.length - 1]! : null;
  const eastTeams = latestSnapshot?.teams.filter((t) => t.division === "east") ?? [];
  const westTeams = latestSnapshot?.teams.filter((t) => t.division === "west") ?? [];

  return (
    <div>
      <h1>B.LEAGUE Stats</h1>
      <p className="page-subtitle">{season}シーズン</p>

      <section className="home-section">
        <div className="home-section-head">
          <h2>直近の試合結果</h2>
          <Link to="/schedule" className="home-section-more">
            日程を見る →
          </Link>
        </div>
        {gamesLoading ? (
          <p className="loading">読み込み中...</p>
        ) : gamesError ? (
          <p className="error-message">{gamesError}</p>
        ) : recentGames.length === 0 ? (
          <p className="empty-message">試合結果がありません</p>
        ) : (
          <div className="recent-games-grid">
            {recentGames.map((g) => (
              <Link key={g.scheduleKey} to={`/games/${g.scheduleKey}`} className="recent-game-card">
                <div className="recent-game-date">
                  {formatDateHeading(g.date)}
                  {g.gameType === "playoff" && <span className="playoff-badge">PO</span>}
                </div>
                <RecentGameTeamRow
                  teamId={g.homeTeamId}
                  teamName={g.homeTeamName}
                  score={g.homeScore}
                  color={teamColors?.[g.homeTeamId]?.primary}
                />
                <RecentGameTeamRow
                  teamId={g.awayTeamId}
                  teamName={g.awayTeamName}
                  score={g.awayScore}
                  color={teamColors?.[g.awayTeamId]?.primary}
                />
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2>シーズンスタッツリーダー</h2>
          <Link to="/rankings" className="home-section-more">
            ランキングを見る →
          </Link>
        </div>
        <div className="mode-toggle">
          <button className={leaderMode === "player" ? "active" : ""} onClick={() => setLeaderMode("player")}>
            個人
          </button>
          <button className={leaderMode === "team" ? "active" : ""} onClick={() => setLeaderMode("team")}>
            チーム
          </button>
        </div>
        {leaderMode === "player" ? (
          playersLoading ? (
            <p className="loading">読み込み中...</p>
          ) : playersError ? (
            <p className="error-message">{playersError}</p>
          ) : !players || players.length === 0 ? (
            <p className="empty-message">選手データがありません</p>
          ) : (
            <div className="leaders-grid">
              {LEADER_STAT_KEYS.map((key) => {
                const def = PLAYER_STAT_DEFS.find((d) => d.key === key);
                if (!def) return null;
                const top = topPlayersForStat(players, teams ?? [], def, LEADER_TOP_N);
                const leader = top[0];
                if (!leader) return null;
                return (
                  <div key={key} className="leader-card">
                    <div className="leader-stat-label">{def.label}</div>
                    <Link to={`/players/${leader.playerId}`} className="leader-top1">
                      <PlayerPhoto playerId={leader.playerId} size={56} className="leader-photo" />
                      <div className="leader-info">
                        <div className="leader-value">{def.format(leader)}</div>
                        <div className="leader-name">{leader.name}</div>
                        <div className="leader-team">{leader.teamName}</div>
                      </div>
                    </Link>
                    {top.length > 1 && (
                      <div className="leader-rest-list">
                        {top.slice(1).map((p, i) => (
                          <div key={p.playerId} className="leader-rest-item">
                            <Link to={`/players/${p.playerId}`} className="leader-rest-item-link">
                              <span className="leader-rest-rank">{i + 2}</span>
                              <span className="leader-rest-name">{p.name}</span>
                            </Link>
                            <span className="leader-rest-value">{def.format(p)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : teamsLoading ? (
          <p className="loading">読み込み中...</p>
        ) : teamsError ? (
          <p className="error-message">{teamsError}</p>
        ) : !teams || teams.length === 0 ? (
          <p className="empty-message">チームデータがありません</p>
        ) : (
          <div className="leaders-grid">
            {TEAM_LEADER_STAT_KEYS.map((key) => {
              const def = TEAM_STAT_DEFS.find((d) => d.key === key);
              if (!def) return null;
              const top = topTeamsForStat(teams, def, LEADER_TOP_N);
              const leader = top[0];
              if (!leader) return null;
              return (
                <div key={key} className="leader-card">
                  <div className="leader-stat-label">{def.label}</div>
                  <Link to={`/teams/${leader.teamId}`} className="leader-top1">
                    <TeamLogo teamId={leader.teamId} size={56} className="leader-photo" />
                    <div className="leader-info">
                      <div className="leader-value">{def.format(leader)}</div>
                      <div className="leader-name">{leader.teamName}</div>
                    </div>
                  </Link>
                  {top.length > 1 && (
                    <div className="leader-rest-list">
                      {top.slice(1).map((t, i) => (
                        <Link key={t.teamId} to={`/teams/${t.teamId}`} className="leader-rest-item">
                          <span className="leader-rest-rank">{i + 2}</span>
                          <span className="leader-rest-name">{t.teamName}</span>
                          <span className="leader-rest-value">{def.format(t)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="home-section">
        <div className="home-section-head">
          <h2>チーム一覧</h2>
          <Link to="/standings" className="home-section-more">
            順位表を見る →
          </Link>
        </div>
        {standingsLoading ? (
          <p className="loading">読み込み中...</p>
        ) : standingsError ? (
          <p className="error-message">{standingsError}</p>
        ) : !latestSnapshot ? (
          <p className="empty-message">チームデータがありません</p>
        ) : (
          <div className="team-logo-section">
            <TeamLogoGroup title="東地区" teams={eastTeams} />
            <TeamLogoGroup title="西地区" teams={westTeams} />
          </div>
        )}
      </section>
    </div>
  );
}

function RecentGameTeamRow({
  teamId,
  teamName,
  score,
  color,
}: {
  teamId: string;
  teamName: string;
  score: number;
  color?: string;
}) {
  return (
    <div className="recent-game-team" style={color ? { borderLeftColor: color } : undefined}>
      <TeamLogo teamId={teamId} size={28} />
      <span className="recent-game-team-name">{teamShortName(teamId, teamName)}</span>
      <span className="recent-game-score">{score}</span>
    </div>
  );
}

function TeamLogoGroup({ title, teams }: { title: string; teams: StandingsTeamSnapshot[] }) {
  return (
    <div className="team-logo-group">
      <h3 className="team-logo-group-title">
        {title}
        <span className="team-logo-group-count">{teams.length}</span>
      </h3>
      <div className="team-logo-grid">
        {teams.map((t) => (
          <Link key={t.teamId} to={`/teams/${t.teamId}`} className="team-logo-card">
            <TeamLogo teamId={t.teamId} size={48} />
          </Link>
        ))}
      </div>
    </div>
  );
}
