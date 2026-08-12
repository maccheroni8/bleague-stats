import { Link, useParams } from "react-router-dom";
import { fetchGame } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import type { BoxscoreRow } from "../../shared/types";
import { KeyStatsChart } from "../components/KeyStatsChart";

function periodLabel(index: number, total: number): string {
  if (index < 4) return `${index + 1}Q`;
  const otCount = total - 4;
  return otCount > 1 ? `OT${index - 4 + 1}` : "OT";
}

function playerRows(rows: BoxscoreRow[]): BoxscoreRow[] {
  return rows.filter((r) => r.Category === 1 && r.PeriodCategory === 18);
}

function teamTotalRow(rows: BoxscoreRow[]): BoxscoreRow | undefined {
  return rows.find((r) => r.Category === 3 && r.PeriodCategory === 18);
}

function topPlayers(rows: BoxscoreRow[], statKey: "Point" | "RB_TOT" | "AS", count = 3): BoxscoreRow[] {
  return [...rows]
    .filter((r) => r.PlayTime !== "DNP")
    .sort((a, b) => b[statKey] - a[statKey])
    .slice(0, count);
}

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

export function GameDetailPage({ season }: { season: string }) {
  const { scheduleKey } = useParams<{ scheduleKey: string }>();
  const { data: game, loading, error } = useJsonData(
    () => (scheduleKey ? fetchGame(season, scheduleKey) : Promise.reject(new Error("scheduleKeyがありません"))),
    [season, scheduleKey],
  );

  if (loading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!game) return <p className="error-message">試合が見つかりませんでした</p>;

  const homePlayers = playerRows(game.raw.HomeBoxscores);
  const awayPlayers = playerRows(game.raw.AwayBoxscores);
  const homeTotal = teamTotalRow(game.raw.HomeBoxscores);
  const awayTotal = teamTotalRow(game.raw.AwayBoxscores);

  const periods = game.quarterScores.home.length;

  return (
    <div>
      <Link to="/teams" className="back-link">
        ← チーム一覧に戻る
      </Link>

      <div className="scoreboard">
        <div className="scoreboard-team">
          <Link to={`/teams/${game.homeTeam.id}`}>{game.homeTeam.name}</Link>
          <div className="scoreboard-score">{game.homeScore}</div>
        </div>
        <div className="scoreboard-vs">
          <div className="scoreboard-date">{game.date}</div>
          <div>{game.gameEndedFlg ? "FINAL" : "試合中"}</div>
        </div>
        <div className="scoreboard-team">
          <Link to={`/teams/${game.awayTeam.id}`}>{game.awayTeam.name}</Link>
          <div className="scoreboard-score">{game.awayScore}</div>
        </div>
      </div>

      <div className="table-scroll">
        <table className="quarter-table">
          <thead>
            <tr>
              <th className="align-left">チーム</th>
              {Array.from({ length: periods }, (_, i) => (
                <th key={i}>{periodLabel(i, periods)}</th>
              ))}
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="align-left">{game.homeTeam.name}</td>
              {game.quarterScores.home.map((s, i) => (
                <td key={i}>{s}</td>
              ))}
              <td>
                <strong>{game.homeScore}</strong>
              </td>
            </tr>
            <tr>
              <td className="align-left">{game.awayTeam.name}</td>
              {game.quarterScores.away.map((s, i) => (
                <td key={i}>{s}</td>
              ))}
              <td>
                <strong>{game.awayScore}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>ゲームリーダー</h2>
      <div className="game-leaders">
        <GameLeadersTeam teamName={game.homeTeam.name} rows={homePlayers} />
        <GameLeadersTeam teamName={game.awayTeam.name} rows={awayPlayers} />
      </div>

      {homeTotal && awayTotal && (
        <>
          <h2>キースタッツ</h2>
          <div className="key-stats-grid">
            <KeyStatsChart
              title="ボリューム系"
              homeTeamName={game.homeTeam.name}
              awayTeamName={game.awayTeam.name}
              rows={[
                { label: "PTS", home: homeTotal.Point, away: awayTotal.Point },
                { label: "REB", home: homeTotal.RB_TOT, away: awayTotal.RB_TOT },
                { label: "AST", home: homeTotal.AS, away: awayTotal.AS },
                { label: "STL", home: homeTotal.ST, away: awayTotal.ST },
                { label: "BLK", home: homeTotal.BS, away: awayTotal.BS },
                { label: "TOV", home: homeTotal.TO, away: awayTotal.TO },
              ]}
            />
            <KeyStatsChart
              title="シュート%"
              homeTeamName={game.homeTeam.name}
              awayTeamName={game.awayTeam.name}
              valueSuffix="%"
              rows={[
                {
                  label: "FG%",
                  home: round1(safeDiv(homeTotal.PT2M + homeTotal.PT3M, homeTotal.PT2A + homeTotal.PT3A) * 100),
                  away: round1(safeDiv(awayTotal.PT2M + awayTotal.PT3M, awayTotal.PT2A + awayTotal.PT3A) * 100),
                },
                {
                  label: "3P%",
                  home: round1(safeDiv(homeTotal.PT3M, homeTotal.PT3A) * 100),
                  away: round1(safeDiv(awayTotal.PT3M, awayTotal.PT3A) * 100),
                },
                {
                  label: "FT%",
                  home: round1(safeDiv(homeTotal.FTM, homeTotal.FTA) * 100),
                  away: round1(safeDiv(awayTotal.FTM, awayTotal.FTA) * 100),
                },
              ]}
            />
          </div>
        </>
      )}

      <h2>ボックススコア</h2>
      <BoxscoreSection teamName={game.homeTeam.name} rows={homePlayers} />
      <BoxscoreSection teamName={game.awayTeam.name} rows={awayPlayers} />
    </div>
  );
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function GameLeadersTeam({ teamName, rows }: { teamName: string; rows: BoxscoreRow[] }) {
  return (
    <div className="game-leaders-team">
      <h3>{teamName}</h3>
      <LeaderRow label="PTS" players={topPlayers(rows, "Point")} statKey="Point" />
      <LeaderRow label="REB" players={topPlayers(rows, "RB_TOT")} statKey="RB_TOT" />
      <LeaderRow label="AST" players={topPlayers(rows, "AS")} statKey="AS" />
    </div>
  );
}

function LeaderRow({
  label,
  players,
  statKey,
}: {
  label: string;
  players: BoxscoreRow[];
  statKey: "Point" | "RB_TOT" | "AS";
}) {
  return (
    <div className="leader-row">
      <span className="leader-label">{label}</span>
      <span className="leader-names">
        {players.map((p) => `${p.PlayerNameJ} ${p[statKey]}`).join(" / ")}
      </span>
    </div>
  );
}

function BoxscoreSection({ teamName, rows }: { teamName: string; rows: BoxscoreRow[] }) {
  const starters = rows.filter((r) => r.StartingFlg === 1);
  const bench = rows.filter((r) => r.StartingFlg !== 1);

  return (
    <div className="boxscore-section">
      <h3>{teamName}</h3>
      <div className="table-scroll">
        <table className="boxscore-table">
          <thead>
            <tr>
              <th className="align-left">選手</th>
              <th>MIN</th>
              <th>PTS</th>
              <th>REB</th>
              <th>AST</th>
              <th>STL</th>
              <th>BLK</th>
              <th>TOV</th>
              <th>FG</th>
              <th>3P</th>
              <th>FT</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            <BoxscoreGroup title="スタメン" rows={starters} />
            <BoxscoreGroup title="ベンチ" rows={bench} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function BoxscoreGroup({ title, rows }: { title: string; rows: BoxscoreRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr className="boxscore-group-row">
        <td colSpan={12}>{title}</td>
      </tr>
      {rows.map((r) => {
        const dnp = r.PlayTime === "DNP";
        return (
          <tr key={r.PlayerID} className={dnp ? "dnp-row" : undefined}>
            <td className="align-left">{r.PlayerNameJ}</td>
            {dnp ? (
              <td colSpan={11}>DNP</td>
            ) : (
              <>
                <td>{r.PlayTime}</td>
                <td>{r.Point}</td>
                <td>{r.RB_TOT}</td>
                <td>{r.AS}</td>
                <td>{r.ST}</td>
                <td>{r.BS}</td>
                <td>{r.TO}</td>
                <td>{`${r.PT2M + r.PT3M}-${r.PT2A + r.PT3A}`}</td>
                <td>{`${r.PT3M}-${r.PT3A}`}</td>
                <td>{`${r.FTM}-${r.FTA}`}</td>
                <td>{r.PLUSMINUS ?? "-"}</td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

