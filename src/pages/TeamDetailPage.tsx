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
  fetchLeagueTeamRankings,
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
  LeagueTeamRankEntry,
  LeagueTeamRankingsFile,
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
} from "../lib/situational";
import { isWednesdayGame, isWeekdayGame } from "../lib/japaneseHolidays";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { safeDiv } from "../../shared/formulas";
import {
  CAREER_TOTAL_DEFS,
  TEAM_AGAINST_RECORD_STATS as TEAM_AGAINST_RECORD_VALUE_DEFS,
  TEAM_RECORD_STATS as TEAM_RECORD_VALUE_DEFS,
  bestTeamSeasonRecord,
  buildTeamCareerTotals,
  longestWinStreak,
  type TeamSeasonSpecialAggregate,
} from "../../shared/teamRecords";
import {
  SEASON_BOX_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  buildTeamGameBoxTotals,
  buildTeamMultiGameBoxTotals,
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
import { astToTovRatio, formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
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
  "Yahoo!スポーツplay-by-play由来のシュートタイプ別成功/試投（チーム全選手合算、2023-24シーズン以降・レギュラーシーズンのみが既定。DESIGN.md参照）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「Jump Shot」に一括りになっている点に注意。上部のシチュエーション別フィルタ・Q別/前後半トグルと連動する（連動時はプレーオフも含まれうる）";

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
    format: (t) => formatPct(t.shooting.ftRate),
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

// ヘッダーのスタッツタイル（4グループ: 自チーム・カウント系/自チーム・レート系/
// opp・カウント系/opp・レート系）。シーズン合計（フィルタなし）固定で表示し、各タイルに
// リーグ内順位を併記する
const TEAM_HEADER_STAT_ROWS: TeamHeaderStatDef[][] = [
  [
    { key: "pts", label: "PTS", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
    { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
    { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
    { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
    { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
    { key: "tov", label: "TOV", value: (t) => t.perGame.tov, format: (t) => formatDecimal(t.perGame.tov), higherIsBetter: false },
    { key: "offRtg", label: "ORtg", value: (t) => t.advanced.offRtg, format: (t) => formatDecimal(t.advanced.offRtg), higherIsBetter: true },
    { key: "netRtg", label: "NETRtg", value: (t) => t.advanced.netRtg, format: (t) => formatSigned(t.advanced.netRtg), higherIsBetter: true },
    { key: "pace", label: "PACE", value: (t) => t.advanced.pace, format: (t) => formatDecimal(t.advanced.pace), higherIsBetter: true },
  ],
  [
    { key: "fgPct", label: "FG%", value: (t) => t.shooting.fgPct, format: (t) => formatPct(t.shooting.fgPct), higherIsBetter: true },
    { key: "tpPct", label: "3P%", value: (t) => t.shooting.tpPct, format: (t) => formatPct(t.shooting.tpPct), higherIsBetter: true },
    { key: "pt2Pct", label: "2P%", value: (t) => t.shooting.pt2Pct, format: (t) => formatPct(t.shooting.pt2Pct), higherIsBetter: true },
    { key: "ftPct", label: "FT%", value: (t) => t.shooting.ftPct, format: (t) => formatPct(t.shooting.ftPct), higherIsBetter: true },
    { key: "tsPct", label: "TS%", value: (t) => t.shooting.tsPct, format: (t) => formatPct(t.shooting.tsPct), higherIsBetter: true },
    { key: "efgPct", label: "eFG%", value: (t) => t.shooting.efgPct, format: (t) => formatPct(t.shooting.efgPct), higherIsBetter: true },
    { key: "ftr", label: "FTR", value: (t) => t.shooting.ftRate, format: (t) => formatPct(t.shooting.ftRate), higherIsBetter: true },
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
    { key: "defRtg", label: "DRtg", value: (t) => t.advanced.defRtg, format: (t) => formatDecimal(t.advanced.defRtg), higherIsBetter: false },
  ],
  [
    { key: "oppFgPct", label: "opp FG%", value: (t) => t.opponentShooting.fgPct, format: (t) => formatPct(t.opponentShooting.fgPct), higherIsBetter: false },
    { key: "oppTpPct", label: "opp 3P%", value: (t) => t.opponentShooting.tpPct, format: (t) => formatPct(t.opponentShooting.tpPct), higherIsBetter: false },
    { key: "oppPt2Pct", label: "opp 2P%", value: (t) => t.opponentShooting.pt2Pct, format: (t) => formatPct(t.opponentShooting.pt2Pct), higherIsBetter: false },
    { key: "oppFtPct", label: "opp FT%", value: (t) => t.opponentShooting.ftPct, format: (t) => formatPct(t.opponentShooting.ftPct), higherIsBetter: false },
    { key: "oppTsPct", label: "opp TS%", value: (t) => t.opponentShooting.tsPct, format: (t) => formatPct(t.opponentShooting.tsPct), higherIsBetter: false },
    { key: "oppEfgPct", label: "opp eFG%", value: (t) => t.opponentShooting.efgPct, format: (t) => formatPct(t.opponentShooting.efgPct), higherIsBetter: false },
    {
      key: "oppFtr",
      label: "opp FTR",
      value: (t) => t.opponentShooting.ftRate,
      format: (t) => formatPct(t.opponentShooting.ftRate),
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

// 「チームスタッツ」タブの自チーム／opp／+/-トグル（ヘッダーの自チーム行/opp行の対比構造
// ＝TEAM_HEADER_STAT_ROWSと同じ考え方）。「日程結果」「比較」タブとも共有する汎用の型・ラベル
type TeamPerspective = "own" | "opp" | "diff";

const TEAM_PERSPECTIVE_LABELS: Record<TeamPerspective, string> = {
  own: "自チーム",
  opp: "opp",
  diff: "+/-",
};

const HONOR_CATEGORY_LABELS: Record<ClubHonor["category"], string> = {
  overall: "年間優勝",
  emperors_cup: "天皇杯",
  division: "地区優勝",
  international: "国際大会",
};
const HONOR_CATEGORY_ORDER: ClubHonor["category"][] = ["overall", "emperors_cup", "division", "international"];

// Phase H4（2026-08-29）: 「スタッツ」タブを「チームスタッツ」に改名し、概要と選手スタッツの間に
// 移動した。オブジェクトのキー順序がそのままタブバーの表示順になる（DetailTabの並びに準拠）
type DetailTab = "overview" | "teamStats" | "playerStats" | "schedule" | "career" | "clubRecord" | "compare";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概要",
  teamStats: "チームスタッツ",
  playerStats: "選手スタッツ",
  schedule: "日程結果",
  career: "通算成績",
  clubRecord: "クラブレコード",
  compare: "比較",
};

interface SeasonRecord {
  season: string;
  teamName: string;
  team: TeamSummary;
}

/**
 * 「シーズン別成績」Miscタブ用（Phase H3①）のPITP/FBPS/2ND PTS/PTSOFFTO/DUNKに加え、
 * 自チーム/opp/+/-トグル（Phase H8-2）用の相手チーム生カウントも持つ。TeamSummaryは
 * opponentPerGame（平均のみ）・opponentShooting（%のみ）しか持たず、FGM/FGA/PF/FD等の
 * 生カウントを公開していないため、TeamGameLog（careerData）側から都度合算する
 * （teams.jsonの他の集計と同じくレギュラーシーズンのみに揃える）
 */
interface TeamSeasonMiscTotals {
  pt2in: number;
  fb: number;
  pt2nd: number;
  pft: number;
  dunks: number;
  oppPts: number;
  oppFgm: number;
  oppFga: number;
  oppTpm: number;
  oppTpa: number;
  oppFtm: number;
  oppFta: number;
  oppOreb: number;
  oppDreb: number;
  oppAst: number;
  oppStl: number;
  oppBlk: number;
  oppTov: number;
  oppPf: number;
  oppFoulsDrawn: number;
  oppPt2in: number;
  oppFb: number;
  oppPt2nd: number;
  oppPft: number;
  oppDunks: number;
  // Misc/スコアリングタブ拡張（2026-08-29）。TeamGameLogの同名フィールドをそのまま合算する
  technicalFouls: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
  disqualifyingFouls: number;
  assisted2m: number;
  assisted3m: number;
  assistedFtm: number;
  paint2m: number;
  paint2a: number;
  mid2m: number;
  mid2a: number;
  oppTechnicalFouls: number;
  oppBasketCounts: number;
  oppUnsportsmanlikeFouls: number;
  oppDisqualifyingFouls: number;
  oppAssisted2m: number;
  oppAssisted3m: number;
  oppAssistedFtm: number;
  oppPaint2m: number;
  oppPaint2a: number;
  oppMid2m: number;
  oppMid2a: number;
}

const EMPTY_TEAM_SEASON_MISC: TeamSeasonMiscTotals = {
  pt2in: 0,
  fb: 0,
  pt2nd: 0,
  pft: 0,
  dunks: 0,
  oppPts: 0,
  oppFgm: 0,
  oppFga: 0,
  oppTpm: 0,
  oppTpa: 0,
  oppFtm: 0,
  oppFta: 0,
  oppOreb: 0,
  oppDreb: 0,
  oppAst: 0,
  oppStl: 0,
  oppBlk: 0,
  oppTov: 0,
  oppPf: 0,
  oppFoulsDrawn: 0,
  oppPt2in: 0,
  oppFb: 0,
  oppPt2nd: 0,
  oppPft: 0,
  oppDunks: 0,
  technicalFouls: 0,
  basketCounts: 0,
  unsportsmanlikeFouls: 0,
  disqualifyingFouls: 0,
  assisted2m: 0,
  assisted3m: 0,
  assistedFtm: 0,
  paint2m: 0,
  paint2a: 0,
  mid2m: 0,
  mid2a: 0,
  oppTechnicalFouls: 0,
  oppBasketCounts: 0,
  oppUnsportsmanlikeFouls: 0,
  oppDisqualifyingFouls: 0,
  oppAssisted2m: 0,
  oppAssisted3m: 0,
  oppAssistedFtm: 0,
  oppPaint2m: 0,
  oppPaint2a: 0,
  oppMid2m: 0,
  oppMid2a: 0,
};

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
        oppPts: acc.oppPts + g.opponentScore,
        oppFgm: acc.oppFgm + g.opponentFgm,
        oppFga: acc.oppFga + g.opponentFga,
        oppTpm: acc.oppTpm + g.opponentTpm,
        oppTpa: acc.oppTpa + g.opponentTpa,
        oppFtm: acc.oppFtm + g.opponentFtm,
        oppFta: acc.oppFta + g.opponentFta,
        oppOreb: acc.oppOreb + g.opponentOreb,
        oppDreb: acc.oppDreb + g.opponentDreb,
        oppAst: acc.oppAst + g.opponentAst,
        oppStl: acc.oppStl + g.opponentStl,
        oppBlk: acc.oppBlk + g.opponentBlk,
        oppTov: acc.oppTov + g.opponentTov,
        oppPf: acc.oppPf + g.opponentPf,
        oppFoulsDrawn: acc.oppFoulsDrawn + g.opponentFoulsDrawn,
        oppPt2in: acc.oppPt2in + g.opponentPt2in,
        oppFb: acc.oppFb + g.opponentFb,
        oppPt2nd: acc.oppPt2nd + g.opponentPt2nd,
        oppPft: acc.oppPft + g.opponentPft,
        oppDunks: acc.oppDunks + g.opponentDunks,
        technicalFouls: acc.technicalFouls + g.technicalFouls,
        basketCounts: acc.basketCounts + g.basketCounts,
        unsportsmanlikeFouls: acc.unsportsmanlikeFouls + g.unsportsmanlikeFouls,
        disqualifyingFouls: acc.disqualifyingFouls + g.disqualifyingFouls,
        assisted2m: acc.assisted2m + g.assisted2m,
        assisted3m: acc.assisted3m + g.assisted3m,
        assistedFtm: acc.assistedFtm + g.assistedFtm,
        paint2m: acc.paint2m + g.paint2m,
        paint2a: acc.paint2a + g.paint2a,
        mid2m: acc.mid2m + g.mid2m,
        mid2a: acc.mid2a + g.mid2a,
        oppTechnicalFouls: acc.oppTechnicalFouls + g.opponentTechnicalFouls,
        oppBasketCounts: acc.oppBasketCounts + g.opponentBasketCounts,
        oppUnsportsmanlikeFouls: acc.oppUnsportsmanlikeFouls + g.opponentUnsportsmanlikeFouls,
        oppDisqualifyingFouls: acc.oppDisqualifyingFouls + g.opponentDisqualifyingFouls,
        oppAssisted2m: acc.oppAssisted2m + g.opponentAssisted2m,
        oppAssisted3m: acc.oppAssisted3m + g.opponentAssisted3m,
        oppAssistedFtm: acc.oppAssistedFtm + g.opponentAssistedFtm,
        oppPaint2m: acc.oppPaint2m + g.opponentPaint2m,
        oppPaint2a: acc.oppPaint2a + g.opponentPaint2a,
        oppMid2m: acc.oppMid2m + g.opponentMid2m,
        oppMid2a: acc.oppMid2a + g.opponentMid2a,
      }),
      { ...EMPTY_TEAM_SEASON_MISC },
    );
}

interface TeamSeasonBoxColumn {
  key: string;
  label: string;
  format: (r: SeasonRecord, misc: TeamSeasonMiscTotals, mode: SeasonDisplayMode, perspective: TeamPerspective) => string;
  description?: string;
}

// カウント系の値（1シーズン合計値total・1試合平均perGameのペア）を、平均/合計トグルの
// 選択に応じてformatDecimalで整形する。合計モードは他の箇所（シューティング等）の既存の
// 「合計モードは整数表示」という慣例に揃え、桁数を0にする
function formatTeamSeasonCount(total: number, gamesPlayed: number, mode: SeasonDisplayMode): string {
  return mode === "total" ? formatDecimal(total, 0) : formatDecimal(safeDiv(total, gamesPlayed));
}

// 自チーム/opp/+/-トグル（Phase H8-2）。own/oppの値ペアを受け取り、選択中のperspectiveに
// 応じた値を返す（own-opp=+/-）。「チームスタッツ」「日程結果」タブのTeamPerspective/
// perspectiveValue（own/opp/diff）と同じ考え方
function teamSeasonPerspectiveValue(own: number, opp: number, perspective: TeamPerspective): number {
  return perspective === "own" ? own : perspective === "opp" ? opp : own - opp;
}

// カウント系own/opp/+/-（平均/合計トグルにも従う）
function formatTeamSeasonCountPerspective(
  ownTotal: number,
  oppTotal: number,
  gamesPlayed: number,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  opts: { digits?: number; signed?: boolean } = {},
): string {
  const { digits = 1, signed = false } = opts;
  const ownScaled = mode === "total" ? ownTotal : safeDiv(ownTotal, gamesPlayed);
  const oppScaled = mode === "total" ? oppTotal : safeDiv(oppTotal, gamesPlayed);
  const v = teamSeasonPerspectiveValue(ownScaled, oppScaled, perspective);
  const d = mode === "total" ? 0 : digits;
  return signed || perspective === "diff" ? formatSigned(v, d) : formatDecimal(v, d);
}

// 比率系own/opp/+/-（mode非依存）
function formatTeamSeasonRatioPerspective(
  ownVal: number,
  oppVal: number,
  perspective: TeamPerspective,
  format: (v: number) => string,
  diffFormat: (v: number) => string,
): string {
  const v = teamSeasonPerspectiveValue(ownVal, oppVal, perspective);
  return perspective === "diff" ? diffFormat(v) : format(v);
}

function formatTeamSeasonPct(ownVal: number, oppVal: number, perspective: TeamPerspective): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatPct(v), (v) => `${formatSigned(v * 100, 1)}%`);
}

function formatTeamSeasonPct100(ownVal: number, oppVal: number, perspective: TeamPerspective): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatPct100(v), (v) => `${formatSigned(v, 1)}%`);
}

function formatTeamSeasonDecimal(ownVal: number, oppVal: number, perspective: TeamPerspective, digits = 1): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatDecimal(v, digits), (v) => formatSigned(v, digits));
}

function formatTeamSeasonSigned(ownVal: number, oppVal: number, perspective: TeamPerspective, digits = 1): string {
  return formatTeamSeasonRatioPerspective(ownVal, oppVal, perspective, (v) => formatSigned(v, digits), (v) => formatSigned(v, digits));
}

/** ショットチャート座標（X/Y/AreaCD）が存在するシーズンかどうか（2022-23シーズン以降のみ、
 * playerSeasonBoxscore.tsのMIN_SHOT_CHART_SEASON_START_YEARと同じ閾値）。「シーズン別成績」の
 * 各行は`r.season`（文字列）を持つだけで、他タブのようにuseSeasonCoverage()の結果を都度
 * 参照できないため、開始年の数値比較で簡易判定する */
const TEAM_SEASON_MIN_SHOT_CHART_YEAR = 2022;
function seasonRecordSupportsShotChart(season: string): boolean {
  return Number(season.split("-")[0]) >= TEAM_SEASON_MIN_SHOT_CHART_YEAR;
}

// 「シーズン別成績」の4カテゴリタブ（Phase H3①）。既存のSEASON_BOX_COLUMNS（選手向け、
// PlayerGameLog由来）とは別に、チーム向けの列定義をここで新設する。トラディショナル/
// アドバンスドはTeamSummary（seasonHistory、既に取得済みのシーズン集計）だけで完結する
// （新規バックエンド集計は不要）。MiscはTeamGameLog（careerData）側のPITP/FBPS/2ND PTS/
// PTSOFFTO/DUNKに加え、2026-08-29にTF/UFOUL/DQFOUL/AND1・被アシスト内訳（AST2M/AST3M/
// ASTFTM/AST%）もTeamGameLogへ追加集計した（DESIGN.md参照。以前は「試合単位のPlayByPlaysから
// のみ算出できチーム単位のシーズン集計としては永続化していない」という制約があったが解消済み）。
// LIVETOV/DEADTOVのみ、Yahoo!スポーツPBP由来でチーム単位の永続化対象に含めていないため
// 引き続き列を設けていない。スコアリングタブは%-share（個人の数値／チームの数値）という概念が
// チーム自身の行には適用できないため、「得点の内訳構成比」（PITP/FBPS/2ND PTS/PTSOFFTOが
// チーム総得点に占める割合）に加え、2026-08-29に「シュート選択構成比」（%3PM/%3PA/%PAINT2M/
// %PAINT2A/%MID2M/%MID2A、いずれもチーム自身の全FGAに占める割合）を追加した。
// %PAINT2M/%PAINT2A/%MID2M/%MID2Aのみショットチャート座標由来のため2022-23シーズン以降限定
// （seasonRecordSupportsShotChart()、それ以前は「-」）。
// 平均/合計トグル: カウント系の列（MIN〜+/-）は選択に応じて値を切り替え、%系・比率系
// （FG%等、AST/TOV、POSS以外のアドバンスド指標、スコアリングタブ全項目）は総量に対する比率・
// 100ポゼッションあたり等の正規化済み指標のため両モードで同じ値のまま変化しない。
// 自チーム/opp/+/-トグル（Phase H8-2）: G・MIN・POSS・PACEは両チーム共通の値（試合数・
// 試合時間・ポゼッション・ペースはどちらのチーム視点でも同一）のためトグルの影響を受けない。
// EFFはBリーグ公式式にテクニカルファウルの重み付け（TF項）が必要だが、相手チームの
// テクニカルファウル数はTeamGameLogに永続化していないため正確な相手視点の値を算出できない。
// 近似式を黙って採用しないという方針（CLAUDE.md）に従い、EFFのみ自チームの値のまま固定する
const TEAM_SEASON_TRADITIONAL_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "min",
    label: "MIN",
    format: (r, _m, mode) =>
      formatMinutesFromSeconds(Math.round((mode === "total" ? r.team.totals.min : r.team.perGame.min) * 60)),
  },
  {
    key: "pts",
    label: "PTS",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.pts, m.oppPts, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fgm",
    label: "FGM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.fgm, m.oppFgm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fga",
    label: "FGA",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.fga, m.oppFga, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fgpct",
    label: "FG%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.fgPct, r.team.opponentShooting.fgPct, p),
  },
  {
    key: "2pm",
    label: "2PM",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.fgm - r.team.totals.tpm, m.oppFgm - m.oppTpm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "2pa",
    label: "2PA",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.fga - r.team.totals.tpa, m.oppFga - m.oppTpa, r.team.gamesPlayed, mode, p),
  },
  {
    key: "2ppct",
    label: "2P%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.pt2Pct, r.team.opponentShooting.pt2Pct, p),
  },
  {
    key: "3pm",
    label: "3PM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.tpm, m.oppTpm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "3pa",
    label: "3PA",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.tpa, m.oppTpa, r.team.gamesPlayed, mode, p),
  },
  {
    key: "3ppct",
    label: "3P%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.tpPct, r.team.opponentShooting.tpPct, p),
  },
  {
    key: "ftm",
    label: "FTM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.ftm, m.oppFtm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fta",
    label: "FTA",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.fta, m.oppFta, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ftpct",
    label: "FT%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.ftPct, r.team.opponentShooting.ftPct, p),
  },
  {
    key: "efg",
    label: "eFG%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.efgPct, r.team.opponentShooting.efgPct, p),
  },
  {
    key: "ts",
    label: "TS%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.tsPct, r.team.opponentShooting.tsPct, p),
  },
  {
    key: "or",
    label: "OR",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.oreb, m.oppOreb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "dr",
    label: "DR",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.dreb, m.oppDreb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "tr",
    label: "TR",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.reb, m.oppOreb + m.oppDreb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ast",
    label: "AST",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.ast, m.oppAst, r.team.gamesPlayed, mode, p),
  },
  {
    key: "tov",
    label: "TOV",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.tov, m.oppTov, r.team.gamesPlayed, mode, p),
  },
  {
    key: "asttov",
    label: "AST/TOV",
    format: (r, m, _mode, p) =>
      formatTeamSeasonDecimal(
        astToTovRatio(r.team.totals.ast, r.team.totals.tov),
        astToTovRatio(m.oppAst, m.oppTov),
        p,
      ),
  },
  {
    key: "stl",
    label: "STL",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.stl, m.oppStl, r.team.gamesPlayed, mode, p),
  },
  {
    key: "blk",
    label: "BLK",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.blk, m.oppBlk, r.team.gamesPlayed, mode, p),
  },
  {
    key: "bsr",
    label: "BSR",
    // opp視点のBSR（相手チームの被ブロック数）＝自チームのブロック数（totals.blk）。
    // TeamGameLogに「相手の被ブロック数」という専用フィールドは無いが、自チームが
    // ブロックした本数＝相手からすれば被ブロックされた本数という表裏の関係で導出できる
    format: (r, _m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.blockedAgainst, r.team.totals.blk, r.team.gamesPlayed, mode, p),
  },
  {
    key: "f",
    label: "F",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(r.team.totals.pf, m.oppPf, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fd",
    label: "FD",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(r.team.totals.foulsDrawn, m.oppFoulsDrawn, r.team.gamesPlayed, mode, p),
  },
  {
    key: "eff",
    label: "EFF",
    format: (r, _m, mode) =>
      formatDecimal(
        mode === "total" ? r.team.advanced.eff * r.team.gamesPlayed : r.team.advanced.eff,
        mode === "total" ? 0 : 1,
      ),
  },
  {
    key: "plusminus",
    label: "+/-",
    format: (r, _m, mode, p) => {
      const ownTotal = r.team.netPerGame.pts * r.team.gamesPlayed;
      return formatTeamSeasonCountPerspective(ownTotal, -ownTotal, r.team.gamesPlayed, mode, p, { signed: true });
    },
  },
];

const TEAM_SEASON_ADVANCED_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "tovpct",
    label: "TOV%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct100(r.team.advanced.tovPct, r.team.advanced.opponentTovPct, p),
  },
  {
    key: "ftr",
    label: "FTR",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.ftRate, r.team.opponentShooting.ftRate, p),
  },
  {
    key: "orbpct",
    label: "OR%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct100(r.team.advanced.orbPct, r.team.advanced.opponentOrbPct, p),
  },
  {
    key: "efg",
    label: "eFG%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.efgPct, r.team.opponentShooting.efgPct, p),
  },
  {
    key: "ts",
    label: "TS%",
    format: (r, _m, _mode, p) => formatTeamSeasonPct(r.team.shooting.tsPct, r.team.opponentShooting.tsPct, p),
  },
  {
    key: "pps",
    label: "PPS",
    format: (r, m, _mode, p) =>
      formatTeamSeasonDecimal(safeDiv(r.team.totals.pts, r.team.totals.fga), safeDiv(m.oppPts, m.oppFga), p, 2),
  },
  {
    key: "poss",
    label: "POSS",
    format: (r, _m, mode) =>
      mode === "total"
        ? formatDecimal(r.team.advanced.poss, 0)
        : formatDecimal(safeDiv(r.team.advanced.poss, r.team.gamesPlayed)),
  },
  { key: "pace", label: "PACE", format: (r) => formatDecimal(r.team.advanced.pace) },
  {
    key: "ortg",
    label: "ORtg",
    // opp視点のORtg＝自チームのDRtg（同じPOSSを分母にした「相手の得点効率」という意味で、
    // 「チームスタッツ」「日程結果」タブのopp視点ORtg/DRtg入れ替えと同じ考え方）
    format: (r, _m, _mode, p) => formatTeamSeasonDecimal(r.team.advanced.offRtg, r.team.advanced.defRtg, p),
  },
  {
    key: "drtg",
    label: "DRtg",
    format: (r, _m, _mode, p) => formatTeamSeasonDecimal(r.team.advanced.defRtg, r.team.advanced.offRtg, p),
  },
  {
    key: "netrtg",
    label: "NetRtg",
    format: (r, _m, _mode, p) => formatTeamSeasonSigned(r.team.advanced.netRtg, -r.team.advanced.netRtg, p),
  },
];

const TEAM_SEASON_MISC_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "pitp",
    label: "PITP",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.pt2in, m.oppPt2in, r.team.gamesPlayed, mode, p),
  },
  {
    key: "fbps",
    label: "FBPS",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.fb, m.oppFb, r.team.gamesPlayed, mode, p),
  },
  {
    key: "2ndpts",
    label: "2ND PTS",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.pt2nd, m.oppPt2nd, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ptsofftov",
    label: "PTSOFFTO",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.pft, m.oppPft, r.team.gamesPlayed, mode, p),
  },
  {
    key: "dunk",
    label: "DUNK",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.dunks, m.oppDunks, r.team.gamesPlayed, mode, p),
  },
  {
    key: "tf",
    label: "TF",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.technicalFouls, m.oppTechnicalFouls, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ufoul",
    label: "UFOUL",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(m.unsportsmanlikeFouls, m.oppUnsportsmanlikeFouls, r.team.gamesPlayed, mode, p),
  },
  {
    key: "dqfoul",
    label: "DQFOUL",
    format: (r, m, mode, p) =>
      formatTeamSeasonCountPerspective(m.disqualifyingFouls, m.oppDisqualifyingFouls, r.team.gamesPlayed, mode, p),
  },
  {
    key: "and1",
    label: "AND1",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.basketCounts, m.oppBasketCounts, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ast2m",
    label: "AST2M",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.assisted2m, m.oppAssisted2m, r.team.gamesPlayed, mode, p),
  },
  {
    key: "ast3m",
    label: "AST3M",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.assisted3m, m.oppAssisted3m, r.team.gamesPlayed, mode, p),
  },
  {
    key: "astftm",
    label: "ASTFTM",
    format: (r, m, mode, p) => formatTeamSeasonCountPerspective(m.assistedFtm, m.oppAssistedFtm, r.team.gamesPlayed, mode, p),
  },
  {
    key: "astpct",
    label: "AST%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(
        safeDiv(100 * (m.assisted2m * 2 + m.assisted3m * 3 + m.assistedFtm), r.team.totals.pts),
        safeDiv(100 * (m.oppAssisted2m * 2 + m.oppAssisted3m * 3 + m.oppAssistedFtm), m.oppPts),
        p,
      ),
  },
];

const TEAM_SEASON_SCORING_COLUMNS: TeamSeasonBoxColumn[] = [
  { key: "g", label: "G", format: (r) => String(r.team.gamesPlayed) },
  {
    key: "pitppct",
    label: "PITP%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.pt2in, r.team.totals.pts), safeDiv(100 * m.oppPt2in, m.oppPts), p),
  },
  {
    key: "fbppct",
    label: "FBP%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.fb, r.team.totals.pts), safeDiv(100 * m.oppFb, m.oppPts), p),
  },
  {
    key: "2ndptspct",
    label: "2ND PTS%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.pt2nd, r.team.totals.pts), safeDiv(100 * m.oppPt2nd, m.oppPts), p),
  },
  {
    key: "ptsofftovpct",
    label: "PTSOFFTO%",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * m.pft, r.team.totals.pts), safeDiv(100 * m.oppPft, m.oppPts), p),
  },
  // ここから下は「自チーム/相手チームの全FGAに対する割合」（シュート選択構成比）。
  // 上記PITP%等（総得点に対する割合）とは分母が異なる別系統の指標
  {
    key: "pct3pm",
    label: "%3PM",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * r.team.totals.tpm, r.team.totals.fga), safeDiv(100 * m.oppTpm, m.oppFga), p),
  },
  {
    key: "pct3pa",
    label: "%3PA",
    format: (r, m, _mode, p) =>
      formatTeamSeasonPct100(safeDiv(100 * r.team.totals.tpa, r.team.totals.fga), safeDiv(100 * m.oppTpa, m.oppFga), p),
  },
  {
    key: "pctpaint2m",
    label: "%PAINT2M",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.paint2m, r.team.totals.fga), safeDiv(100 * m.oppPaint2m, m.oppFga), p)
        : "-",
  },
  {
    key: "pctpaint2a",
    label: "%PAINT2A",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.paint2a, r.team.totals.fga), safeDiv(100 * m.oppPaint2a, m.oppFga), p)
        : "-",
  },
  {
    key: "pctmid2m",
    label: "%MID2M",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.mid2m, r.team.totals.fga), safeDiv(100 * m.oppMid2m, m.oppFga), p)
        : "-",
  },
  {
    key: "pctmid2a",
    label: "%MID2A",
    format: (r, m, _mode, p) =>
      seasonRecordSupportsShotChart(r.season)
        ? formatTeamSeasonPct100(safeDiv(100 * m.mid2a, r.team.totals.fga), safeDiv(100 * m.oppMid2a, m.oppFga), p)
        : "-",
  },
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
 * 不要）なので、行はpredicateで絞った試合の生データからbuildTeamMultiGameBoxTotalsを直接
 * 呼ぶだけでよい（Phase H4④、上部集計表と同じCOLUMNS_BY_TAB/カテゴリタブに変更）
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
  gamesPlayed: number;
  boxTotals: TeamGameBoxTotals;
}
interface TeamSituationalStatsGroup {
  key: string;
  label: string;
  rows: TeamSituationalStatsRow[];
}

// 「通算成績」タブ（Phase TF）・「クラブレコード」タブ（Phase TG）の値関数（TeamCareerTotals/
// buildTeamCareerTotals/longestWinStreak/CAREER_TOTAL_DEFS/TEAM_RECORD_STATS/
// bestTeamSeasonRecord）は、歴代クラブ横断の順位算出バッチ（scripts/aggregate-league-rankings.ts、
// Phase H7）からも同じ定義を参照する必要があるため、shared/teamRecords.tsに移設した
// （二重管理を避けるため。DESIGN.md参照）。TEAM_RECORD_STATSのみ、フロントエンド表示専用の
// %フォーマット（format）をこのファイル側で追加でマージしている（shared側はvalue/filterのみで
// 完結させ、表示整形の関心事を持ち込まないようにした）

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
  worstEligible?: boolean;
  filter?: (g: TeamRecordGame) => boolean;
  lowerIsBetter?: boolean;
}

const TEAM_RECORD_PCT_FORMATS: Partial<Record<string, (v: number) => string>> = {
  fgPct: formatPct,
  twoPct: formatPct,
  tpPct: formatPct,
  ftPct: formatPct,
};

const TEAM_RECORD_STATS: TeamRecordDef[] = TEAM_RECORD_VALUE_DEFS.map((d) => ({
  ...d,
  format: TEAM_RECORD_PCT_FORMATS[d.key],
}));

/** 「被記録」（Phase H8）: TEAM_RECORD_STATSと同じ%フォーマットのマージだけを行う */
const TEAM_AGAINST_RECORD_STATS: TeamRecordDef[] = TEAM_AGAINST_RECORD_VALUE_DEFS.map((d) => ({
  ...d,
  format: TEAM_RECORD_PCT_FORMATS[d.key],
}));

/** 同じ記録値の試合が複数ある場合、新しい順（日付降順）に並べる（個人版と同じ方式） */
function sortTeamRecordGamesByDateDesc(games: TeamRecordGame[]): TeamRecordGame[] {
  return [...games].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/** 「◯位/◯チーム」表示。formatTeamRank()と同じフォーマット規則（rankAmongTeamsとは別に
 * データ自体に順位が既に含まれているLeagueTeamRankEntry用） */
function formatLeagueRank(entry: LeagueTeamRankEntry | undefined): string | undefined {
  return entry ? `${entry.rank}位/${entry.totalTeams}チーム` : undefined;
}

/**
 * 「比較」タブ（Phase TH）: 個人詳細ページの比較タブ（describeSituationalFilter）と同じ
 * ラベル生成ロジック。チーム版はシーズン前半戦/後半戦フィルタに対応していない
 * （TeamDetailPage.tsxのSituationalFilterPickerがどこもseasonHalfBoundaryを渡していないため、
 * dateRangeは常に「期間指定」/日付範囲表記になる）。2026-08-29、複数選択（AND条件）対応に伴い、
 * range＋AND条件の各軸で同時に選択されている全ての部分を「・」区切りで列挙する形に変更した
 * （1つも選択が無ければ「シーズン全体」）
 */
function describeTeamSituationalFilter(filter: SituationalFilter): string {
  const parts: string[] = [];
  switch (filter.range.kind) {
    case "all":
      break;
    case "recent":
      parts.push(`直近${filter.range.n}試合`);
      break;
    case "dateRange":
      parts.push(!filter.range.start && !filter.range.end ? "期間指定" : `${filter.range.start || "…"}〜${filter.range.end || "…"}`);
      break;
  }
  if (filter.result) parts.push(filter.result === "win" ? "勝った試合" : "負けた試合");
  if (filter.homeAway) parts.push(filter.homeAway === "home" ? "ホーム" : "アウェイ");
  if (filter.division) parts.push(filter.division === "east" ? "対東地区" : "対西地区");
  if (filter.month !== undefined) parts.push(`${filter.month}月`);
  if (filter.newYear) parts.push(filter.newYear === "before" ? "年明け前" : "年明け後");
  if (filter.weekday) parts.push("平日開催");
  if (filter.opponentWinRate) {
    parts.push(filter.opponentWinRate === "under50" ? "対5割未満" : filter.opponentWinRate === "atLeast50" ? "対5割以上" : "対6割以上");
  }
  if (filter.includePlayoffs) parts.push("PO込み");
  return parts.length > 0 ? parts.join("・") : "シーズン全体";
}

interface TeamCompareSlotState {
  season: string;
  filter: SituationalFilter;
}

function defaultTeamCompareSlots(season: string): [TeamCompareSlotState, TeamCompareSlotState] {
  return [
    { season, filter: { range: { kind: "all" } } },
    { season: "", filter: { range: { kind: "all" } } },
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
  // 通算成績・クラブレコードの歴代クラブ横断順位（Phase H7）。scripts/aggregate-league-rankings.tsが
  // 手動実行のバッチ処理で生成する単一ファイルのため、ファイルが未生成でもfetchJsonが
  // エラーを投げるだけでページ全体は壊れない（leagueRankingsがnullのまま＝順位バッジ非表示になる）
  const { data: leagueRankings } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: summaries, loading: summariesLoading } = useJsonData(() => fetchGameSummaries(season), [season]);
  const { data: schedule, loading: scheduleLoading } = useJsonData(() => fetchSchedule(season), [season]);
  // ヘッダーの地区順位・全体順位表示用（既存の順位表ページと同じstandings-history.jsonを再利用）
  const { data: standingsHistory } = useJsonData(() => fetchStandingsHistory(season), [season]);
  // シチュエーション別フィルタの「対勝率別」用（対戦相手のその試合時点までの勝率が必要）
  const opponentRecords = useMemo(() => (summaries ? buildRecordsBeforeGame(summaries) : undefined), [summaries]);

  const [filter, setFilter] = useState<SituationalFilter>({ range: { kind: "all" } });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = useState<DetailTab>("overview");
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
        if (bestValue === null || (def.lowerIsBetter ? v < bestValue : v > bestValue)) bestValue = v;
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
          if (worstValue === null || (def.lowerIsBetter ? v > worstValue : v < worstValue)) worstValue = v;
        }
        if (worstValue === null) return null;
        const matches = sortTeamRecordGamesByDateDesc(pool.filter((g) => def.value(g) === worstValue));
        const [game, ...otherGames] = matches;
        return { ...def, game, otherGames, display: def.format ? def.format(worstValue) : String(worstValue) };
      })
      .filter((r): r is TeamRecordDef & { game: TeamRecordGame; otherGames: TeamRecordGame[]; display: string } => r !== null);
  }, [clubRecordAllGames]);

  // 「被記録」（Phase H8）: 「対戦相手の多かった試合」＝TEAM_AGAINST_RECORD_STATS（TeamGameLogの
  // opponent*フィールド）についても最大値を求める。clubRecordsと同じロジックだが対象defsが異なる
  const clubAgainstRecords = useMemo(() => {
    return TEAM_AGAINST_RECORD_STATS.map((def) => {
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

  // 歴代クラブ横断順位（Phase H7）: leagueRankingsは[gameType][statKey][teamId]のルックアップ構造
  // （scripts/aggregate-league-rankings.ts参照）。「通算成績」「クラブレコード」タブは同じ
  // careerGameTypeFilterを共有しているため、gameTypeの取り違えが起きない
  const careerRank = (statKey: string): LeagueTeamRankEntry | undefined =>
    teamId ? leagueRankings?.career[careerGameTypeFilter]?.[statKey]?.[teamId] : undefined;
  const clubRecordRank = (statKey: string): LeagueTeamRankEntry | undefined =>
    teamId ? leagueRankings?.clubRecord[careerGameTypeFilter]?.[statKey]?.[teamId] : undefined;
  const seasonSpecialRank = (statKey: "wins" | "streak"): LeagueTeamRankEntry | undefined =>
    teamId ? leagueRankings?.seasonSpecial[careerGameTypeFilter]?.[statKey]?.[teamId] : undefined;

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

  // 「チームスタッツ」タブ（Phase H4）: 自チーム/opp/+/-トグル・Q別/前後半トグル（上部の
  // カテゴリタブ集計表・シチュエーション別成績（チーム版）の両方で共有する）。「試合」選択時は
  // 追加取得不要（既存のgameLogs/team.jsonのみで完結する）が、Q別/前後半選択時のみこのチームの
  // 全試合（gameLogsのscheduleKey全件）の生データを遅延取得する
  const [teamPerspective, setTeamPerspective] = useState<TeamPerspective>("own");
  const [statsPeriod, setStatsPeriod] = useState<PeriodRangeValue>("all");
  const statsPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === statsPeriod);
  // トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブ（「日程結果」「比較」タブと
  // 同じCOLUMNS_BY_TAB/BoxscoreTabKeyを再利用。Phase H4③でタイル形式表示から置き換えた）。
  // 上部集計表とシチュエーション別成績（チーム版）で別々のタブ選択状態を持つ（PlayerDetailPage
  // の「シーズン別成績」「シチュエーション別成績」が独立したタブ状態を持つのと同じ設計）
  const [teamStatsBoxTab, setTeamStatsBoxTab] = useState<BoxscoreTabKey>("traditional");
  const [situationalTeamBoxTab, setSituationalTeamBoxTab] = useState<BoxscoreTabKey>("traditional");
  // 上部集計表専用のレギュラー/プレーオフ/合算トグル（Phase H4②）。SituationalFilterPickerの
  // 組み込みトグルはhideGameTypeToggleで隠し、filterには常にincludePlayoffs: trueを渡した上で
  // filterByGameTypeで絞り込む（個人・チーム双方の「比較」タブと同じ設計）
  const [teamStatsGameType, setTeamStatsGameType] = useState<SeasonGameTypeFilter>("regular");
  // 「試合」選択時・フィルタ無し（isDefaultFilter）・レギュラーシーズンのみの場合のみteams.jsonの
  // シーズン集計を0コストで再利用できる。それ以外（シチュエーション別フィルタ・Q別/前後半トグル・
  // プレーオフ/合算選択のいずれかが有効）はTeamGameLog/生データベースの再集計が必要
  // （シューティングセクションで使う。上部集計表自体は常に生データベースの
  // buildTeamMultiGameBoxTotalsを使うため対象外）
  const needsTeamPeriodRecompute =
    !isDefaultFilter(filter) || teamStatsGameType !== "regular" || (!!statsPeriodOption && statsPeriodOption.periods !== null);
  const statsRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [statsRawGames, setStatsRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [statsRawGamesLoading, setStatsRawGamesLoading] = useState(false);
  // 「チーム内リーダー」（概要タブ、Phase H3②）専用のチーム全体/日本人選手限定トグル
  const [teamLeadersJpOnly, setTeamLeadersJpOnly] = useState(false);
  // 「シチュエーション別成績」（チーム版）専用のレギュラー/プレーオフ/合算トグル。
  // 上部集計表のteamStatsGameTypeとは独立（個人詳細ページの同名セクションと同じ設計）
  const [situationalTeamGameType, setSituationalTeamGameType] = useState<SeasonGameTypeFilter>("regular");
  // 「シチュエーション別勝敗」（概要タブ、Phase H3③）専用のレギュラー/プレーオフ/合算トグル。
  // 他のシチュエーション別セクションと同じく独立した状態を持つ
  const [situationalRecordGameType, setSituationalRecordGameType] = useState<SeasonGameTypeFilter>("regular");

  // 「シーズン別成績」（概要タブ）の平均/合計トグル。個人詳細ページのSeasonBreakdownTableと
  // 同じ仕組み（TeamSeasonBoxColumn.formatにmodeを渡す）を再利用する
  const [seasonBoxDisplayMode, setSeasonBoxDisplayMode] = useState<SeasonDisplayMode>("perGame");
  // 「シーズン別成績」の自チーム/opp/+/-トグル（Phase H8-2）。「チームスタッツ」「日程結果」
  // タブと同じTeamPerspective型・同じ3値切り替えの仕組みを再利用する
  const [seasonBoxPerspective, setSeasonBoxPerspective] = useState<TeamPerspective>("own");
  // 「シューティング」セクションの平均/合計トグル
  const [teamShootingDisplayMode, setTeamShootingDisplayMode] = useState<SeasonDisplayMode>("perGame");
  // 「当該シーズンのスタッツ」（上部集計表）・「シチュエーション別成績」（チーム版）の
  // 平均/合計トグル。それぞれ独立した状態を持つ（他のトグル群と同じ設計）
  const [teamStatsDisplayMode, setTeamStatsDisplayMode] = useState<SeasonDisplayMode>("perGame");
  const [situationalTeamDisplayMode, setSituationalTeamDisplayMode] = useState<SeasonDisplayMode>("perGame");
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
  // 「シチュエーション別勝敗」（概要タブ）「シチュエーション別成績」（チームスタッツタブ）の
  // 各グループの説明文。個人詳細ページの同名セクションと同じ「デフォルト非表示・▶説明ボタンで
  // 開閉」の仕組みをそのまま踏襲する
  const [situationalRecordLegendExpanded, setSituationalRecordLegendExpanded] = useState(false);
  const [situationalTeamLegendExpanded, setSituationalTeamLegendExpanded] = useState(false);

  // 「日程結果」タブ: 自チーム/opp/+/-トグル・レギュラー/プレーオフ/合算トグル・Q別/前後半トグル・
  // トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブ（試合詳細ページのボックススコアと
  // 全く同じCOLUMNS_BY_TAB/ColumnCtxをbuildTeamGameBoxTotals経由で再利用する。DESIGN.md参照）。
  // 「選手スタッツ」タブ（60章）と同様、このタブ専用の独立したトグル状態を持つ（「チームスタッツ」
  // タブのfilter/statsPeriodとは連動しない）。ゲーム種別トグルの既定は「合算」にし、既存の日程結果タブの
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
      tab === "teamStats" ||
      (tab === "overview" && situationalRecordRawExpanded) ||
      (!!statsPeriodOption && statsPeriodOption.periods !== null);
    if ((tab !== "teamStats" && tab !== "schedule" && tab !== "overview") || !needsRawGames || !gameLogs) return;
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
    // 「チームスタッツ」タブは上部集計表・シチュエーション別成績（チーム版）ともMiscタブの
    // LIVETOV/DEADTOV等でYahoo PBPが常に必要なため、「日程結果」タブと同じく無条件で取得する
    // （0コストの高速経路は無い。DESIGN.md参照）
    if ((tab !== "teamStats" && tab !== "schedule") || !yahooPbpSupported || !gameLogs) return;
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
  }, [tab, yahooPbpSupported, gameLogs, season]);

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
  // 「選手スタッツ」タブの平均/合計トグル。ctx.scaledがbuildTeamSplitRowsForPeriod呼び出し時の
  // modeで確定するため、render時にcol.format(ctx, mode)へ渡すだけでは反映されない
  // （SeasonBoxscoreCtx.scaledは構築時に1回だけ計算される）。playerStatsRowsのuseMemo側で
  // このstateを使ってctxを再構築する必要があるため、TeamPlayerStatsTable内のローカルstateでは
  // なく親コンポーネントで持つ
  const [playerStatsDisplayMode, setPlayerStatsDisplayMode] = useState<SeasonDisplayMode>("perGame");
  // Q別/前後半トグル（既存のbuildPeriodRangeOptionsをOT無しで固定した共通オプション）。
  // 「試合」選択時は追加取得不要（既存のTeamGameLog/PlayerGameLog永続集計をそのまま使う）だが、
  // Q別/前後半選択時のみ、必要な試合の生データ（PlayByPlays込み）を遅延取得する
  const [playerStatsPeriod, setPlayerStatsPeriod] = useState<PeriodRangeValue>("all");
  // シチュエーション別フィルタ（シーズン全体/直近N試合/勝敗別/期間指定/ホーム・アウェイ/
  // 対東西地区/月別/年明け前後/平日開催/対勝率別）。既存のSituationalFilterPickerをそのまま
  // 再利用し、選手一覧の全選手に一括で適用する（個別選手ごとの選択ではない）。レギュラー/
  // プレーオフ/合算は既存のplayerStatsGameType（3値トグル）に一本化するため、
  // filterGameLogsへは常にincludePlayoffs: trueを渡す（比較タブ・43章と同じパターン）
  const [playerStatsFilter, setPlayerStatsFilter] = useState<SituationalFilter>({ range: { kind: "all" } });
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
      const situationalFilteredLogs = filterGameLogs(
        gameTypeFilteredLogs,
        { ...playerStatsFilter, includePlayoffs: true },
        opponentRecords,
        divisionHistory,
        season,
      );
      const scheduleKeys = new Set(
        situationalFilteredLogs
          .filter((g) => g.min > 0 && c.ownTeamByScheduleKey.get(g.scheduleKey)?.teamId === teamId)
          .map((g) => g.scheduleKey),
      );
      if (scheduleKeys.size === 0) continue;
      const teamTotals = sumTeamGameLogsFor(gameLogs, scheduleKeys);
      const splitRows = buildTeamSplitRowsForPeriod(
        c.playerId,
        situationalFilteredLogs,
        c.ownTeamByScheduleKey,
        new Map([[teamId, teamTotals]]),
        playerStatsDisplayMode,
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
  }, [
    playerStatsCandidates,
    players,
    gameLogs,
    teamId,
    season,
    playerStatsGameType,
    playerStatsFilter,
    opponentRecords,
    divisionHistory,
    playerStatsDisplayMode,
    playerStatsPeriodOption,
    playerStatsRawGames,
  ]);

  // 「スタメン平均」見出しに追記する、当該シーズン（レギュラーシーズンのみ、avgHeightCm等と
  // 同じ基準）で実際に起用されたスタメン5人の組み合わせ種類数。playerStatsCandidates
  // （「選手スタッツ」タブ用に既に取得済みのPlayerGameLog、isStarterを持つ）から
  // scheduleKeyごとのスタメン集合を組み立て、正規化キーの種類数を数える
  const startingLineupComboCount = useMemo(() => {
    if (!playerStatsCandidates || !teamId) return null;
    const startersByGame = new Map<string, Set<string>>();
    for (const c of playerStatsCandidates) {
      for (const log of c.logs) {
        if (!log.isStarter || log.gameType !== "regular") continue;
        if (c.ownTeamByScheduleKey.get(log.scheduleKey)?.teamId !== teamId) continue;
        if (!startersByGame.has(log.scheduleKey)) startersByGame.set(log.scheduleKey, new Set());
        startersByGame.get(log.scheduleKey)!.add(c.playerId);
      }
    }
    const combos = new Set([...startersByGame.values()].map((ids) => [...ids].sort().join(",")));
    return combos.size;
  }, [playerStatsCandidates, teamId]);

  if (teamsLoading || playersLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;

  const team = teams?.find((t) => t.teamId === teamId);
  if (!team) return <p className="error-message">チームが見つかりませんでした</p>;

  const accentColor = teamColors?.[team.teamId]?.primary;
  const teamPlayers = (players ?? []).filter((p) => p.teamId === teamId);
  const teamLeadersPool = teamLeadersJpOnly ? teamPlayers.filter((p) => p.classification === "日本人") : teamPlayers;

  // 「スタメン選手」は現状このアプリに現在の先発5人という概念が無いため、シーズン中に
  // 1度でも先発出場した選手（gamesStarted > 0）を近似として使う
  const starters = teamPlayers.filter((p) => p.gamesStarted > 0);
  const avgHeightCm = averageOf(starters.flatMap((p) => (p.heightCm != null ? [p.heightCm] : [])));
  const avgWeightKg = averageOf(starters.flatMap((p) => (p.weightKg != null ? [p.weightKg] : [])));
  const avgAge = averageOf(starters.flatMap((p) => (p.birthDate ? [calculateAge(p.birthDate)] : [])));

  // Phase H4②: レギュラー/プレーオフ/合算はSituationalFilterPickerの組み込みトグル（binary）
  // ではなく専用のteamStatsGameTypeで管理する。filterには常にincludePlayoffs: trueを渡して
  // 「地区/月別等の絞り込みだけ適用した全試合」を得た上で、filterByGameTypeで最終的な
  // レギュラー/プレーオフ/合算の絞り込みを行う（個人・チーム双方の「比較」タブと同じ設計）
  const filteredLogs = gameLogs
    ? filterByGameType(
        filterGameLogs(gameLogs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season),
        teamStatsGameType,
      )
    : [];
  const teamStatsShotChartSupported = isShotChartSupported(coverage);
  const yahooTurnoversByScheduleKey = new Map([...teamYahooPbp].map(([k, v]) => [k, v.turnovers] as const));
  // 上部集計表（Phase H4③）: 「日程結果」「比較」タブと同じbuildTeamMultiGameBoxTotalsで、
  // 選択中のフィルタ・ゲーム種別・Q別/前後半に絞り込んだ全試合を1試合あたり平均に集計する。
  // Misc/スコアリングタブの正確性を優先し、Phase TE（64-1章）と同じく0コスト経路は設けない
  const teamStatsEntries = filteredLogs
    .map((g) => {
      const game = statsRawGames.get(g.scheduleKey);
      return game ? { game, isHome: g.isHome } : null;
    })
    .filter((e): e is { game: StoredGame; isHome: boolean } => e !== null);
  const teamStatsBoxTotals = buildTeamMultiGameBoxTotals(
    teamStatsEntries,
    yahooTurnoversByScheduleKey,
    teamStatsShotChartSupported,
    yahooPbpSupported,
    statsPeriodOption,
    teamStatsDisplayMode,
  );

  // 「シューティング」セクション: 「試合」選択時・フィルタ無し・レギュラーシーズンのみの場合だけ
  // teams.jsonのshotTypes（0コスト）、それ以外はYahoo PBPを試合ごとに合算し直す
  const currentTeamShotTypes: ShotTypeBreakdown | undefined = !needsTeamPeriodRecompute
    ? team.shotTypes
    : buildShotTypeBreakdownByTeam(
        filteredLogs
          .filter((g) => g.min > 0)
          .flatMap((g) => teamYahooPbp.get(g.scheduleKey)?.shots ?? [])
          .filter((s) => s.teamId === team.teamId && periodInRange(statsPeriodOption, s.period)),
      ).get(team.teamId);
  const teamShootingGamesPlayed = !needsTeamPeriodRecompute ? team.gamesPlayed : filteredLogs.length;
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
        const matched = situationalTeamScopedLogs.filter(row.predicate);
        const entries = matched
          .map((g) => {
            const game = statsRawGames.get(g.scheduleKey);
            return game ? { game, isHome: g.isHome } : null;
          })
          .filter((e): e is { game: StoredGame; isHome: boolean } => e !== null);
        const boxTotals = buildTeamMultiGameBoxTotals(
          entries,
          yahooTurnoversByScheduleKey,
          teamStatsShotChartSupported,
          yahooPbpSupported,
          statsPeriodOption,
          situationalTeamDisplayMode,
        );
        return boxTotals ? [{ key: row.key, label: row.label, gamesPlayed: matched.length, boxTotals }] : [];
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
            {season}シーズン・{recordLine}
          </p>
        </div>
      </div>

      <div className="team-header-columns">
        <div className="team-header-info">
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
        <div className="stat-grid team-header-stat-grid" key={i}>
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
          <div className="mode-toggle">
            {(["own", "opp", "diff"] as TeamPerspective[]).map((p) => (
              <button
                key={p}
                className={p === seasonBoxPerspective ? "active" : ""}
                onClick={() => setSeasonBoxPerspective(p)}
                type="button"
              >
                {TEAM_PERSPECTIVE_LABELS[p]}
              </button>
            ))}
          </div>
          <div className="tab-bar-with-toggle">
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
            <div className="mode-toggle">
              {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
                <button
                  key={m}
                  className={m === seasonBoxDisplayMode ? "active" : ""}
                  onClick={() => setSeasonBoxDisplayMode(m)}
                  type="button"
                >
                  {SEASON_DISPLAY_MODE_LABELS[m]}
                </button>
              ))}
            </div>
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
                      <th className="align-right" key={c.key} title={c.description}>
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
                            {c.format(r, misc, seasonBoxDisplayMode, seasonBoxPerspective)}
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
          <div className="mode-toggle">
            <button
              className={teamLeadersJpOnly ? "" : "active"}
              onClick={() => setTeamLeadersJpOnly(false)}
              type="button"
            >
              チーム全体
            </button>
            <button
              className={teamLeadersJpOnly ? "active" : ""}
              onClick={() => setTeamLeadersJpOnly(true)}
              type="button"
            >
              日本人選手限定
            </button>
          </div>
          {teamLeadersPool.length === 0 ? (
            <p className="empty-message">選手データがありません</p>
          ) : (
            <div className="leaders-grid">
              {TEAM_INTERNAL_LEADER_STAT_KEYS.map((key) => {
                const def = PLAYER_STAT_DEFS.find((d) => d.key === key);
                if (!def) return null;
                const top = [...teamLeadersPool].sort((a, b) => def.value(b) - def.value(a)).slice(0, TEAM_LEADERS_TOP_N);
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

          <div className="situational-groups-legend">
            <h3
              className="collapsible-heading"
              onClick={() => setSituationalRecordLegendExpanded((v) => !v)}
            >
              {situationalRecordLegendExpanded ? "▼ " : "▶ "}
              説明
            </h3>
            {situationalRecordLegendExpanded && (
            <dl>
              <dt>会場</dt>
              <dd>ホーム開催／アウェイ開催の試合を分けて集計します。</dd>
              <dt>地区</dt>
              <dd>対戦相手の所属地区（東地区／西地区）別の成績です。シーズンごとの実際の地区分けを反映しています。</dd>
              <dt>曜日</dt>
              <dd>水曜開催の試合のみを集計します。</dd>
              <dt>月別</dt>
              <dd>開催月ごとの成績です。試合が無い月は表示されません。</dd>
              <dt>対戦相手の強さ</dt>
              <dd>
                その試合に入る時点での対戦相手の勝率（対5割未満／対5割以上／対6割以上）別の成績です。
                相手の消化試合数が5試合未満の対戦は、勝率が極端な値になりやすいため集計から除外しています。
              </dd>
              <dt>連戦</dt>
              <dd>中1日以内の間隔で連続して試合を行った場合の、1試合目（GAME1）／2試合目以降（GAME2）別の成績です。</dd>
              <dt>自チーム外国籍人数</dt>
              <dd>
                その試合で自チームが最も長くコートに立たせていた、外国籍・帰化選手・アジア特別枠選手の
                同時出場人数（0〜3人）別の成績です。
              </dd>
              <dt>得点/失点</dt>
              <dd>自チームの得点・相手チームの得点（失点）がそれぞれ80点/100点を超えたかどうかで分けた成績です。</dd>
              <dt>点差決着</dt>
              <dd>
                最終的な得失点差が10点差／20点差以上だったか、僅差（1ポゼッション差＝3点差以内／
                2ポゼッション差＝6点差以内）だったかで分けた成績です。
              </dd>
              <dt>延長</dt>
              <dd>延長（OT）にもつれた試合と、レギュレーション（4Q）で決着した試合を分けた成績です。</dd>
              <dt>Q1終了時点／前半終了時点／3Q終了時点</dt>
              <dd>各チェックポイント時点でリード・同点・ビハインドのいずれだったかで分けた成績です。</dd>
            </dl>
            )}
          </div>
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
                  <StatTile
                    key={def.key}
                    label={def.label}
                    value={def.value(careerTotals).toLocaleString()}
                    rank={formatLeagueRank(careerRank(def.key))}
                  />
                ))}
                <StatTile label="最多連勝" value={`${careerLongestWinStreak}連勝`} />
              </div>
              <p className="page-subtitle">
                {careerData[0]?.season}〜{careerData[careerData.length - 1]?.season}シーズンの合計値（PITP/FBPS/2ND
                PTS/PTSOFFTOはPBPタグ集計による得点ベースの値。ホーム来場者数はホーム開催試合のみの合計）。項目名の
                下の順位は過去在籍した全クラブ横断（Phase H7、シーズンをまたいだ連勝は対象外。詳細はクラブレコード
                タブの「最多連勝（シーズン内）」参照）
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
                    rank={formatLeagueRank(seasonSpecialRank("wins"))}
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
                    rank={formatLeagueRank(seasonSpecialRank("streak"))}
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
                    rank={formatLeagueRank(clubRecordRank(r.key))}
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

              <h3 className="career-highs-subheading">被記録</h3>
              <div className="career-highs-grid">
                {clubAgainstRecords.map((r) => (
                  <ClubRecordCard
                    key={r.key}
                    tieKey={`against:${r.key}`}
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
                %系の指標は低試投数での極端な値を避けるため、クラブワーストの対象外。項目名の下の順位は過去在籍した
                全クラブ横断（Phase H7）。クラブワーストは順位算出の対象外。「被記録」は対戦相手がこのチーム相手に
                記録した最多値（来場者数を除く28項目。歴代順位の算出対象外）
              </p>
            </>
          )}
        </>
      )}

      {tab === "teamStats" && (
        <>
          <SituationalFilterPicker
            filter={filter}
            onChange={setFilter}
            opponentWinRateSupported={!!opponentRecords}
            hideGameTypeToggle
          />
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button key={g} className={g === teamStatsGameType ? "active" : ""} onClick={() => setTeamStatsGameType(g)} type="button">
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          <div className="mode-toggle">
            {(["own", "opp", "diff"] as TeamPerspective[]).map((m) => (
              <button key={m} className={teamPerspective === m ? "active" : ""} onClick={() => setTeamPerspective(m)} type="button">
                {TEAM_PERSPECTIVE_LABELS[m]}
              </button>
            ))}
          </div>
          <PeriodRangeToggle options={SEASON_BOX_PERIOD_OPTIONS} value={statsPeriod} onChange={setStatsPeriod} />
          {statsRawGamesLoading && <p className="loading">読み込み中...</p>}
          <div className="tab-bar-with-toggle">
            <div className="tab-bar">
              {BOXSCORE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-button${teamStatsBoxTab === t.key ? " active" : ""}`}
                  onClick={() => setTeamStatsBoxTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mode-toggle">
              {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
                <button
                  key={m}
                  className={m === teamStatsDisplayMode ? "active" : ""}
                  onClick={() => setTeamStatsDisplayMode(m)}
                  type="button"
                >
                  {SEASON_DISPLAY_MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          {!teamStatsBoxTotals ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-right">試合数</th>
                    {COLUMNS_BY_TAB[teamStatsBoxTab].map((col) => (
                      <th key={col.key} className="align-right" title={col.description}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="align-right">{teamStatsEntries.length}</td>
                    {COLUMNS_BY_TAB[teamStatsBoxTab].map((col) => (
                      <td key={col.key} className="align-right">
                        {teamPerspective === "own"
                          ? cleanNumericString(col.format(teamStatsBoxTotals.own, teamStatsBoxTotals.ownCtx))
                          : teamPerspective === "opp"
                            ? cleanNumericString(col.format(teamStatsBoxTotals.opp, teamStatsBoxTotals.oppCtx))
                            : formatColumnDiff(
                                col,
                                teamStatsBoxTotals.own,
                                teamStatsBoxTotals.ownCtx,
                                teamStatsBoxTotals.opp,
                                teamStatsBoxTotals.oppCtx,
                              )}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
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
          <div className="tab-bar-with-toggle">
            <div className="tab-bar">
              {BOXSCORE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-button${situationalTeamBoxTab === t.key ? " active" : ""}`}
                  onClick={() => setSituationalTeamBoxTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mode-toggle">
              {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
                <button
                  key={m}
                  className={m === situationalTeamDisplayMode ? "active" : ""}
                  onClick={() => setSituationalTeamDisplayMode(m)}
                  type="button"
                >
                  {SEASON_DISPLAY_MODE_LABELS[m]}
                </button>
              ))}
            </div>
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
                    {COLUMNS_BY_TAB[situationalTeamBoxTab].map((col) => (
                      <th key={col.key} className="align-right" title={col.description}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {situationalTeamGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td colSpan={COLUMNS_BY_TAB[situationalTeamBoxTab].length + 2}>{group.label}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="align-left">{row.label}</td>
                          <td className="align-right">{row.gamesPlayed}</td>
                          {COLUMNS_BY_TAB[situationalTeamBoxTab].map((col) => (
                            <td key={col.key} className="align-right">
                              {teamPerspective === "own"
                                ? cleanNumericString(col.format(row.boxTotals.own, row.boxTotals.ownCtx))
                                : teamPerspective === "opp"
                                  ? cleanNumericString(col.format(row.boxTotals.opp, row.boxTotals.oppCtx))
                                  : formatColumnDiff(
                                      col,
                                      row.boxTotals.own,
                                      row.boxTotals.ownCtx,
                                      row.boxTotals.opp,
                                      row.boxTotals.oppCtx,
                                    )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="situational-groups-legend">
            <h3
              className="collapsible-heading"
              onClick={() => setSituationalTeamLegendExpanded((v) => !v)}
            >
              {situationalTeamLegendExpanded ? "▼ " : "▶ "}
              説明
            </h3>
            {situationalTeamLegendExpanded && (
            <dl>
              <dt>会場</dt>
              <dd>ホーム開催／アウェイ開催の試合を分けて集計します。</dd>
              <dt>地区</dt>
              <dd>対戦相手の所属地区（東地区／西地区）別の成績です。シーズンごとの実際の地区分けを反映しています。</dd>
              <dt>曜日</dt>
              <dd>平日開催／休日開催（土日・祝日）の試合を分けて集計します。</dd>
              <dt>時期</dt>
              <dd>年明け（1月）を境に、シーズン前半・後半の試合を分けて集計します。</dd>
              <dt>月別</dt>
              <dd>開催月ごとの成績です。試合が無い月は表示されません。</dd>
              <dt>対戦相手の強さ</dt>
              <dd>
                その試合に入る時点での対戦相手の勝率（対5割未満／対5割以上／対6割以上）別の成績です。
                相手の消化試合数が5試合未満の対戦は、勝率が極端な値になりやすいため集計から除外しています。
              </dd>
              <dt>連戦</dt>
              <dd>中1日以内の間隔で連続して試合を行った場合の、1試合目（GAME1）／2試合目以降（GAME2）別の成績です。</dd>
              <dt>自チーム外国籍人数</dt>
              <dd>
                その試合で自チームが最も長くコートに立たせていた、外国籍・帰化選手・アジア特別枠選手の
                同時出場人数（0〜3人）別の成績です。
              </dd>
              <dt>相手チーム外国籍人数</dt>
              <dd>上記を相手チーム視点で見た成績です。</dd>
            </dl>
            )}
          </div>

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

          <h2>ターンオーバー強制/被強制（種類別）</h2>
          {!team.forcedTurnovers || !team.turnoversCommitted ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="sortable-table">
                  <thead>
                    <tr>
                      <th className="align-left">区分</th>
                      <th className="align-right" title="シュートファウル以外のオフェンスファウルによるターンオーバー">オフェンスファウル</th>
                      <th className="align-right" title="24秒バイオレーションによるターンオーバー">24秒バイオレーション</th>
                      <th className="align-right" title="バックコートバイオレーションによるターンオーバー">バックコート</th>
                      <th className="align-right" title="5秒バイオレーションによるターンオーバー">5秒バイオレーション</th>
                      <th className="align-right" title="トラベリング・ダブルドリブル・3秒/8秒バイオレーション・アウトオブバウンズ等、上記以外のデッドボールターンオーバー">その他デッドボール</th>
                      <th className="align-right" title="スティール由来（バッドパス・ボールハンドリングロスト）のライブボールターンオーバー。参考値">ライブボール（参考）</th>
                      <th className="align-right">合計</th>
                      <th className="align-right" title="Yahoo!スポーツplay-by-playが実際に取得できた試合数（分母の目安）">データあり試合数</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(
                      [
                        { label: "相手から奪った（自チームが強制）", data: team.forcedTurnovers },
                        { label: "自チームが記録（相手に強制された）", data: team.turnoversCommitted },
                      ] as const
                    ).map(({ label, data }) => (
                      <tr key={label}>
                        <td className="align-left">{label}</td>
                        <td className="align-right">{data.offensiveFoul}</td>
                        <td className="align-right">{data.violation24sec}</td>
                        <td className="align-right">{data.backcourtViolation}</td>
                        <td className="align-right">{data.violation5sec}</td>
                        <td className="align-right">{data.otherDead}</td>
                        <td className="align-right">{data.live}</td>
                        <td className="align-right">
                          {data.offensiveFoul + data.violation24sec + data.backcourtViolation + data.violation5sec + data.otherDead + data.live}
                        </td>
                        <td className="align-right">{data.gamesWithData}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      {tab === "playerStats" && (
        <>
          {coverageLoading ? (
            <p className="loading">読み込み中...</p>
          ) : !pbpSupported ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <>
              <SituationalFilterPicker
                filter={playerStatsFilter}
                onChange={setPlayerStatsFilter}
                opponentWinRateSupported={!!opponentRecords}
                hideGameTypeToggle
              />
              {playerStatsCandidatesLoading || !playerStatsRows ? (
                <p className="loading">読み込み中...</p>
              ) : (
                <TeamPlayerStatsTable
                  rows={playerStatsRows}
                  gameType={playerStatsGameType}
                  onGameTypeChange={setPlayerStatsGameType}
                  displayMode={playerStatsDisplayMode}
                  onDisplayModeChange={setPlayerStatsDisplayMode}
                  period={playerStatsPeriod}
                  onPeriodChange={setPlayerStatsPeriod}
                  periodLoading={playerStatsRawGamesLoading}
                />
              )}
            </>
          )}

          {(avgHeightCm != null || avgWeightKg != null || avgAge != null) && (
            <>
              <h2>
                スタメン平均（先発出場経験のある選手
                {startingLineupComboCount != null && `・今シーズン${startingLineupComboCount}通りの組み合わせを起用`}）
              </h2>
              <div className="stat-grid">
                <StatTile label="平均身長" value={avgHeightCm != null ? `${formatDecimal(avgHeightCm)}cm` : "-"} />
                <StatTile label="平均体重" value={avgWeightKg != null ? `${formatDecimal(avgWeightKg)}kg` : "-"} />
                <StatTile label="平均年齢" value={avgAge != null ? `${formatDecimal(avgAge)}歳` : "-"} />
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
                      <th className="align-right">得点</th>
                      <th className="align-right">失点</th>
                      <th className="align-right">得失点</th>
                      <th className="align-right">ORtg（推定）</th>
                      <th className="align-right">DRtg（推定）</th>
                      <th className="align-right">NetRtg（推定）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topLineups.map((l) => (
                      <tr key={l.lineupKey}>
                        <td className="align-left">{l.playerIds.map((id) => playerNameById.get(id) ?? id).join(" / ")}</td>
                        <td className="align-right">{l.gamesPlayed}</td>
                        <td className="align-right">{formatDecimal(l.secondsPlayed / 60)}分</td>
                        <td className="align-right">{l.ownPoints}</td>
                        <td className="align-right">{l.oppPoints}</td>
                        <td className="align-right">{formatSigned(l.netPoints, 0)}</td>
                        <td className="align-right">{formatDecimal(l.estimatedOffRtg)}</td>
                        <td className="align-right">{formatDecimal(l.estimatedDefRtg)}</td>
                        <td className="align-right">{formatSigned(l.estimatedNetRtg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="page-subtitle">
                出場時間{MIN_LINEUP_SECONDS}秒未満の組み合わせは除外・上位{MAX_LINEUP_ROWS}組まで表示。ORtg/DRtg/Net
                Ratingはスティント単位の実ポゼッション数が無いため、チームのシーズン平均ペースから推定した参考値。
                試合数がまだ少ないため、いずれの数値もサンプルサイズが小さい点に留意
              </p>
            </>
          )}
        </>
      )}

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
                        next[i] = { season: nextSeason, filter: { range: { kind: "all" } } };
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
  rank,
  expandedKeys,
  onToggle,
}: {
  tieKey: string;
  label: string;
  display: string;
  game: TeamRecordGame;
  otherGames: TeamRecordGame[];
  /** 歴代クラブ横断順位（Phase H7）。「◯位/◯チーム」形式。未算出（league-team-rankings.json
   * 未生成、またはクラブワースト等の非対象項目）の場合は表示しない */
  rank?: string;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const expanded = expandedKeys.has(tieKey);
  return (
    <div className="career-high-card">
      <div className="career-high-label">{label}</div>
      <div className="career-high-value">{display}</div>
      {rank && <div className="career-high-rank">{rank}</div>}
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
  rank,
  expandedKeys,
  onToggle,
}: {
  teamId: string;
  tieKey: string;
  label: string;
  display: string;
  season: string;
  otherSeasons: string[];
  /** 歴代クラブ横断順位（Phase H7）。「◯位/◯チーム」形式 */
  rank?: string;
  expandedKeys: Set<string>;
  onToggle: (key: string) => void;
}) {
  const expanded = expandedKeys.has(tieKey);
  return (
    <div className="career-high-card">
      <div className="career-high-label">{label}</div>
      <div className="career-high-value">{display}</div>
      {rank && <div className="career-high-rank">{rank}</div>}
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
  displayMode,
  onDisplayModeChange,
  period,
  onPeriodChange,
  periodLoading,
}: {
  rows: TeamPlayerStatsRow[];
  gameType: SeasonGameTypeFilter;
  onGameTypeChange: (g: SeasonGameTypeFilter) => void;
  displayMode: SeasonDisplayMode;
  onDisplayModeChange: (m: SeasonDisplayMode) => void;
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
        return col ? col.value(r.ctx, displayMode) : 0;
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
  }, [rows, sortKey, sortDir, columns, displayMode]);

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
          <div className="tab-bar-with-toggle">
            <div className="tab-bar">
              {SEASON_BOX_TABS.map((t) => (
                <button key={t.key} className={`tab-button${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)} type="button">
                  {t.label}
                </button>
              ))}
            </div>
            <div className="mode-toggle">
              {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
                <button key={m} className={m === displayMode ? "active" : ""} onClick={() => onDisplayModeChange(m)} type="button">
                  {SEASON_DISPLAY_MODE_LABELS[m]}
                </button>
              ))}
            </div>
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
                        {col.format(r.ctx, displayMode)}
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
