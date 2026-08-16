import { useParams } from "react-router-dom";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGame, fetchPlayers } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, isShotChartSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import { formatSigned } from "../lib/format";
import type { BoxscoreRow, PlayerSummary } from "../../shared/types";
import { KeyStatsChart } from "../components/KeyStatsChart";
import { LeadTrackerChart } from "../components/LeadTrackerChart";
import { SubstitutionBarChart, type SubstitutionRow } from "../components/SubstitutionBarChart";
import { ShotChartPanel } from "../components/ShotChart";
import { buildPeriodBoundaries, buildScoreTimeline, buildTimeoutMarks, totalGameSeconds } from "../lib/leadTracker";
import { buildShotEvents } from "../lib/shotChart";
import { reconstructOnCourt, substitutionModelForSeason } from "../../shared/onCourt";

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

/** "7-12 (58.3%)"。試投0本の場合は成功率を出さず本数だけ表示する */
function formatShotLine(makes: number, attempts: number): string {
  if (attempts === 0) return `${makes}-${attempts}`;
  return `${makes}-${attempts} (${((makes / attempts) * 100).toFixed(1)}%)`;
}

function playTimeToSeconds(playTime: string): number {
  if (playTime === "DNP") return 0;
  const [m, s] = playTime.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

/** 合計秒数を"MM:SS"に戻す（5人×試合時間なので99分を超えうる） */
function formatMinutesFromSeconds(totalSec: number): string {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

interface StatTotals {
  minSec: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pt2m: number;
  pt2a: number;
  pt3m: number;
  pt3a: number;
  ftm: number;
  fta: number;
  plusMinus: number;
}

function sumBoxscoreRows(rows: BoxscoreRow[]): StatTotals {
  return rows.reduce(
    (acc, r) => ({
      minSec: acc.minSec + playTimeToSeconds(r.PlayTime),
      pts: acc.pts + r.Point,
      reb: acc.reb + r.RB_TOT,
      ast: acc.ast + r.AS,
      stl: acc.stl + r.ST,
      blk: acc.blk + r.BS,
      tov: acc.tov + r.TO,
      pt2m: acc.pt2m + r.PT2M,
      pt2a: acc.pt2a + r.PT2A,
      pt3m: acc.pt3m + r.PT3M,
      pt3a: acc.pt3a + r.PT3A,
      ftm: acc.ftm + r.FTM,
      fta: acc.fta + r.FTA,
      plusMinus: acc.plusMinus + (r.PLUSMINUS ?? 0),
    }),
    {
      minSec: 0,
      pts: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      pt2m: 0,
      pt2a: 0,
      pt3m: 0,
      pt3a: 0,
      ftm: 0,
      fta: 0,
      plusMinus: 0,
    },
  );
}

export function GameDetailPage({ season }: { season: string }) {
  const { scheduleKey } = useParams<{ scheduleKey: string }>();
  const { data: game, loading, error } = useJsonData(
    () => (scheduleKey ? fetchGame(season, scheduleKey) : Promise.reject(new Error("scheduleKeyがありません"))),
    [season, scheduleKey],
  );
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  // players-master.json由来の国籍・登録区分（players.jsonに突合済み）をボックススコア集計に流用する。
  // 退団済み選手など現在のロースターに載っていない選手はclassification未定義のままになりうる
  const { data: players, loading: playersLoading } = useJsonData(() => fetchPlayers(season), [season]);

  if (loading || coverageLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!game) return <p className="error-message">試合が見つかりませんでした</p>;

  const pbpSupported = isPbpSupported(coverage);
  const shotChartSupported = isShotChartSupported(coverage);
  const classificationById = new Map((players ?? []).map((p) => [p.playerId, p.classification] as const));

  const homePlayers = playerRows(game.raw.HomeBoxscores);
  const awayPlayers = playerRows(game.raw.AwayBoxscores);
  const homeTotal = teamTotalRow(game.raw.HomeBoxscores);
  const awayTotal = teamTotalRow(game.raw.AwayBoxscores);

  const allShots = shotChartSupported ? buildShotEvents(game.raw.PlayByPlays) : [];
  const homeShots = allShots.filter((s) => s.teamId === game.homeTeam.id);
  const awayShots = allShots.filter((s) => s.teamId === game.awayTeam.id);

  const periods = game.quarterScores.home.length;

  const scoreTimeline = buildScoreTimeline(
    game.raw.PlayByPlays,
    { home: game.homeScore, away: game.awayScore },
    periods,
  );
  const timeoutMarks = buildTimeoutMarks(game.raw.PlayByPlays);
  const periodBoundaries = buildPeriodBoundaries(periods);

  let homeStarters: SubstitutionRow[] = [];
  let homeBench: SubstitutionRow[] = [];
  let awayStarters: SubstitutionRow[] = [];
  let awayBench: SubstitutionRow[] = [];

  if (pbpSupported) {
    const onCourt = reconstructOnCourt(
      game.raw.PlayByPlays,
      game.raw.HomeBoxscores,
      game.raw.AwayBoxscores,
      game.homeTeam.id,
      game.awayTeam.id,
      periods,
      substitutionModelForSeason(game.season),
    );
    const intervalsByPlayer = new Map<string, { startSec: number; endSec: number }[]>();
    for (const iv of onCourt.intervals) {
      const list = intervalsByPlayer.get(iv.playerId) ?? [];
      list.push({ startSec: iv.startSec, endSec: iv.endSec });
      intervalsByPlayer.set(iv.playerId, list);
    }
    const toSubstitutionRows = (rows: BoxscoreRow[]): SubstitutionRow[] =>
      rows.map((r) => ({
        playerId: r.PlayerID,
        name: r.PlayerNameJ,
        intervals: (intervalsByPlayer.get(r.PlayerID) ?? []).sort((a, b) => a.startSec - b.startSec),
      }));
    homeStarters = toSubstitutionRows(homePlayers.filter((r) => r.StartingFlg === 1));
    homeBench = toSubstitutionRows(homePlayers.filter((r) => r.StartingFlg !== 1));
    awayStarters = toSubstitutionRows(awayPlayers.filter((r) => r.StartingFlg === 1));
    awayBench = toSubstitutionRows(awayPlayers.filter((r) => r.StartingFlg !== 1));
  }

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

      <h2>Lead Tracker</h2>
      {pbpSupported ? (
        <LeadTrackerChart
          points={scoreTimeline}
          timeouts={timeoutMarks}
          periodBoundaries={periodBoundaries}
          totalSeconds={totalGameSeconds(periods)}
          homeTeamName={game.homeTeam.name}
          awayTeamName={game.awayTeam.name}
        />
      ) : (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      )}

      <h2>出場交代</h2>
      {pbpSupported ? (
        <SubstitutionBarChart
          homeTeamName={game.homeTeam.name}
          awayTeamName={game.awayTeam.name}
          homeStarters={homeStarters}
          homeBench={homeBench}
          awayStarters={awayStarters}
          awayBench={awayBench}
          periodBoundaries={periodBoundaries}
          totalSeconds={totalGameSeconds(periods)}
        />
      ) : (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      )}

      <h2>ショットチャート</h2>
      {shotChartSupported ? (
        <div className="shot-chart-grid">
          <ShotChartPanel teamName={game.homeTeam.name} players={homePlayers} shots={homeShots} color="var(--accent)" />
          <ShotChartPanel teamName={game.awayTeam.name} players={awayPlayers} shots={awayShots} color="var(--muted)" />
        </div>
      ) : (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      )}

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
      <BoxscoreSection teamName={game.homeTeam.name} rows={homePlayers} classificationById={classificationById} />
      <BoxscoreSection teamName={game.awayTeam.name} rows={awayPlayers} classificationById={classificationById} />
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

function BoxscoreSection({
  teamName,
  rows,
  classificationById,
}: {
  teamName: string;
  rows: BoxscoreRow[];
  classificationById: Map<string, PlayerSummary["classification"]>;
}) {
  const starters = rows.filter((r) => r.StartingFlg === 1);
  const bench = rows.filter((r) => r.StartingFlg !== 1);
  const japanese = rows.filter((r) => classificationById.get(r.PlayerID) === "日本人");
  const international = rows.filter((r) => {
    const c = classificationById.get(r.PlayerID);
    return c === "外国籍" || c === "帰化選手" || c === "アジア特別枠";
  });
  // classificationはplayers-master.jsonの「現在の登録情報」をシーズン非依存で突合したもの
  // （帰化選手/アジア特別枠の手動判定リストも一時点のスナップショット）。出場した選手のうち
  // 区分不明な人数を、日本人/外国籍等どちらの合計にも反映されない欠落として注記する
  const unclassifiedPlayedCount = rows.filter(
    (r) => r.PlayTime !== "DNP" && classificationById.get(r.PlayerID) === undefined,
  ).length;
  const classificationNote =
    "※現在の登録情報に基づく参考値" +
    (unclassifiedPlayedCount > 0 ? `／${unclassifiedPlayedCount}名分のデータ欠落あり` : "");

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
              <th>2P</th>
              <th>3P</th>
              <th>FT</th>
              <th>+/-</th>
            </tr>
          </thead>
          <tbody>
            <BoxscoreGroup title="スタメン" rows={starters} />
            <BoxscoreGroup title="ベンチ" rows={bench} />
            <SummaryRow label="スタメン合計" rows={starters} />
            <SummaryRow label="ベンチ合計" rows={bench} />
            <SummaryRow label="日本人選手合計" rows={japanese} note={classificationNote} />
            <SummaryRow label="外国籍+帰化+アジア特別枠合計" rows={international} note={classificationNote} />
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
        <td colSpan={13}>{title}</td>
      </tr>
      {rows.map((r) => {
        const dnp = r.PlayTime === "DNP";
        return (
          <tr key={r.PlayerID} className={dnp ? "dnp-row" : undefined}>
            <td className="align-left">{r.PlayerNameJ}</td>
            {dnp ? (
              <td colSpan={12}>DNP</td>
            ) : (
              <>
                <td>{r.PlayTime}</td>
                <td>{r.Point}</td>
                <td>{r.RB_TOT}</td>
                <td>{r.AS}</td>
                <td>{r.ST}</td>
                <td>{r.BS}</td>
                <td>{r.TO}</td>
                <td>{formatShotLine(r.PT2M + r.PT3M, r.PT2A + r.PT3A)}</td>
                <td>{formatShotLine(r.PT2M, r.PT2A)}</td>
                <td>{formatShotLine(r.PT3M, r.PT3A)}</td>
                <td>{formatShotLine(r.FTM, r.FTA)}</td>
                <td>{r.PLUSMINUS ?? "-"}</td>
              </>
            )}
          </tr>
        );
      })}
    </>
  );
}

/**
 * スタメン/ベンチ/国籍区分ごとの合計行。対象選手が0人の区分（classification未登録の
 * 選手しかいない旧シーズン等）は表示しない
 */
function SummaryRow({ label, rows, note }: { label: string; rows: BoxscoreRow[]; note?: string }) {
  if (rows.length === 0) return null;
  const t = sumBoxscoreRows(rows);
  return (
    <tr className="boxscore-summary-row">
      <td className="align-left">
        {label}
        {note && (
          <span className="row-note" title={note}>
            ※
          </span>
        )}
      </td>
      <td>{formatMinutesFromSeconds(t.minSec)}</td>
      <td>{t.pts}</td>
      <td>{t.reb}</td>
      <td>{t.ast}</td>
      <td>{t.stl}</td>
      <td>{t.blk}</td>
      <td>{t.tov}</td>
      <td>{formatShotLine(t.pt2m + t.pt3m, t.pt2a + t.pt3a)}</td>
      <td>{formatShotLine(t.pt2m, t.pt2a)}</td>
      <td>{formatShotLine(t.pt3m, t.pt3a)}</td>
      <td>{formatShotLine(t.ftm, t.fta)}</td>
      <td>{formatSigned(t.plusMinus, 0)}</td>
    </tr>
  );
}

