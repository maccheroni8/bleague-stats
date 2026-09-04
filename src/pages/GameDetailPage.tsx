import { Fragment, useState } from "react";
import { useParams } from "react-router-dom";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGame, fetchPlayers, fetchTeamColors, fetchYahooGamePbp } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import { formatPct } from "../lib/format";
import type { BoxscoreRow, ShotTypeBreakdown } from "../../shared/types";
import { KeyStatsSection } from "../components/KeyStatsSection";
import { LeadTrackerChart } from "../components/LeadTrackerChart";
import { SubstitutionBarChart, type SubstitutionRow } from "../components/SubstitutionBarChart";
import { ShotChartPanel } from "../components/ShotChart";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { PeriodRangeToggle } from "../components/PeriodRangeToggle";
import { BOXSCORE_TABS, BoxscoreTable, type BoxscoreTabKey } from "../components/BoxscoreTable";
import { buildPeriodBoundaries, buildScoreTimeline, buildTimeoutMarks, totalGameSeconds } from "../lib/leadTracker";
import { buildShotEvents } from "../lib/shotChart";
import { buildPeriodRangeOptions, periodInRange, type PeriodRangeValue } from "../lib/periodRange";
import { computeOnCourtRatings, reconstructOnCourt, substitutionModelForSeason, type PlayerOnCourtRatings } from "../../shared/onCourt";
import { playTimeToSeconds } from "../lib/boxscoreAggregate";
import {
  buildShotTypeBreakdownByPlayer,
  formatShotTypeAttempted,
  formatShotTypeMade,
  formatShotTypePct,
  shotTypeLabel,
  sortShotTypeKeys,
  sumShotTypeCounts,
} from "../lib/shotTypeBreakdown";

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

interface LeaderDisplayRow {
  player: BoxscoreRow;
  value: number;
  /** このグループを代表者+「他◯人」の1行にまとめている場合の残り人数（分割表示時は常に0） */
  otherCount: number;
  /** 値グループの順位（0始まり、1位グループ=0）。行位置ではなくこれで文字サイズ等の強調度を決める */
  groupIndex: number;
}

/** pickTieBreakWinnerと同じ優先順位（プレータイム→EFF→背番号）の比較関数版。タイ内の表示順を揃えるのに使う */
function compareTieBreak(a: BoxscoreRow, b: BoxscoreRow): number {
  const playTimeDiff = playTimeToSeconds(b.PlayTime) - playTimeToSeconds(a.PlayTime);
  if (playTimeDiff !== 0) return playTimeDiff;
  const effDiff = b.EFF - a.EFF;
  if (effDiff !== 0) return effDiff;
  return Number(a.PlayerNo) - Number(b.PlayerNo);
}

const LEADER_TOP3_SLOTS = 3;

/**
 * スタッツ上位（表示枠3行）を、同値タイの扱いを含めて求める。値の大きいグループから順に、
 * 残り枠にグループ全員が収まるならそれぞれ別の行で表示し、収まらない場合のみ
 * pickTieBreakWinnerで代表者を1人選び「他◯人」を付けた1行にまとめる（この行が最後の表示行になる。
 * 例えば残り2枠にタイ5人のグループが来た場合も、代表者1行にまとめて打ち切る＝以降のグループは
 * 表示しない。複数行に分割されたグループ内の順序もcompareTieBreakで揃える）。
 * 各行のgroupIndexは「何番目に大きい値のグループか」を表し、行位置ではなくこれをCSSの
 * 強調度（文字サイズ等）に対応させる
 */
function topRankedLeaderRows(rows: BoxscoreRow[], statKey: "Point" | "RB_TOT" | "AS"): LeaderDisplayRow[] {
  const candidates = rows.filter((r) => r.PlayTime !== "DNP");
  if (candidates.length === 0) return [];
  const distinctValues = Array.from(new Set(candidates.map((r) => r[statKey]))).sort((a, b) => b - a);

  const result: LeaderDisplayRow[] = [];
  let remaining = LEADER_TOP3_SLOTS;
  for (let groupIndex = 0; groupIndex < distinctValues.length && remaining > 0; groupIndex++) {
    const value = distinctValues[groupIndex]!;
    const tied = candidates.filter((r) => r[statKey] === value);
    if (tied.length <= remaining) {
      for (const player of [...tied].sort(compareTieBreak)) {
        result.push({ player, value, otherCount: 0, groupIndex });
      }
      remaining -= tied.length;
    } else {
      const representative = pickTieBreakWinner(tied);
      result.push({ player: representative, value, otherCount: tied.length - 1, groupIndex });
      remaining = 0;
    }
  }
  return result;
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

export function GameDetailPage({ season }: { season: string }) {
  const { scheduleKey } = useParams<{ scheduleKey: string }>();
  const { data: game, loading, error } = useJsonData(
    () => (scheduleKey ? fetchGame(season, scheduleKey) : Promise.reject(new Error("scheduleKeyがありません"))),
    [season, scheduleKey],
  );
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const { supported: yahooSeasonSupported } = useYahooPbpCoverage(season);
  const { data: yahooPbp } = useJsonData(
    () => (yahooSeasonSupported && scheduleKey ? fetchYahooGamePbp(season, scheduleKey) : Promise.resolve(null)),
    [season, scheduleKey, yahooSeasonSupported],
  );
  // シーズン単位で対応範囲でも、この試合自体が未取得（Yahoo側500エラー等でスキップ）のことが
  // あるため、実際にデータが取れているかで最終判定する（DESIGN.md参照）
  const yahooPbpAvailable = yahooPbp !== null;
  // players-master.json由来の国籍・登録区分（players.jsonに突合済み）をボックススコア集計に流用する。
  // 2016-17〜2025-26シーズンの退団済み選手はscrape-season-rosters.tsのバックフィルで概ね
  // カバー済みだが、それ以外（バックフィル対象外の選手・legacy期間の一覧漏れ等）は
  // classification未定義のままになりうる
  const { data: players, loading: playersLoading } = useJsonData(() => fetchPlayers(season), [season]);
  // シーズン非依存の静的データなので空配列depsで一度だけ取得する。無くても表示は成立する
  // （ロゴ・写真と同じくグレースフルデグラデーション。デフォルト色にフォールバックする）ため
  // ローディング/エラーで画面全体をブロックしない
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const [shotPeriodRange, setShotPeriodRange] = useState<PeriodRangeValue>("all");
  const [showExtendedLeaders, setShowExtendedLeaders] = useState(true);
  // ボックススコアのカテゴリタブに「シューティング」を5つ目の選択肢として統合したもの
  // （DESIGN.md参照）。トラディショナル/アドバンスド/Misc/スコアリングはBoxscoreTable本体へ
  // 制御を委譲し、シューティング選択時はBoxscoreTableの代わりに既存のシュートタイプ内訳
  // テーブル（横スライド形式のUIはそのまま）を表示する
  const [boxscoreTab, setBoxscoreTab] = useState<BoxscoreTabKey | "shooting">("traditional");

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

  const allShots = shotChartSupported ? buildShotEvents(game.raw.PlayByPlays) : [];
  const homeShots = allShots.filter((s) => s.teamId === game.homeTeam.id);
  const awayShots = allShots.filter((s) => s.teamId === game.awayTeam.id);

  // シュートタイプ内訳（Yahoo!スポーツplay-by-play由来。DESIGN.md参照）
  const shotTypeBreakdownByPlayer = yahooPbp ? buildShotTypeBreakdownByPlayer(yahooPbp.shots) : new Map<string, ShotTypeBreakdown>();
  const shotTypeKeys = yahooPbp
    ? sortShotTypeKeys([...new Set(yahooPbp.shots.map((s) => s.shotType).filter((t) => t.length > 0))])
    : [];

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
  // 個人OFFRTG/DEFRTG/NETRTG/PACE（在コート中のチームレーティング）。検証手段が無く精度を
  // 保証できないため、coverage==="full"（ショットチャートと同じ2022-23シーズン以降）のみ算出する
  // （DESIGN.md 17章参照）
  let onCourtRatings: Record<string, PlayerOnCourtRatings> = {};

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
    if (shotChartSupported) {
      onCourtRatings = computeOnCourtRatings(onCourt.intervals);
    }
    const intervalsByPlayer = new Map<string, SubstitutionRow["intervals"]>();
    for (const iv of onCourt.intervals) {
      const list = intervalsByPlayer.get(iv.playerId) ?? [];
      list.push({ startSec: iv.startSec, endSec: iv.endSec, ownPts: iv.ownPts, oppPts: iv.oppPts });
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
          <a
            href={`https://www.bleague.jp/game_detail/?ScheduleKey=${game.scheduleKey}&tab=2`}
            target="_blank"
            rel="noreferrer"
            className="scoreboard-date"
            title="公式サイトのボックススコアを見る（bleague.jp）"
          >
            {game.date}
          </a>
          <div>{game.gameEndedFlg ? "FINAL" : "試合中"}</div>
          {game.raw.Game.Attendance != null && (
            <div className="scoreboard-attendance">来場者数 {game.raw.Game.Attendance.toLocaleString()}人</div>
          )}
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
                  <td className="align-left">
                    <Link to={`/teams/${game.homeTeam.id}`}>{game.homeTeam.name}</Link>
                  </td>
                  {game.quarterScores.home.map((s, i) => (
                    <td key={i}>{s}</td>
                  ))}
                  <td>
                    <strong>{game.homeScore}</strong>
                  </td>
                </tr>
                <tr>
                  <td className="align-left">
                    <Link to={`/teams/${game.awayTeam.id}`}>{game.awayTeam.name}</Link>
                  </td>
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
                  <td className="align-left">
                    <Link to={`/teams/${game.homeTeam.id}`}>{game.homeTeam.name}</Link>
                  </td>
                  {homeCum.map((s, i) => (
                    <td key={i}>{s}</td>
                  ))}
                </tr>
                <tr>
                  <td className="align-left">
                    <Link to={`/teams/${game.awayTeam.id}`}>{game.awayTeam.name}</Link>
                  </td>
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
            timeouts={timeoutMarks}
          />
        ) : (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        )}
      </section>

      <h2>ボックススコア</h2>
      <div className="mode-toggle boxscore-category-tabs">
        {BOXSCORE_TABS.map((tab) => (
          <button key={tab.key} className={tab.key === boxscoreTab ? "active" : ""} onClick={() => setBoxscoreTab(tab.key)}>
            {tab.label}
          </button>
        ))}
        <button className={boxscoreTab === "shooting" ? "active" : ""} onClick={() => setBoxscoreTab("shooting")}>
          シューティング
        </button>
      </div>
      {boxscoreTab === "shooting" ? (
        !yahooPbpAvailable ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ShootingBreakdownTable
              teamName={game.homeTeam.name}
              players={homePlayers}
              breakdownByPlayer={shotTypeBreakdownByPlayer}
              shotTypeKeys={shotTypeKeys}
              accentColor={homeColor}
            />
            <ShootingBreakdownTable
              teamName={game.awayTeam.name}
              players={awayPlayers}
              breakdownByPlayer={shotTypeBreakdownByPlayer}
              shotTypeKeys={shotTypeKeys}
              accentColor={awayColor}
            />
            <p className="page-subtitle">
              Yahoo!スポーツplay-by-play由来のシュートタイプ内訳（2023-24シーズン以降。DESIGN.md参照）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「Jump Shot」に一括りになっている点に注意
            </p>
          </>
        )
      ) : (
        <BoxscoreTable
          homeTeamName={game.homeTeam.name}
          awayTeamName={game.awayTeam.name}
          homeRows={game.raw.HomeBoxscores}
          awayRows={game.raw.AwayBoxscores}
          summaries={game.raw.Summaries}
          playByPlays={game.raw.PlayByPlays}
          yahooTurnovers={yahooPbp?.turnovers ?? []}
          yahooPbpSupported={yahooPbpAvailable}
          periods={periods}
          classificationById={classificationById}
          shotChartSupported={shotChartSupported}
          onCourtRatings={onCourtRatings}
          homeColor={homeColor}
          awayColor={awayColor}
          activeTab={boxscoreTab}
          onTabChange={setBoxscoreTab}
          hideTabBar
        />
      )}

      <h2>ゲームリーダー</h2>
      <div className="game-leaders">
        <GameLeadersTeam teamName={game.homeTeam.name} rows={homePlayers} accentColor={homeColor} />
        <GameLeadersTeam teamName={game.awayTeam.name} rows={awayPlayers} accentColor={awayColor} />
      </div>
      <div className="leader-matchup-toggle">
        <button onClick={() => setShowExtendedLeaders((v) => !v)}>
          {showExtendedLeaders ? "隠す" : "詳細"}
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
    </div>
  );
}

const EMPTY_SHOT_TYPE_COUNTS = { made: 0, attempted: 0 };

function ShootingBreakdownTable({
  teamName,
  players,
  breakdownByPlayer,
  shotTypeKeys,
  accentColor,
}: {
  teamName: string;
  players: BoxscoreRow[];
  breakdownByPlayer: Map<string, ShotTypeBreakdown>;
  shotTypeKeys: string[];
  accentColor?: string;
}) {
  const renderRows = (rows: BoxscoreRow[]) =>
    rows.map((p) => {
      const breakdown = breakdownByPlayer.get(p.PlayerID) ?? {};
      const totalTwo = shotTypeKeys.reduce((acc, key) => {
        const c = breakdown[key];
        return c ? sumShotTypeCounts(acc, c.twoPoint) : acc;
      }, EMPTY_SHOT_TYPE_COUNTS);
      const totalThree = shotTypeKeys.reduce((acc, key) => {
        const c = breakdown[key];
        return c ? sumShotTypeCounts(acc, c.threePoint) : acc;
      }, EMPTY_SHOT_TYPE_COUNTS);
      return (
        <tr key={p.PlayerID}>
          <td className="align-left">
            <Link to={`/players/${p.PlayerID}`} className="cell-link">
              {p.PlayerNameJ}
            </Link>
          </td>
          {shotTypeKeys.map((key) => (
            <Fragment key={key}>
              <td className="align-right">{formatShotTypeMade(breakdown[key]?.twoPoint)}</td>
              <td className="align-right">{formatShotTypeAttempted(breakdown[key]?.twoPoint)}</td>
              <td className="align-right">{formatShotTypePct(breakdown[key]?.twoPoint)}</td>
              <td className="align-right">{formatShotTypeMade(breakdown[key]?.threePoint)}</td>
              <td className="align-right">{formatShotTypeAttempted(breakdown[key]?.threePoint)}</td>
              <td className="align-right">{formatShotTypePct(breakdown[key]?.threePoint)}</td>
            </Fragment>
          ))}
          <td className="align-right">{formatShotTypeMade(totalTwo)}</td>
          <td className="align-right">{formatShotTypeAttempted(totalTwo)}</td>
          <td className="align-right">{formatShotTypePct(totalTwo)}</td>
          <td className="align-right">{formatShotTypeMade(totalThree)}</td>
          <td className="align-right">{formatShotTypeAttempted(totalThree)}</td>
          <td className="align-right">{formatShotTypePct(totalThree)}</td>
        </tr>
      );
    });
  const starters = players.filter((p) => p.StartingFlg === 1);
  const bench = players.filter((p) => p.StartingFlg !== 1);
  return (
    <div className="boxscore-section" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
      <h3>{teamName}</h3>
      {shotTypeKeys.length === 0 ? (
        <p className="empty-message">この試合のデータがありません</p>
      ) : (
        <div className="table-scroll">
          <table className="boxscore-table">
            <thead>
              <tr>
                <th className="align-left" rowSpan={2}>選手</th>
                {shotTypeKeys.map((key) => (
                  <th key={key} colSpan={6}>{shotTypeLabel(key)}</th>
                ))}
                <th colSpan={6}>合計</th>
              </tr>
              <tr>
                {shotTypeKeys.map((key) => (
                  <Fragment key={key}>
                    <th className="align-right">2PM</th>
                    <th className="align-right">2PA</th>
                    <th className="align-right">2P%</th>
                    <th className="align-right">3PM</th>
                    <th className="align-right">3PA</th>
                    <th className="align-right">3P%</th>
                  </Fragment>
                ))}
                <th className="align-right">2PM</th>
                <th className="align-right">2PA</th>
                <th className="align-right">2P%</th>
                <th className="align-right">3PM</th>
                <th className="align-right">3PA</th>
                <th className="align-right">3P%</th>
              </tr>
            </thead>
            <tbody>
              {renderRows(starters)}
              {renderRows(bench)}
            </tbody>
          </table>
        </div>
      )}
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
      <LeaderTop3Row label="PTS" rows={topRankedLeaderRows(rows, "Point")} />
      <LeaderTop3Row label="REB" rows={topRankedLeaderRows(rows, "RB_TOT")} />
      <LeaderTop3Row label="AST" rows={topRankedLeaderRows(rows, "AS")} />
    </div>
  );
}

function LeaderTop3Row({ label, rows }: { label: string; rows: LeaderDisplayRow[] }) {
  const top1 = rows[0];
  return (
    <div className="leader-top3-row">
      <span className="leader-top3-label">{label}</span>
      {top1 ? (
        <PlayerPhoto playerId={top1.player.PlayerID} size={48} className="leader-top3-photo" />
      ) : (
        <div className="leader-top3-photo-placeholder" />
      )}
      <div className="leader-top3-list">
        {rows.map((row) => (
          <div key={row.player.PlayerID} className={`leader-top3-item leader-top3-rank-${row.groupIndex + 1}`}>
            <Link to={`/players/${row.player.PlayerID}`} className="leader-top3-name">
              {row.player.PlayerNameJ}
              {row.otherCount > 0 && <span className="leader-top3-others"> 他{row.otherCount}人</span>}
            </Link>
            <span className="leader-top3-value">{row.value}</span>
          </div>
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
    <div className="leader-matchup-player">
      <Link to={`/players/${player.PlayerID}`} className="leader-matchup-player-link">
        <PlayerPhoto playerId={player.PlayerID} size={44} className="leader-matchup-player-photo" />
        <span className="leader-matchup-player-name">
          {player.PlayerNameJ}
          {otherCount > 0 && <span className="leader-matchup-player-others"> 他{otherCount}人</span>}
        </span>
      </Link>
    </div>
  );
}


