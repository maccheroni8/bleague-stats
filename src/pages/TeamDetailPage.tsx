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
  fetchGame,
  fetchGameSummaries,
  fetchPlayerGameLogs,
  fetchPlayers,
  fetchSchedule,
  fetchSeasons,
  fetchTeamColors,
  fetchTeamGameLogs,
  fetchTeamHistory,
  fetchTeamLineups,
  fetchTeams,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import type {
  ClubHonor,
  GameSummary,
  GameType,
  PlayerGameLog,
  PlayerSummary,
  StoredGame,
  TeamGameLog,
  TeamSummary,
  UpcomingGameEntry,
} from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PeriodRangeToggle } from "../components/PeriodRangeToggle";
import type { PeriodRangeValue } from "../lib/periodRange";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatRecord, formatSigned } from "../lib/format";
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
  type GameTeamInfo,
  type SituationalFilter,
  type TeamSituationalStats,
} from "../lib/situational";
import { isWeekdayGame } from "../lib/japaneseHolidays";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { safeDiv } from "../../shared/formulas";
import { bleaguePlayerUrl } from "../lib/externalLinks";
import { ExternalLinkIcon } from "../components/ExternalLinkIcon";
import {
  SEASON_BOX_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  SEASON_GAME_TYPE_LABELS,
  buildTeamPeriodStats,
  buildTeamSplitRowsForPeriod,
  countDoubleTripleDoubles,
  filterByGameType,
  sumTeamGameLogsFor,
  type SeasonBoxTabKey,
  type SeasonBoxscoreCtx,
  type SeasonGameTypeFilter,
} from "../lib/playerSeasonBoxscore";

// 出場時間がこれ未満のラインナップはサンプルが小さすぎてノイズが大きいため一覧から除外する
// （実データ確認: 4試合時点で3分(180秒)基準だとチームあたり4〜14組が該当。DESIGN.md参照）
const MIN_LINEUP_SECONDS = 180;
const MAX_LINEUP_ROWS = 10;

const LEADER_STAT_KEYS = ["pts", "reb", "ast", "stl", "blk"];
const LEADERS_PER_STAT = 3;

interface RadarStatDef {
  key: string;
  label: string;
  value: (t: TeamSummary) => number;
  format: (t: TeamSummary) => string;
  /** falseならDRtgのように値が小さいほど良い項目。パーセンタイル換算・順位算出の向きに使う */
  higherIsBetter: boolean;
}

// ヘッダーのレーダーチャート用の8項目。多すぎると見づらいため主要項目のみに絞る。
// Phase TA時点では項目が未定のため、既存の「他クラブ比較」用に組んでいたこの配列を
// そのまま流用している（差し替えは配列の中身を変えるだけで済む）
const RADAR_STAT_DEFS: RadarStatDef[] = [
  { key: "pts", label: "PTS", value: (t) => t.perGame.pts, format: (t) => formatDecimal(t.perGame.pts), higherIsBetter: true },
  { key: "reb", label: "REB", value: (t) => t.perGame.reb, format: (t) => formatDecimal(t.perGame.reb), higherIsBetter: true },
  { key: "ast", label: "AST", value: (t) => t.perGame.ast, format: (t) => formatDecimal(t.perGame.ast), higherIsBetter: true },
  { key: "stl", label: "STL", value: (t) => t.perGame.stl, format: (t) => formatDecimal(t.perGame.stl), higherIsBetter: true },
  { key: "blk", label: "BLK", value: (t) => t.perGame.blk, format: (t) => formatDecimal(t.perGame.blk), higherIsBetter: true },
  {
    key: "efgPct",
    label: "eFG%",
    value: (t) => t.shooting.efgPct,
    format: (t) => formatPct(t.shooting.efgPct),
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

type DetailTab = "overview" | "playerStats" | "schedule" | "stats";

const TAB_LABELS: Record<DetailTab, string> = {
  overview: "概要",
  playerStats: "選手スタッツ",
  schedule: "日程結果",
  stats: "スタッツ",
};

interface SeasonRecord {
  season: string;
  teamName: string;
  team: TeamSummary;
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
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: summaries, loading: summariesLoading } = useJsonData(() => fetchGameSummaries(season), [season]);
  const { data: schedule, loading: scheduleLoading } = useJsonData(() => fetchSchedule(season), [season]);
  // シチュエーション別フィルタの「対勝率別」用（対戦相手のその試合時点までの勝率が必要）
  const opponentRecords = useMemo(() => (summaries ? buildRecordsBeforeGame(summaries) : undefined), [summaries]);

  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);

  const [tab, setTab] = useState<DetailTab>("overview");
  const [playerStatMode, setPlayerStatMode] = useState<PlayerStatMode>("basic");

  // 「スタッツ」タブ: 自チーム/opp/+/-トグル・Q別/前後半トグル（上部のstat-grid・
  // シチュエーション別成績（チーム版）の両方で共有する。「試合」選択時は追加取得不要
  // （既存のgameLogs/team.jsonのみで完結する）が、Q別/前後半選択時のみこのチームの
  // 全試合（gameLogsのscheduleKey全件）の生データを遅延取得する
  const [teamPerspective, setTeamPerspective] = useState<TeamPerspective>("own");
  const [statsPeriod, setStatsPeriod] = useState<PeriodRangeValue>("all");
  const statsPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === statsPeriod);
  const statsRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [statsRawGames, setStatsRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [statsRawGamesLoading, setStatsRawGamesLoading] = useState(false);
  // 「シチュエーション別成績」（チーム版）専用のレギュラー/プレーオフ/合算トグル。
  // 上部stat-gridのfilter.includePlayoffsとは独立（個人詳細ページの同名セクションと同じ設計）
  const [situationalTeamGameType, setSituationalTeamGameType] = useState<SeasonGameTypeFilter>("regular");

  useEffect(() => {
    statsRawGamesRequestedRef.current = new Set();
    setStatsRawGames(new Map());
  }, [teamId, season]);

  useEffect(() => {
    if (tab !== "stats" || !statsPeriodOption || statsPeriodOption.periods === null || !gameLogs) return;
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
  }, [tab, statsPeriodOption, gameLogs, season]);

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

  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter, opponentRecords) : [];
  // 「試合」選択時・フィルタ無しの場合のみteams.jsonの既存集計を0コストで再利用する。
  // それ以外（シチュエーション別フィルタ・Q別/前後半トグルのいずれかが有効）は
  // buildTeamPeriodStatsでTeamGameLog/生データベースの再集計を行う（DESIGN.md参照）
  const currentTeamStats: TeamSituationalStats | null =
    isDefaultFilter(filter) && (!statsPeriodOption || statsPeriodOption.periods === null)
      ? teamSummaryToSituationalStats(team)
      : buildTeamPeriodStats(filteredLogs, statsPeriodOption, statsRawGames);

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
        { key: "east", label: "対東地区", predicate: (g) => matchesDivision(g, "east") },
        { key: "west", label: "対西地区", predicate: (g) => matchesDivision(g, "west") },
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

  const nameHistory = teamHistory?.find((h) => h.teamId === team.teamId)?.names ?? [];
  const honors = clubHonors?.[team.teamId] ?? [];

  const scheduleRows =
    summaries && teamId
      ? buildTeamScheduleRows(summaries, schedule?.upcomingGames ?? [], teamId, team.teamName)
      : [];

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
          <div className="stat-grid">
            <StatTile label="試合数" value={String(team.gamesPlayed)} />
            <StatTile label="勝敗" value={formatRecord(team.wins, team.losses)} />
            <StatTile label="勝率" value={formatPct(winPct)} />
          </div>
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
          {seasonHistoryLoading ? (
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
                    <th className="align-right">得点</th>
                    <th className="align-right">失点</th>
                    <th className="align-right">Net</th>
                    <th className="align-right">REB</th>
                    <th className="align-right">AST</th>
                    <th className="align-right">FG%</th>
                    <th className="align-right">3P%</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonHistory.map((r) => (
                    <tr key={r.season}>
                      <td className="align-left">
                        <RouterLink to={`/teams/${team.teamId}?season=${r.season}`} className="cell-link">
                          {r.season}
                        </RouterLink>
                      </td>
                      <td className="align-left">{r.teamName}</td>
                      <td className="align-right">{r.team.gamesPlayed}</td>
                      <td className="align-right">{formatRecord(r.team.wins, r.team.losses)}</td>
                      <td className="align-right">{formatPct(safeDiv(r.team.wins, r.team.wins + r.team.losses))}</td>
                      <td className="align-right">{formatDecimal(r.team.perGame.pts)}</td>
                      <td className="align-right">{formatDecimal(r.team.opponentPerGame.pts)}</td>
                      <td className="align-right">{formatSigned(r.team.netPerGame.pts)}</td>
                      <td className="align-right">{formatDecimal(r.team.perGame.reb)}</td>
                      <td className="align-right">{formatDecimal(r.team.perGame.ast)}</td>
                      <td className="align-right">{formatPct(r.team.shooting.fgPct)}</td>
                      <td className="align-right">{formatPct(r.team.shooting.tpPct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <h2>チーム内リーダー</h2>
          {teamPlayers.length === 0 ? (
            <p className="empty-message">選手データがありません</p>
          ) : (
            <div className="team-leaders-grid">
              {LEADER_STAT_KEYS.map((key) => {
                const def = PLAYER_STAT_DEFS.find((d) => d.key === key);
                if (!def) return null;
                const top = [...teamPlayers].sort((a, b) => def.value(b) - def.value(a)).slice(0, LEADERS_PER_STAT);
                return (
                  <div className="team-leader-card" key={key}>
                    <div className="team-leader-stat-label">{def.label}</div>
                    {top.map((p) => (
                      <div key={p.playerId} className="team-leader-row">
                        <Link to={`/players/${p.playerId}`} className="team-leader-row-link">
                          <PlayerPhoto playerId={p.playerId} size={28} className="team-leader-photo" />
                          <span className="team-leader-name">{p.name}</span>
                        </Link>
                        <ExternalLinkIcon href={bleaguePlayerUrl(p.playerId)} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
                        <span className="team-leader-value">{def.format(p)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {tab === "schedule" &&
        (summariesLoading || scheduleLoading ? (
          <p className="loading">読み込み中...</p>
        ) : scheduleRows.length === 0 ? (
          <p className="empty-message">日程データがありません</p>
        ) : (
          <div className="table-scroll">
            <table className="sortable-table schedule-table">
              <thead>
                <tr>
                  <th className="align-left">日付</th>
                  <th className="align-left">対戦相手</th>
                  <th className="align-right">結果</th>
                  <th className="align-left">会場</th>
                </tr>
              </thead>
              <tbody>
                {scheduleRows.map((row) => (
                  <TeamScheduleRowView key={row.scheduleKey} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        ))}

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
                  externalLinkTo={(p) => bleaguePlayerUrl(p.playerId)}
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
    </div>
  );
}

function TeamScheduleRowView({ row }: { row: TeamScheduleRow }) {
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
                      <ExternalLinkIcon href={bleaguePlayerUrl(r.player.playerId)} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
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
