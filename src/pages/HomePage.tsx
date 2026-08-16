import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGameSummaries, fetchPlayers, fetchStandingsHistory, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS, type StatDef } from "../lib/statDefs";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDateHeading } from "../lib/format";
import { teamShortName } from "../../shared/teamNames";
import type { GameSummary, PlayerSummary, StandingsTeamSnapshot } from "../../shared/types";

// B.PREMIERは26チーム÷2で同日最大13試合になりうる。直近日の試合が13に満たない場合は
// 同じ横1列の枠内でより古い日程の試合を足して埋める（date desc, scheduleKey descの上位を
// そのまま並べれば、直近日の試合がまとまり、足りない分だけ自然に1つ前の日程が続く）
const RECENT_GAMES_COUNT = 13;
const LEADER_TOP_N = 5;
// 1行3項目×4行（得点/REB/AST、BLK/STL/FG%、3P%/2P%/FT%、MIN/eFG%/PER）
const LEADER_STAT_KEYS = ["pts", "reb", "ast", "blk", "stl", "fgPct", "tpPct", "twoPct", "ftPct", "min", "efgPct", "per"];

function recentFinishedGames(summaries: GameSummary[]): GameSummary[] {
  return [...summaries]
    .filter((g) => g.gameEndedFlg)
    .sort((a, b) => (a.date === b.date ? b.scheduleKey.localeCompare(a.scheduleKey) : b.date.localeCompare(a.date)))
    .slice(0, RECENT_GAMES_COUNT);
}

// ⚠️ 暫定対応（2026-08-17、応急処置）: シュート系%スタッツは試投数が極端に少ないと
// （例: シーズン通算1本だけ試投して成功＝100%）異常値がリーダーの1位に出てしまう。
// ランキングページ全体の掲載基準（複数段階の閾値切り替え等）は別途設計を相談する前提のため、
// 正式な仕組み（statDefs.tsのminMinutesForRankingのような一般化）は入れず、ホーム画面の
// リーダー表示だけをその場しのぎで足切りする。ランキングページ本体（RankingsPage.tsx）には
// 一切適用しない。正式な設計が決まったら、この定数・関数ごと置き換える想定
const HOME_MIN_ATTEMPTS_TEMP = 5;

/** 上記の暫定対応: statKeyに応じた「試投数」を返す（対象外のスタッツはnull） */
function attemptsForStatTemp(p: PlayerSummary, statKey: string): number | null {
  switch (statKey) {
    case "fgPct":
    case "efgPct":
      return p.totals.fga;
    case "tpPct":
      return p.totals.tpa;
    case "twoPct":
      return p.totals.fga - p.totals.tpa;
    case "ftPct":
      return p.totals.fta;
    default:
      return null;
  }
}

/** ランキングページと同じ最低出場時間フィルタ（PERのみ設定される）を適用してから上位N人を返す */
function topPlayersForStat(players: PlayerSummary[], def: StatDef<PlayerSummary>, count: number): PlayerSummary[] {
  return [...players]
    .filter((p) => p.totals.min >= (def.minMinutesForRanking ?? 0))
    .filter((p) => {
      const attempts = attemptsForStatTemp(p, def.key);
      return attempts === null || attempts >= HOME_MIN_ATTEMPTS_TEMP;
    })
    .sort((a, b) => def.value(b) - def.value(a))
    .slice(0, count);
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
              const top = topPlayersForStat(players, def, LEADER_TOP_N);
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
                        <Link key={p.playerId} to={`/players/${p.playerId}`} className="leader-rest-item">
                          <span className="leader-rest-rank">{i + 2}</span>
                          <span className="leader-rest-name">{p.name}</span>
                          <span className="leader-rest-value">{def.format(p)}</span>
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
          <div className="standings-grid">
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
    <div>
      <h2>{title}</h2>
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
