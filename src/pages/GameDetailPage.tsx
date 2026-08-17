import { useState } from "react";
import { useParams } from "react-router-dom";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGame, fetchPlayers, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, isShotChartSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import { formatPct, formatSigned } from "../lib/format";
import type { BoxscoreRow, PlayerSummary } from "../../shared/types";
import { KeyStatsSection } from "../components/KeyStatsSection";
import { LeadTrackerChart } from "../components/LeadTrackerChart";
import { SubstitutionBarChart, type SubstitutionRow } from "../components/SubstitutionBarChart";
import { ShotChartPanel } from "../components/ShotChart";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { PeriodRangeToggle } from "../components/PeriodRangeToggle";
import { buildPeriodBoundaries, buildScoreTimeline, buildTimeoutMarks, totalGameSeconds } from "../lib/leadTracker";
import { buildShotEvents } from "../lib/shotChart";
import { buildPeriodRangeOptions, periodInRange, type PeriodRangeValue } from "../lib/periodRange";
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

/**
 * 個人に紐付かないチーム発生イベント行（コーチ/ベンチのテクニカルファウル等）の試合合計行。
 * bleague.jp公式サイトのgenius_game_new2208.jsでも同じCategory=2行を「TEAM / COACHES」として
 * 表示している（docs:/DESIGN.md 2-2章参照）
 */
function teamCoachesRow(rows: BoxscoreRow[]): BoxscoreRow | undefined {
  return rows.find((r) => r.Category === 2 && r.PeriodCategory === 18);
}

/** Q別得点（非累積）から、そのQ終了時点までの累積スコアを求める */
function cumulativeScores(quarterScores: number[]): number[] {
  let sum = 0;
  return quarterScores.map((s) => (sum += s));
}

function byMax<T>(items: T[], keyFn: (item: T) => number): T[] {
  const max = Math.max(...items.map(keyFn));
  return items.filter((item) => keyFn(item) === max);
}

/**
 * タイになった選手群から代表者を1人選ぶ。プレータイムが長い方→EFFが高い方の順で
 * 絞り込み、それでも決まらなければ背番号昇順で確定させる（表示を一意にするための
 * 最終フォールバック。スタッツ・プレータイム・EFFが全員完全一致する状況は現実的には稀）
 */
function pickTieBreakWinner(tied: BoxscoreRow[]): BoxscoreRow {
  if (tied.length === 1) return tied[0]!;
  const byPlayTime = byMax(tied, (r) => playTimeToSeconds(r.PlayTime));
  if (byPlayTime.length === 1) return byPlayTime[0]!;
  const byEff = byMax(byPlayTime, (r) => r.EFF);
  if (byEff.length === 1) return byEff[0]!;
  return [...byEff].sort((a, b) => Number(a.PlayerNo) - Number(b.PlayerNo))[0]!;
}

interface RankedLeader {
  player: BoxscoreRow;
  value: number;
  /** 同順位でタイだった、表示選手以外の人数（"他◯人"表記用） */
  otherCount: number;
}

/**
 * スタッツ上位3「順位」を、同値タイは同順位扱いで求める（例: 1位タイが2人いれば
 * 2位は欠番にせず、次に大きい値のグループを2位として繰り上げる＝密順位）。
 * 各順位の代表者はpickTieBreakWinnerで1人選ぶ
 */
function topRankedLeaders(rows: BoxscoreRow[], statKey: "Point" | "RB_TOT" | "AS", ranks = 3): RankedLeader[] {
  const candidates = rows.filter((r) => r.PlayTime !== "DNP");
  if (candidates.length === 0) return [];
  const distinctValues = Array.from(new Set(candidates.map((r) => r[statKey])))
    .sort((a, b) => b - a)
    .slice(0, ranks);
  return distinctValues.map((value) => {
    const tied = candidates.filter((r) => r[statKey] === value);
    return { player: pickTieBreakWinner(tied), value, otherCount: tied.length - 1 };
  });
}

function safeDiv(a: number, b: number): number {
  return b === 0 ? 0 : a / b;
}

/** ゲームリーダー拡張セクション（PTS/OREB/DREB/TREB/AST/STL/BLK/TO/2P%/3P%/FT%）の項目定義 */
interface GameLeaderStatDef {
  key: string;
  label: string;
  value: (r: BoxscoreRow) => number;
  format: (r: BoxscoreRow) => string;
  /** 2P%/3P%/FT%用。試投0の選手をリーダー候補から除外するための試投数 */
  attempts?: (r: BoxscoreRow) => number;
  /**
   * 2P%/3P%/FT%用。%が同値タイの場合、プレータイム/EFFより先にこの値（成功数）が
   * 多い方を優先する（例: 3P%は 3P% → 3P成功数 → プレータイム → EFF の順）
   */
  tieBreakValue?: (r: BoxscoreRow) => number;
}

const GAME_LEADER_STAT_DEFS: GameLeaderStatDef[] = [
  { key: "pts", label: "PTS", value: (r) => r.Point, format: (r) => String(r.Point) },
  { key: "oreb", label: "OREB", value: (r) => r.RB_OFF, format: (r) => String(r.RB_OFF) },
  { key: "dreb", label: "DREB", value: (r) => r.RB_DEF, format: (r) => String(r.RB_DEF) },
  { key: "treb", label: "TREB", value: (r) => r.RB_OFF + r.RB_DEF, format: (r) => String(r.RB_OFF + r.RB_DEF) },
  { key: "ast", label: "AST", value: (r) => r.AS, format: (r) => String(r.AS) },
  { key: "stl", label: "STL", value: (r) => r.ST, format: (r) => String(r.ST) },
  { key: "blk", label: "BLK", value: (r) => r.BS, format: (r) => String(r.BS) },
  { key: "to", label: "TO", value: (r) => r.TO, format: (r) => String(r.TO) },
  {
    key: "fg2pct",
    label: "2P%",
    value: (r) => safeDiv(r.PT2M, r.PT2A),
    format: (r) => formatPct(safeDiv(r.PT2M, r.PT2A)),
    attempts: (r) => r.PT2A,
    tieBreakValue: (r) => r.PT2M,
  },
  {
    key: "fg3pct",
    label: "3P%",
    value: (r) => safeDiv(r.PT3M, r.PT3A),
    format: (r) => formatPct(safeDiv(r.PT3M, r.PT3A)),
    attempts: (r) => r.PT3A,
    tieBreakValue: (r) => r.PT3M,
  },
  {
    key: "ftpct",
    label: "FT%",
    value: (r) => safeDiv(r.FTM, r.FTA),
    format: (r) => formatPct(safeDiv(r.FTM, r.FTA)),
    attempts: (r) => r.FTA,
    tieBreakValue: (r) => r.FTM,
  },
];

interface GameLeaderResult {
  player: BoxscoreRow;
  /** 同スタッツ値でタイだった、表示選手以外の人数（"他◯人"表記用） */
  otherCount: number;
}

/**
 * 該当スタッツの最大値を出した選手を1人選ぶ。%系スタッツ（2P%/3P%/FT%）は同値タイの場合、
 * pickTieBreakWinner（プレータイム→EFF→背番号）より先にtieBreakValue（成功数）で絞り込む。
 * 元のスタッツ値でタイだった人数はotherCountとして保持し、"他◯人"表記に使う
 */
function gameLeaderPlayer(rows: BoxscoreRow[], def: GameLeaderStatDef): GameLeaderResult | undefined {
  const candidates = rows.filter((r) => r.PlayTime !== "DNP" && (def.attempts ? def.attempts(r) > 0 : true));
  if (candidates.length === 0) return undefined;
  const byStat = byMax(candidates, def.value);
  const narrowed = def.tieBreakValue ? byMax(byStat, def.tieBreakValue) : byStat;
  return { player: pickTieBreakWinner(narrowed), otherCount: byStat.length - 1 };
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
  // シーズン非依存の静的データなので空配列depsで一度だけ取得する。無くても表示は成立する
  // （ロゴ・写真と同じくグレースフルデグラデーション。デフォルト色にフォールバックする）ため
  // ローディング/エラーで画面全体をブロックしない
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const [shotPeriodRange, setShotPeriodRange] = useState<PeriodRangeValue>("all");
  const [showExtendedLeaders, setShowExtendedLeaders] = useState(true);

  if (loading || coverageLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (!game) return <p className="error-message">試合が見つかりませんでした</p>;

  const pbpSupported = isPbpSupported(coverage);
  const shotChartSupported = isShotChartSupported(coverage);
  const classificationById = new Map((players ?? []).map((p) => [p.playerId, p.classification] as const));
  const homeColor = teamColors?.[game.homeTeam.id]?.primary;
  const awayColor = teamColors?.[game.awayTeam.id]?.primary;

  const homePlayers = playerRows(game.raw.HomeBoxscores);
  const awayPlayers = playerRows(game.raw.AwayBoxscores);
  const homeTotal = teamTotalRow(game.raw.HomeBoxscores);
  const awayTotal = teamTotalRow(game.raw.AwayBoxscores);
  const gameSummary = game.raw.Summaries.find((s) => s.PeriodCategory === 18);
  const homeCoachesRow = teamCoachesRow(game.raw.HomeBoxscores);
  const awayCoachesRow = teamCoachesRow(game.raw.AwayBoxscores);

  const allShots = shotChartSupported ? buildShotEvents(game.raw.PlayByPlays) : [];
  const homeShots = allShots.filter((s) => s.teamId === game.homeTeam.id);
  const awayShots = allShots.filter((s) => s.teamId === game.awayTeam.id);

  const periods = game.quarterScores.home.length;

  const shotPeriodOptions = buildPeriodRangeOptions(periods);
  const selectedShotPeriodOption = shotPeriodOptions.find((o) => o.value === shotPeriodRange);
  const shotPeriodHomeShots = homeShots.filter((s) => periodInRange(selectedShotPeriodOption, s.period));
  const shotPeriodAwayShots = awayShots.filter((s) => periodInRange(selectedShotPeriodOption, s.period));

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

  const homeCum = cumulativeScores(game.quarterScores.home);
  const awayCum = cumulativeScores(game.quarterScores.away);

  return (
    <div className="game-detail-page">
      <Link to="/teams" className="back-link">
        ← チーム一覧に戻る
      </Link>

      <div className="scoreboard">
        <div className="scoreboard-team" style={homeColor ? { borderTopColor: homeColor } : undefined}>
          <TeamLogo teamId={game.homeTeam.id} size={44} className="scoreboard-logo" />
          <Link to={`/teams/${game.homeTeam.id}`}>{game.homeTeam.name}</Link>
          <div className="scoreboard-score">{game.homeScore}</div>
        </div>
        <div className="scoreboard-vs">
          <div className="scoreboard-date">{game.date}</div>
          <div>{game.gameEndedFlg ? "FINAL" : "試合中"}</div>
        </div>
        <div className="scoreboard-team" style={awayColor ? { borderTopColor: awayColor } : undefined}>
          <TeamLogo teamId={game.awayTeam.id} size={44} className="scoreboard-logo" />
          <Link to={`/teams/${game.awayTeam.id}`}>{game.awayTeam.name}</Link>
          <div className="scoreboard-score">{game.awayScore}</div>
        </div>
      </div>

      <div className="quarter-tables-grid">
        <section className="gd-card">
          <h2>Q別得点</h2>
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
        </section>

        <section className="gd-card">
          <h2>累積スコア</h2>
          <div className="table-scroll">
            <table className="quarter-table">
              <thead>
                <tr>
                  <th className="align-left">チーム</th>
                  {Array.from({ length: periods }, (_, i) => (
                    <th key={i}>{periodLabel(i, periods)}終了</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="align-left">{game.homeTeam.name}</td>
                  {homeCum.map((s, i) => (
                    <td key={i}>{s}</td>
                  ))}
                </tr>
                <tr>
                  <td className="align-left">{game.awayTeam.name}</td>
                  {awayCum.map((s, i) => (
                    <td key={i}>{s}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="gd-card">
        <h2>Lead Tracker</h2>
        {pbpSupported ? (
          <LeadTrackerChart
            points={scoreTimeline}
            timeouts={timeoutMarks}
            periodBoundaries={periodBoundaries}
            totalSeconds={totalGameSeconds(periods)}
            homeTeamName={game.homeTeam.name}
            awayTeamName={game.awayTeam.name}
            homeColor={homeColor}
            awayColor={awayColor}
          />
        ) : (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        )}
      </section>

      <section className="gd-card">
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
            homeColor={homeColor}
            awayColor={awayColor}
          />
        ) : (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        )}
      </section>

      <h2>ショットチャート</h2>
      {shotChartSupported ? (
        <>
          <PeriodRangeToggle options={shotPeriodOptions} value={shotPeriodRange} onChange={setShotPeriodRange} />
          <div className="shot-chart-grid">
            <ShotChartPanel
              teamName={game.homeTeam.name}
              players={homePlayers}
              shots={shotPeriodHomeShots}
              color={homeColor ?? "var(--accent)"}
              accentColor={homeColor}
            />
            <ShotChartPanel
              teamName={game.awayTeam.name}
              players={awayPlayers}
              shots={shotPeriodAwayShots}
              color={awayColor ?? "var(--muted)"}
              accentColor={awayColor}
            />
          </div>
        </>
      ) : (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      )}

      <h2>ゲームリーダー</h2>
      <div className="game-leaders">
        <GameLeadersTeam teamName={game.homeTeam.name} rows={homePlayers} accentColor={homeColor} />
        <GameLeadersTeam teamName={game.awayTeam.name} rows={awayPlayers} accentColor={awayColor} />
      </div>
      <div className="leader-matchup-toggle">
        <button onClick={() => setShowExtendedLeaders((v) => !v)}>
          {showExtendedLeaders ? "その他のスタッツリーダーを隠す" : "その他のスタッツリーダーを表示"}
        </button>
      </div>
      {showExtendedLeaders && (
        <GameLeadersMatchup
          homeTeamName={game.homeTeam.name}
          awayTeamName={game.awayTeam.name}
          homeRows={homePlayers}
          awayRows={awayPlayers}
        />
      )}

      {homeTotal && awayTotal && (
        <KeyStatsSection
          homeTotal={homeTotal}
          awayTotal={awayTotal}
          homePlayers={homePlayers}
          awayPlayers={awayPlayers}
          gameSummary={gameSummary}
          homeColor={homeColor}
          awayColor={awayColor}
        />
      )}

      <h2>ボックススコア</h2>
      <BoxscoreSection
        teamName={game.homeTeam.name}
        rows={homePlayers}
        coachesRow={homeCoachesRow}
        classificationById={classificationById}
        accentColor={homeColor}
      />
      <BoxscoreSection
        teamName={game.awayTeam.name}
        rows={awayPlayers}
        coachesRow={awayCoachesRow}
        classificationById={classificationById}
        accentColor={awayColor}
      />
    </div>
  );
}

function GameLeadersTeam({
  teamName,
  rows,
  accentColor,
}: {
  teamName: string;
  rows: BoxscoreRow[];
  accentColor?: string;
}) {
  return (
    <div className="game-leaders-team" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
      <h3>{teamName}</h3>
      <LeaderTop3Row label="PTS" leaders={topRankedLeaders(rows, "Point")} />
      <LeaderTop3Row label="REB" leaders={topRankedLeaders(rows, "RB_TOT")} />
      <LeaderTop3Row label="AST" leaders={topRankedLeaders(rows, "AS")} />
    </div>
  );
}

function LeaderTop3Row({ label, leaders }: { label: string; leaders: RankedLeader[] }) {
  const top1 = leaders[0];
  return (
    <div className="leader-top3-row">
      <span className="leader-top3-label">{label}</span>
      {top1 ? (
        <PlayerPhoto playerId={top1.player.PlayerID} size={48} className="leader-top3-photo" />
      ) : (
        <div className="leader-top3-photo-placeholder" />
      )}
      <div className="leader-top3-list">
        {leaders.map((leader, i) => (
          <Link
            key={leader.player.PlayerID}
            to={`/players/${leader.player.PlayerID}`}
            className={`leader-top3-item leader-top3-rank-${i + 1}`}
          >
            <span className="leader-top3-name">
              {leader.player.PlayerNameJ}
              {leader.otherCount > 0 && <span className="leader-top3-others"> 他{leader.otherCount}人</span>}
            </span>
            <span className="leader-top3-value">{leader.value}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

function GameLeadersMatchup({
  homeTeamName,
  awayTeamName,
  homeRows,
  awayRows,
}: {
  homeTeamName: string;
  awayTeamName: string;
  homeRows: BoxscoreRow[];
  awayRows: BoxscoreRow[];
}) {
  return (
    <div className="leader-matchup">
      <div className="leader-matchup-header">
        <span className="leader-matchup-header-team leader-matchup-header-team-home">{homeTeamName}</span>
        <span />
        <span className="leader-matchup-header-team leader-matchup-header-team-away">{awayTeamName}</span>
      </div>
      {GAME_LEADER_STAT_DEFS.map((def) => {
        const homeLeader = gameLeaderPlayer(homeRows, def);
        const awayLeader = gameLeaderPlayer(awayRows, def);
        return (
          <div key={def.key} className="leader-matchup-row">
            <div className="leader-matchup-side leader-matchup-side-home">
              <LeaderMatchupPlayer leader={homeLeader} />
              <span className="leader-matchup-value">{homeLeader ? def.format(homeLeader.player) : "—"}</span>
            </div>
            <span className="leader-matchup-label">{def.label}</span>
            <div className="leader-matchup-side leader-matchup-side-away">
              <span className="leader-matchup-value">{awayLeader ? def.format(awayLeader.player) : "—"}</span>
              <LeaderMatchupPlayer leader={awayLeader} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function LeaderMatchupPlayer({ leader }: { leader: GameLeaderResult | undefined }) {
  if (!leader) return <div className="leader-matchup-player" />;
  const { player, otherCount } = leader;
  return (
    <Link to={`/players/${player.PlayerID}`} className="leader-matchup-player">
      <PlayerPhoto playerId={player.PlayerID} size={44} className="leader-matchup-player-photo" />
      <span className="leader-matchup-player-name">
        {player.PlayerNameJ}
        {otherCount > 0 && <span className="leader-matchup-player-others"> 他{otherCount}人</span>}
      </span>
    </Link>
  );
}

function BoxscoreSection({
  teamName,
  rows,
  coachesRow,
  classificationById,
  accentColor,
}: {
  teamName: string;
  rows: BoxscoreRow[];
  coachesRow?: BoxscoreRow;
  classificationById: Map<string, PlayerSummary["classification"]>;
  accentColor?: string;
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
    <div className="boxscore-section" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
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
            {coachesRow && <TeamCoachesRow row={coachesRow} />}
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
            <td className="align-left">
              {r.PlayerID ? (
                <Link to={`/players/${r.PlayerID}`} className="cell-link">
                  {r.PlayerNameJ}
                </Link>
              ) : (
                r.PlayerNameJ
              )}
            </td>
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
 * 個人に紐付かないチーム発生イベント（コーチ/ベンチのテクニカルファウル等）の行。
 * bleague.jp公式サイトでの表示名「TEAM / COACHES」をそのまま使う（docs:/DESIGN.md 2-2章参照）
 */
function TeamCoachesRow({ row }: { row: BoxscoreRow }) {
  return (
    <tr className="team-coaches-row">
      <td className="align-left">TEAM / COACHES</td>
      <td>-</td>
      <td>{row.Point}</td>
      <td>{row.RB_TOT}</td>
      <td>{row.AS}</td>
      <td>{row.ST}</td>
      <td>{row.BS}</td>
      <td>{row.TO}</td>
      <td>{formatShotLine(row.PT2M + row.PT3M, row.PT2A + row.PT3A)}</td>
      <td>{formatShotLine(row.PT2M, row.PT2A)}</td>
      <td>{formatShotLine(row.PT3M, row.PT3A)}</td>
      <td>{formatShotLine(row.FTM, row.FTA)}</td>
      <td>-</td>
    </tr>
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

