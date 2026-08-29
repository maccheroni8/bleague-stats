import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  fetchDivisionHistory,
  fetchGame,
  fetchGameSummaries,
  fetchPlayerGameLogs,
  fetchPlayers,
  fetchSchedule,
  fetchSeasons,
  fetchStandingsHistory,
  fetchTeamColors,
  fetchTeamGameLogs,
  fetchTeamHistory,
  fetchTeamLineups,
  fetchTeams,
  fetchYahooGamePbp,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  ClubHonor,
  DivisionHistoryFile,
  GameSummary,
  GameType,
  PlayerGameLog,
  PlayerSummary,
  ShotTypeBreakdown,
  StandingsSnapshot,
  StoredGame,
  TeamGameLog,
  TeamSummary,
  UpcomingGameEntry,
  YahooGamePbp,
  YahooTurnoverEvent,
} from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PeriodRangeToggle } from "../components/PeriodRangeToggle";
import { periodInRange, type PeriodRangeValue } from "../lib/periodRange";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatPct100, formatRecord, formatSigned, formatWinPct } from "../lib/format";
import {
  buildBackToBackStatus,
  buildGameTeamsByScheduleKey,
  buildRecordsBeforeGame,
  filterGameLogs,
  isDefaultFilter,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  resolveOwnTeam,
  type BackToBackGame,
  type GameTeamInfo,
  type RecordBeforeGame,
  type SituationalFilter,
  type TeamSituationalStats,
} from "../lib/situational";
import { isWednesdayGame, isWeekdayGame } from "../lib/japaneseHolidays";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { safeDiv } from "../../shared/formulas";
import {
  SEASON_BOX_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  buildTeamGameBoxTotals,
  buildTeamMultiGameBoxTotals,
  buildTeamPeriodStats,
  buildTeamSplitRowsForPeriod,
  countDoubleTripleDoubles,
  filterByGameType,
  sumTeamGameLogsFor,
  type SeasonBoxTabKey,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamGameBoxTotals,
} from "../lib/playerSeasonBoxscore";
import { BOXSCORE_TABS, COLUMNS_BY_TAB, type BoxscoreColumn, type BoxscoreTabKey, type ColumnCtx } from "../components/BoxscoreTable";
import { formatAstToRatio, formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import type { BoxscoreCounts } from "../lib/boxscoreAggregate";
import { ShotChartPanel } from "../components/ShotChart";
import { buildShotEvents, type ShotEvent } from "../lib/shotChart";
import {
  buildShotTypeBreakdownByTeam,
  formatShotTypeCell,
  scaleShotTypeCounts,
  shotTypeLabel,
  sortShotTypeKeys,
  sumShotTypeCounts,
} from "../lib/shotTypeBreakdown";
import { ComparisonTable, type ComparisonRow, type ComparisonStatDef } from "./ComparePage";

// 「シューティング」セクションの平均/合計切り替え。個人詳細ページと同じ2択のみ
const DISPLAY_MODE_TOGGLE_OPTIONS: SeasonDisplayMode[] = ["perGame", "total"];

const TEAM_SHOOTING_SECTION_TOOLTIP =
  "Yahoo!スポーツplay-by-play由来のシュートタイプ別成功/試投（チーム全選手合算、2023-24シーズン以降・レギュラーシーズンのみが既定。DESIGN.md参照）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「ジャンプショット」に一括りになっている点に注意。上部のシチュエーション別フィルタ・Q別/前後半トグルと連動する（連動時はプレーオフも含まれうる）";

// 出場時間がこれ未満のラインナップはサンプルが小さすぎてノイズが大きいため一覧から除外する
// （実データ確認: 4試合時点で3分(180秒)基準だとチームあたり4〜14組が該当。DESIGN.md参照）
const MIN_LINEUP_SECONDS = 180;
const MAX_LINEUP_ROWS = 10;

// 「チーム内リーダー」（Phase H3②）。ホーム画面の「シーズンスタッツリーダー」個人モードと
// 同じ構成（各項目トップ5・1位のみ写真付き）・同じ12項目をチームの選手のみに絞って表示する。
// 表示条件（ランキング掲載基準）は後日設定するとのことのため、今回は基準なし（全選手対象）
const TEAM_INTERNAL_LEADER_STAT_KEYS = ["pts", "reb", "ast", "blk", "stl", "fgPct", "tpPct", "twoPct", "ftPct", "min", "efgPct", "per"];
const TEAM_LEADERS_TOP_N = 5;

interface RadarStatDef {
  key: string;
  label: string;
  value: (t: TeamSummary) => number;
  format: (t: TeamSummary) => string;
  /** falseならDRtgのように値が小さいほど良い項目。パーセンタイル換算・順位算出の向きに使う */
  higherIsBetter: boolean;
}

// ヘッダーのレーダーチャート用の16項目（0時の位置から時計回り: 得点/リバウンド/アシスト/
// スティール/ブロック/2P%/3P%/FT%/失点/eFG%/TOV%/FTR/OR%/ORtg/DRtg/NETRtg）
const RADAR_STAT_DEFS: RadarStatDef[] = [
  { key: "pts", label: "得点", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
  { key: "reb", label: "リバウンド", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
  { key: "ast", label: "アシスト", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
  { key: "stl", label: "スティール", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
  { key: "blk", label: "ブロック", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
  { key: "pt2Pct", label: "2P%", value: (t) => t.shooting.pt2Pct, format: (t) => formatPct(t.shooting.pt2Pct), higherIsBetter: true },
  { key: "tpPct", label: "3P%", value: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct), higherIsBetter: true },
  { key: "ftPct", label: "FT%", value: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct), higherIsBetter: true },
  {
    key: "oppPts",
    label: "失点",
    value: (t) => t.opponentPerGame.pts,
    format: (t) => formatDecimal(t.opponentPerGame.pts),
    higherIsBetter: false,
  },
  {
    key: "efgPct",
    label: "eFG%",
    value: (t) => t.shooting.efgPct,
    format: (t) => formatPct(t.shooting.efgPct),
    higherIsBetter: true,
  },
  {
    key: "tovPct",
    label: "TOV%",
    value: (t) => t.advanced.tovPct,
    format: (t) => formatPct100(t.advanced.tovPct),
    higherIsBetter: false,
  },
  {
    key: "ftRate",
    label: "FTR",
    value: (t) => t.shooting.ftRate,
    format: (t) => formatDecimal(t.shooting.ftRate, 3),
    higherIsBetter: true,
  },
  {
    key: "orbPct",
    label: "OR%",
    value: (t) => t.advanced.orbPct,
    format: (t) => formatPct100(t.advanced.orbPct),
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
  {
    key: "netRtg",
    label: "NETRtg",
    value: (t) => t.advanced.netRtg,
    format: (t) => formatSigned(t.advanced.netRtg),
    higherIsBetter: true,
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

interface TeamHeaderStatDef {
  key: string;
  label: string;
  value: (t: TeamSummary) => number;
  format: (t: TeamSummary) => string;
  /** falseなら値が小さいほど良い項目（oppPTS等）。順位算出の向きに使う。
   * oppTOVのみ「相手に強制したターンオーバー」の意味なので例外的にtrue */
  higherIsBetter: boolean;
}

// ヘッダーのスタッツタイル（2段×14列）。上段=自チーム、下段=相手（opp）で、
// 同じ列位置が対になるよう配置する（NetRtgの真下だけはoppNetRtgではなくPACEを配置）。
// シーズン合計（フィルタなし）固定で表示し、各タイルにリーグ内順位を併記する
const TEAM_HEADER_STAT_ROWS: TeamHeaderStatDef[][] = [
  [
    { key: "pts", label: "PTS", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
    { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
    { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
    { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
    { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
    { key: "tov", label: "TOV", value: (t) => t.perGame.tov, format: (t) => formatDecimal(t.perGame.tov), higherIsBetter: false },
    { key: "fgPct", label: "FG%", value: (t) => t.shooting.fgPct, format: (t) => formatPct(t.shooting.fgPct), higherIsBetter: true },
    { key: "tpPct", label: "3P%", value: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct), higherIsBetter: true },
    { key: "pt2Pct", label: "2P%", value: (t) => t.shooting.pt2Pct, format: (t) => formatPct(t.shooting.pt2Pct), higherIsBetter: true },
    { key: "ftPct", label: "FT%", value: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct), higherIsBetter: true },
    { key: "efgPct", label: "eFG%", value: (t) => t.shooting.efgPct, format: (t) => formatPct(t.shooting.efgPct), higherIsBetter: true },
    { key: "tsPct", label: "TS%", value: (t) => t.shooting.tsPct, format: (t) => formatPct(t.shooting.tsPct), higherIsBetter: true },
    { key: "offRtg", label: "ORtg", value: (t) => t.advanced.offRtg, format: (t) => formatDecimal(t.advanced.offRtg), higherIsBetter: true },
    { key: "netRtg", label: "NetRtg", value: (t) => t.advanced.netRtg, format: (t) => formatSigned(t.advanced.netRtg), higherIsBetter: true },
    { key: "ftr", label: "FTR", value: (t) => t.shooting.ftRate, format: (t) => formatDecimal(t.shooting.ftRate, 3), higherIsBetter: true },
    { key: "tovPct", label: "TOV%", value: (t) => t.advanced.tovPct, format: (t) => formatPct100(t.advanced.tovPct), higherIsBetter: false },
    { key: "orbPct", label: "OR%", value: (t) => t.advanced.orbPct, format: (t) => formatPct100(t.advanced.orbPct), higherIsBetter: true },
  ],
  [
    { key: "oppPts", label: "oppPTS", value: (t) => t.opponentPerGame.pts, format: (t) => formatDecimal(t.opponentPerGame.pts), higherIsBetter: false },
    { key: "oppReb", label: "oppREB", value: (t) => t.opponentPerGame.reb, format: (t) => formatDecimal(t.opponentPerGame.reb), higherIsBetter: false },
    { key: "oppAst", label: "oppAST", value: (t) => t.opponentPerGame.ast, format: (t) => formatDecimal(t.opponentPerGame.ast), higherIsBetter: false },
    { key: "oppStl", label: "oppSTL", value: (t) => t.opponentPerGame.stl, format: (t) => formatDecimal(t.opponentPerGame.stl), higherIsBetter: false },
    { key: "oppBlk", label: "oppBLK", value: (t) => t.opponentPerGame.blk, format: (t) => formatDecimal(t.opponentPerGame.blk), higherIsBetter: false },
    { key: "oppTov", label: "oppTOV", value: (t) => t.opponentPerGame.tov, format: (t) => formatDecimal(t.opponentPerGame.tov), higherIsBetter: true },
    { key: "oppFgPct", label: "opp FG%", value: (t) => t.opponentShooting.fgPct, format: (t) => formatPct(t.opponentShooting.fgPct), higherIsBetter: false },
    { key: "oppTpPct", label: "opp 3P%", value: (t) => t.opponentShooting.tpPct, format: (t) => formatPct(t.opponentShooting.tpPct), higherIsBetter: false },
    { key: "oppPt2Pct", label: "opp 2P%", value: (t) => t.opponentShooting.pt2Pct, format: (t) => formatPct(t.opponentShooting.pt2Pct), higherIsBetter: false },
    { key: "oppFtPct", label: "opp FT%", value: (t) => t.opponentShooting.ftPct, format: (t) => formatPct(t.opponentShooting.ftPct), higherIsBetter: false },
    { key: "oppEfgPct", label: "opp eFG%", value: (t) => t.opponentShooting.efgPct, format: (t) => formatPct(t.opponentShooting.efgPct), higherIsBetter: false },
    { key: "oppTsPct", label: "opp TS%", value: (t) => t.opponentShooting.tsPct, format: (t) => formatPct(t.opponentShooting.tsPct), higherIsBetter: false },
    { key: "defRtg", label: "DRtg", value: (t) => t.advanced.defRtg, format: (t) => formatDecimal(t.advanced.defRtg), higherIsBetter: false },
    { key: "pace", label: "PACE", value: (t) => t.advanced.pace, format: (t) => formatDecimal(t.advanced.pace), higherIsBetter: true },
    {
      key: "oppFtr",
      label: "opp FTR",
      value: (t) => t.opponentShooting.ftRate,
      format: (t) => formatDecimal(t.opponentShooting.ftRate, 3),
      higherIsBetter: false,
    },
    {
      key: "oppTovPct",
      label: "opp TOV%",
      value: (t) => t.advanced.opponentTovPct,
      format: (t) => formatPct100(t.advanced.opponentTovPct),
      higherIsBetter: true,
    },
    {
      key: "oppOrbPct",
      label: "opp OR%",
      value: (t) => t.advanced.opponentOrbPct,
      format: (t) => formatPct100(t.advanced.opponentOrbPct),
      higherIsBetter: false,
    },
  ],
];

interface TeamRankResult {
  rank: number;
  total: number;
}

/** リーグ全チーム中でのteamの順位を返す（1位=最良）。higherIsBetterがfalseの項目は昇順で評価する */
function rankAmongTeams(team: TeamSummary, allTeams: TeamSummary[], def: TeamHeaderStatDef): TeamRankResult {
  const total = allTeams.length;
  const sorted = [...allTeams].sort((a, b) => (def.higherIsBetter ? def.value(b) - def.value(a) : def.value(a) - def.value(b)));
  const rank = sorted.findIndex((t) => t.teamId === team.teamId) + 1;
  return { rank, total };
}

function formatTeamRank({ rank, total }: TeamRankResult): string {
  return `${rank}位/${total}チーム`;
}

const DIVISION_LABELS: Record<string, string> = {
  east: "東地区",
  west: "西地区",
  north: "北地区",
  central: "中地区",
  south: "南地区",
};

// ヘッダーの試合数/勝敗/勝率+順位の1行表示（例:「60試合45勝15敗.750 東地区1位 全体2位」）。
// 地区順位・全体順位は既存のstandings-history.json（順位表ページと同じデータ源）から引く
function buildTeamRecordLine(team: TeamSummary, standingsHistory: StandingsSnapshot[] | null | undefined): string {
  const winPct = safeDiv(team.wins, team.wins + team.losses);
  let line = `${team.gamesPlayed}試合${team.wins}勝${team.losses}敗${formatWinPct(winPct)}`;

  const latest = standingsHistory && standingsHistory.length > 0 ? standingsHistory[standingsHistory.length - 1] : undefined;
  const entry = latest?.teams.find((t) => t.teamId === team.teamId);
  if (entry) {
    if (entry.division && entry.divisionRank) {
      const divisionLabel = DIVISION_LABELS[entry.division] ?? entry.division;
      line += ` ${divisionLabel}${entry.divisionRank}位`;
    }
    line += ` 全体${entry.rank}位`;
  }
  return line;
}

// 「スタッツ」タブの自チーム／opp／+/-トグル。ヘッダーの自チーム行/opp行の対比構造
// （TEAM_HEADER_STAT_ROWS）と同じ考え方を、カウント/シューティング系11項目に絞って
// 1つのトグルボタンで切り替えられるようにしたもの。PACE/ORtg/DRtg/NetRtgの4項目は
// ヘッダー側と同様、自チーム視点の値のみを持つ既存の独立した概念のためトグルの対象外とし、
// 常に固定表示する（DESIGN.md参照）
type TeamPerspective = "own" | "opp" | "diff";

const TEAM_PERSPECTIVE_LABELS: Record<TeamPerspective, string> = {
  own: "自チーム",
  opp: "opp",
  diff: "+/-",
};

interface TeamPerspectiveStatDef {
  key: string;
  label: string;
  own: (s: TeamSituationalStats) => number;
  opp: (s: TeamSituationalStats) => number;
  diff: (s: TeamSituationalStats) => number;
  isPct: boolean;
}

const TEAM_PERSPECTIVE_STAT_DEFS: TeamPerspectiveStatDef[] = [
  { key: "pts", label: "PTS", own: (s) => s.perGame.pts, opp: (s) => s.perGame.oppPts, diff: (s) => s.perGame.net, isPct: false },
  {
    key: "reb",
    label: "REB",
    own: (s) => s.perGame.reb,
    opp: (s) => s.perGame.oppReb,
    diff: (s) => s.perGame.reb - s.perGame.oppReb,
    isPct: false,
  },
  {
    key: "ast",
    label: "AST",
    own: (s) => s.perGame.ast,
    opp: (s) => s.perGame.oppAst,
    diff: (s) => s.perGame.ast - s.perGame.oppAst,
    isPct: false,
  },
  {
    key: "stl",
    label: "STL",
    own: (s) => s.perGame.stl,
    opp: (s) => s.perGame.oppStl,
    diff: (s) => s.perGame.stl - s.perGame.oppStl,
    isPct: false,
  },
  {
    key: "blk",
    label: "BLK",
    own: (s) => s.perGame.blk,
    opp: (s) => s.perGame.oppBlk,
    diff: (s) => s.perGame.blk - s.perGame.oppBlk,
    isPct: false,
  },
  {
    key: "tov",
    label: "TOV",
    own: (s) => s.perGame.tov,
    opp: (s) => s.perGame.oppTov,
    diff: (s) => s.perGame.tov - s.perGame.oppTov,
    isPct: false,
  },
  {
    key: "fgPct",
    label: "FG%",
    own: (s) => s.shooting.fgPct,
    opp: (s) => s.shooting.oppFgPct,
    diff: (s) => s.shooting.fgPct - s.shooting.oppFgPct,
    isPct: true,
  },
  {
    key: "tpPct",
    label: "3P%",
    own: (s) => s.shooting.tpPct,
    opp: (s) => s.shooting.oppTpPct,
    diff: (s) => s.shooting.tpPct - s.shooting.oppTpPct,
    isPct: true,
  },
  {
    key: "ftPct",
    label: "FT%",
    own: (s) => s.shooting.ftPct,
    opp: (s) => s.shooting.oppFtPct,
    diff: (s) => s.shooting.ftPct - s.shooting.oppFtPct,
    isPct: true,
  },
  {
    key: "efgPct",
    label: "eFG%",
    own: (s) => s.shooting.efgPct,
    opp: (s) => s.shooting.oppEfgPct,
    diff: (s) => s.shooting.efgPct - s.shooting.oppEfgPct,
    isPct: true,
  },
  {
    key: "tsPct",
    label: "TS%",
    own: (s) => s.shooting.tsPct,
    opp: (s) => s.shooting.oppTsPct,
    diff: (s) => s.shooting.tsPct - s.shooting.oppTsPct,
    isPct: true,
  },
];

function formatTeamPerspectiveValue(def: TeamPerspectiveStatDef, stats: TeamSituationalStats, mode: TeamPerspective): string {
  const value = mode === "own" ? def.own(stats) : mode === "opp" ? def.opp(stats) : def.diff(stats);
  if (mode === "diff") return def.isPct ? `${formatSigned(value * 100, 1)}%` : formatSigned(value);
  return def.isPct ? formatPct(value) : formatDecimal(value);
}

/** フィルタ無し（シーズン全体・試合全体）の場合のみ、teams.jsonのシーズン集計値（0コストで参照可能）
 * からTeamSituationalStats相当の形を直接組み立てる。それ以外（シチュエーション別フィルタ・
 * Q別/前後半トグル）はTeamGameLog/生データベースの再集計（buildTeamPeriodStats）が必要になる */
function teamSummaryToSituationalStats(team: TeamSummary): TeamSituationalStats {
  return {
    gamesPlayed: team.gamesPlayed,
    perGame: {
      pts: team.perGame.pts,
      oppPts: team.opponentPerGame.pts,
      net: team.netPerGame.pts,
      reb: team.perGame.reb,
      oppReb: team.opponentPerGame.reb,
      ast: team.perGame.ast,
      oppAst: team.opponentPerGame.ast,
      stl: team.perGame.stl,
      oppStl: team.opponentPerGame.stl,
      blk: team.perGame.blk,
      oppBlk: team.opponentPerGame.blk,
      tov: team.perGame.tov,
      oppTov: team.opponentPerGame.tov,
    },
    shooting: {
      fgPct: team.shooting.fgPct,
      oppFgPct: team.opponentShooting.fgPct,
      tpPct: team.shooting.tpPct,
      oppTpPct: team.opponentShooting.tpPct,
      ftPct: team.shooting.ftPct,
      oppFtPct: team.opponentShooting.ftPct,
      efgPct: team.shooting.efgPct,
      oppEfgPct: team.opponentShooting.efgPct,
      tsPct: team.shooting.tsPct,
      oppTsPct: team.opponentShooting.tsPct,
    },
    advanced: {
      pace: team.advanced.pace,
      offRtg: team.advanced.offRtg,
      defRtg: team.advanced.defRtg,
      netRtg: team.advanced.netRtg,
    },
  };
}

type PlayerStatMode = "basic" | "advanced";

const PLAYER_STAT_MODE_LABELS: Record<PlayerStatMode, string> = {
  basic: "基本",
  advanced: "アドバンスド",
};

const HONOR_CATEGORY_LABELS: Record<ClubHonor["category"], string> = {
  overall: "年間優勝",
  emperors_cup: "天皇杯",
  division: "地区優勝",
  international: "国際大会",
};
const HONOR_CATEGORY_ORDER: ClubHonor["category"][] = ["overall", "emperors_cup", "division", "international"];

type DetailTab = "overview" | "playerStats" | "schedule" | "career" | "clubRecord" | "stats" | "compare";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概要",
  playerStats: "選手スタッツ",
  schedule: "日程結果",
  career: "通算成績",
  clubRecord: "クラブレコード",
  stats: "スタッツ",
  compare: "比較",
};

interface SeasonRecord {
  season: string;
  teamName: string;
  team: TeamSummary;
}

/**
 * 「シーズン別成績」Miscタブ用（Phase H3①）。PITP/FBPS/2ND PTS/PTSOFFTO/DUNKは
 * TeamSummary（teams.json）には存在せず、TeamGameLog（careerData）側にのみ持っている
 * フィールドのため、シーズンごとにレギュラーシーズンの試合だけを合算して用意する
 * （teams.jsonの他の集計と同じくレギュラーシーズンのみに揃える）
 */
interface TeamSeasonMiscTotals {
  pt2in: number;
  fb: number;
  pt2nd: number;
  pft: number;
  dunks: number;
}

const EMPTY_TEAM_SEASON_MISC: TeamSeasonMiscTotals = { pt2in: 0, fb: 0, pt2nd: 0, pft: 0, dunks: 0 };

function sumTeamSeasonMisc(logs: TeamGameLog[]): TeamSeasonMiscTotals {
  return logs
    .filter((g) => g.gameType === "regular")
    .reduce<TeamSeasonMiscTotals>(
      (acc, g) => ({
        pt2in: acc.pt2in + g.pt2in,
        fb: acc.fb + g.fb,
        pt2nd: acc.pt2nd + g.pt2nd,
        pft: acc.pft + g.pft,
        dunks: acc.dunks + g.dunks,
      }),
      { ...EMPTY_TEAM_SEASON_MISC },
    );
}

interface TeamSeasonBoxColumn {
  key: string;
  label: string;
  format: (r: SeasonRecord, misc: TeamSeasonMiscTotals) => string;
  description?: string;
}

// 「シーズン別成績」の4カテゴリタブ（Phase H3①）。既存のSEASON_BOX_COLUMNS（選手向け、
// PlayerGameLog由来）とは別に、チーム向けの列定義をここで新設する。トラディショナル/
// アドバンスドはTeamSummary（seasonHistory、既に取得済みのシーズン集計）だけで完結する
// （新規バックエンド集計は不要）。MiscはTeamGameLog（careerData）側のPITP/FBPS/2ND PTS/
// PTSOFFTO/DUNKを再利用する。AND1/UFOUL/DQFOUL・被アシスト内訳・LIVETOV/DEADTOVは
// 試合単位のPlayByPlaysからのみ算出できチーム単位のシーズン集計としては永続化していないため
// 今回は列自体を設けていない（DESIGN.md参照、既知の制約）。スコアリングタブは%-share
// （個人の数値／チームの数値）という概念がチーム自身の行には適用できないため、代わりに
// 「得点の内訳構成比」（PITP/FBPS/2ND PTS/PTSOFFTOがチーム総得点に占める割合）を表示する
const TEAM_SEASON_TRADITIONAL_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  { key: "min", label: "MIN", format: (r) => formatMinutesFromSeconds(Math.round(r.team.perGame.min * 60)) },
  { key: "pts", label: "PTS", format: (r) => formatDecimal(r.team.perGame.pts) },
  { key: "fgm", label: "FGM", format: (r) => formatDecimal(safeDiv(r.team.totals.fgm, r.team.gamesPlayed)) },
  { key: "fga", label: "FGA", format: (r) => formatDecimal(safeDiv(r.team.totals.fga, r.team.gamesPlayed)) },
  { key: "fgpct", label: "FG%", format: (r) => formatPct(r.team.shooting.fgPct) },
  { key: "2pm", label: "2PM", format: (r) => formatDecimal(safeDiv(r.team.totals.fgm - r.team.totals.tpm, r.team.gamesPlayed)) },
  { key: "2pa", label: "2PA", format: (r) => formatDecimal(safeDiv(r.team.totals.fga - r.team.totals.tpa, r.team.gamesPlayed)) },
  { key: "2ppct", label: "2P%", format: (r) => formatPct(r.team.shooting.pt2Pct) },
  { key: "3pm", label: "3PM", format: (r) => formatDecimal(safeDiv(r.team.totals.tpm, r.team.gamesPlayed)) },
  { key: "3pa", label: "3PA", format: (r) => formatDecimal(safeDiv(r.team.totals.tpa, r.team.gamesPlayed)) },
  { key: "3ppct", label: "3P%", format: (r) => formatPct(r.team.shooting.tpPct) },
  { key: "ftm", label: "FTM", format: (r) => formatDecimal(safeDiv(r.team.totals.ftm, r.team.gamesPlayed)) },
  { key: "fta", label: "FTA", format: (r) => formatDecimal(safeDiv(r.team.totals.fta, r.team.gamesPlayed)) },
  { key: "ftpct", label: "FT%", format: (r) => formatPct(r.team.shooting.ftPct) },
  { key: "efg", label: "eFG%", format: (r) => formatPct(r.team.shooting.efgPct) },
  { key: "ts", label: "TS%", format: (r) => formatPct(r.team.shooting.tsPct) },
  { key: "or", label: "OR", format: (r) => formatDecimal(r.team.perGame.oreb) },
  { key: "dr", label: "DR", format: (r) => formatDecimal(r.team.perGame.dreb) },
  { key: "tr", label: "TR", format: (r) => formatDecimal(r.team.perGame.reb) },
  { key: "ast", label: "AST", format: (r) => formatDecimal(r.team.perGame.ast) },
  { key: "tov", label: "TOV", format: (r) => formatDecimal(r.team.perGame.tov) },
  { key: "asttov", label: "AST/TOV", format: (r) => formatAstToRatio(r.team.totals.ast, r.team.totals.tov) },
  { key: "stl", label: "STL", format: (r) => formatDecimal(r.team.perGame.stl) },
  { key: "blk", label: "BLK", format: (r) => formatDecimal(r.team.perGame.blk) },
  { key: "bsr", label: "BSR", format: (r) => formatDecimal(safeDiv(r.team.totals.blockedAgainst, r.team.gamesPlayed)) },
  { key: "f", label: "F", format: (r) => formatDecimal(r.team.perGame.pf) },
  { key: "fd", label: "FD", format: (r) => formatDecimal(safeDiv(r.team.totals.foulsDrawn, r.team.gamesPlayed)) },
  { key: "eff", label: "EFF", format: (r) => formatDecimal(r.team.advanced.eff) },
  { key: "plusminus", label: "+/-", format: (r) => formatSigned(r.team.netPerGame.pts) },
];

const TEAM_SEASON_ADVANCED_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  { key: "tovpct", label: "TOV%", format: (r) => formatPct100(r.team.advanced.tovPct) },
  { key: "ftr", label: "FTR", format: (r) => formatDecimal(r.team.shooting.ftRate, 3) },
  { key: "orbpct", label: "OR%", format: (r) => formatPct100(r.team.advanced.orbPct) },
  { key: "efg", label: "eFG%", format: (r) => formatPct(r.team.shooting.efgPct) },
  { key: "ts", label: "TS%", format: (r) => formatPct(r.team.shooting.tsPct) },
  { key: "pps", label: "PPS", format: (r) => formatDecimal(safeDiv(r.team.totals.pts, r.team.totals.fga), 2) },
  { key: "poss", label: "POSS", format: (r) => formatDecimal(safeDiv(r.team.advanced.poss, r.team.gamesPlayed)) },
  { key: "pace", label: "PACE", format: (r) => formatDecimal(r.team.advanced.pace) },
  { key: "ortg", label: "ORtg", format: (r) => formatDecimal(r.team.advanced.offRtg) },
  { key: "drtg", label: "DRtg", format: (r) => formatDecimal(r.team.advanced.defRtg) },
  { key: "netrtg", label: "NetRtg", format: (r) => formatSigned(r.team.advanced.netRtg) },
];

const TEAM_SEASON_MISC_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  { key: "pitp", label: "PITP", format: (r, m) => formatDecimal(safeDiv(m.pt2in, r.team.gamesPlayed)) },
  { key: "fbps", label: "FBPS", format: (r, m) => formatDecimal(safeDiv(m.fb, r.team.gamesPlayed)) },
  { key: "2ndpts", label: "2ND PTS", format: (r, m) => formatDecimal(safeDiv(m.pt2nd, r.team.gamesPlayed)) },
  { key: "ptsofftov", label: "PTSOFFTO", format: (r, m) => formatDecimal(safeDiv(m.pft, r.team.gamesPlayed)) },
  { key: "dunk", label: "DUNK", format: (r, m) => formatDecimal(safeDiv(m.dunks, r.team.gamesPlayed)) },
];

const TEAM_SEASON_SCORING_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  { key: "pitppct", label: "PITP%", format: (r, m) => formatPct100(safeDiv(100 * m.pt2in, r.team.totals.pts)) },
  { key: "fbppct", label: "FBP%", format: (r, m) => formatPct100(safeDiv(100 * m.fb, r.team.totals.pts)) },
  { key: "2ndptspct", label: "2ND PTS%", format: (r, m) => formatPct100(safeDiv(100 * m.pt2nd, r.team.totals.pts)) },
  { key: "ptsofftovpct", label: "PTSOFFTO%", format: (r, m) => formatPct100(safeDiv(100 * m.pft, r.team.totals.pts)) },
];

const TEAM_SEASON_BOX_COLUMNS: Record<SeasonBoxTabKey, TeamSeasonBoxColumn[]> = {
  traditional: TEAM_SEASON_TRADITIONAL_COLUMNS,
  advanced: TEAM_SEASON_ADVANCED_COLUMNS,
  misc: TEAM_SEASON_MISC_COLUMNS,
  scoring: TEAM_SEASON_SCORING_COLUMNS,
};

// ---- 「シチュエーション別勝敗」（Phase H3③、概要タブ） ----

const SITUATIONAL_RECORD_STATUS_LABELS: Record<"lead" | "tie" | "behind", string> = {
  lead: "リード",
  tie: "同点",
  behind: "ビハインド",
};

interface SituationalRecordRow {
  key: string;
  label: string;
  /** rawGameが必要な区分（延長・Q別リード状況）は、未取得の試合に対してはこの関数を呼ばない
   * （呼び出し側でrawGames.has(scheduleKey)の試合だけに絞り込んでから呼ぶ） */
  predicate: (g: TeamGameLog, rawGame: StoredGame | undefined) => boolean;
}

interface SituationalRecordGroupDef {
  key: string;
  label: string;
  /** trueの区分は試合の生データ（quarterScores）が無いと判定できないため、rawGamesに
   * 存在する試合だけを母集団にする（DESIGN.md参照。日程結果/スタッツタブと同じstatsRawGamesを再利用） */
  needsRawGame?: boolean;
  rows: SituationalRecordRow[];
}

/** 1ポゼッションあたりの平均得点（両チーム合計点 / (POSS×2)）。「点差決着」グループの
 * 1POS/2POS差以内判定では現在使用していない（2026-08-29、固定点差方式に変更したため。
 * 下記marginWithinPossessions()参照）。他の用途で再利用する可能性があるため残してある */
function pointsPerPossession(g: TeamGameLog): number {
  return safeDiv(g.teamScore + g.opponentScore, 2 * g.poss);
}

/** その試合の実際のPOSSデータから算出したポゼッション差判定（現在未使用。2026-08-29、
 * 「点差決着」グループの1POS/2POS差以内は固定点差（3点/6点）方式に変更したため、
 * marginWithinFixedPoints()に置き換えた。関数自体は削除せず残してある） */
function marginWithinPossessions(g: TeamGameLog, n: number): boolean {
  const ppp = pointsPerPossession(g);
  if (ppp <= 0) return false;
  return Math.abs(g.teamScore - g.opponentScore) <= Math.round(ppp * n);
}

/** 1POS/2POS差以内の判定基準（固定点差）。ユーザー指定により2026-08-29、POSSベースの
 * marginWithinPossessions()から固定点差方式に変更した: 1POS差=3点差以内、2POS差=6点差以内 */
function marginWithinFixedPoints(g: TeamGameLog, points: number): boolean {
  return Math.abs(g.teamScore - g.opponentScore) <= points;
}

function cumulativeQuarterScore(scores: number[], throughQuarter: number): number {
  return scores.slice(0, throughQuarter).reduce((a, b) => a + b, 0);
}

/** 指定Q終了時点でのリード/同点/ビハインドを、rawGame.quarterScores（既存の試合詳細ページの
 * スコアボードと同じデータ）から判定する。rawGame未取得ならundefined（呼び出し側で除外） */
function statusAtCheckpoint(
  g: TeamGameLog,
  rawGame: StoredGame | undefined,
  throughQuarter: number,
): "lead" | "tie" | "behind" | undefined {
  if (!rawGame) return undefined;
  const home = cumulativeQuarterScore(rawGame.quarterScores.home, throughQuarter);
  const away = cumulativeQuarterScore(rawGame.quarterScores.away, throughQuarter);
  const own = g.isHome ? home : away;
  const opp = g.isHome ? away : home;
  if (own > opp) return "lead";
  if (own < opp) return "behind";
  return "tie";
}

function buildSituationalRecordGroups(
  logs: TeamGameLog[],
  teamId: string,
  backToBack: Map<string, Map<string, BackToBackGame>> | undefined,
  opponentRecords: Map<string, Map<string, RecordBeforeGame>> | undefined,
  divisionHistory: DivisionHistoryFile | null | undefined,
  season: string,
): SituationalRecordGroupDef[] {
  const monthsWithData = new Set(logs.map((g) => Number(g.date.slice(5, 7))));
  return [
    {
      key: "venue",
      label: "会場",
      rows: [
        { key: "home", label: "ホーム", predicate: (g) => g.isHome },
        { key: "away", label: "アウェイ", predicate: (g) => !g.isHome },
      ],
    },
    {
      key: "division",
      label: "地区",
      rows: [
        { key: "east", label: "対東地区", predicate: (g) => matchesDivision(g, "east", divisionHistory, season) },
        { key: "west", label: "対西地区", predicate: (g) => matchesDivision(g, "west", divisionHistory, season) },
      ],
    },
    {
      key: "weekday",
      label: "曜日",
      rows: [{ key: "wed", label: "水曜開催", predicate: (g) => isWednesdayGame(g.date) }],
    },
    {
      key: "month",
      label: "月別",
      rows: Array.from({ length: 12 }, (_, i) => ((i + 8) % 12) + 1)
        .filter((m) => monthsWithData.has(m))
        .map((m) => ({ key: `m${m}`, label: `${m}月`, predicate: (g: TeamGameLog) => matchesMonth(g, m) })),
    },
    {
      key: "opponentStrength",
      label: "対戦相手の強さ",
      rows: opponentRecords
        ? (
            [
              ["under50", "対5割未満"],
              ["atLeast50", "対5割以上"],
              ["atLeast60", "対6割以上"],
            ] as const
          ).map(([tier, label]) => ({
            key: tier,
            label,
            predicate: (g: TeamGameLog) => matchesOpponentWinRateTier(g, tier, opponentRecords),
          }))
        : [],
    },
    {
      key: "backToBack",
      label: "連戦",
      rows: backToBack
        ? (["GAME1", "GAME2"] as const).map((status) => ({
            key: status,
            label: status,
            predicate: (g: TeamGameLog) => backToBack.get(g.scheduleKey)?.get(teamId) === status,
          }))
        : [],
    },
    {
      key: "foreignPlayerCount",
      label: "自チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `own${n}`,
        label: `${n}人`,
        predicate: (g: TeamGameLog) => g.foreignPlayerCount === n,
      })),
    },
    {
      key: "score",
      label: "得点/失点",
      rows: [
        { key: "score80plus", label: "80得点以上", predicate: (g: TeamGameLog) => g.teamScore >= 80 },
        { key: "score80under", label: "80得点未満", predicate: (g: TeamGameLog) => g.teamScore < 80 },
        { key: "allow80under", label: "80失点未満", predicate: (g: TeamGameLog) => g.opponentScore < 80 },
        { key: "allow80plus", label: "80失点以上", predicate: (g: TeamGameLog) => g.opponentScore >= 80 },
        {
          key: "both80plus",
          label: "お互い80点以上",
          predicate: (g: TeamGameLog) => g.teamScore >= 80 && g.opponentScore >= 80,
        },
        {
          key: "both80under",
          label: "お互い80点未満",
          predicate: (g: TeamGameLog) => g.teamScore < 80 && g.opponentScore < 80,
        },
        { key: "century", label: "100点ゲーム", predicate: (g: TeamGameLog) => g.teamScore >= 100 || g.opponentScore >= 100 },
      ],
    },
    {
      key: "margin",
      label: "点差決着",
      rows: [
        { key: "margin10", label: "10点差以上", predicate: (g: TeamGameLog) => Math.abs(g.teamScore - g.opponentScore) >= 10 },
        { key: "margin20", label: "20点差以上", predicate: (g: TeamGameLog) => Math.abs(g.teamScore - g.opponentScore) >= 20 },
        { key: "poss1", label: "1POS差以内", predicate: (g: TeamGameLog) => marginWithinFixedPoints(g, 3) },
        { key: "poss2", label: "2POS差以内", predicate: (g: TeamGameLog) => marginWithinFixedPoints(g, 6) },
      ],
    },
    {
      key: "overtime",
      label: "延長",
      needsRawGame: true,
      rows: [
        { key: "ot", label: "OT試合", predicate: (_g, raw) => !!raw && raw.quarterScores.home.length > 4 },
        { key: "regulation", label: "レギュレーション決着", predicate: (_g, raw) => !!raw && raw.quarterScores.home.length <= 4 },
      ],
    },
    {
      key: "q1status",
      label: "Q1終了時点",
      needsRawGame: true,
      rows: (["lead", "tie", "behind"] as const).map((status) => ({
        key: status,
        label: SITUATIONAL_RECORD_STATUS_LABELS[status],
        predicate: (g, raw) => statusAtCheckpoint(g, raw, 1) === status,
      })),
    },
    {
      key: "halfStatus",
      label: "前半終了時点",
      needsRawGame: true,
      rows: (["lead", "tie", "behind"] as const).map((status) => ({
        key: status,
        label: SITUATIONAL_RECORD_STATUS_LABELS[status],
        predicate: (g, raw) => statusAtCheckpoint(g, raw, 2) === status,
      })),
    },
    {
      key: "q3status",
      label: "3Q終了時点",
      needsRawGame: true,
      rows: (["lead", "tie", "behind"] as const).map((status) => ({
        key: status,
        label: SITUATIONAL_RECORD_STATUS_LABELS[status],
        predicate: (g, raw) => statusAtCheckpoint(g, raw, 3) === status,
      })),
    },
  ];
}

interface SituationalRecordStats {
  key: string;
  label: string;
  games: number;
  wins: number;
  losses: number;
  winPct: number;
}

/** 勝率に応じた背景色（緑=高勝率〜赤=低勝率のグラデーション）。h2h-win/h2h-lossと同じ
 * 基調色（緑#2e7d32・赤系var(--accent)）をcolor-mix()で連続的に補間する */
function winPctBackground(winPct: number): string {
  const greenPct = Math.round(Math.max(0, Math.min(1, winPct)) * 100);
  return `color-mix(in srgb, color-mix(in srgb, #2e7d32 ${greenPct}%, var(--accent) ${100 - greenPct}%) 22%, transparent)`;
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

/**
 * 「シチュエーション別成績」（チーム版）の1グループ（会場・地区・曜日・時期・月別・
 * 対戦相手の強さ・連戦・外国籍人数）。個人詳細ページの同名セクションと違い、チームの
 * TeamGameLogは既にそのチーム自身の試合ログ（シーズン内移籍のような「所属チームの動的解決」が
 * 不要）なので、行はpredicateで絞ったTeamGameLog[]から直接buildTeamPeriodStatsを呼ぶだけでよい
 */
interface TeamSituationalRowDef {
  key: string;
  label: string;
  predicate: (g: TeamGameLog) => boolean;
}
interface TeamSituationalGroupDef {
  key: string;
  label: string;
  rows: TeamSituationalRowDef[];
}
interface TeamSituationalStatsRow {
  key: string;
  label: string;
  stats: TeamSituationalStats;
}
interface TeamSituationalStatsGroup {
  key: string;
  label: string;
  rows: TeamSituationalStatsRow[];
}

/**
 * 「通算成績」タブ（Phase TF）: 全シーズン合算の単一の合計値（平均ではない）。
 * PlayerDetailPage.tsxのCareerCountTotals（45章）と同じ考え方をチーム版に転用したもの
 */
interface TeamCareerTotals {
  wins: number;
  games: number;
  pts: number;
  oppPts: number;
  fgm: number;
  fga: number;
  twoPm: number;
  twoPa: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
  reb: number;
  ast: number;
  tov: number;
  stl: number;
  blk: number;
  pf: number;
  fbps: number;
  pitp: number;
  ptsOffTov: number;
  secondChancePts: number;
  foulsDrawn: number;
  dunks: number;
  homeAttendance: number;
}

function buildTeamCareerTotals(logs: TeamGameLog[]): TeamCareerTotals {
  const totals: TeamCareerTotals = {
    wins: 0,
    games: 0,
    pts: 0,
    oppPts: 0,
    fgm: 0,
    fga: 0,
    twoPm: 0,
    twoPa: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    oreb: 0,
    dreb: 0,
    reb: 0,
    ast: 0,
    tov: 0,
    stl: 0,
    blk: 0,
    pf: 0,
    fbps: 0,
    pitp: 0,
    ptsOffTov: 0,
    secondChancePts: 0,
    foulsDrawn: 0,
    dunks: 0,
    homeAttendance: 0,
  };
  for (const g of logs) {
    totals.wins += g.win ? 1 : 0;
    totals.games += 1;
    totals.pts += g.teamScore;
    totals.oppPts += g.opponentScore;
    totals.fgm += g.fgm;
    totals.fga += g.fga;
    totals.twoPm += g.fgm - g.tpm;
    totals.twoPa += g.fga - g.tpa;
    totals.tpm += g.tpm;
    totals.tpa += g.tpa;
    totals.ftm += g.ftm;
    totals.fta += g.fta;
    totals.oreb += g.oreb;
    totals.dreb += g.dreb;
    totals.reb += g.reb;
    totals.ast += g.ast;
    totals.tov += g.tov;
    totals.stl += g.stl;
    totals.blk += g.blk;
    totals.pf += g.pf;
    totals.fbps += g.fb;
    totals.pitp += g.pt2in;
    totals.ptsOffTov += g.pft;
    totals.secondChancePts += g.pt2nd;
    totals.foulsDrawn += g.foulsDrawn;
    totals.dunks += g.dunks;
    if (g.isHome && g.attendance !== undefined) totals.homeAttendance += g.attendance;
  }
  return totals;
}

/** そのチームの全試合を日付順に走査し、最長の連続勝利記録を求める（ユーザー指定通り） */
function longestWinStreak(logs: TeamGameLog[]): number {
  const sorted = [...logs].sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey));
  let max = 0;
  let current = 0;
  for (const g of sorted) {
    if (g.win) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  }
  return max;
}

interface CareerTotalDef {
  key: string;
  label: string;
  value: (t: TeamCareerTotals) => number;
}

const CAREER_TOTAL_DEFS: CareerTotalDef[] = [
  { key: "wins", label: "勝利数", value: (t) => t.wins },
  { key: "games", label: "試合数", value: (t) => t.games },
  { key: "pts", label: "得点", value: (t) => t.pts },
  { key: "oppPts", label: "失点", value: (t) => t.oppPts },
  { key: "fgm", label: "FG成功数", value: (t) => t.fgm },
  { key: "fga", label: "FG試投数", value: (t) => t.fga },
  { key: "twoPm", label: "2P成功数", value: (t) => t.twoPm },
  { key: "twoPa", label: "2P試投数", value: (t) => t.twoPa },
  { key: "tpm", label: "3P成功数", value: (t) => t.tpm },
  { key: "tpa", label: "3P試投数", value: (t) => t.tpa },
  { key: "ftm", label: "フリースロー成功数", value: (t) => t.ftm },
  { key: "fta", label: "フリースロー試投数", value: (t) => t.fta },
  { key: "oreb", label: "オフェンスリバウンド", value: (t) => t.oreb },
  { key: "dreb", label: "ディフェンスリバウンド", value: (t) => t.dreb },
  { key: "reb", label: "トータルリバウンド", value: (t) => t.reb },
  { key: "ast", label: "アシスト", value: (t) => t.ast },
  { key: "tov", label: "ターンオーバー", value: (t) => t.tov },
  { key: "stl", label: "スティール", value: (t) => t.stl },
  { key: "blk", label: "ブロックショット", value: (t) => t.blk },
  { key: "pf", label: "ファウル", value: (t) => t.pf },
  { key: "fbps", label: "ファストブレイクポイント", value: (t) => t.fbps },
  { key: "pitp", label: "ペイント内得点", value: (t) => t.pitp },
  { key: "ptsOffTov", label: "ポイントオフターンオーバー", value: (t) => t.ptsOffTov },
  { key: "secondChancePts", label: "セカンドチャンスポイント", value: (t) => t.secondChancePts },
  { key: "foulsDrawn", label: "ファウルドローン", value: (t) => t.foulsDrawn },
  { key: "dunks", label: "ダンク", value: (t) => t.dunks },
  { key: "homeAttendance", label: "ホーム来場者数", value: (t) => t.homeAttendance },
];

/**
 * 「クラブレコード」タブ（Phase TG）: 個人詳細ページのキャリアハイ/ワースト（CareerHighGame/
 * CAREER_HIGH_STATS）と同じ方式をチーム版に転用したもの。1試合単位の最高/最低記録を扱う
 */
type TeamRecordGame = TeamGameLog & { season: string };

interface TeamRecordDef {
  key: string;
  label: string;
  value: (g: TeamRecordGame) => number;
  format?: (v: number) => string;
  /**
   * %系の指標は、個人版と同様に低試投数での極端な値がワースト記録として意味を持ちにくいため
   * 除外する。デフォルトはtrue
   */
  worstEligible?: boolean;
  /** 対象試合の絞り込み（未指定なら全試合）。ホーム来場者数はホーム開催かつ計測済みの試合のみ対象にする */
  filter?: (g: TeamRecordGame) => boolean;
}

const TEAM_RECORD_STATS: TeamRecordDef[] = [
  { key: "pts", label: "得点", value: (g) => g.teamScore },
  { key: "oppPts", label: "失点", value: (g) => g.opponentScore },
  { key: "fgm", label: "FG成功数", value: (g) => g.fgm },
  { key: "fga", label: "FG試投数", value: (g) => g.fga },
  { key: "fgPct", label: "FG成功率", value: (g) => safeDiv(g.fgm, g.fga), format: formatPct, worstEligible: false },
  { key: "twoPm", label: "2P成功数", value: (g) => g.fgm - g.tpm },
  { key: "twoPa", label: "2P試投数", value: (g) => g.fga - g.tpa },
  {
    key: "twoPct",
    label: "2P成功率",
    value: (g) => safeDiv(g.fgm - g.tpm, g.fga - g.tpa),
    format: formatPct,
    worstEligible: false,
  },
  { key: "tpm", label: "3P成功数", value: (g) => g.tpm },
  { key: "tpa", label: "3P試投数", value: (g) => g.tpa },
  { key: "tpPct", label: "3P成功率", value: (g) => safeDiv(g.tpm, g.tpa), format: formatPct, worstEligible: false },
  { key: "ftm", label: "フリースロー成功数", value: (g) => g.ftm },
  { key: "fta", label: "フリースロー試投数", value: (g) => g.fta },
  {
    key: "ftPct",
    label: "フリースロー成功率",
    value: (g) => safeDiv(g.ftm, g.fta),
    format: formatPct,
    worstEligible: false,
  },
  { key: "oreb", label: "オフェンスリバウンド", value: (g) => g.oreb },
  { key: "dreb", label: "ディフェンスリバウンド", value: (g) => g.dreb },
  { key: "reb", label: "トータルリバウンド", value: (g) => g.reb },
  { key: "ast", label: "アシスト", value: (g) => g.ast },
  { key: "tov", label: "ターンオーバー", value: (g) => g.tov },
  { key: "stl", label: "スティール", value: (g) => g.stl },
  { key: "blk", label: "ブロックショット", value: (g) => g.blk },
  { key: "pf", label: "ファウル", value: (g) => g.pf },
  { key: "fbps", label: "ファストブレイクポイント", value: (g) => g.fb },
  { key: "pitp", label: "ペイント内得点", value: (g) => g.pt2in },
  { key: "ptsOffTov", label: "ポイントオフターンオーバー", value: (g) => g.pft },
  { key: "secondChancePts", label: "セカンドチャンスポイント", value: (g) => g.pt2nd },
  { key: "foulsDrawn", label: "ファウルドローン", value: (g) => g.foulsDrawn },
  { key: "dunks", label: "ダンク", value: (g) => g.dunks },
  {
    key: "attendance",
    label: "ホーム来場者数",
    value: (g) => g.attendance ?? 0,
    filter: (g) => g.isHome && g.attendance !== undefined,
  },
];

/** 同じ記録値の試合が複数ある場合、新しい順（日付降順）に並べる（個人版と同じ方式） */
function sortTeamRecordGamesByDateDesc(games: TeamRecordGame[]): TeamRecordGame[] {
  return [...games].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** シーズン単位の特殊集計（最多勝利数・最多連勝）の1シーズン分 */
interface TeamSeasonSpecialAggregate {
  season: string;
  wins: number;
  streak: number;
}

/** シーズン単位の値から最高値のシーズン（代表）と、同値タイの他シーズン一覧を求める */
function bestTeamSeasonRecord(
  aggregates: TeamSeasonSpecialAggregate[],
  pick: (a: TeamSeasonSpecialAggregate) => number,
): { value: number; season: string; otherSeasons: string[] } | null {
  if (aggregates.length === 0) return null;
  const best = Math.max(...aggregates.map(pick));
  const matches = aggregates
    .filter((a) => pick(a) === best)
    .map((a) => a.season)
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
  const [season, ...otherSeasons] = matches;
  return { value: best, season: season!, otherSeasons };
}

/**
 * 「比較」タブ（Phase TH）: 個人詳細ページの比較タブ（describeSituationalFilter）と同じ
 * ラベル生成ロジック。チーム版はシーズン前半戦/後半戦フィルタに対応していない
 * （TeamDetailPage.tsxのSituationalFilterPickerがどこもseasonHalfBoundaryを渡していないため、
 * dateRangeは常に「期間指定」/日付範囲表記になる）
 */
function describeTeamSituationalFilter(filter: SituationalFilter): string {
  let base: string;
  switch (filter.kind) {
    case "all":
      base = "シーズン全体";
      break;
    case "recent":
      base = `直近${filter.n}試合`;
      break;
    case "result":
      base = filter.win ? "勝った試合" : "負けた試合";
      break;
    case "dateRange":
      base = !filter.start && !filter.end ? "期間指定" : `${filter.start || "…"}〜${filter.end || "…"}`;
      break;
    case "homeAway":
      base = filter.home ? "ホーム" : "アウェイ";
      break;
    case "division":
      base = filter.division === "east" ? "対東地区" : "対西地区";
      break;
    case "month":
      base = `${filter.month}月`;
      break;
    case "newYear":
      base = filter.half === "before" ? "年明け前" : "年明け後";
      break;
    case "weekday":
      base = "平日開催";
      break;
    case "opponentWinRate":
      base = filter.tier === "under50" ? "対5割未満" : filter.tier === "atLeast50" ? "対5割以上" : "対6割以上";
      break;
  }
  return filter.includePlayoffs ? `${base}・PO込み` : base;
}

interface TeamCompareSlotState {
  season: string;
  filter: SituationalFilter;
}

function defaultTeamCompareSlots(season: string): [TeamCompareSlotState, TeamCompareSlotState] {
  return [
    { season, filter: { kind: "all" } },
    { season: "", filter: { kind: "all" } },
  ];
}

interface TeamCompareColumnData {
  key: string;
  label: string;
  boxTotals: TeamGameBoxTotals;
}

/**
 * 「日程結果」タブと同じCOLUMNS_BY_TAB（試合詳細ページのボックススコア列定義）を、
 * 自チーム/opp/+/-トグルに応じたComparisonStatDefへ変換する。formatColumnDiffは
 * 「日程結果」タブの+/-表示用にDESIGN.md 65章で整備済みのものをそのまま再利用する
 */
/**
 * BoxscoreColumn.format（例: `String(c.pts)`）は1試合分の整数カウント前提で書かれているため、
 * buildTeamMultiGameBoxTotalsが返す1試合あたり平均値（小数）をそのまま渡すと、内部の複合計算
 * （例: FGM列のc.pt2m+c.pt3m）で浮動小数点誤差が乗り小数点以下が延々と表示されることがある
 * （例: "31.200000000000003"）。col.formatの出力が単純な数値文字列（%表記・MM:SS・"-"等では
 * ない）の場合のみ小数第1位に丸め直す。丸め自体はbuildTeamMultiGameBoxTotals側では行わず
 * （%系列の分子分母を丸め前の生の値で計算させ、ポイント差を防ぐため）、ここでの文字列レベルの
 * 後処理のみで対応する
 */
function cleanNumericString(s: string): string {
  const n = Number(s);
  return Number.isFinite(n) ? n.toFixed(1) : s;
}

function teamCompareDefs(tabKey: BoxscoreTabKey, perspective: TeamPerspective): ComparisonStatDef<TeamCompareColumnData>[] {
  return COLUMNS_BY_TAB[tabKey].map((col) => ({
    key: col.key,
    label: col.label,
    value: (r) => {
      if (perspective === "own") return col.value?.(r.boxTotals.own, r.boxTotals.ownCtx) ?? 0;
      if (perspective === "opp") return col.value?.(r.boxTotals.opp, r.boxTotals.oppCtx) ?? 0;
      const ownValue = col.value?.(r.boxTotals.own, r.boxTotals.ownCtx);
      const oppValue = col.value?.(r.boxTotals.opp, r.boxTotals.oppCtx);
      return ownValue !== undefined && oppValue !== undefined ? ownValue - oppValue : 0;
    },
    format: (r) =>
      perspective === "own"
        ? cleanNumericString(col.format(r.boxTotals.own, r.boxTotals.ownCtx))
        : perspective === "opp"
          ? cleanNumericString(col.format(r.boxTotals.opp, r.boxTotals.oppCtx))
          : formatColumnDiff(col, r.boxTotals.own, r.boxTotals.ownCtx, r.boxTotals.opp, r.boxTotals.oppCtx),
    higherIsBetter: col.higherIsBetter,
  }));
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
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: summaries, loading: summariesLoading } = useJsonData(() => fetchGameSummaries(season), [season]);
  const { data: schedule, loading: scheduleLoading } = useJsonData(() => fetchSchedule(season), [season]);
  // ヘッダーの地区順位・全体順位表示用（既存の順位表ページと同じstandings-history.jsonを再利用）
  const { data: standingsHistory } = useJsonData(() => fetchStandingsHistory(season), [season]);
  // シチュエーション別フィルタの「対勝率別」用（対戦相手のその試合時点までの勝率が必要）
  const opponentRecords = useMemo(() => (summaries ? buildRecordsBeforeGame(summaries) : undefined), [summaries]);

  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = useState<DetailTab>("overview");
  const [playerStatMode, setPlayerStatMode] = useState<PlayerStatMode>("basic");
  // 「シーズン別成績」のカテゴリ切り替え（Phase H3①）。トラディショナル/アドバンスド/Misc/
  // スコアリングの4タブは既存の選手スタッツ/日程結果タブと同じSEASON_BOX_TABS/SeasonBoxTabKeyを
  // 再利用するが、列自体はTeamSummary（seasonHistory）＋TeamGameLog（careerData、Misc用）から
  // 直接組み立てる専用の列定義（TEAM_SEASON_*_COLUMNS）を使う（DESIGN.md参照）
  const [seasonBoxTab, setSeasonBoxTab] = useState<SeasonBoxTabKey>("traditional");

  // 「通算成績」タブ（Phase TF）: 個人詳細ページのcareerDataと同じパターンで、このチームが
  // 存在する全シーズン分のTeamGameLogをタブを開いたときだけ遅延取得する
  const [careerData, setCareerData] = useState<{ season: string; logs: TeamGameLog[] }[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);
  const careerFetchStartedRef = useRef(false);
  const [careerGameTypeFilter, setCareerGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");

  useEffect(() => {
    if (
      (tab !== "overview" && tab !== "career" && tab !== "clubRecord" && tab !== "compare") ||
      !teamId ||
      !seasons ||
      careerFetchStartedRef.current
    )
      return;
    careerFetchStartedRef.current = true;
    setCareerLoading(true);
    setCareerError(null);
    Promise.all(
      seasons.map(async (s) => {
        try {
          const logs = await fetchTeamGameLogs(s.season, teamId);
          return { season: s.season, logs };
        } catch {
          return { season: s.season, logs: [] as TeamGameLog[] };
        }
      }),
    )
      .then((results) => setCareerData(results.filter((r) => r.logs.length > 0)))
      .catch(() => setCareerError("通算成績の取得に失敗しました"))
      .finally(() => setCareerLoading(false));
  }, [tab, teamId, seasons]);

  // 「シーズン別成績」Miscタブ用（Phase H3①）。シーズンごとにレギュラーシーズンの
  // TeamGameLogだけを合算する（careerDataは既に「概要」タブでも取得済みのため追加取得なし）
  const teamSeasonMiscBySeason = useMemo(
    () => new Map((careerData ?? []).map((cd) => [cd.season, sumTeamSeasonMisc(cd.logs)])),
    [careerData],
  );

  const careerFilteredLogs = useMemo(
    () => (careerData ? filterByGameType(careerData.flatMap((cd) => cd.logs), careerGameTypeFilter) : []),
    [careerData, careerGameTypeFilter],
  );
  const careerTotals = useMemo(() => buildTeamCareerTotals(careerFilteredLogs), [careerFilteredLogs]);
  const careerLongestWinStreak = useMemo(() => longestWinStreak(careerFilteredLogs), [careerFilteredLogs]);

  // 「クラブレコード」タブ（Phase TG）: 「通算成績」タブと同じcareerData・careerGameTypeFilter
  // を共有する（個人詳細ページのキャリアハイ/通算成績タブが1つのトグルを共有するのと同じ方針）
  const [expandedClubRecordTieCards, setExpandedClubRecordTieCards] = useState<Set<string>>(new Set());
  const toggleClubRecordTieCard = (key: string) => {
    setExpandedClubRecordTieCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const clubRecordAllGames = useMemo<TeamRecordGame[]>(() => {
    if (!careerData) return [];
    return filterByGameType(
      careerData.flatMap((cd) => cd.logs.map((g) => ({ ...g, season: cd.season }))),
      careerGameTypeFilter,
    );
  }, [careerData, careerGameTypeFilter]);

  const clubRecords = useMemo(() => {
    return TEAM_RECORD_STATS.map((def) => {
      const pool = def.filter ? clubRecordAllGames.filter(def.filter) : clubRecordAllGames;
      let bestValue: number | null = null;
      for (const g of pool) {
        const v = def.value(g);
        if (bestValue === null || v > bestValue) bestValue = v;
      }
      if (bestValue === null) return null;
      const matches = sortTeamRecordGamesByDateDesc(pool.filter((g) => def.value(g) === bestValue));
      const [game, ...otherGames] = matches;
      return { ...def, game, otherGames, display: def.format ? def.format(bestValue) : String(bestValue) };
    }).filter((r): r is TeamRecordDef & { game: TeamRecordGame; otherGames: TeamRecordGame[]; display: string } => r !== null);
  }, [clubRecordAllGames]);

  const clubWorsts = useMemo(() => {
    return TEAM_RECORD_STATS.filter((def) => def.worstEligible !== false)
      .map((def) => {
        const pool = def.filter ? clubRecordAllGames.filter(def.filter) : clubRecordAllGames;
        let worstValue: number | null = null;
        for (const g of pool) {
          const v = def.value(g);
          if (worstValue === null || v < worstValue) worstValue = v;
        }
        if (worstValue === null) return null;
        const matches = sortTeamRecordGamesByDateDesc(pool.filter((g) => def.value(g) === worstValue));
        const [game, ...otherGames] = matches;
        return { ...def, game, otherGames, display: def.format ? def.format(worstValue) : String(worstValue) };
      })
      .filter((r): r is TeamRecordDef & { game: TeamRecordGame; otherGames: TeamRecordGame[]; display: string } => r !== null);
  }, [clubRecordAllGames]);

  // シーズン単位の特殊集計（最多勝利数・最多連勝）。既存のlongestWinStreak()をシーズンごとの
  // 試合ログに絞って呼ぶだけで「シーズン内」の記録になる（シーズンをまたいだ通算成績タブの
  // 最多連勝＝careerLongestWinStreakとは別の値）
  const clubSeasonAggregates = useMemo<TeamSeasonSpecialAggregate[]>(() => {
    if (!careerData) return [];
    return careerData
      .map((cd) => {
        const filtered = filterByGameType(cd.logs, careerGameTypeFilter);
        return { season: cd.season, wins: filtered.filter((g) => g.win).length, streak: longestWinStreak(filtered), games: filtered.length };
      })
      .filter((s) => s.games > 0);
  }, [careerData, careerGameTypeFilter]);

  const mostWinsSeasonRecord = useMemo(
    () => bestTeamSeasonRecord(clubSeasonAggregates, (a) => a.wins),
    [clubSeasonAggregates],
  );
  const longestStreakSeasonRecord = useMemo(
    () => bestTeamSeasonRecord(clubSeasonAggregates, (a) => a.streak),
    [clubSeasonAggregates],
  );

  // 「比較」タブ（Phase TH）: 個人詳細ページの比較タブと同じ構成をチーム版に転用したもの。
  // careerData（通算成績/クラブレコードタブと共有、全シーズン分のTeamGameLog）から
  // スロットごとに選んだシーズンの試合ログを取り出し、シチュエーション別フィルタで絞り込む。
  // 自チーム/opp/+/-トグル・トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブは
  // 「日程結果」タブと同じCOLUMNS_BY_TAB/buildTeamGameBoxTotals系を再利用する
  const [compareSlots, setCompareSlots] = useState<[TeamCompareSlotState, TeamCompareSlotState]>(() =>
    defaultTeamCompareSlots(season),
  );
  useEffect(() => {
    setCompareSlots(defaultTeamCompareSlots(season));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId]);
  const [comparePerspective, setComparePerspective] = useState<TeamPerspective>("own");
  const [compareGameType, setCompareGameType] = useState<SeasonGameTypeFilter>("regular");
  const [compareTab, setCompareTab] = useState<BoxscoreTabKey>("traditional");

  // 各スロットの「対勝率別」フィルタ用（対戦相手のその試合時点までの勝率が必要）。
  // スロットごとに異なるシーズンを選べるため、個人詳細ページの比較タブと同様、
  // 配列化せず2つ個別にuseJsonDataを呼ぶ。「比較」タブを開いている間だけ取得する
  const { data: compareSummaries0 } = useJsonData(
    () => (tab === "compare" && compareSlots[0].season ? fetchGameSummaries(compareSlots[0].season) : Promise.resolve(null)),
    [tab, compareSlots[0].season],
  );
  const { data: compareSummaries1 } = useJsonData(
    () => (tab === "compare" && compareSlots[1].season ? fetchGameSummaries(compareSlots[1].season) : Promise.resolve(null)),
    [tab, compareSlots[1].season],
  );
  const compareOpponentRecords = [
    useMemo(() => (compareSummaries0 ? buildRecordsBeforeGame(compareSummaries0) : undefined), [compareSummaries0]),
    useMemo(() => (compareSummaries1 ? buildRecordsBeforeGame(compareSummaries1) : undefined), [compareSummaries1]),
  ];

  // トラディショナル/アドバンスド/Misc/スコアリングの全列（PTSOFFTO・DUNK・被アシスト内訳・
  // ライブ/デッドTOV・ペイント内外分割等）を出すには、シーズン集計済みのTeamGameLogだけでは
  // 足りず生データ（StoredGame）・Yahoo PBPが必要（「日程結果」タブ・DESIGN.md 64章と同じ理由）。
  // スロットが選んだシーズン単位でまとめて取得し（situational filterでの絞り込みは
  // クライアント側で行うため、フィルタを変えるたびの再取得は発生しない）、scheduleKeyで
  // 一意なので両スロットのキャッシュを共有する
  const compareRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [compareRawGames, setCompareRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [compareRawGamesLoading, setCompareRawGamesLoading] = useState(false);
  const compareYahooPbpRequestedRef = useRef<Set<string>>(new Set());
  const [compareYahooPbp, setCompareYahooPbp] = useState<Map<string, YahooGamePbp>>(new Map());
  const [compareYahooPbpLoading, setCompareYahooPbpLoading] = useState(false);

  useEffect(() => {
    compareRawGamesRequestedRef.current = new Set();
    setCompareRawGames(new Map());
    compareYahooPbpRequestedRef.current = new Set();
    setCompareYahooPbp(new Map());
  }, [teamId]);

  useEffect(() => {
    if (tab !== "compare" || !careerData) return;
    const pairs: { season: string; scheduleKey: string }[] = [];
    for (const slot of compareSlots) {
      if (!slot.season) continue;
      const logs = careerData.find((cd) => cd.season === slot.season)?.logs ?? [];
      for (const g of logs) {
        if (g.min > 0 && !compareRawGamesRequestedRef.current.has(g.scheduleKey)) {
          pairs.push({ season: slot.season, scheduleKey: g.scheduleKey });
        }
      }
    }
    const needed = [...new Map(pairs.map((p) => [p.scheduleKey, p])).values()];
    if (needed.length === 0) return;
    for (const p of needed) compareRawGamesRequestedRef.current.add(p.scheduleKey);
    setCompareRawGamesLoading(true);
    Promise.all(
      needed.map(async ({ season: s, scheduleKey }) => {
        try {
          return [scheduleKey, await fetchGame(s, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setCompareRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setCompareRawGamesLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, careerData, compareSlots[0].season, compareSlots[1].season]);

  useEffect(() => {
    if (tab !== "compare" || !careerData || !seasons) return;
    const pairs: { season: string; scheduleKey: string }[] = [];
    for (const slot of compareSlots) {
      if (!slot.season) continue;
      if (!(seasons.find((s) => s.season === slot.season)?.yahooPbp ?? false)) continue;
      const logs = careerData.find((cd) => cd.season === slot.season)?.logs ?? [];
      for (const g of logs) {
        if (g.min > 0 && !compareYahooPbpRequestedRef.current.has(g.scheduleKey)) {
          pairs.push({ season: slot.season, scheduleKey: g.scheduleKey });
        }
      }
    }
    const needed = [...new Map(pairs.map((p) => [p.scheduleKey, p])).values()];
    if (needed.length === 0) return;
    for (const p of needed) compareYahooPbpRequestedRef.current.add(p.scheduleKey);
    setCompareYahooPbpLoading(true);
    Promise.all(
      needed.map(async ({ season: s, scheduleKey }) => {
        try {
          return [scheduleKey, await fetchYahooGamePbp(s, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setCompareYahooPbp((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r && r[1]) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setCompareYahooPbpLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, careerData, seasons, compareSlots[0].season, compareSlots[1].season]);

  const compareDataLoading = compareRawGamesLoading || compareYahooPbpLoading;

  const compareRows: ComparisonRow<TeamCompareColumnData>[] = useMemo(() => {
    return ([0, 1] as const)
      .map((i): ComparisonRow<TeamCompareColumnData> | null => {
        const slot = compareSlots[i];
        if (!slot.season || !careerData) return null;
        const logs = careerData.find((cd) => cd.season === slot.season)?.logs;
        if (!logs) return null;
        const gameTypeScoped = filterByGameType(logs, compareGameType);
        const filtered = filterGameLogs(
          gameTypeScoped,
          { ...slot.filter, includePlayoffs: true },
          compareOpponentRecords[i],
          divisionHistory,
          slot.season,
        );
        const entries = filtered
          .map((g) => {
            const game = compareRawGames.get(g.scheduleKey);
            return game ? { game, isHome: g.isHome } : null;
          })
          .filter((e): e is { game: StoredGame; isHome: boolean } => e !== null);
        if (entries.length === 0) return null;
        const shotChartSupported = seasons?.find((s) => s.season === slot.season)?.coverage === "full";
        const yahooPbpSupported = seasons?.find((s) => s.season === slot.season)?.yahooPbp ?? false;
        const yahooTurnoversByScheduleKey = new Map(
          entries.map(({ game }) => [game.scheduleKey, compareYahooPbp.get(game.scheduleKey)?.turnovers ?? []]),
        );
        const boxTotals = buildTeamMultiGameBoxTotals(entries, yahooTurnoversByScheduleKey, shotChartSupported, yahooPbpSupported);
        if (!boxTotals) return null;
        return {
          item: { key: `slot${i}`, label: describeTeamSituationalFilter(slot.filter), boxTotals },
          season: slot.season,
        };
      })
      .filter((r): r is ComparisonRow<TeamCompareColumnData> => r !== null);
  }, [compareSlots, careerData, compareGameType, compareOpponentRecords, compareRawGames, compareYahooPbp, seasons]);

  // 「スタッツ」タブ: 自チーム/opp/+/-トグル・Q別/前後半トグル（上部のstat-grid・
  // シチュエーション別成績（チーム版）の両方で共有する。「試合」選択時は追加取得不要
  // （既存のgameLogs/team.jsonのみで完結する）が、Q別/前後半選択時のみこのチームの
  // 全試合（gameLogsのscheduleKey全件）の生データを遅延取得する
  const [teamPerspective, setTeamPerspective] = useState<TeamPerspective>("own");
  const [statsPeriod, setStatsPeriod] = useState<PeriodRangeValue>("all");
  const statsPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === statsPeriod);
  // 「試合」選択時・フィルタ無し（isDefaultFilter）の場合のみteams.jsonのシーズン集計を0コストで
  // 再利用できる。それ以外（シチュエーション別フィルタ・Q別/前後半トグルのいずれかが有効）は
  // TeamGameLog/生データベースの再集計が必要（currentTeamStats・シューティングセクション共通で使う）
  const needsTeamPeriodRecompute = !isDefaultFilter(filter) || (!!statsPeriodOption && statsPeriodOption.periods !== null);
  const statsRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [statsRawGames, setStatsRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [statsRawGamesLoading, setStatsRawGamesLoading] = useState(false);
  // 「シチュエーション別成績」（チーム版）専用のレギュラー/プレーオフ/合算トグル。
  // 上部stat-gridのfilter.includePlayoffsとは独立（個人詳細ページの同名セクションと同じ設計）
  const [situationalTeamGameType, setSituationalTeamGameType] = useState<SeasonGameTypeFilter>("regular");
  // 「シチュエーション別勝敗」（概要タブ、Phase H3③）専用のレギュラー/プレーオフ/合算トグル。
  // 他のシチュエーション別セクションと同じく独立した状態を持つ
  const [situationalRecordGameType, setSituationalRecordGameType] = useState<SeasonGameTypeFilter>("regular");

  // 「シューティング」セクションの平均/合計トグル
  const [teamShootingDisplayMode, setTeamShootingDisplayMode] = useState<SeasonDisplayMode>("perGame");
  // 「シューティング」セクション用: Q別/前後半選択時・非デフォルトフィルタ選択時のみ、
  // このチームの全試合のYahoo PBPを遅延取得する（既定の「試合」×フィルタ無しはteams.jsonの
  // shotTypesを0コストで使うため取得不要。DESIGN.md参照）
  const { supported: yahooPbpSupported } = useYahooPbpCoverage(season);
  const teamYahooPbpRequestedRef = useRef<Set<string>>(new Set());
  const [teamYahooPbp, setTeamYahooPbp] = useState<Map<string, YahooGamePbp>>(new Map());
  const [teamYahooPbpLoading, setTeamYahooPbpLoading] = useState(false);

  // 「ショットチャート」セクション: 個人詳細ページの季集計ショットチャートと同じく、
  // 開いたときだけ生データ（PlayByPlays込み）を遅延取得する。取得自体はstatsRawGames
  // （Q別/前後半トグルと共有するキャッシュ）を再利用する
  const [teamShotChartExpanded, setTeamShotChartExpanded] = useState(false);
  // 「シチュエーション別勝敗」（概要タブ）の延長・Q1/前半/3Q終了時点のリード状況は
  // quarterScores（試合の生データ）が必要なため、ショットチャートと同じ折りたたみ式にし、
  // 展開したときだけstatsRawGamesを取得する（DESIGN.md参照。初回表示時の通信を抑える）
  const [situationalRecordRawExpanded, setSituationalRecordRawExpanded] = useState(false);

  // 「日程結果」タブ: 自チーム/opp/+/-トグル・レギュラー/プレーオフ/合算トグル・Q別/前後半トグル・
  // トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブ（試合詳細ページのボックススコアと
  // 全く同じCOLUMNS_BY_TAB/ColumnCtxをbuildTeamGameBoxTotals経由で再利用する。DESIGN.md参照）。
  // 「選手スタッツ」タブ（60章）と同様、このタブ専用の独立したトグル状態を持つ（「スタッツ」タブの
  // filter/statsPeriodとは連動しない）。ゲーム種別トグルの既定は「合算」にし、既存の日程結果タブの
  // 見た目（予定を含む全試合表示）を変えないようにしている点が他のトグルと異なる。
  // Misc/スコアリングタブのPBPタグ集計・座標ゾーン分割はQ別/前後半に関わらず生データが必要なため、
  // このタブが開いている間は常にstatsRawGames/teamYahooPbpを取得する（0コストの高速経路は無い）
  const [scheduleTeamPerspective, setScheduleTeamPerspective] = useState<TeamPerspective>("own");
  const [scheduleGameType, setScheduleGameType] = useState<SeasonGameTypeFilter>("both");
  const [schedulePeriod, setSchedulePeriod] = useState<PeriodRangeValue>("all");
  const schedulePeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === schedulePeriod);
  const [scheduleBoxTab, setScheduleBoxTab] = useState<BoxscoreTabKey>("traditional");

  useEffect(() => {
    statsRawGamesRequestedRef.current = new Set();
    setStatsRawGames(new Map());
    teamYahooPbpRequestedRef.current = new Set();
    setTeamYahooPbp(new Map());
    setTeamShotChartExpanded(false);
    setSituationalRecordRawExpanded(false);
  }, [teamId, season]);

  useEffect(() => {
    // 「概要」タブの「シチュエーション別勝敗」のうち延長・Q1/前半/3Q終了時点のリード状況は
    // quarterScores（試合の生データ）が無いと判定できないため、他タブと同じstatsRawGamesを
    // このタブでも取得する。ショットチャートと同じ折りたたみ式にしてあり、展開したときだけ
    // 取得する（DESIGN.md参照。初回表示時に自動で通信が走らないようにする判断）
    const needsRawGames =
      teamShotChartExpanded ||
      tab === "schedule" ||
      (tab === "overview" && situationalRecordRawExpanded) ||
      (!!statsPeriodOption && statsPeriodOption.periods !== null);
    if ((tab !== "stats" && tab !== "schedule" && tab !== "overview") || !needsRawGames || !gameLogs) return;
    const needed = [
      ...new Set(
        gameLogs.filter((g) => g.min > 0 && !statsRawGamesRequestedRef.current.has(g.scheduleKey)).map((g) => g.scheduleKey),
      ),
    ];
    if (needed.length === 0) return;
    for (const k of needed) statsRawGamesRequestedRef.current.add(k);
    setStatsRawGamesLoading(true);
    Promise.all(
      needed.map(async (scheduleKey) => {
        try {
          return [scheduleKey, await fetchGame(season, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setStatsRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setStatsRawGamesLoading(false));
  }, [tab, statsPeriodOption, gameLogs, season, teamShotChartExpanded, situationalRecordRawExpanded]);

  useEffect(() => {
    if ((tab !== "stats" && tab !== "schedule") || !yahooPbpSupported || !gameLogs) return;
    if (tab === "stats" && !needsTeamPeriodRecompute) return;
    const needed = [
      ...new Set(
        gameLogs.filter((g) => g.min > 0 && !teamYahooPbpRequestedRef.current.has(g.scheduleKey)).map((g) => g.scheduleKey),
      ),
    ];
    if (needed.length === 0) return;
    for (const k of needed) teamYahooPbpRequestedRef.current.add(k);
    setTeamYahooPbpLoading(true);
    Promise.all(
      needed.map(async (scheduleKey) => {
        try {
          return [scheduleKey, await fetchYahooGamePbp(season, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setTeamYahooPbp((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r && r[1]) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setTeamYahooPbpLoading(false));
  }, [tab, needsTeamPeriodRecompute, yahooPbpSupported, gameLogs, season]);

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

  // 「選手スタッツ」タブ: そのシーズン、このチームで一度でもプレーした選手の一覧
  // （シーズン内移籍選手も含む）。lineupsFile（在コート復元済みのラインナップ、既に
  // このページで取得済み）に登場する全playerIdの和集合をロースター候補として使う
  // （プレー時間ゼロなら在コート区間自体に一切登場しないため、「一度でもプレーした」の
  // 判定として使える。DESIGN.md参照）。候補ごとに個人の試合ログ・所属チーム解決結果だけを
  // 先に取得しておき（レギュラー/プレーオフ/合算トグル・Q別/前後半トグルの切り替えで
  // 再フェッチしなくて済むように）、最終的な表示行は下のuseMemoで組み立てる
  const playerStatsCandidatesFetchKeyRef = useRef<string | null>(null);
  const [playerStatsCandidates, setPlayerStatsCandidates] = useState<PlayerStatsCandidate[] | null>(null);
  const [playerStatsCandidatesLoading, setPlayerStatsCandidatesLoading] = useState(false);
  const [playerStatsGameType, setPlayerStatsGameType] = useState<SeasonGameTypeFilter>("regular");
  // Q別/前後半トグル（既存のbuildPeriodRangeOptionsをOT無しで固定した共通オプション）。
  // 「試合」選択時は追加取得不要（既存のTeamGameLog/PlayerGameLog永続集計をそのまま使う）だが、
  // Q別/前後半選択時のみ、必要な試合の生データ（PlayByPlays込み）を遅延取得する
  const [playerStatsPeriod, setPlayerStatsPeriod] = useState<PeriodRangeValue>("all");
  const playerStatsRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [playerStatsRawGames, setPlayerStatsRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [playerStatsRawGamesLoading, setPlayerStatsRawGamesLoading] = useState(false);
  const playerStatsPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === playerStatsPeriod);

  useEffect(() => {
    if (tab !== "playerStats" || !teamId || !pbpSupported || !lineupsFile || !summaries) return;
    const fetchKey = `${season}|${teamId}`;
    if (playerStatsCandidatesFetchKeyRef.current === fetchKey) return;
    playerStatsCandidatesFetchKeyRef.current = fetchKey;
    setPlayerStatsCandidatesLoading(true);
    setPlayerStatsCandidates(null);
    setPlayerStatsRawGames(new Map());
    playerStatsRawGamesRequestedRef.current = new Set();
    const candidateIds = [...new Set(lineupsFile.lineups.flatMap((l) => l.playerIds))];
    const gameTeams = buildGameTeamsByScheduleKey(summaries);
    Promise.all(
      candidateIds.map(async (playerId): Promise<PlayerStatsCandidate | null> => {
        try {
          const logs = await fetchPlayerGameLogs(season, playerId);
          const ownTeamByScheduleKey = new Map<string, GameTeamInfo>();
          for (const log of logs) {
            if (log.min <= 0) continue;
            const own = resolveOwnTeam(log, gameTeams);
            if (own) ownTeamByScheduleKey.set(log.scheduleKey, own);
          }
          const playsForThisTeam = [...ownTeamByScheduleKey.values()].some((t) => t.teamId === teamId);
          if (!playsForThisTeam) return null;
          return { playerId, logs, ownTeamByScheduleKey };
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setPlayerStatsCandidates(results.filter((r): r is PlayerStatsCandidate => r !== null));
      })
      .finally(() => setPlayerStatsCandidatesLoading(false));
  }, [tab, teamId, season, pbpSupported, lineupsFile, summaries]);

  // Q別/前後半選択時のみ、このチームに関係する試合（候補選手の誰かがこのチーム所属として
  // 出場した試合）の生データを遅延取得する。同じチームの選手はほぼ同じ試合群を共有するため、
  // scheduleKey単位で重複排除すれば選手数に関わらずチームの試合数分（〜60試合程度）で済む
  useEffect(() => {
    if (!playerStatsPeriodOption || playerStatsPeriodOption.periods === null || !playerStatsCandidates || !teamId) return;
    const neededKeys = new Set<string>();
    for (const c of playerStatsCandidates) {
      for (const [scheduleKey, own] of c.ownTeamByScheduleKey) {
        if (own.teamId === teamId && !playerStatsRawGamesRequestedRef.current.has(scheduleKey)) neededKeys.add(scheduleKey);
      }
    }
    if (neededKeys.size === 0) return;
    for (const k of neededKeys) playerStatsRawGamesRequestedRef.current.add(k);
    setPlayerStatsRawGamesLoading(true);
    Promise.all(
      [...neededKeys].map(async (scheduleKey) => {
        try {
          return [scheduleKey, await fetchGame(season, scheduleKey)] as const;
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setPlayerStatsRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setPlayerStatsRawGamesLoading(false));
  }, [playerStatsPeriodOption, playerStatsCandidates, teamId, season]);

  const playerStatsRows = useMemo((): TeamPlayerStatsRow[] | null => {
    if (!playerStatsCandidates || !players || !gameLogs || !teamId) return null;
    const seasonStartYear = Number(season.split("-")[0]);
    const playerById = new Map(players.map((p) => [p.playerId, p]));
    const rows: TeamPlayerStatsRow[] = [];
    for (const c of playerStatsCandidates) {
      const gameTypeFilteredLogs = filterByGameType(c.logs, playerStatsGameType);
      const scheduleKeys = new Set(
        gameTypeFilteredLogs
          .filter((g) => g.min > 0 && c.ownTeamByScheduleKey.get(g.scheduleKey)?.teamId === teamId)
          .map((g) => g.scheduleKey),
      );
      if (scheduleKeys.size === 0) continue;
      const teamTotals = sumTeamGameLogsFor(gameLogs, scheduleKeys);
      const splitRows = buildTeamSplitRowsForPeriod(
        c.playerId,
        gameTypeFilteredLogs,
        c.ownTeamByScheduleKey,
        new Map([[teamId, teamTotals]]),
        "perGame",
        seasonStartYear,
        c.playerId,
        playerStatsPeriodOption,
        playerStatsRawGames,
      );
      const row = splitRows.find((r) => r.teamId === teamId);
      const player = playerById.get(c.playerId);
      if (!row || !player) continue;
      rows.push({ player, ctx: row.ctx, ddtd: countDoubleTripleDoubles(row.logs) });
    }
    return rows;
  }, [playerStatsCandidates, players, gameLogs, teamId, season, playerStatsGameType, playerStatsPeriodOption, playerStatsRawGames]);

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

  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter, opponentRecords, divisionHistory, season) : [];
  // 「試合」選択時・フィルタ無しの場合のみteams.jsonの既存集計を0コストで再利用する。
  // それ以外（シチュエーション別フィルタ・Q別/前後半トグルのいずれかが有効）は
  // buildTeamPeriodStatsでTeamGameLog/生データベースの再集計を行う（DESIGN.md参照）
  const currentTeamStats: TeamSituationalStats | null = !needsTeamPeriodRecompute
    ? teamSummaryToSituationalStats(team)
    : buildTeamPeriodStats(filteredLogs, statsPeriodOption, statsRawGames);

  // 「シューティング」セクション: currentTeamStatsと同じ判定（needsTeamPeriodRecompute）で、
  // 既定はteams.jsonのshotTypes（0コスト）、それ以外はYahoo PBPを試合ごとに合算し直す
  const currentTeamShotTypes: ShotTypeBreakdown | undefined = !needsTeamPeriodRecompute
    ? team.shotTypes
    : buildShotTypeBreakdownByTeam(
        filteredLogs
          .filter((g) => g.min > 0)
          .flatMap((g) => teamYahooPbp.get(g.scheduleKey)?.shots ?? [])
          .filter((s) => s.teamId === team.teamId && periodInRange(statsPeriodOption, s.period)),
      ).get(team.teamId);
  const teamShootingGamesPlayed = currentTeamStats?.gamesPlayed ?? 0;
  const teamShootingFactor =
    teamShootingDisplayMode === "total" || teamShootingGamesPlayed <= 0 ? 1 : 1 / teamShootingGamesPlayed;
  const teamShootingDigits = teamShootingDisplayMode === "total" ? 0 : 1;

  // 「ショットチャート」セクション: 全選手のショットをteamId一致で合算する（個人詳細ページの
  // シーズン集計ショットチャートと同じ生データ・同じbuildShotEvents()を再利用し、選手個別の
  // フィルタを外しただけ）。上部のシチュエーション別フィルタ・Q別/前後半トグルに連動する
  const teamShotEvents: ShotEvent[] = teamShotChartExpanded
    ? filteredLogs
        .filter((g) => g.min > 0)
        .flatMap((g) => {
          const game = statsRawGames.get(g.scheduleKey);
          if (!game) return [];
          return buildShotEvents(game.raw.PlayByPlays)
            .filter((s) => s.teamId === team.teamId)
            .filter((s) => periodInRange(statsPeriodOption, s.period));
        })
    : [];
  const teamShotChartPlayerOptions = teamPlayers.map((p) => ({ PlayerID: p.playerId, PlayerNameJ: p.name }));

  // 「シチュエーション別勝敗」（概要タブ、Phase H3③）。延長・Q1/前半/3Q終了時点の区分は
  // 試合の生データ（quarterScores）が必要なため、ショットチャートと同じ折りたたみ式にし、
  // 展開したときだけstatsRawGamesを取得する（DESIGN.md参照）。それ以外の区分（会場・地区・
  // 月別等）はgameLogsだけで完結するため常に表示する
  const situationalRecordScopedLogs = gameLogs ? filterByGameType(gameLogs, situationalRecordGameType) : [];
  const situationalRecordBackToBack = summaries ? buildBackToBackStatus(summaries) : undefined;
  const situationalRecordGroupDefs = teamId
    ? buildSituationalRecordGroups(
        situationalRecordScopedLogs,
        teamId,
        situationalRecordBackToBack,
        opponentRecords,
        divisionHistory,
        season,
      )
    : [];
  const situationalRecordRawGamesReady =
    situationalRecordScopedLogs.length > 0 && situationalRecordScopedLogs.every((g) => statsRawGames.has(g.scheduleKey));
  const situationalRecordAllGroups = situationalRecordGroupDefs
    .map((group) => {
      const pool = group.needsRawGame
        ? situationalRecordScopedLogs.filter((g) => statsRawGames.has(g.scheduleKey))
        : situationalRecordScopedLogs;
      const rows: SituationalRecordStats[] = group.rows.flatMap((row) => {
        const matched = pool.filter((g) => row.predicate(g, statsRawGames.get(g.scheduleKey)));
        if (matched.length === 0) return [];
        const wins = matched.filter((g) => g.win).length;
        return [
          {
            key: row.key,
            label: row.label,
            games: matched.length,
            wins,
            losses: matched.length - wins,
            winPct: safeDiv(wins, matched.length),
          },
        ];
      });
      return { key: group.key, label: group.label, needsRawGame: group.needsRawGame, rows };
    })
    .filter((group) => group.rows.length > 0);
  const situationalRecordGroups = situationalRecordAllGroups.filter((g) => !g.needsRawGame);
  const situationalRecordRawGroups = situationalRecordAllGroups.filter((g) => g.needsRawGame);

  // 「シチュエーション別成績」（チーム版）: 会場・地区・曜日・時期・月別・対戦相手の強さ・連戦・
  // 外国籍人数の8グループ。チームのTeamGameLogは既にそのチーム自身の試合ログのため、
  // 個人詳細ページのようなシーズン内移籍の動的チーム解決（resolveOwnTeam等）は不要
  const situationalTeamScopedLogs = gameLogs ? filterByGameType(gameLogs, situationalTeamGameType) : [];
  const situationalTeamBackToBack = summaries ? buildBackToBackStatus(summaries) : undefined;
  const situationalTeamMonthsWithData = new Set(
    situationalTeamScopedLogs.filter((g) => g.min > 0).map((g) => Number(g.date.slice(5, 7))),
  );
  const situationalTeamGroupDefs: TeamSituationalGroupDef[] = [
    {
      key: "venue",
      label: "会場",
      rows: [
        { key: "home", label: "ホーム", predicate: (g) => g.isHome },
        { key: "away", label: "アウェイ", predicate: (g) => !g.isHome },
      ],
    },
    {
      key: "division",
      label: "地区",
      rows: [
        { key: "east", label: "対東地区", predicate: (g) => matchesDivision(g, "east", divisionHistory, season) },
        { key: "west", label: "対西地区", predicate: (g) => matchesDivision(g, "west", divisionHistory, season) },
      ],
    },
    {
      key: "weekday",
      label: "曜日",
      rows: [
        { key: "weekday", label: "平日開催", predicate: (g) => isWeekdayGame(g.date) },
        { key: "holiday", label: "休日開催", predicate: (g) => !isWeekdayGame(g.date) },
      ],
    },
    {
      key: "timing",
      label: "時期",
      rows: [
        { key: "before", label: "年明け前", predicate: (g) => matchesNewYearHalf(g, "before") },
        { key: "after", label: "年明け後", predicate: (g) => matchesNewYearHalf(g, "after") },
      ],
    },
    {
      key: "month",
      label: "月別",
      rows: Array.from({ length: 12 }, (_, i) => ((i + 8) % 12) + 1)
        .filter((m) => situationalTeamMonthsWithData.has(m))
        .map((m) => ({ key: `m${m}`, label: `${m}月`, predicate: (g: TeamGameLog) => matchesMonth(g, m) })),
    },
    {
      key: "opponentStrength",
      label: "対戦相手の強さ",
      rows: opponentRecords
        ? (
            [
              ["under50", "対5割未満"],
              ["atLeast50", "対5割以上"],
              ["atLeast60", "対6割以上"],
            ] as const
          ).map(([tier, label]) => ({
            key: tier,
            label,
            predicate: (g: TeamGameLog) => matchesOpponentWinRateTier(g, tier, opponentRecords),
          }))
        : [],
    },
    {
      key: "backToBack",
      label: "連戦",
      rows: situationalTeamBackToBack
        ? (["GAME1", "GAME2"] as const).map((status) => ({
            key: status,
            label: status,
            predicate: (g: TeamGameLog) => situationalTeamBackToBack.get(g.scheduleKey)?.get(team.teamId) === status,
          }))
        : [],
    },
    {
      key: "foreignPlayerCount",
      label: "自チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `own${n}`,
        label: `${n}人`,
        predicate: (g: TeamGameLog) => g.foreignPlayerCount === n,
      })),
    },
    {
      key: "opponentForeignPlayerCount",
      label: "相手チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `opp${n}`,
        label: `${n}人`,
        predicate: (g: TeamGameLog) => g.opponentForeignPlayerCount === n,
      })),
    },
  ];
  const situationalTeamGroups: TeamSituationalStatsGroup[] = situationalTeamGroupDefs
    .map((group) => ({
      key: group.key,
      label: group.label,
      rows: group.rows.flatMap((row) => {
        const stats = buildTeamPeriodStats(situationalTeamScopedLogs.filter(row.predicate), statsPeriodOption, statsRawGames);
        return stats ? [{ key: row.key, label: row.label, stats }] : [];
      }),
    }))
    .filter((group) => group.rows.length > 0);

  const playerNameById = new Map((players ?? []).map((p) => [p.playerId, p.name]));
  const topLineups = (lineupsFile?.lineups ?? [])
    .filter((l) => l.secondsPlayed >= MIN_LINEUP_SECONDS)
    .slice(0, MAX_LINEUP_ROWS);

  const winPct = safeDiv(team.wins, team.wins + team.losses);
  const recordLine = buildTeamRecordLine(team, standingsHistory);

  const nameHistory = teamHistory?.find((h) => h.teamId === team.teamId)?.names ?? [];
  const honors = clubHonors?.[team.teamId] ?? [];

  const scheduleRows =
    summaries && teamId
      ? buildTeamScheduleRows(summaries, schedule?.upcomingGames ?? [], teamId, team.teamName)
      : [];
  // 「日程結果」タブのレギュラー/プレーオフ/合算トグル用: scheduleKey→TeamGameLogの引き当て
  // （未消化・進行中の試合はTeamGameLogが存在しないため「合算」選択時以外は自然に除外される）
  const gameLogsByScheduleKey = new Map((gameLogs ?? []).map((g) => [g.scheduleKey, g]));
  const scheduleFilteredRows =
    scheduleGameType === "both"
      ? scheduleRows
      : scheduleRows.filter((row) => gameLogsByScheduleKey.get(row.scheduleKey)?.gameType === scheduleGameType);
  // 「日程結果」タブのカテゴリタブ用の列定義。試合詳細ページのボックススコアと完全に同じ配列
  const scheduleBoxColumns = COLUMNS_BY_TAB[scheduleBoxTab];
  const scheduleShotChartSupported = isShotChartSupported(coverage);
  // Misc/スコアリングタブのPBPタグ集計にはYahoo PBPも必要。season対応でも該当試合の取得が
  // 終わっていない間は誤って「0件」と表示しないよう、読み込み中はテーブル全体を「読み込み中」にする
  const scheduleDataLoading = statsRawGamesLoading || (yahooPbpSupported && teamYahooPbpLoading);

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

      <div className="team-header-columns">
        <div className="team-header-info">
          <p className="team-record-line">{recordLine}</p>
          {honors.length > 0 && (
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
                          {h.note && category !== "international" && category !== "emperors_cup" && (
                            <span className="honor-note">（{h.note}）</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="team-header-radar">
          {radarData.length === 0 ? (
            <p className="empty-message">比較対象のチームがありません</p>
          ) : (
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
          )}
        </div>
      </div>

      {TEAM_HEADER_STAT_ROWS.map((row, i) => (
        <div className="stat-grid" key={i}>
          {row.map((def) => (
            <StatTile
              key={def.key}
              label={def.label}
              value={def.format(team)}
              rank={teams && teams.length > 0 ? formatTeamRank(rankAmongTeams(team, teams, def)) : undefined}
            />
          ))}
        </div>
      ))}

      <div className="tab-bar">
        {(Object.keys(TAB_LABELS) as DetailTab[]).map((t) => (
          <button key={t} className={`tab-button${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <>
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
          <div className="tab-bar">
            {SEASON_BOX_TABS.map((t) => (
              <button
                key={t.key}
                className={`tab-button${seasonBoxTab === t.key ? " active" : ""}`}
                onClick={() => setSeasonBoxTab(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>
          {seasonHistoryLoading || careerLoading ? (
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
                    {TEAM_SEASON_BOX_COLUMNS[seasonBoxTab].map((c) => (
                      <th className="align-right" key={c.key}>
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {seasonHistory.map((r) => {
                    const misc = teamSeasonMiscBySeason.get(r.season) ?? EMPTY_TEAM_SEASON_MISC;
                    return (
                      <tr key={r.season}>
                        <td className="align-left">
                          <RouterLink to={`/teams/${team.teamId}?season=${r.season}`} className="cell-link">
                            {r.season}
                          </RouterLink>
                        </td>
                        <td className="align-left">{r.teamName}</td>
                        <td className="align-right">{r.team.gamesPlayed}</td>
                        <td className="align-right">{formatRecord(r.team.wins, r.team.losses)}</td>
                        <td className="align-right">{formatWinPct(safeDiv(r.team.wins, r.team.wins + r.team.losses))}</td>
                        {TEAM_SEASON_BOX_COLUMNS[seasonBoxTab].map((c) => (
                          <td className="align-right" key={c.key}>
                            {c.format(r, misc)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          <h2>チーム内リーダー</h2>
          {teamPlayers.length === 0 ? (
            <p className="empty-message">選手データがありません</p>
          ) : (
            <div className="leaders-grid">
              {TEAM_INTERNAL_LEADER_STAT_KEYS.map((key) => {
                const def = PLAYER_STAT_DEFS.find((d) => d.key === key);
                if (!def) return null;
                const top = [...teamPlayers].sort((a, b) => def.value(b) - def.value(a)).slice(0, TEAM_LEADERS_TOP_N);
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
          )}

          <h2>シチュエーション別勝敗</h2>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button
                key={g}
                className={g === situationalRecordGameType ? "active" : ""}
                onClick={() => setSituationalRecordGameType(g)}
                type="button"
              >
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          {gameLogsLoading ? (
            <p className="loading">読み込み中...</p>
          ) : situationalRecordGroups.length === 0 ? (
            <p className="empty-message">対象試合がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">区分</th>
                    <th className="align-right">試合数</th>
                    <th className="align-right">勝敗</th>
                    <th className="align-right">勝率</th>
                  </tr>
                </thead>
                <tbody>
                  {situationalRecordGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td colSpan={4}>{group.label}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="align-left">{row.label}</td>
                          <td className="align-right">{row.games}</td>
                          <td className="align-right">{formatRecord(row.wins, row.losses)}</td>
                          <td className="align-right" style={{ background: winPctBackground(row.winPct) }}>
                            {formatWinPct(row.winPct)}
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h3
            className="collapsible-heading"
            onClick={() => setSituationalRecordRawExpanded((v) => !v)}
          >
            {situationalRecordRawExpanded ? "▼ " : "▶ "}
            延長・Q別リード状況
          </h3>
          {!situationalRecordRawExpanded ? null : statsRawGamesLoading || !situationalRecordRawGamesReady ? (
            <p className="loading">読み込み中...</p>
          ) : situationalRecordRawGroups.length === 0 ? (
            <p className="empty-message">対象試合がありません</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="stats-table">
                  <thead>
                    <tr>
                      <th className="align-left">区分</th>
                      <th className="align-right">試合数</th>
                      <th className="align-right">勝敗</th>
                      <th className="align-right">勝率</th>
                    </tr>
                  </thead>
                  <tbody>
                    {situationalRecordRawGroups.map((group) => (
                      <Fragment key={group.key}>
                        <tr className="situational-group-heading">
                          <td colSpan={4}>{group.label}</td>
                        </tr>
                        {group.rows.map((row) => (
                          <tr key={row.key}>
                            <td className="align-left">{row.label}</td>
                            <td className="align-right">{row.games}</td>
                            <td className="align-right">{formatRecord(row.wins, row.losses)}</td>
                            <td className="align-right" style={{ background: winPctBackground(row.winPct) }}>
                              {formatWinPct(row.winPct)}
                            </td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="page-subtitle">
                試合の生データ（quarterScores）から判定しているため、展開時にこのチームの当該シーズン全試合を読み込む（DESIGN.md参照）
              </p>
            </>
          )}
        </>
      )}

      {tab === "schedule" &&
        (summariesLoading || scheduleLoading ? (
          <p className="loading">読み込み中...</p>
        ) : scheduleRows.length === 0 ? (
          <p className="empty-message">日程データがありません</p>
        ) : (
          <>
            <div className="mode-toggle">
              {(["own", "opp", "diff"] as TeamPerspective[]).map((m) => (
                <button
                  key={m}
                  className={scheduleTeamPerspective === m ? "active" : ""}
                  onClick={() => setScheduleTeamPerspective(m)}
                  type="button"
                >
                  {TEAM_PERSPECTIVE_LABELS[m]}
                </button>
              ))}
            </div>
            <div className="mode-toggle">
              {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
                <button
                  key={g}
                  className={g === scheduleGameType ? "active" : ""}
                  onClick={() => setScheduleGameType(g)}
                  type="button"
                >
                  {SEASON_GAME_TYPE_LABELS[g]}
                </button>
              ))}
            </div>
            <PeriodRangeToggle options={SEASON_BOX_PERIOD_OPTIONS} value={schedulePeriod} onChange={setSchedulePeriod} />
            <div className="tab-bar">
              {BOXSCORE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-button${scheduleBoxTab === t.key ? " active" : ""}`}
                  onClick={() => setScheduleBoxTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
            {scheduleDataLoading && <p className="loading">読み込み中...</p>}
            {scheduleFilteredRows.length === 0 ? (
              <p className="empty-message">該当する試合がありません</p>
            ) : (
              <div className="table-scroll">
                <table className="sortable-table schedule-table">
                  <thead>
                    <tr>
                      <th className="align-left">日付</th>
                      <th className="align-left">対戦相手</th>
                      <th className="align-right">結果</th>
                      {scheduleBoxColumns.map((col) => (
                        <th key={col.key} className="align-right" title={col.description}>
                          {col.label}
                        </th>
                      ))}
                      <th className="align-left">会場</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduleFilteredRows.map((row) => {
                      const game = statsRawGames.get(row.scheduleKey);
                      const boxTotals = game
                        ? buildTeamGameBoxTotals(
                            game,
                            row.isHome,
                            schedulePeriodOption,
                            teamYahooPbp.get(row.scheduleKey)?.turnovers ?? [],
                            scheduleShotChartSupported,
                            yahooPbpSupported,
                          )
                        : null;
                      return (
                        <TeamScheduleRowView
                          key={row.scheduleKey}
                          row={row}
                          perspective={scheduleTeamPerspective}
                          columns={scheduleBoxColumns}
                          boxTotals={boxTotals}
                        />
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <p className="page-subtitle">
              各列は試合詳細ページのボックススコアと同じ算出ロジック（自チーム/opp/+/-切り替え可）。上部のレギュラー/プレーオフ・Q別/前後半トグルと連動する。未消化・進行中の試合は「-」表示になる
            </p>
          </>
        ))}

      {tab === "career" && (
        <>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button
                key={g}
                className={g === careerGameTypeFilter ? "active" : ""}
                onClick={() => setCareerGameTypeFilter(g)}
                type="button"
              >
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          {careerLoading && !careerData ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerData || careerData.length === 0 ? (
            <p className="empty-message">通算成績のデータがありません</p>
          ) : (
            <>
              <div className="stat-grid">
                {CAREER_TOTAL_DEFS.map((def) => (
                  <StatTile key={def.key} label={def.label} value={def.value(careerTotals).toLocaleString()} />
                ))}
                <StatTile label="最多連勝" value={`${careerLongestWinStreak}連勝`} />
              </div>
              <p className="page-subtitle">
                {careerData[0]?.season}〜{careerData[careerData.length - 1]?.season}シーズンの合計値（PITP/FBPS/2ND
                PTS/PTSOFFTOはPBPタグ集計による得点ベースの値。ホーム来場者数はホーム開催試合のみの合計）
              </p>
            </>
          )}
        </>
      )}

      {tab === "clubRecord" && (
        <>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button
                key={g}
                className={g === careerGameTypeFilter ? "active" : ""}
                onClick={() => setCareerGameTypeFilter(g)}
                type="button"
              >
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          {careerLoading && !careerData ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerData || careerData.length === 0 ? (
            <p className="empty-message">クラブレコードのデータがありません</p>
          ) : (
            <>
              <h3 className="career-highs-subheading">シーズン記録</h3>
              <div className="career-highs-grid">
                {mostWinsSeasonRecord && (
                  <SeasonRecordCard
                    teamId={teamId ?? ""}
                    tieKey="season:wins"
                    label="最多勝利数（1シーズン）"
                    display={`${mostWinsSeasonRecord.value}勝`}
                    season={mostWinsSeasonRecord.season}
                    otherSeasons={mostWinsSeasonRecord.otherSeasons}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                  />
                )}
                {longestStreakSeasonRecord && (
                  <SeasonRecordCard
                    teamId={teamId ?? ""}
                    tieKey="season:streak"
                    label="最多連勝（シーズン内）"
                    display={`${longestStreakSeasonRecord.value}連勝`}
                    season={longestStreakSeasonRecord.season}
                    otherSeasons={longestStreakSeasonRecord.otherSeasons}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                  />
                )}
              </div>

              <h3 className="career-highs-subheading">クラブレコード</h3>
              <div className="career-highs-grid">
                {clubRecords.map((r) => (
                  <ClubRecordCard
                    key={r.key}
                    tieKey={`high:${r.key}`}
                    label={r.label}
                    display={r.display}
                    game={r.game}
                    otherGames={r.otherGames}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                  />
                ))}
              </div>

              <h3 className="career-highs-subheading">クラブワースト</h3>
              <div className="career-highs-grid">
                {clubWorsts.map((r) => (
                  <ClubRecordCard
                    key={r.key}
                    tieKey={`worst:${r.key}`}
                    label={r.label}
                    display={r.display}
                    game={r.game}
                    otherGames={r.otherGames}
                    expandedKeys={expandedClubRecordTieCards}
                    onToggle={toggleClubRecordTieCard}
                  />
                ))}
              </div>
              <p className="page-subtitle">
                {careerData[0]?.season}〜{careerData[careerData.length - 1]?.season}シーズンの中での1試合の最高/最低記録
                （PITP/FBPS/2ND PTS/PTSOFFTOはPBPタグ集計による得点ベースの値。ホーム来場者数はホーム開催試合のみが対象）。
                %系の指標は低試投数での極端な値を避けるため、クラブワーストの対象外
              </p>
            </>
          )}
        </>
      )}

      {tab === "stats" && (
        <>
          <SituationalFilterPicker
            filter={filter}
            onChange={setFilter}
            opponentWinRateSupported={!!opponentRecords}
          />

          <div className="mode-toggle">
            {(["own", "opp", "diff"] as TeamPerspective[]).map((m) => (
              <button key={m} className={teamPerspective === m ? "active" : ""} onClick={() => setTeamPerspective(m)} type="button">
                {TEAM_PERSPECTIVE_LABELS[m]}
              </button>
            ))}
          </div>
          <PeriodRangeToggle options={SEASON_BOX_PERIOD_OPTIONS} value={statsPeriod} onChange={setStatsPeriod} />
          {statsRawGamesLoading && statsPeriod !== "all" && <p className="loading">この期間の再集計中...</p>}

          {!currentTeamStats ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="stat-grid">
              <StatTile label="試合数" value={String(currentTeamStats.gamesPlayed)} />
              {TEAM_PERSPECTIVE_STAT_DEFS.map((def) => (
                <StatTile key={def.key} label={def.label} value={formatTeamPerspectiveValue(def, currentTeamStats, teamPerspective)} />
              ))}
              <StatTile label="PACE" value={formatDecimal(currentTeamStats.advanced.pace)} />
              <StatTile label="ORtg" value={formatDecimal(currentTeamStats.advanced.offRtg)} />
              <StatTile label="DRtg" value={formatDecimal(currentTeamStats.advanced.defRtg)} />
              <StatTile label="NetRtg" value={formatSigned(currentTeamStats.advanced.netRtg)} />
            </div>
          )}

          <h2>シチュエーション別成績</h2>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button
                key={g}
                className={g === situationalTeamGameType ? "active" : ""}
                onClick={() => setSituationalTeamGameType(g)}
                type="button"
              >
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          {situationalTeamGroups.length === 0 ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table situational-groups-table">
                <thead>
                  <tr>
                    <th className="align-left">区分</th>
                    <th className="align-right">試合数</th>
                    {TEAM_PERSPECTIVE_STAT_DEFS.map((def) => (
                      <th key={def.key} className="align-right">
                        {def.label}
                      </th>
                    ))}
                    <th className="align-right">PACE</th>
                    <th className="align-right">ORtg</th>
                    <th className="align-right">DRtg</th>
                    <th className="align-right">NetRtg</th>
                  </tr>
                </thead>
                <tbody>
                  {situationalTeamGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td colSpan={TEAM_PERSPECTIVE_STAT_DEFS.length + 6}>{group.label}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="align-left">{row.label}</td>
                          <td className="align-right">{row.stats.gamesPlayed}</td>
                          {TEAM_PERSPECTIVE_STAT_DEFS.map((def) => (
                            <td key={def.key} className="align-right">
                              {formatTeamPerspectiveValue(def, row.stats, teamPerspective)}
                            </td>
                          ))}
                          <td className="align-right">{formatDecimal(row.stats.advanced.pace)}</td>
                          <td className="align-right">{formatDecimal(row.stats.advanced.offRtg)}</td>
                          <td className="align-right">{formatDecimal(row.stats.advanced.defRtg)}</td>
                          <td className="align-right">{formatSigned(row.stats.advanced.netRtg)}</td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2 title={TEAM_SHOOTING_SECTION_TOOLTIP}>シューティング</h2>
          <div className="mode-toggle">
            {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
              <button
                key={m}
                className={m === teamShootingDisplayMode ? "active" : ""}
                onClick={() => setTeamShootingDisplayMode(m)}
                type="button"
              >
                {SEASON_DISPLAY_MODE_LABELS[m]}
              </button>
            ))}
          </div>
          {needsTeamPeriodRecompute && teamYahooPbpLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !currentTeamShotTypes ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th />
                    {sortShotTypeKeys(Object.keys(currentTeamShotTypes)).map((key) => (
                      <th key={key} className="align-right">
                        {shotTypeLabel(key)}
                      </th>
                    ))}
                    <th className="align-right">合計</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="align-left">2P</td>
                    {sortShotTypeKeys(Object.keys(currentTeamShotTypes)).map((key) => (
                      <td key={key} className="align-right">
                        {formatShotTypeCell(scaleShotTypeCounts(currentTeamShotTypes[key]!.twoPoint, teamShootingFactor), teamShootingDigits)}
                      </td>
                    ))}
                    <td className="align-right">
                      {formatShotTypeCell(
                        scaleShotTypeCounts(
                          Object.values(currentTeamShotTypes).reduce(
                            (acc, c) => sumShotTypeCounts(acc, c.twoPoint),
                            { made: 0, attempted: 0 },
                          ),
                          teamShootingFactor,
                        ),
                        teamShootingDigits,
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="align-left">3P</td>
                    {sortShotTypeKeys(Object.keys(currentTeamShotTypes)).map((key) => (
                      <td key={key} className="align-right">
                        {formatShotTypeCell(scaleShotTypeCounts(currentTeamShotTypes[key]!.threePoint, teamShootingFactor), teamShootingDigits)}
                      </td>
                    ))}
                    <td className="align-right">
                      {formatShotTypeCell(
                        scaleShotTypeCounts(
                          Object.values(currentTeamShotTypes).reduce(
                            (acc, c) => sumShotTypeCounts(acc, c.threePoint),
                            { made: 0, attempted: 0 },
                          ),
                          teamShootingFactor,
                        ),
                        teamShootingDigits,
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h2
            className={isShotChartSupported(coverage) ? "collapsible-heading" : undefined}
            onClick={isShotChartSupported(coverage) ? () => setTeamShotChartExpanded((v) => !v) : undefined}
          >
            {isShotChartSupported(coverage) ? (teamShotChartExpanded ? "▼ " : "▶ ") : ""}
            ショットチャート
          </h2>
          {!isShotChartSupported(coverage) ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : !teamShotChartExpanded ? null : statsRawGamesLoading ? (
            <p className="loading">読み込み中...</p>
          ) : (
            <>
              <div className="shot-chart-grid shot-chart-grid-single">
                <ShotChartPanel
                  teamName={team.teamName}
                  players={teamShotChartPlayerOptions}
                  shots={teamShotEvents}
                  color={accentColor ?? "var(--accent)"}
                  accentColor={accentColor}
                />
              </div>
              <p className="page-subtitle">
                チームの全選手が出場した各試合の生データ（GeniusAPI由来のショット座標）を合算したもの（2022-23シーズン以降のみ対応。DESIGN.md参照）。個別ショット/エリア別成功率の切り替え、選手セレクタでの個人絞り込みができる。上部のシチュエーション別フィルタ・Q別/前後半トグルに連動する
              </p>
            </>
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

          <h2>相手に強制したターンオーバー（種類別）</h2>
          {!team.forcedTurnovers ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="sortable-table">
                  <thead>
                    <tr>
                      <th className="align-right" title="シュートファウル以外の相手オフェンスファウルを誘発した回数">オフェンスファウル強制</th>
                      <th className="align-right" title="相手の24秒バイオレーションを誘発した回数">24秒バイオレーション強制</th>
                      <th className="align-right" title="相手のバックコートバイオレーションを誘発した回数">バックコート強制</th>
                      <th className="align-right" title="相手の5秒バイオレーションを誘発した回数">5秒バイオレーション強制</th>
                      <th className="align-right" title="トラベリング・ダブルドリブル・3秒/8秒バイオレーション・アウトオブバウンズ等、上記以外のデッドボールターンオーバーを誘発した回数">その他デッドボール</th>
                      <th className="align-right" title="スティール由来（バッドパス・ボールハンドリングロスト）のライブボールターンオーバー数。参考値">ライブボール（参考）</th>
                      <th className="align-right">合計</th>
                      <th className="align-right" title="Yahoo!スポーツplay-by-playが実際に取得できた試合数（分母の目安）">データあり試合数</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="align-right">{team.forcedTurnovers.offensiveFoul}</td>
                      <td className="align-right">{team.forcedTurnovers.violation24sec}</td>
                      <td className="align-right">{team.forcedTurnovers.backcourtViolation}</td>
                      <td className="align-right">{team.forcedTurnovers.violation5sec}</td>
                      <td className="align-right">{team.forcedTurnovers.otherDead}</td>
                      <td className="align-right">{team.forcedTurnovers.live}</td>
                      <td className="align-right">
                        {team.forcedTurnovers.offensiveFoul +
                          team.forcedTurnovers.violation24sec +
                          team.forcedTurnovers.backcourtViolation +
                          team.forcedTurnovers.violation5sec +
                          team.forcedTurnovers.otherDead +
                          team.forcedTurnovers.live}
                      </td>
                      <td className="align-right">{team.forcedTurnovers.gamesWithData}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="page-subtitle">
                Yahoo!スポーツplay-by-play由来のディフェンス指標（2023-24シーズン以降。DESIGN.md参照）。相手が犯したターンオーバーの種類別カウント（レギュラーシーズンのみ）
              </p>
            </>
          )}
        </>
      )}

      {tab === "playerStats" &&
        (coverageLoading ? (
          <p className="loading">読み込み中...</p>
        ) : !pbpSupported ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : playerStatsCandidatesLoading || !playerStatsRows ? (
          <p className="loading">読み込み中...</p>
        ) : (
          <TeamPlayerStatsTable
            rows={playerStatsRows}
            gameType={playerStatsGameType}
            onGameTypeChange={setPlayerStatsGameType}
            period={playerStatsPeriod}
            onPeriodChange={setPlayerStatsPeriod}
            periodLoading={playerStatsRawGamesLoading}
          />
        ))}

      {tab === "compare" && (
        <>
          <div className="player-compare-slots">
            {([0, 1] as const).map((i) => {
              const slot = compareSlots[i];
              return (
                <div className="player-compare-slot" key={i}>
                  <select
                    value={slot.season}
                    onChange={(e) => {
                      const nextSeason = e.target.value;
                      setCompareSlots((prev) => {
                        const next: [TeamCompareSlotState, TeamCompareSlotState] = [...prev];
                        next[i] = { season: nextSeason, filter: { kind: "all" } };
                        return next;
                      });
                    }}
                  >
                    <option value="">未選択</option>
                    {[...(careerData ?? [])]
                      .map((cd) => cd.season)
                      .reverse()
                      .map((s) => (
                        <option key={s} value={s}>
                          {s}シーズン
                        </option>
                      ))}
                  </select>
                  {slot.season ? (
                    <SituationalFilterPicker
                      filter={slot.filter}
                      onChange={(f) =>
                        setCompareSlots((prev) => {
                          const next: [TeamCompareSlotState, TeamCompareSlotState] = [...prev];
                          next[i] = { ...next[i], filter: f };
                          return next;
                        })
                      }
                      opponentWinRateSupported={!!compareOpponentRecords[i]}
                      hideGameTypeToggle
                    />
                  ) : (
                    <p className="compare-slot-note">シーズンを選択してください</p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button key={g} className={g === compareGameType ? "active" : ""} onClick={() => setCompareGameType(g)} type="button">
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          <div className="mode-toggle">
            {(["own", "opp", "diff"] as TeamPerspective[]).map((m) => (
              <button
                key={m}
                className={comparePerspective === m ? "active" : ""}
                onClick={() => setComparePerspective(m)}
                type="button"
              >
                {TEAM_PERSPECTIVE_LABELS[m]}
              </button>
            ))}
          </div>
          <div className="tab-bar">
            {BOXSCORE_TABS.map((t) => (
              <button
                key={t.key}
                className={`tab-button${compareTab === t.key ? " active" : ""}`}
                onClick={() => setCompareTab(t.key)}
                type="button"
              >
                {t.label}
              </button>
            ))}
          </div>
          {compareDataLoading && <p className="loading">データ取得中...</p>}
          {careerLoading && !careerData ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : (
            <ComparisonTable
              rows={compareRows}
              defs={teamCompareDefs(compareTab, comparePerspective)}
              rowKey={(r) => r.key}
              name={(r) => r.label}
              linkTo={() => `/teams/${teamId}`}
            />
          )}
          <p className="page-subtitle">
            各列は「日程結果」タブと同じボックススコア列定義（自チーム/opp/+/-切り替え可）を、選択中のシチュエーション別フィルタで絞り込んだ試合の1試合あたり平均値として算出する
          </p>
        </>
      )}
    </div>
  );
}

// 「日程結果」タブの+/-（差分）表示用。BoxscoreColumnはformat(単一のBoxscoreCounts)のみを
// 持ち差分表示を想定していないため、col.value(own/opp双方の生数値)から差分を求めて
// この関数側で整形する。%系（列ラベルに"%"を含む）は分子分母が同じ係数で相殺されないため
// ポイント差（±X.X%）、それ以外は原則整数（要件3: 1試合分のカウント系スタッツは
// 小数ではなく整数で表示する。SeasonBoxscoreColumnのcountDigits（合計モード=0桁）と同じ考え方）。
// AST/TOV・PPS・Rtg系(PACE/ORtg/DRtg/NetRtg)は元々小数表示の指標のため、そのまま桁数を保つ
const DECIMAL_DIFF_DIGITS: Record<string, number> = { asttov: 1, pps: 2, pace: 1, ortg: 1, drtg: 1, netrtg: 1 };

// col.value()の値スケールが列ごとに異なる: FG%/2P%/3P%/FT%/eFG%/TS%/PAINT2%/MID2%はsafeDiv()
// ベースで0〜1（format側でformatPctが×100する）だが、USG%/TOV%/AST%/LIVE%/DEAD%と
// スコアリングタブの%-share系（%PTS等）はsharePct()/tovPct()等が既に0〜100スケールを返す
// （format側はformatPct100でそのまま%表記にする）。後者を診断表示用のformatColumnDiffで
// 誤って再度×100すると桁違いの値になるため、0〜100スケールの列だけこの集合で判定して
// 二重乗算を避ける
const PCT_ALREADY_0_TO_100: ReadonlySet<string> = new Set([
  "usg",
  "tovpct",
  "astpct",
  "livetovpct",
  "deadtovpct",
  "pctpts",
  "pctfgm",
  "pctfga",
  "pct3pm",
  "pct3pa",
  "pctftm",
  "pctfta",
]);

function formatColumnDiff(col: BoxscoreColumn, own: BoxscoreCounts, ownCtx: ColumnCtx, opp: BoxscoreCounts, oppCtx: ColumnCtx): string {
  if (!col.value) return "-";
  const ownValue = col.value(own, ownCtx);
  const oppValue = col.value(opp, oppCtx);
  if (ownValue === undefined || oppValue === undefined) return "-";
  const diff = ownValue - oppValue;
  if (col.label.includes("%")) {
    const diffPct = PCT_ALREADY_0_TO_100.has(col.key) ? diff : diff * 100;
    return `${formatSigned(diffPct, 1)}%`;
  }
  if (col.key === "min") {
    const sign = diff > 0 ? "+" : diff < 0 ? "-" : "";
    return `${sign}${Math.floor(Math.abs(diff) / 60)}:${String(Math.abs(diff) % 60).padStart(2, "0")}`;
  }
  const digits = DECIMAL_DIFF_DIGITS[col.key];
  return digits !== undefined ? formatSigned(diff, digits) : formatSigned(Math.round(diff), 0);
}

function TeamScheduleRowView({
  row,
  perspective,
  columns,
  boxTotals,
}: {
  row: TeamScheduleRow;
  perspective: TeamPerspective;
  columns: BoxscoreColumn[];
  boxTotals: TeamGameBoxTotals | null;
}) {
  const linkTo = row.status === "upcoming" ? undefined : `/games/${row.scheduleKey}`;
  return (
    <tr className={`schedule-row status-${row.status}`}>
      <td className="align-left">{linkTo ? <Link to={linkTo} className="cell-link">{row.date}</Link> : row.date}</td>
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
      {columns.map((col) => (
        <td key={col.key} className="align-right">
          {!boxTotals
            ? "-"
            : perspective === "own"
              ? col.format(boxTotals.own, boxTotals.ownCtx)
              : perspective === "opp"
                ? col.format(boxTotals.opp, boxTotals.oppCtx)
                : formatColumnDiff(col, boxTotals.own, boxTotals.ownCtx, boxTotals.opp, boxTotals.oppCtx)}
        </td>
      ))}
      <td className="align-left">{row.venue ?? "-"}</td>
    </tr>
  );
}

function MaybeLink({ to, children }: { to?: string; children: ReactNode }) {
  return to ? (
    <Link to={to} className="cell-link">
      {children}
    </Link>
  ) : (
    <>{children}</>
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

/**
 * 「クラブレコード」タブの1試合記録カード。個人詳細ページのCareerHighCardと同じ方式
 * （同値タイの試合が複数ある場合、代表試合〔最新〕を主表示にし、残りを「他◯試合」で展開する）
 */
function ClubRecordCard({
  tieKey,
  label,
  display,
  game,
  otherGames,
  expandedKeys,
  onToggle,
}: {
  tieKey: string;
  label: string;
  display: string;
  game: TeamRecordGame;
  otherGames: TeamRecordGame[];
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const expanded = expandedKeys.has(tieKey);
  return (
    <div className="career-high-card">
      <div className="career-high-label">{label}</div>
      <div className="career-high-value">{display}</div>
      <RouterLink to={`/games/${game.scheduleKey}?season=${game.season}`} className="career-high-game-link">
        {game.date}　{game.isHome ? "vs" : "@"}
        {game.opponentTeamName}
      </RouterLink>
      {otherGames.length > 0 && (
        <>
          <button type="button" className="career-high-others-toggle" onClick={() => onToggle(tieKey)}>
            {expanded ? "閉じる" : `他${otherGames.length}試合`}
          </button>
          {expanded && (
            <ul className="career-high-others-list">
              {otherGames.map((g) => (
                <li key={g.scheduleKey}>
                  <RouterLink to={`/games/${g.scheduleKey}?season=${g.season}`} className="career-high-game-link">
                    {g.date}　{g.isHome ? "vs" : "@"}
                    {g.opponentTeamName}
                  </RouterLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

/**
 * 「クラブレコード」タブのシーズン単位記録カード（最多勝利数・最多連勝）。ClubRecordCardと同じ
 * タイ表示方式だが、試合ではなくシーズン単位（同値タイの他シーズンを展開）で扱う
 */
function SeasonRecordCard({
  teamId,
  tieKey,
  label,
  display,
  season,
  otherSeasons,
  expandedKeys,
  onToggle,
}: {
  teamId: string;
  tieKey: string;
  label: string;
  display: string;
  season: string;
  otherSeasons: string[];
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const expanded = expandedKeys.has(tieKey);
  return (
    <div className="career-high-card">
      <div className="career-high-label">{label}</div>
      <div className="career-high-value">{display}</div>
      <RouterLink to={`/teams/${teamId}?season=${season}`} className="career-high-game-link">
        {season}シーズン
      </RouterLink>
      {otherSeasons.length > 0 && (
        <>
          <button type="button" className="career-high-others-toggle" onClick={() => onToggle(tieKey)}>
            {expanded ? "閉じる" : `他${otherSeasons.length}シーズン`}
          </button>
          {expanded && (
            <ul className="career-high-others-list">
              {otherSeasons.map((s) => (
                <li key={s}>
                  <RouterLink to={`/teams/${teamId}?season=${s}`} className="career-high-game-link">
                    {s}シーズン
                  </RouterLink>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

interface PlayerStatsCandidate {
  playerId: string;
  logs: PlayerGameLog[];
  ownTeamByScheduleKey: Map<string, GameTeamInfo>;
}

interface TeamPlayerStatsRow {
  player: PlayerSummary;
  ctx: SeasonBoxscoreCtx;
  ddtd: { dd: number; td: number };
}

/**
 * 「選手スタッツ」タブ: 選択中シーズンに一度でもこのチームでプレーした選手の一覧
 * （シーズン内移籍選手は移籍前後どちらのチームでも、そのチーム在籍分のみのスタッツで表示する。
 * 集計自体は個人詳細ページ「シーズン別成績」と同じbuildTeamSplitRowsForPeriodを再利用し、
 * 対象チームの行だけを抽出している。呼び出し元のfetch・行構築ロジック参照）。カテゴリタブ切り替え・
 * 列ヘッダーソートは個人詳細ページのSeasonBreakdownTableと同じ方式を踏襲する。
 * レギュラー/プレーオフ/合算トグル、Q別/前後半トグル（PeriodRangeToggle）も同様に共通ロジックを再利用する
 */
function TeamPlayerStatsTable({
  rows,
  gameType,
  onGameTypeChange,
  period,
  onPeriodChange,
  periodLoading,
}: {
  rows: TeamPlayerStatsRow[];
  gameType: SeasonGameTypeFilter;
  onGameTypeChange: (g: SeasonGameTypeFilter) => void;
  period: PeriodRangeValue;
  onPeriodChange: (p: PeriodRangeValue) => void;
  periodLoading: boolean;
}) {
  const [tab, setTab] = useState<SeasonBoxTabKey>("traditional");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const columns = SEASON_BOX_COLUMNS[tab];

  const rowSortValue = (r: TeamPlayerStatsRow, key: string): number | string => {
    switch (key) {
      case "player":
        return r.player.name;
      case "dd2":
        return r.ddtd.dd;
      case "td3":
        return r.ddtd.td;
      default: {
        const col = columns.find((c) => c.key === key);
        return col ? col.value(r.ctx, "perGame") : 0;
      }
    }
  };

  const sortedRows = useMemo(() => {
    if (!sortKey) return rows;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = rowSortValue(a, sortKey);
      const bv = rowSortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortKey, sortDir, columns]);

  const handleHeaderClick = (key: string) => {
    if (key === sortKey) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };
  const sortIndicator = (key: string) => (sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "");
  const sortAria = (key: string) => (sortKey === key ? (sortDir === "asc" ? "ascending" : "descending") : undefined);

  return (
    <>
      <div className="mode-toggle">
        {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
          <button key={g} className={g === gameType ? "active" : ""} onClick={() => onGameTypeChange(g)} type="button">
            {SEASON_GAME_TYPE_LABELS[g]}
          </button>
        ))}
      </div>
      <PeriodRangeToggle options={SEASON_BOX_PERIOD_OPTIONS} value={period} onChange={onPeriodChange} />
      {periodLoading && <p className="loading">この期間の再集計中...</p>}
      {rows.length === 0 ? (
        <p className="empty-message">選手スタッツがありません</p>
      ) : (
        <>
          <div className="tab-bar">
            {SEASON_BOX_TABS.map((t) => (
              <button key={t.key} className={`tab-button${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)} type="button">
                {t.label}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="stats-table">
              <thead>
                <tr>
                  <th className="align-left sortable-col" onClick={() => handleHeaderClick("player")} aria-sort={sortAria("player")}>
                    選手{sortIndicator("player")}
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className="align-right sortable-col"
                      title={col.description}
                      onClick={() => handleHeaderClick(col.key)}
                      aria-sort={sortAria(col.key)}
                    >
                      {col.label}
                      {sortIndicator(col.key)}
                    </th>
                  ))}
                  <th className="align-right sortable-col" onClick={() => handleHeaderClick("dd2")} aria-sort={sortAria("dd2")}>
                    DD2{sortIndicator("dd2")}
                  </th>
                  <th className="align-right sortable-col" onClick={() => handleHeaderClick("td3")} aria-sort={sortAria("td3")}>
                    TD3{sortIndicator("td3")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => (
                  <tr key={r.player.playerId}>
                    <td className="align-left">
                      <Link to={`/players/${r.player.playerId}`} className="cell-link">
                        <div className="player-cell">
                          <PlayerPhoto playerId={r.player.playerId} size={32} className="player-cell-photo" />
                          <div className="player-cell-info">
                            <div className="player-cell-name">{r.player.name}</div>
                            {playerProfileLine(r.player) && <div className="player-cell-profile">{playerProfileLine(r.player)}</div>}
                          </div>
                        </div>
                      </Link>
                    </td>
                    {columns.map((col) => (
                      <td key={col.key} className="align-right">
                        {col.format(r.ctx, "perGame")}
                      </td>
                    ))}
                    <td className="align-right">{r.ddtd.dd}</td>
                    <td className="align-right">{r.ddtd.td}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
