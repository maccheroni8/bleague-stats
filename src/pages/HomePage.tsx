import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGameSummaries, fetchPlayers, fetchStandingsHistory } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDateHeading } from "../lib/format";
import type { GameSummary, StandingsTeamSnapshot } from "../../shared/types";

const RECENT_GAMES_COUNT = 8;
const LEADER_STAT_KEYS = ["pts", "reb", "ast", "stl", "blk"];

function recentFinishedGames(summaries: GameSummary[]): GameSummary[] {
  return [...summaries]
    .filter((g) => g.gameEndedFlg)
    .sort((a, b) => (a.date === b.date ? b.scheduleKey.localeCompare(a.scheduleKey) : b.date.localeCompare(a.date)))
    .slice(0, RECENT_GAMES_COUNT);
}

export function HomePage({ season }: { season: string }) {
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
    data: history,
    loading: standingsLoading,
    error: standingsError,
  } = useJsonData(() => fetchStandingsHistory(season), [season]);

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
                <RecentGameTeamRow teamId={g.homeTeamId} teamName={g.homeTeamName} score={g.homeScore} />
                <RecentGameTeamRow teamId={g.awayTeamId} teamName={g.awayTeamName} score={g.awayScore} />
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
        {playersLoading ? (
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
              const leader = [...players].sort((a, b) => def.value(b) - def.value(a))[0];
              if (!leader) return null;
              return (
                <Link key={key} to={`/players/${leader.playerId}`} className="leader-card">
                  <PlayerPhoto playerId={leader.playerId} size={64} className="leader-photo" />
                  <div className="leader-info">
                    <div className="leader-stat-label">{def.label}</div>
                    <div className="leader-value">{def.format(leader)}</div>
                    <div className="leader-name">{leader.name}</div>
                    <div className="leader-team">{leader.teamName}</div>
                  </div>
                </Link>
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
          <div className="standings-grid">
            <TeamLogoGroup title="東地区" teams={eastTeams} />
            <TeamLogoGroup title="西地区" teams={westTeams} />
          </div>
        )}
      </section>
    </div>
  );
}

function RecentGameTeamRow({ teamId, teamName, score }: { teamId: string; teamName: string; score: number }) {
  return (
    <div className="recent-game-team">
      <TeamLogo teamId={teamId} size={28} />
      <span className="recent-game-team-name">{teamName}</span>
      <span className="recent-game-score">{score}</span>
    </div>
  );
}

function TeamLogoGroup({ title, teams }: { title: string; teams: StandingsTeamSnapshot[] }) {
  return (
    <div>
      <h2>{title}</h2>
      <div className="team-logo-grid">
        {teams.map((t) => (
          <Link key={t.teamId} to={`/teams/${t.teamId}`} className="team-logo-card">
            <TeamLogo teamId={t.teamId} size={48} />
            <span>{t.teamName}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
