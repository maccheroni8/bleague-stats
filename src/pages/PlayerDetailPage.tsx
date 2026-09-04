import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Link as RouterLink } from "react-router-dom";
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
  fetchDivisionHistory,
  fetchGame,
  fetchGameSummaries,
  fetchPlayerGameLogs,
  fetchPlayerAwards,
  fetchPlayerHistory,
  fetchPlayers,
  fetchSeasons,
  fetchTeamColors,
  fetchTeamGameLogs,
  fetchTeams,
  fetchYahooGamePbp,
  ONE_CATEGORY_SEASONS,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  Category,
  DivisionHistoryFile,
  PlayerGameLog,
  PlayerSummary,
  ShotTypeBreakdown,
  StoredGame,
  TeamGameLog,
  YahooShotEvent,
} from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { SortableTable, type Column } from "../components/SortableTable";
import { BOXSCORE_TABS, type BoxscoreColumn, type BoxscoreTabKey, COLUMNS_BY_TAB } from "../components/BoxscoreTable";
import { buildPlayerGameBoxscoreRow, type PlayerGameBoxscoreRow } from "../lib/playerGameBoxscore";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { ExternalLinkIcon } from "../components/ExternalLinkIcon";
import { bleaguePlayerUrl } from "../lib/externalLinks";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
import { formatMinutesFromSeconds, astToTovRatio } from "../lib/boxscoreAggregate";
import { buildShotTypeBreakdown, shotTypeEntityColumns, sortShotTypeKeys } from "../lib/shotTypeBreakdown";
import { ShotChartPanel } from "../components/ShotChart";
import { buildShotEvents, type ShotEvent } from "../lib/shotChart";
import { ShotChartFilterPicker } from "../components/ShotChartFilterPicker";
import { PeriodRangeToggle } from "../components/PeriodRangeToggle";
import { periodInRange, type PeriodRangeOption, type PeriodRangeValue } from "../lib/periodRange";
import { filterPlayersByGamesPlayedRatio } from "../lib/statDefs";
import { safeDiv, eff, efgPct, tsPct } from "../../shared/formulas";
import {
  EMPTY_TEAM_TOTALS,
  SEASON_BOX_COLUMNS,
  SEASON_BOX_PERIOD_OPTIONS,
  SEASON_BOX_TABS,
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  buildPeriodFilteredRawTotals,
  buildSeasonBoxscoreCtx,
  buildTeamSplitRows,
  buildTeamSplitRowsForPeriod,
  computeGamePeriodTotals,
  countDigits,
  countDoubleTripleDoubles,
  filterByGameType,
  modeFactor,
  seasonTotalEff,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  sumTeamSeasonTotals,
  type GamePeriodTotals,
  type SeasonBoxTabKey,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamSeasonRawTotals,
  type TeamSplitRow,
} from "../lib/playerSeasonBoxscore";
import {
  buildBackToBackStatus,
  buildGameTeamsByScheduleKey,
  buildRecordsBeforeGame,
  computePlayerSituationalStats,
  computeSeasonHalfBoundary,
  filterGameLogs,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  matchesShotChartGameFilters,
  resolveOwnTeam,
  type GameTeamInfo,
  type RecordBeforeGame,
  type SeasonHalfBoundary,
  type ShotChartGameFilters,
  type SituationalFilter,
} from "../lib/situational";
import { isWeekdayGame } from "../lib/japaneseHolidays";
import { ComparisonTable, type ComparisonRow, type ComparisonStatDef } from "./ComparePage";

/** 試合詳細ページのボックススコア列定義（BoxscoreColumn）を、試合ログテーブル用のColumnに変換する */
function toGameLogColumns(tabKey: BoxscoreTabKey): Column<PlayerGameBoxscoreRow>[] {
  const fixed: Column<PlayerGameBoxscoreRow>[] = [
    { key: "date", label: "日付", sortValue: (r) => r.gameLog.date, align: "left" },
    {
      key: "opponent",
      label: "対戦相手",
      sortValue: (r) => r.gameLog.opponentTeamName,
      align: "left",
      render: (r) => (
        <>
          {r.gameLog.isHome ? "vs" : "@"} {r.gameLog.opponentTeamName}
          {r.gameLog.gameType === "playoff" && <span className="playoff-badge">PO</span>}
        </>
      ),
    },
    {
      key: "result",
      label: "結果",
      sortValue: (r) => (r.gameLog.win ? 1 : 0),
      render: (r) => <span className={`result-badge ${r.gameLog.win ? "win" : "loss"}`}>{r.gameLog.win ? "W" : "L"}</span>,
    },
  ];
  const statColumns: Column<PlayerGameBoxscoreRow>[] = COLUMNS_BY_TAB[tabKey].map((col: BoxscoreColumn) => ({
    key: col.key,
    label: col.label,
    sortValue: (r) => col.value?.(r.counts, r.ctx) ?? col.format(r.counts, r.ctx),
    format: (r) => col.format(r.counts, r.ctx),
  }));
  return [...fixed, ...statColumns];
}

type DetailTab = "stats" | "gamelog" | "career" | "highs" | "compare";

const TAB_LABELS: Record<DetailTab, string> = {
  stats: "スタッツ",
  gamelog: "試合ログ",
  career: "通算成績",
  highs: "キャリアハイ",
  compare: "比較",
};

// 「シーズン別成績」「シチュエーション別成績」の平均/合計切り替え。SeasonDisplayModeには
// 「30分換算」も含まれるが、ここでは依頼通り平均/合計の2択のみボタン化する
const DISPLAY_MODE_TOGGLE_OPTIONS: SeasonDisplayMode[] = ["perGame", "total"];

// 「通算成績」タブのカテゴリ選択。B.NEXTは未実装のためスコープ外、カテゴリ横断の
// 「全カテゴリ合計」もB.ONEのデータが1シーズン分しか無く中途半端な合計になるため実装しない
// （DESIGN.md参照）
const CAREER_CATEGORY_OPTIONS: Category[] = ["premier", "one"];
const CAREER_CATEGORY_LABELS: Record<Category, string> = {
  premier: "B.PREMIER",
  one: "B.ONE",
};

interface PlayerStatDef {
  key: string;
  label: string;
  value: (p: PlayerSummary) => number;
  format: (p: PlayerSummary) => string;
  /** falseならTOVのように値が小さいほど良い項目。パーセンタイル換算・順位算出の向きに使う */
  higherIsBetter: boolean;
}

/** (FGM-3PM)/(FGA-3PA)。ShootingStatsに2P%が無いため内訳から算出する */
function pt2Pct(p: PlayerSummary): number {
  return safeDiv(p.totals.fgm - p.totals.tpm, p.totals.fga - p.totals.tpa);
}

// ヘッダーのスタッツタイル用。レーダーチャートはこのうち一部（後述RADAR_STAT_KEYS）を流用する
const TILE_STAT_DEFS: PlayerStatDef[] = [
  {
    key: "min",
    label: "MIN",
    value: (p) => p.perGame.min,
    format: (p) => formatMinutesFromSeconds(Math.round(p.perGame.min * 60)),
    higherIsBetter: true,
  },
  { key: "pts", label: "PTS", value: (p) => p.perGame.pts, format: (p) => formatDecimal(p.perGame.pts), higherIsBetter: true },
  { key: "reb", label: "REB", value: (p) => p.perGame.reb, format: (p) => formatDecimal(p.perGame.reb), higherIsBetter: true },
  { key: "ast", label: "AST", value: (p) => p.perGame.ast, format: (p) => formatDecimal(p.perGame.ast), higherIsBetter: true },
  { key: "stl", label: "STL", value: (p) => p.perGame.stl, format: (p) => formatDecimal(p.perGame.stl), higherIsBetter: true },
  { key: "blk", label: "BLK", value: (p) => p.perGame.blk, format: (p) => formatDecimal(p.perGame.blk), higherIsBetter: true },
  { key: "tov", label: "TOV", value: (p) => p.perGame.tov, format: (p) => formatDecimal(p.perGame.tov), higherIsBetter: false },
  {
    key: "plusMinus",
    label: "+/-",
    value: (p) => p.perGame.plusMinus,
    format: (p) => formatSigned(p.perGame.plusMinus),
    higherIsBetter: true,
  },
  { key: "fgPct", label: "FG%", value: (p) => p.shooting.fgPct, format: (p) => formatPct(p.shooting.fgPct), higherIsBetter: true },
  { key: "tpPct", label: "3P%", value: (p) => p.shooting.tpPct, format: (p) => formatPct(p.shooting.tpPct), higherIsBetter: true },
  { key: "pt2Pct", label: "2P%", value: (p) => pt2Pct(p), format: (p) => formatPct(pt2Pct(p)), higherIsBetter: true },
  { key: "ftPct", label: "FT%", value: (p) => p.shooting.ftPct, format: (p) => formatPct(p.shooting.ftPct), higherIsBetter: true },
  { key: "efgPct", label: "eFG%", value: (p) => p.shooting.efgPct, format: (p) => formatPct(p.shooting.efgPct), higherIsBetter: true },
  { key: "tsPct", label: "TS%", value: (p) => p.shooting.tsPct, format: (p) => formatPct(p.shooting.tsPct), higherIsBetter: true },
  { key: "eff", label: "EFF", value: (p) => p.advanced.eff, format: (p) => formatDecimal(p.advanced.eff), higherIsBetter: true },
  { key: "per", label: "PER", value: (p) => p.advanced.per, format: (p) => formatDecimal(p.advanced.per), higherIsBetter: true },
  {
    key: "doubleDoubles",
    label: "DD2",
    value: (p) => p.totals.doubleDoubles,
    format: (p) => String(p.totals.doubleDoubles),
    higherIsBetter: true,
  },
  {
    key: "tripleDoubles",
    label: "TD3",
    value: (p) => p.totals.tripleDoubles,
    format: (p) => String(p.totals.tripleDoubles),
    higherIsBetter: true,
  },
];

// レーダーチャート用の12項目（MIN/PTS/REB/AST/STL/BLK/TOV/3P%/2P%/FT%/EFF/eFG%）。TILE_STAT_DEFSの
// 定義済みaccessorをそのまま流用し、二重定義を避ける
const RADAR_STAT_KEYS = ["min", "pts", "reb", "ast", "stl", "blk", "tov", "tpPct", "pt2Pct", "ftPct", "eff", "efgPct"];
const RADAR_STAT_DEFS = TILE_STAT_DEFS.filter((d) => RADAR_STAT_KEYS.includes(d.key));

interface RankResult {
  rank: number;
  total: number;
}

/** リーグ全選手中でのplayerの順位を返す（1位=最良）。higherIsBetterがfalseの項目は昇順で評価する */
function rankAmong(player: PlayerSummary, allPlayers: PlayerSummary[], def: PlayerStatDef): RankResult {
  const total = allPlayers.length;
  const sorted = [...allPlayers].sort((a, b) => (def.higherIsBetter ? def.value(b) - def.value(a) : def.value(a) - def.value(b)));
  const rank = sorted.findIndex((p) => p.playerId === player.playerId) + 1;
  return { rank, total };
}

function formatRank({ rank, total }: RankResult): string {
  return `${rank}位/${total}人`;
}

interface RadarDataPoint {
  key: string;
  label: string;
  percentile: number;
  rank: number;
  total: number;
  actualValue: string;
}

/** リーグ全選手中でのplayerの各項目の順位を0〜100のパーセンタイルに変換する（TeamDetailPageの
 * buildRadarData()と同じ考え方を選手向けに転用したもの。TOV等は向きを反転） */
function buildPlayerRadarData(player: PlayerSummary, allPlayers: PlayerSummary[]): RadarDataPoint[] {
  const total = allPlayers.length;
  return RADAR_STAT_DEFS.map((def) => {
    const { rank } = rankAmong(player, allPlayers, def);
    const percentile = total > 1 ? (100 * (total - rank)) / (total - 1) : 50;
    return { key: def.key, label: def.label, percentile, rank, total, actualValue: def.format(player) };
  });
}


interface CareerSeasonLogs {
  season: string;
  logs: PlayerGameLog[];
}

/**
 * 1シーズン分の「試合ログから動的に導出した所属チーム」情報。ownTeamByScheduleKeyは
 * resolveOwnTeam()の結果をscheduleKeyごとにキャッシュしたもの（シーズン内移籍で複数チームに
 * 分かれうる）、teamTotalsByTeamIdは%-share/USG%の分母となるチーム総計をチームごとに持つ
 * （移籍前後どちらのチームの試合かで正しい分母を出し分けるため、シーズン単位ではなくチーム単位で持つ）
 */
interface CareerSeasonTeamInfo {
  ownTeamByScheduleKey: Map<string, GameTeamInfo>;
  teamTotalsByTeamId: Map<string, TeamSeasonRawTotals>;
}

/** 「通算成績」タブ: 全シーズン合算の単一の合計値（平均ではない） */
interface CareerCountTotals {
  gamesPlayed: number;
  minSeconds: number;
  pts: number;
  fgm: number;
  tpm: number;
  twoPm: number;
  ftm: number;
  ast: number;
  reb: number;
  blk: number;
  stl: number;
  dd: number;
  td: number;
  oreb: number;
  dreb: number;
  pf: number;
  foulsDrawn: number;
  pt2in: number;
  ptfb: number;
  pt2nd: number;
  ptsOffTov: number;
  dunks: number;
  basketCounts: number;
  unsportsmanlikeFouls: number;
}

type CareerHighGame = PlayerGameLog & { season: string };

interface CareerHighDef {
  key: string;
  label: string;
  value: (g: CareerHighGame) => number;
  format?: (v: number) => string;
  /**
   * %系の指標（FG%等）やAST/TOVのような比率は、試投数の少ない1試合でたまたま0%や
   * 極端な値になりやすく「ワースト記録」として意味を持ちにくいため、キャリアワースト
   * 一覧からは除外する（DESIGN.md参照。ユーザー確認済み）。デフォルトはtrue
   */
  worstEligible?: boolean;
}

function effTotalsOfGame(g: PlayerGameLog) {
  return {
    pts: g.pts,
    ast: g.ast,
    blk: g.blk,
    stl: g.stl,
    reb: g.reb,
    tov: g.tov,
    pf: g.pf,
    fgm: g.fgm,
    fga: g.fga,
    ftm: g.ftm,
    fta: g.fta,
    foulsDrawn: g.foulsDrawn,
    blockedAgainst: g.blockedAgainst,
    technicalFouls: g.technicalFouls,
  };
}

const CAREER_HIGH_STATS: CareerHighDef[] = [
  {
    key: "min",
    label: "MIN",
    value: (g) => g.min,
    format: (v) => formatMinutesFromSeconds(Math.round(v * 60)),
    worstEligible: false,
  },
  { key: "pts", label: "PTS", value: (g) => g.pts },
  { key: "fgm", label: "FGM", value: (g) => g.fgm },
  { key: "fga", label: "FGA", value: (g) => g.fga },
  { key: "fgPct", label: "FG%", value: (g) => safeDiv(g.fgm, g.fga), format: formatPct, worstEligible: false },
  { key: "2pm", label: "2PM", value: (g) => g.fgm - g.tpm },
  { key: "2pa", label: "2PA", value: (g) => g.fga - g.tpa },
  {
    key: "2pPct",
    label: "2P%",
    value: (g) => safeDiv(g.fgm - g.tpm, g.fga - g.tpa),
    format: formatPct,
    worstEligible: false,
  },
  { key: "tpm", label: "3PM", value: (g) => g.tpm },
  { key: "tpa", label: "3PA", value: (g) => g.tpa },
  { key: "tpPct", label: "3P%", value: (g) => safeDiv(g.tpm, g.tpa), format: formatPct, worstEligible: false },
  { key: "ftm", label: "FTM", value: (g) => g.ftm },
  { key: "fta", label: "FTA", value: (g) => g.fta },
  { key: "ftPct", label: "FT%", value: (g) => safeDiv(g.ftm, g.fta), format: formatPct, worstEligible: false },
  {
    key: "efgPct",
    label: "eFG%",
    value: (g) => efgPct(g.fgm, g.tpm, g.fga),
    format: formatPct,
    worstEligible: false,
  },
  {
    key: "tsPct",
    label: "TS%",
    value: (g) => tsPct(g.pts, g.fga, g.fta),
    format: formatPct,
    worstEligible: false,
  },
  { key: "oreb", label: "OR", value: (g) => g.oreb },
  { key: "dreb", label: "DR", value: (g) => g.dreb },
  { key: "reb", label: "TR", value: (g) => g.reb },
  { key: "ast", label: "AST", value: (g) => g.ast },
  { key: "tov", label: "TOV", value: (g) => g.tov },
  {
    key: "astTov",
    label: "AST/TOV",
    value: (g) => astToTovRatio(g.ast, g.tov),
    format: (v) => v.toFixed(1),
    worstEligible: false,
  },
  { key: "stl", label: "STL", value: (g) => g.stl },
  { key: "blk", label: "BLK", value: (g) => g.blk },
  { key: "blockedAgainst", label: "BSR", value: (g) => g.blockedAgainst },
  { key: "pf", label: "F", value: (g) => g.pf },
  { key: "foulsDrawn", label: "FD", value: (g) => g.foulsDrawn },
  {
    key: "eff",
    label: "EFF",
    value: (g) => eff(Number(g.season.split("-")[0]), effTotalsOfGame(g), 1),
    format: (v) => v.toFixed(0),
  },
  { key: "plusMinus", label: "+/-", value: (g) => g.plusMinus, format: (v) => formatSigned(v, 0) },
  { key: "pt2in", label: "PITP", value: (g) => g.pt2in },
  { key: "ptfb", label: "FBPS", value: (g) => g.ptfb },
  { key: "pt2nd", label: "2ND PTS", value: (g) => g.pt2nd },
  { key: "ptsOffTov", label: "PTSOFFTO", value: (g) => g.ptsOffTov },
  { key: "dunks", label: "DUNK", value: (g) => g.dunks },
  { key: "basketCounts", label: "AND1", value: (g) => g.basketCounts },
  { key: "unsportsmanlikeFouls", label: "UFOUL", value: (g) => g.unsportsmanlikeFouls },
  { key: "technicalFouls", label: "TF", value: (g) => g.technicalFouls },
];

interface CompareSlotState {
  season: string;
  filter: SituationalFilter;
}

function defaultCompareSlots(season: string): [CompareSlotState, CompareSlotState] {
  return [
    { season, filter: { range: { kind: "all" } } },
    { season: "", filter: { range: { kind: "all" } } },
  ];
}

/**
 * シチュエーション別フィルタの選択内容を、比較表の列見出しに出す短い日本語ラベルに変換する。
 * 前半戦/後半戦は内部的には「期間指定」（dateRange）として保持されている（situational.ts参照）ため、
 * 境界日と一致するかどうかで判定し直す（SituationalFilterPickerのactive判定と同じロジック）。
 * 2026-08-29、複数選択（AND条件）対応に伴い、range＋AND条件の各軸で同時に選択されている全ての
 * 部分を「・」区切りで列挙する形に変更した（1つも選択が無ければ「シーズン全体」）
 */
function describeSituationalFilter(filter: SituationalFilter, boundary: SeasonHalfBoundary | null): string {
  const parts: string[] = [];
  switch (filter.range.kind) {
    case "all":
      break;
    case "recent":
      parts.push(`直近${filter.range.n}試合`);
      break;
    case "dateRange":
      if (boundary && filter.range.start === "" && filter.range.end === boundary.firstHalfEnd) parts.push("前半戦");
      else if (boundary && filter.range.start === boundary.secondHalfStart && filter.range.end === "") parts.push("後半戦");
      else if (!filter.range.start && !filter.range.end) parts.push("期間指定");
      else parts.push(`${filter.range.start || "…"}〜${filter.range.end || "…"}`);
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

interface CompareColumnData {
  key: string;
  label: string;
  ctx: SeasonBoxscoreCtx;
}

/**
 * 「シチュエーション別成績」の1グループ（会場・地区・曜日・時期・月別・対戦相手の強さ、等）。
 * 将来項目7（外国籍選手同時出場人数別）・項目8（連戦GAME1/GAME2）を追加する際は、この配列に
 * グループを1つ足すだけでよい構造にしている（DESIGN.md参照）
 */
interface SituationalStatsRowDef {
  key: string;
  label: string;
  predicate: (g: PlayerGameLog) => boolean;
}
interface SituationalStatsGroupDef {
  key: string;
  label: string;
  rows: SituationalStatsRowDef[];
}
interface SituationalStatsRow {
  key: string;
  label: string;
  /** シーズン内移籍対応: 試合ログから動的に導出した所属チーム（略称）。1チームのみなら
   * そのチーム名、複数チームにまたがる場合は「複数チーム」（buildTeamSplitRows参照） */
  teamLabel: string;
  /** teamLabelのリンク先（チーム詳細ページ）用。「複数チーム」合計行・未解決行はnull */
  teamId: string | null;
  ctx: SeasonBoxscoreCtx;
  isCombined: boolean;
  /** シューティングタブ用: この行に属する試合ログ（scheduleKey列挙のみに使う） */
  logs: PlayerGameLog[];
  /** シューティングタブ選択時のみ、この行に属する試合のショットから組み立てる */
  breakdown?: ShotTypeBreakdown;
}
interface SituationalStatsGroup {
  key: string;
  label: string;
  rows: SituationalStatsRow[];
}

// 比較タブ: 「シーズン別成績」等と同じSEASON_BOX_COLUMNS（トラディショナル/アドバンスド/
// Misc/スコアリング）をそのままComparisonStatDefに変換する。表示は常に「平均」固定
// （合計だとスロットごとの試合数の違いで比較しづらくなるため。シチュエーション別成績と同じ方針）
function seasonBoxCompareDefs(tabKey: SeasonBoxTabKey): ComparisonStatDef<CompareColumnData>[] {
  return SEASON_BOX_COLUMNS[tabKey].map((col) => ({
    key: col.key,
    label: col.label,
    value: (r) => col.value(r.ctx, "perGame"),
    format: (r) => col.format(r.ctx, "perGame"),
    higherIsBetter: col.higherIsBetter,
  }));
}

function formatBirthDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${y}年${m}月${d}日`;
}

function calcAge(birthDate: string): number {
  const [y, m, d] = birthDate.split("-").map(Number) as [number, number, number];
  const today = new Date();
  let age = today.getFullYear() - y;
  const beforeBirthdayThisYear = today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d);
  if (beforeBirthdayThisYear) age -= 1;
  return age;
}

// シーズン集計ショットチャートのQ別/前後半トグル用の固定オプション。試合詳細ページの
// buildPeriodRangeOptions()は1試合のOT数に応じて動的に組み立てるが、シーズン合計では
// 試合ごとにOT数が異なりうるため、5〜9（最大4OTまで）を一括で「OT」として扱う固定表にする
// （複数OTの試合自体が低頻度事象であることは既存のDESIGN.md記載の通り）
const SEASON_SHOT_CHART_PERIOD_OPTIONS: PeriodRangeOption[] = [
  { value: "all", label: "試合", periods: null },
  { value: "q1", label: "1Q", periods: [1] },
  { value: "q2", label: "2Q", periods: [2] },
  { value: "q3", label: "3Q", periods: [3] },
  { value: "q4", label: "4Q", periods: [4] },
  { value: "ot1", label: "OT", periods: [5, 6, 7, 8, 9] },
  { value: "h1", label: "前半", periods: [1, 2] },
  { value: "h2", label: "後半", periods: [3, 4, 5, 6, 7, 8, 9] },
];

const SHOOTING_TAB_TOOLTIP =
  "Yahoo!スポーツplay-by-play由来のシュートタイプ別成功/試投（2023-24シーズン以降のみ。DESIGN.md参照）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「Jump Shot」に一括りになっている点に注意";

export function PlayerDetailPage({ season }: { season: string }) {
  const { playerId } = useParams<{ playerId: string }>();
  const {
    data: players,
    loading: playersLoading,
    error: playersError,
  } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: gameLogs, loading: logsLoading } = useJsonData(
    () => (playerId ? fetchPlayerGameLogs(season, playerId) : Promise.resolve([])),
    [season, playerId],
  );
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  // レーダーチャートのランキング母集団の足切り（所属チーム試合数の85%以上出場）に使う
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: playerHistory } = useJsonData(() => fetchPlayerHistory(), []);
  const { data: playerAwards } = useJsonData(() => fetchPlayerAwards(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);
  const { coverage } = useSeasonCoverage(season);
  const shotChartSupported = isShotChartSupported(coverage);
  const { supported: yahooSeasonSupported } = useYahooPbpCoverage(season);

  const [gameTypeFilter, setGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");
  // 「シーズン別成績」の平均/合計切り替え（従来は「平均」固定だったが、選べるようにする要望）
  const [seasonDisplayMode, setSeasonDisplayMode] = useState<SeasonDisplayMode>("perGame");
  // 「シーズン別成績」のQ別/前後半トグル。「試合」選択時は追加取得不要（既存のPlayerGameLog
  // 永続集計をそのまま使う）だが、Q別/前後半選択時のみ、必要な試合の生データ（PlayByPlays込み）を
  // 遅延取得する（periodRawGamesキャッシュは「シチュエーション別成績」のQ別トグルとも共有する。
  // scheduleKeyはサイト全体で一意のため、シーズンをまたいだキャッシュ共有でも衝突しない）
  const [seasonBreakdownPeriod, setSeasonBreakdownPeriod] = useState<PeriodRangeValue>("all");
  const periodRawGamesRequestedRef = useRef<Set<string>>(new Set());
  const [periodRawGames, setPeriodRawGames] = useState<Map<string, StoredGame>>(new Map());
  const [periodRawGamesLoading, setPeriodRawGamesLoading] = useState(false);

  const [tab, setTab] = useState<DetailTab>("stats");
  const [careerData, setCareerData] = useState<CareerSeasonLogs[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);
  // 「シーズン別成績」テーブルのカテゴリタブ（トラディショナル/アドバンスド/Misc/スコアリング）用に、
  // careerData全シーズン分の「試合ログから動的に導出した所属チーム」情報を取得する
  // （シーズン内移籍でチームが複数に分かれうるため、teamIdごとに%-share/USG%の分母を持つ）
  const [careerTeamData, setCareerTeamData] = useState<Map<string, CareerSeasonTeamInfo> | null>(null);
  const careerTeamDataFetchStartedRef = useRef(false);
  // 通算成績・キャリアハイ両タブで共有するレギュラー/プレーオフ/合算トグル（既存のgameType軸を再利用）
  const [careerGameTypeFilter, setCareerGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");
  // キャリアハイ/ワーストで同値の試合が複数ある場合の「他◯試合」展開状態。
  // "high:${key}" / "worst:${key}" のプレフィックス付きキーで管理する（highs/worstsで同じdef.keyを使うため）
  const [expandedCareerTieCards, setExpandedCareerTieCards] = useState<Set<string>>(new Set());
  const toggleCareerTieCard = (key: string) => {
    setExpandedCareerTieCards((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  // 「通算成績」「キャリアハイ」両タブで共有するカテゴリ選択（B.PREMIER/B.ONE）。上のcareerData
  // （比較・シーズン別成績等、他タブ全部が参照する共有state）はB.PREMIER専用のまま変更しない。
  // B.ONE選択時だけ別途careerDataOneを遅延取得する（B.ONEは現状data/seasons.json相当の
  // 季一覧が無いため、ONE_CATEGORY_SEASONS（既知の取得済みシーズン一覧）を直接ループする）
  const [careerCategory, setCareerCategory] = useState<Category>("premier");
  const [careerDataOne, setCareerDataOne] = useState<CareerSeasonLogs[] | null>(null);
  const [careerOneLoading, setCareerOneLoading] = useState(false);
  const careerOneFetchStartedRef = useRef(false);

  // 試合ログタブのボックススコア形式表示（試合詳細ページと同じトラディショナル/アドバンスド/
  // Misc/スコアリング切り替え）。各試合の生データ（PlayByPlays込み）を選手の出場試合数分
  // フェッチする必要があるため、タブを開いたときだけ遅延取得する（careerと同じ方針）
  const [gameBoxTab, setGameBoxTab] = useState<BoxscoreTabKey>("traditional");
  const [gameBoxRows, setGameBoxRows] = useState<PlayerGameBoxscoreRow[] | null>(null);
  const [gameBoxLoading, setGameBoxLoading] = useState(false);
  const gameBoxFetchStartedRef = useRef(false);

  // シーズン集計ショットチャート: 選手の出場試合数分の生データ（PlayByPlays込み）を
  // フェッチする必要があるため、試合ログタブと同じ方針で「ユーザーが表示を求めたときだけ」
  // 遅延取得する（「スタッツ」タブはデフォルトタブのため、ここだけ自動取得にすると
  // ページを開くたびに毎回重い取得が走ってしまう）
  const [seasonShotChartExpanded, setSeasonShotChartExpanded] = useState(false);
  const [seasonShotGameData, setSeasonShotGameData] = useState<{ log: PlayerGameLog; shots: ShotEvent[] }[] | null>(
    null,
  );
  const [seasonShotChartLoading, setSeasonShotChartLoading] = useState(false);
  const seasonShotChartFetchStartedRef = useRef(false);
  // ショットチャート専用の複数選択フィルタ（対勝率別・地区別・会場・時期・曜日・月別をAND合成）と
  // Q別/前後半（試合ごとのPeriod番号ベース、試合詳細ページと同じPeriodRangeToggleを再利用）
  const [shotChartFilters, setShotChartFilters] = useState<ShotChartGameFilters>({});
  const [shotChartPeriod, setShotChartPeriod] = useState<PeriodRangeValue>("all");

  // 比較タブ: 2スロット分の{シーズン, シチュエーション別フィルタ}。スロット1は現在選択中の
  // シーズン・シーズン全体、スロット2は未選択（ユーザーが選ぶ）がデフォルト
  const [compareSlots, setCompareSlots] = useState<[CompareSlotState, CompareSlotState]>(() =>
    defaultCompareSlots(season),
  );
  // 比較タブ: トラディショナル/アドバンスド/Misc/スコアリングのカテゴリ切り替え（既存の
  // SEASON_BOX_TABS/SEASON_BOX_COLUMNSを再利用）と、レギュラー/プレーオフ/合算トグル
  // （既存のSeasonGameTypeFilter軸を再利用）。両スロット共通の1セットのみ持つ（各スロットの
  // シチュエーション別フィルタ自体はスロットごとに独立のまま）
  const [compareTab, setCompareTab] = useState<SeasonBoxTabKey>("traditional");
  const [compareGameType, setCompareGameType] = useState<SeasonGameTypeFilter>("regular");

  // 「スタッツ」タブの「シチュエーション別成績」セクション: 独立したシーズン選択・
  // レギュラー/プレーオフ/合算トグル・ボックススコアのカテゴリタブを持つ
  // （ページ本体の現在シーズンとは別のシーズンを選べるため、上のシーズン成績/シーズン別成績とは
  // 独立させている）。デフォルトは現在選択中のシーズン
  const [situationalStatsSeason, setSituationalStatsSeason] = useState(season);
  const [situationalStatsGameType, setSituationalStatsGameType] = useState<SeasonGameTypeFilter>("regular");
  const [situationalStatsTab, setSituationalStatsTab] = useState<SeasonBoxTabKey | "shooting">("traditional");
  const [situationalStatsDisplayMode, setSituationalStatsDisplayMode] = useState<SeasonDisplayMode>("perGame");
  // Q別/前後半トグル（periodRawGamesキャッシュ・fetchロジックは「シーズン別成績」と共有。上の
  // seasonBreakdownPeriod参照）
  const [situationalStatsPeriod, setSituationalStatsPeriod] = useState<PeriodRangeValue>("all");
  // 「各グループの説明」はデフォルト非表示。「説明」ボタンで開閉する
  const [situationalGroupsLegendExpanded, setSituationalGroupsLegendExpanded] = useState(false);
  // 列ヘッダークリックソート。会場・地区・曜日等のグループ構造そのものを崩すと比較の意味が
  // 失われるため、グループの並び順・見出し行は維持したまま「各グループ内の行だけ」をソートする
  // （SeasonBreakdownTableと同じ「1回目クリックで降順、もう一度クリックで昇順」の方式。DESIGN.md参照）
  const [situationalStatsSortKey, setSituationalStatsSortKey] = useState<string | null>(null);
  const [situationalStatsSortDir, setSituationalStatsSortDir] = useState<"asc" | "desc">("desc");

  // 「シューティング」タブ: 従来の独立セクション（自前のシーズン選択・チーム別ボタンを持つ）を
  // 廃止し、「シーズン別成績」「シチュエーション別成績」それぞれのカテゴリタブ（トラディショナル/
  // アドバンスド/Misc/スコアリング）に5つ目の選択肢として統合した（試合詳細ページのシューティング
  // タブ統合パターンを踏襲。DESIGN.md参照）。「シーズン別成績」はSeasonBreakdownTable内部の
  // タブ状態をactiveTab/onTabChangeで親（このコンポーネント）に持ち上げ、どちらかで
  // シューティングタブが選ばれたら、この選手のYahoo PBP対応シーズン分の出場試合のショットを
  // 遅延取得する（両セクションで共有。scheduleKeyごとにキャッシュするため二重取得しない）
  const [seasonBreakdownTab, setSeasonBreakdownTab] = useState<SeasonBoxTabKey | "shooting">("traditional");
  const [careerShots, setCareerShots] = useState<Map<string, YahooShotEvent[]>>(new Map());
  const [careerShotsLoading, setCareerShotsLoading] = useState(false);
  const careerShotsFetchStartedRef = useRef(false);

  // careerLoading/careerDataをdeps配列に含めると、setCareerLoading(true)自体がeffectを
  // 再発火させcleanupで直前のfetchをcancelしてしまう（自己キャンセルのループ）。
  // そのためfetch開始済みかどうかはstateではなくrefで管理する
  const careerFetchStartedRef = useRef(false);

  useEffect(() => {
    setTab("stats");
    setCareerData(null);
    setCareerError(null);
    careerFetchStartedRef.current = false;
    setCareerTeamData(null);
    careerTeamDataFetchStartedRef.current = false;
    setCareerCategory("premier");
    setCareerDataOne(null);
    careerOneFetchStartedRef.current = false;
    setGameBoxRows(null);
    gameBoxFetchStartedRef.current = false;
    setSeasonShotChartExpanded(false);
    setSeasonShotGameData(null);
    seasonShotChartFetchStartedRef.current = false;
    setShotChartFilters({});
    setShotChartPeriod("all");
    setCompareSlots(defaultCompareSlots(season));
    setSituationalStatsSeason(season);
    setSeasonBreakdownTab("traditional");
    setCareerShots(new Map());
    careerShotsFetchStartedRef.current = false;
    setSeasonBreakdownPeriod("all");
    setSituationalStatsPeriod("all");
    setPeriodRawGames(new Map());
    periodRawGamesRequestedRef.current = new Set();
    setPeriodRawGamesLoading(false);
    // 選手が変わった時だけリセットする（season変更では比較タブ・シチュエーション別成績・
    // シューティングの選択を維持したいため、依存配列にseasonは含めない。ここで参照するのは
    // リセット時点の最新値でよい）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  // シーズン切り替え時も試合ログボックススコアを再取得する必要がある（careerは全シーズン
  // 横断のため season 変更の影響を受けないが、こちらは選択中シーズンのgameLogsに依存する）
  useEffect(() => {
    setGameBoxRows(null);
    gameBoxFetchStartedRef.current = false;
    setSeasonShotChartExpanded(false);
    setSeasonShotGameData(null);
    seasonShotChartFetchStartedRef.current = false;
    setShotChartFilters({});
    setShotChartPeriod("all");
  }, [season]);

  // 「シーズン成績」のレギュラー/プレーオフ/合算トグル（gameTypeFilter、直上のボックススコアと
  // 同じstateを共有）が変わったら取り直す。上のYahoo由来シュートタイプ表はレギュラーシーズン
  // 固定（バックエンド集計）だが、こちらは生PBPからその場集計するため同じトグルに追従できる
  useEffect(() => {
    setSeasonShotGameData(null);
    seasonShotChartFetchStartedRef.current = false;
  }, [gameTypeFilter]);

  useEffect(() => {
    if (
      !seasonShotChartExpanded ||
      !playerId ||
      !gameLogs ||
      !shotChartSupported ||
      seasonShotChartFetchStartedRef.current
    )
      return;
    seasonShotChartFetchStartedRef.current = true;
    setSeasonShotChartLoading(true);
    Promise.all(
      filterByGameType(gameLogs, gameTypeFilter)
        .filter((log) => log.min > 0)
        .map(async (log) => {
          try {
            const game = await fetchGame(season, log.scheduleKey);
            const shots = buildShotEvents(game.raw.PlayByPlays).filter((s) => s.playerId === playerId);
            return { log, shots };
          } catch {
            return { log, shots: [] as ShotEvent[] };
          }
        }),
    )
      .then((results) => setSeasonShotGameData(results))
      .finally(() => setSeasonShotChartLoading(false));
  }, [seasonShotChartExpanded, playerId, season, gameLogs, shotChartSupported, gameTypeFilter]);

  // ショットチャートの「対勝率別」フィルタ用の試合日程（対応シーズンでのみ取得。ページ本体の
  // 現在シーズンに紐づくため、シチュエーション別成績セクションが別シーズンを選んでいても影響しない）
  const { data: shotChartGameSummaries } = useJsonData(
    () => (seasonShotChartExpanded ? fetchGameSummaries(season) : Promise.resolve(null)),
    [seasonShotChartExpanded, season],
  );
  const shotChartOpponentRecords = useMemo(
    () => (shotChartGameSummaries ? buildRecordsBeforeGame(shotChartGameSummaries) : undefined),
    [shotChartGameSummaries],
  );
  // シーズン内移籍対応: 所属チームを試合ログから動的に導出する（resolveOwnTeam参照）。
  // 複数チームでプレーしたシーズンのみShotChartFilterPickerにチーム別ボタンが表示される
  const shotChartGameTeams = useMemo(
    () => (shotChartGameSummaries ? buildGameTeamsByScheduleKey(shotChartGameSummaries) : new Map()),
    [shotChartGameSummaries],
  );
  const shotChartOwnTeamByScheduleKey = useMemo(() => {
    const map = new Map<string, GameTeamInfo>();
    for (const { log } of seasonShotGameData ?? []) {
      const own = resolveOwnTeam(log, shotChartGameTeams);
      if (own) map.set(log.scheduleKey, own);
    }
    return map;
  }, [seasonShotGameData, shotChartGameTeams]);
  const shotChartTeamOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const t of shotChartOwnTeamByScheduleKey.values()) byId.set(t.teamId, t.teamName);
    return [...byId.entries()].map(([teamId, teamName]) => ({ teamId, label: teamShortName(teamId, teamName) }));
  }, [shotChartOwnTeamByScheduleKey]);

  const shotChartPeriodOption = SEASON_SHOT_CHART_PERIOD_OPTIONS.find((o) => o.value === shotChartPeriod);
  const filteredSeasonShotEvents = useMemo(() => {
    if (!seasonShotGameData) return [];
    return seasonShotGameData
      .filter(({ log }) =>
        matchesShotChartGameFilters(
          log,
          shotChartFilters,
          shotChartOpponentRecords,
          shotChartOwnTeamByScheduleKey,
          divisionHistory,
          season,
        ),
      )
      .flatMap(({ shots }) => shots.filter((s) => periodInRange(shotChartPeriodOption, s.period)));
  }, [seasonShotGameData, shotChartFilters, shotChartOpponentRecords, shotChartOwnTeamByScheduleKey, shotChartPeriodOption]);

  useEffect(() => {
    if (tab !== "gamelog" || !playerId || !gameLogs || gameBoxFetchStartedRef.current) return;
    gameBoxFetchStartedRef.current = true;
    setGameBoxLoading(true);
    Promise.all(
      gameLogs.map(async (log) => {
        try {
          const [game, yahooPbp] = await Promise.all([
            fetchGame(season, log.scheduleKey),
            yahooSeasonSupported ? fetchYahooGamePbp(season, log.scheduleKey) : Promise.resolve(null),
          ]);
          return buildPlayerGameBoxscoreRow(game, log, playerId, yahooPbp, shotChartSupported);
        } catch {
          return null;
        }
      }),
    )
      .then((results) => {
        setGameBoxRows(results.filter((r): r is PlayerGameBoxscoreRow => r !== null));
      })
      .finally(() => {
        setGameBoxLoading(false);
      });
  }, [tab, playerId, season, gameLogs, yahooSeasonSupported, shotChartSupported]);

  useEffect(() => {
    if (
      (tab !== "stats" && tab !== "career" && tab !== "highs" && tab !== "compare") ||
      !playerId ||
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
          const logs = await fetchPlayerGameLogs(s.season, playerId);
          return { season: s.season, logs };
        } catch {
          return { season: s.season, logs: [] as PlayerGameLog[] };
        }
      }),
    )
      .then((results) => {
        setCareerData(results.filter((r) => r.logs.length > 0));
      })
      .catch(() => {
        setCareerError("通算成績の取得に失敗しました");
      })
      .finally(() => {
        setCareerLoading(false);
      });
  }, [tab, playerId, seasons]);

  // 「通算成績」「キャリアハイ」タブでB.ONEを選んだ時だけ遅延取得する（ONE_CATEGORY_SEASONSは
  // 既知の取得済みシーズンの列挙。data/{season}/one/player-games/{playerId}.jsonが存在しない
  // （＝その選手がそのシーズンB.ONEに出場していない）試合はfetchが失敗するため、
  // 上のcareerData取得と同様catchしてlogsを空配列にし、結果からフィルタして除外する
  useEffect(() => {
    if ((tab !== "career" && tab !== "highs") || careerCategory !== "one" || !playerId || careerOneFetchStartedRef.current) return;
    careerOneFetchStartedRef.current = true;
    setCareerOneLoading(true);
    Promise.all(
      ONE_CATEGORY_SEASONS.map(async (s) => {
        try {
          const logs = await fetchPlayerGameLogs(s, playerId, "one");
          return { season: s, logs };
        } catch {
          return { season: s, logs: [] as PlayerGameLog[] };
        }
      }),
    )
      .then((results) => {
        setCareerDataOne(results.filter((r) => r.logs.length > 0));
      })
      .finally(() => {
        setCareerOneLoading(false);
      });
  }, [tab, careerCategory, playerId]);

  // 「シーズン別成績」テーブルのUSG%・%-shareスタッツ用に、careerData取得済みの各シーズンについて
  // 所属チームを試合ログから動的に導出（games-summary.jsonのhomeTeamId/awayTeamId×isHome、
  // resolveOwnTeam参照）してからチーム総計を取得する。players.jsonの単一teamId（直近所属チームで
  // 上書き済み）には頼らない（シーズン内移籍で複数チームに分かれる選手を正しく扱うため）。
  // careerData自体が揃うまで待つ必要があるため別effectに分離。careerFetchStartedRefと同じ
  // 「一度だけ・playerId変更時のみリセット」パターン
  useEffect(() => {
    if (!careerData || careerTeamDataFetchStartedRef.current) return;
    careerTeamDataFetchStartedRef.current = true;
    Promise.all(
      careerData.map(async (cd) => {
        try {
          const summaries = await fetchGameSummaries(cd.season);
          const gameTeams = buildGameTeamsByScheduleKey(summaries);
          const playedLogs = cd.logs.filter((g) => g.min > 0);
          const ownTeamByScheduleKey = new Map<string, GameTeamInfo>();
          for (const log of playedLogs) {
            const own = resolveOwnTeam(log, gameTeams);
            if (own) ownTeamByScheduleKey.set(log.scheduleKey, own);
          }
          const teamIds = [...new Set([...ownTeamByScheduleKey.values()].map((t) => t.teamId))];
          const teamTotalsByTeamId = new Map<string, TeamSeasonRawTotals>();
          await Promise.all(
            teamIds.map(async (teamId) => {
              try {
                const teamLogs = await fetchTeamGameLogs(cd.season, teamId);
                const scheduleKeys = new Set(
                  playedLogs.filter((g) => ownTeamByScheduleKey.get(g.scheduleKey)?.teamId === teamId).map((g) => g.scheduleKey),
                );
                teamTotalsByTeamId.set(teamId, sumTeamGameLogsFor(teamLogs, scheduleKeys));
              } catch {
                // 取得失敗時はこのteamIdの分だけ空欄（呼び出し側でEMPTY_TEAM_TOTALSにフォールバック）
              }
            }),
          );
          return [cd.season, { ownTeamByScheduleKey, teamTotalsByTeamId }] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      setCareerTeamData(new Map(entries.filter((e): e is readonly [string, CareerSeasonTeamInfo] => e !== null)));
    });
  }, [careerData, playerId]);

  // 「シーズン別成績」のQ別/前後半トグル用: 選択中の期間が「試合」以外になったら、careerData
  // 全シーズン分の出場試合の生データ（PlayByPlays込み）を遅延取得する。periodRawGamesRequestedRef
  // で一度要求したscheduleKeyは再要求しない（シチュエーション別成績側のeffectとも共有）ため、
  // 両セクションで同じ試合が必要でも二重取得は発生しない
  useEffect(() => {
    const option = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === seasonBreakdownPeriod);
    if (!option || option.periods === null || !careerData) return;
    const needed: { season: string; scheduleKey: string }[] = [];
    for (const cd of careerData) {
      for (const log of cd.logs) {
        if (log.min <= 0 || periodRawGamesRequestedRef.current.has(log.scheduleKey)) continue;
        needed.push({ season: cd.season, scheduleKey: log.scheduleKey });
      }
    }
    if (needed.length === 0) return;
    for (const n of needed) periodRawGamesRequestedRef.current.add(n.scheduleKey);
    setPeriodRawGamesLoading(true);
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
        setPeriodRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setPeriodRawGamesLoading(false));
  }, [seasonBreakdownPeriod, careerData]);

  // 「シーズン別成績」「シチュエーション別成績」いずれかでシューティングタブが選ばれたら、
  // Yahoo PBP対応シーズン（data/seasons.jsonのyahooPbpフラグ）の出場試合分だけ、この選手の
  // ショットを遅延取得する（両セクションで共有。scheduleKeyごとにキャッシュするため二重取得しない）
  useEffect(() => {
    const needed = seasonBreakdownTab === "shooting" || situationalStatsTab === "shooting";
    if (!needed || careerShotsFetchStartedRef.current || !careerData || !seasons || !playerId) return;
    careerShotsFetchStartedRef.current = true;
    setCareerShotsLoading(true);
    const yahooSeasons = new Set(seasons.filter((s) => s.yahooPbp).map((s) => s.season));
    const targets: { season: string; scheduleKey: string }[] = [];
    for (const cd of careerData) {
      if (!yahooSeasons.has(cd.season)) continue;
      for (const log of cd.logs) {
        if (log.min <= 0) continue;
        targets.push({ season: cd.season, scheduleKey: log.scheduleKey });
      }
    }
    Promise.all(
      targets.map(async ({ season: s, scheduleKey }) => {
        try {
          const pbp = await fetchYahooGamePbp(s, scheduleKey);
          return [scheduleKey, pbp?.shots.filter((sh) => sh.playerId === playerId) ?? []] as const;
        } catch {
          return [scheduleKey, [] as YahooShotEvent[]] as const;
        }
      }),
    )
      .then((results) => setCareerShots(new Map(results)))
      .finally(() => setCareerShotsLoading(false));
  }, [seasonBreakdownTab, situationalStatsTab, careerData, seasons, playerId]);

  // 通算成績・キャリアハイ共通: DNP（出場0分）を除いた上で、選択中のレギュラー/プレーオフ/合算
  // トグルで絞り込む（既存のSeasonGameTypeFilter/filterByGameTypeをそのまま再利用）
  const playedFilteredLogs = (logs: PlayerGameLog[]) => filterByGameType(logs.filter((g) => g.min > 0), careerGameTypeFilter);

  // 通算成績タブ: 全シーズン合算の単一の合計値（平均ではなく合計）。PlayerSituationalStatsは
  // 平均値と割合しか持たないため、FGM/3PM/FTM等の合計はgameLogから直接合算し直す
  const careerCountTotalsSource = careerCategory === "one" ? careerDataOne : careerData;
  const careerCountTotals = useMemo((): CareerCountTotals | null => {
    if (!careerCountTotalsSource) return null;
    const allPlayed = careerCountTotalsSource.flatMap((cd) => playedFilteredLogs(cd.logs));
    if (allPlayed.length === 0) return null;
    const sums = allPlayed.reduce(
      (acc, g) => ({
        min: acc.min + g.min,
        pts: acc.pts + g.pts,
        fgm: acc.fgm + g.fgm,
        tpm: acc.tpm + g.tpm,
        ftm: acc.ftm + g.ftm,
        ast: acc.ast + g.ast,
        reb: acc.reb + g.reb,
        blk: acc.blk + g.blk,
        stl: acc.stl + g.stl,
        oreb: acc.oreb + g.oreb,
        dreb: acc.dreb + g.dreb,
        pf: acc.pf + g.pf,
        foulsDrawn: acc.foulsDrawn + g.foulsDrawn,
        pt2in: acc.pt2in + g.pt2in,
        ptfb: acc.ptfb + g.ptfb,
        pt2nd: acc.pt2nd + g.pt2nd,
        ptsOffTov: acc.ptsOffTov + g.ptsOffTov,
        dunks: acc.dunks + g.dunks,
        basketCounts: acc.basketCounts + g.basketCounts,
        unsportsmanlikeFouls: acc.unsportsmanlikeFouls + g.unsportsmanlikeFouls,
      }),
      {
        min: 0,
        pts: 0,
        fgm: 0,
        tpm: 0,
        ftm: 0,
        ast: 0,
        reb: 0,
        blk: 0,
        stl: 0,
        oreb: 0,
        dreb: 0,
        pf: 0,
        foulsDrawn: 0,
        pt2in: 0,
        ptfb: 0,
        pt2nd: 0,
        ptsOffTov: 0,
        dunks: 0,
        basketCounts: 0,
        unsportsmanlikeFouls: 0,
      },
    );
    const { dd, td } = countDoubleTripleDoubles(allPlayed);
    return {
      gamesPlayed: allPlayed.length,
      minSeconds: Math.round(sums.min * 60),
      pts: sums.pts,
      fgm: sums.fgm,
      tpm: sums.tpm,
      twoPm: sums.fgm - sums.tpm,
      ftm: sums.ftm,
      ast: sums.ast,
      reb: sums.reb,
      blk: sums.blk,
      stl: sums.stl,
      dd,
      td,
      oreb: sums.oreb,
      dreb: sums.dreb,
      pf: sums.pf,
      foulsDrawn: sums.foulsDrawn,
      pt2in: sums.pt2in,
      ptfb: sums.ptfb,
      pt2nd: sums.pt2nd,
      ptsOffTov: sums.ptsOffTov,
      dunks: sums.dunks,
      basketCounts: sums.basketCounts,
      unsportsmanlikeFouls: sums.unsportsmanlikeFouls,
    };
  }, [careerCountTotalsSource, careerGameTypeFilter]);

  // 「キャリアハイ」タブのDD/TD達成数カードで引き続き使用（通算成績タブの表示自体は
  // 上のcareerCountTotalsに置き換え済み）。通算成績タブと同じくcareerCountTotalsSource
  // （careerCategoryに応じてcareerData/careerDataOneを切り替え）を参照する
  const careerTotal = useMemo(() => {
    if (!careerCountTotalsSource) return null;
    const allPlayed = careerCountTotalsSource.flatMap((cd) => playedFilteredLogs(cd.logs));
    const stats = computePlayerSituationalStats(allPlayed);
    return stats ? { stats, ddtd: countDoubleTripleDoubles(allPlayed) } : null;
  }, [careerCountTotalsSource, careerGameTypeFilter]);

  // 同値タイの試合を新しい順（日付降順）に並べる。代表試合（先頭）を各カードの主表示に使い、
  // 残り（otherGames）を「他◯試合」展開に使う
  function sortGamesByDateDesc(games: CareerHighGame[]): CareerHighGame[] {
    return [...games].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }

  const careerHighs = useMemo(() => {
    if (!careerCountTotalsSource) return [];
    const allGames = careerCountTotalsSource.flatMap((cd) =>
      playedFilteredLogs(cd.logs).map((g) => ({ ...g, season: cd.season })),
    );
    return CAREER_HIGH_STATS.map((def) => {
      let bestValue: number | null = null;
      for (const g of allGames) {
        const v = def.value(g);
        if (bestValue === null || v > bestValue) bestValue = v;
      }
      if (bestValue === null) return null;
      const matches = sortGamesByDateDesc(allGames.filter((g) => def.value(g) === bestValue));
      const [game, ...otherGames] = matches;
      return { ...def, game, otherGames, display: def.format ? def.format(bestValue) : String(bestValue) };
    }).filter((r): r is CareerHighDef & { game: CareerHighGame; otherGames: CareerHighGame[]; display: string } => r !== null);
  }, [careerCountTotalsSource, careerGameTypeFilter]);

  // 「キャリアワースト」: %系の指標・AST/TOV（worstEligible: false）を除いた項目について、
  // 同じ試合ログ集合から最小値を求める（キャリアハイと対になる一覧。DESIGN.md参照）
  const careerWorsts = useMemo(() => {
    if (!careerCountTotalsSource) return [];
    const allGames = careerCountTotalsSource.flatMap((cd) =>
      playedFilteredLogs(cd.logs).map((g) => ({ ...g, season: cd.season })),
    );
    return CAREER_HIGH_STATS.filter((def) => def.worstEligible !== false)
      .map((def) => {
        let worstValue: number | null = null;
        for (const g of allGames) {
          const v = def.value(g);
          if (worstValue === null || v < worstValue) worstValue = v;
        }
        if (worstValue === null) return null;
        const matches = sortGamesByDateDesc(allGames.filter((g) => def.value(g) === worstValue));
        const [game, ...otherGames] = matches;
        return { ...def, game, otherGames, display: def.format ? def.format(worstValue) : String(worstValue) };
      })
      .filter((r): r is CareerHighDef & { game: CareerHighGame; otherGames: CareerHighGame[]; display: string } => r !== null);
  }, [careerCountTotalsSource, careerGameTypeFilter]);

  // 比較タブ: 各スロットの「前半戦/後半戦」ボタン用に、スロットで選ばれたシーズンの試合日程を
  // 都度取得する（2スロットのみなので配列化せず個別にuseJsonDataを呼ぶ）。比較タブを開いている
  // 間だけ取得する（タブを開くまで無駄な通信をしないため）
  const { data: compareSummaries0 } = useJsonData(
    () => (tab === "compare" && compareSlots[0].season ? fetchGameSummaries(compareSlots[0].season) : Promise.resolve(null)),
    [tab, compareSlots[0].season],
  );
  const { data: compareSummaries1 } = useJsonData(
    () => (tab === "compare" && compareSlots[1].season ? fetchGameSummaries(compareSlots[1].season) : Promise.resolve(null)),
    [tab, compareSlots[1].season],
  );
  const compareBoundaries: [SeasonHalfBoundary | null, SeasonHalfBoundary | null] = [
    useMemo(() => (compareSummaries0 ? computeSeasonHalfBoundary(compareSummaries0) : null), [compareSummaries0]),
    useMemo(() => (compareSummaries1 ? computeSeasonHalfBoundary(compareSummaries1) : null), [compareSummaries1]),
  ];
  // 「対勝率別」フィルタ用（対戦相手のその試合時点までの勝率が必要。前半戦/後半戦の境界日と同じく
  // スロットごとのシーズンの試合日程から求める）
  const compareOpponentRecords = [
    useMemo(() => (compareSummaries0 ? buildRecordsBeforeGame(compareSummaries0) : undefined), [compareSummaries0]),
    useMemo(() => (compareSummaries1 ? buildRecordsBeforeGame(compareSummaries1) : undefined), [compareSummaries1]),
  ];

  // 「シチュエーション別成績」セクション用データ。選択中シーズンの試合日程（対勝率別・連戦・
  // 所属チーム解決に使う）と、チーム総計（%-share・USG%の分母）。「スタッツ」タブを
  // 開いている間だけ取得する
  const { data: situationalStatsSummaries } = useJsonData(
    () => (tab === "stats" ? fetchGameSummaries(situationalStatsSeason) : Promise.resolve(null)),
    [tab, situationalStatsSeason],
  );
  const situationalStatsOpponentRecords = useMemo(
    () => (situationalStatsSummaries ? buildRecordsBeforeGame(situationalStatsSummaries) : undefined),
    [situationalStatsSummaries],
  );
  // 選手の所属チームはシーズン内移籍で複数に分かれうるため、players.jsonの単一teamIdには頼らず
  // 試合ログから動的に導出する（resolveOwnTeam参照）。situationalStatsLogsは本来この下の
  // 早期returnの後で計算していたが、この節のフックが参照する必要があるため早期returnより前に
  // 前倒しした（player/playersには依存しないため安全）
  const situationalStatsLogs = careerData?.find((cd) => cd.season === situationalStatsSeason)?.logs;

  // 「シチュエーション別成績」のQ別/前後半トグル用: 選択中シーズン（situationalStatsSeason）の
  // 出場試合のみが対象（careerData全体ではなく、こちらは1シーズン分のみで済む）。上の
  // 「シーズン別成績」用effectとperiodRawGames・periodRawGamesRequestedRefを共有する
  // （scheduleKeyはサイト全体で一意のため衝突しない）
  useEffect(() => {
    const option = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === situationalStatsPeriod);
    if (!option || option.periods === null || !situationalStatsLogs) return;
    const needed = situationalStatsLogs
      .filter((g) => g.min > 0 && !periodRawGamesRequestedRef.current.has(g.scheduleKey))
      .map((g) => ({ season: situationalStatsSeason, scheduleKey: g.scheduleKey }));
    if (needed.length === 0) return;
    for (const n of needed) periodRawGamesRequestedRef.current.add(n.scheduleKey);
    setPeriodRawGamesLoading(true);
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
        setPeriodRawGames((prev) => {
          const next = new Map(prev);
          for (const r of results) if (r) next.set(r[0], r[1]);
          return next;
        });
      })
      .finally(() => setPeriodRawGamesLoading(false));
  }, [situationalStatsPeriod, situationalStatsLogs, situationalStatsSeason]);

  const situationalStatsGameTeams = useMemo(
    () => (situationalStatsSummaries ? buildGameTeamsByScheduleKey(situationalStatsSummaries) : new Map()),
    [situationalStatsSummaries],
  );
  const situationalStatsOwnTeamByScheduleKey = useMemo(() => {
    const map = new Map<string, GameTeamInfo>();
    for (const log of situationalStatsLogs ?? []) {
      if (log.min <= 0) continue;
      const own = resolveOwnTeam(log, situationalStatsGameTeams);
      if (own) map.set(log.scheduleKey, own);
    }
    return map;
  }, [situationalStatsLogs, situationalStatsGameTeams]);
  const situationalStatsTeamIds = [...new Set([...situationalStatsOwnTeamByScheduleKey.values()].map((t) => t.teamId))];
  const { data: situationalStatsTeamGameLogsByTeam } = useJsonData(
    () =>
      tab === "stats" && situationalStatsTeamIds.length > 0
        ? Promise.all(
            situationalStatsTeamIds.map(
              async (teamId) => [teamId, await fetchTeamGameLogs(situationalStatsSeason, teamId)] as const,
            ),
          ).then((entries) => new Map(entries))
        : Promise.resolve(new Map<string, TeamGameLog[]>()),
    [tab, situationalStatsSeason, situationalStatsTeamIds.join("|")],
  );
  const situationalStatsTeamTotalsByTeamId = useMemo(() => {
    const map = new Map<string, TeamSeasonRawTotals>();
    for (const teamId of situationalStatsTeamIds) {
      const teamLogs = situationalStatsTeamGameLogsByTeam?.get(teamId) ?? [];
      const scheduleKeys = new Set(
        (situationalStatsLogs ?? [])
          .filter((g) => g.min > 0 && situationalStatsOwnTeamByScheduleKey.get(g.scheduleKey)?.teamId === teamId)
          .map((g) => g.scheduleKey),
      );
      map.set(teamId, sumTeamGameLogsFor(teamLogs, scheduleKeys));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [situationalStatsTeamGameLogsByTeam, situationalStatsLogs, situationalStatsOwnTeamByScheduleKey, situationalStatsTeamIds.join("|")]);

  const situationalStatsBackToBack = useMemo(
    () => (situationalStatsSummaries ? buildBackToBackStatus(situationalStatsSummaries) : undefined),
    [situationalStatsSummaries],
  );

  // 各スロットのctxを組み立てる。レギュラー/プレーオフ/合算はcompareGameType（共有トグル）で
  // 先に絞り込んでから、スロットごとのシチュエーション別フィルタ（kindのみ。includePlayoffsは
  // compareGameTypeに一本化するため常にtrueを渡し、filterGameLogs内の二重絞り込みを避ける）を
  // 適用する。シーズン内移籍で複数チームに分かれる場合はbuildTeamSplitRowsの「複数チーム」合算行
  // （常に配列の最後）を1スロット1列として使う
  const compareRows: ComparisonRow<CompareColumnData>[] = compareSlots
    .map((slot, i): ComparisonRow<CompareColumnData> | null => {
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
      if (filtered.length === 0) return null;
      const teamInfo = careerTeamData?.get(slot.season);
      const seasonStartYear = Number(slot.season.split("-")[0]);
      const splitRows = buildTeamSplitRows(
        `slot${i}`,
        filtered,
        teamInfo?.ownTeamByScheduleKey ?? new Map(),
        teamInfo?.teamTotalsByTeamId ?? new Map(),
        "perGame",
        seasonStartYear,
      );
      const combined = splitRows[splitRows.length - 1];
      if (!combined) return null;
      return {
        item: { key: `slot${i}`, label: describeSituationalFilter(slot.filter, compareBoundaries[i]!), ctx: combined.ctx },
        season: slot.season,
      };
    })
    .filter((r): r is ComparisonRow<CompareColumnData> => r !== null);

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;

  const player = players?.find((p) => p.playerId === playerId);
  if (!player) return <p className="error-message">選手が見つかりませんでした</p>;

  const accentColor = teamColors?.[player.teamId]?.primary;
  const nameHistory = playerHistory?.find((h) => h.playerId === player.playerId)?.names ?? [];
  const playerAwardList = [...(playerAwards?.[player.playerId] ?? [])].sort((a, b) =>
    b.season.localeCompare(a.season),
  );

  // レーダーチャートのパーセンタイル算出対象は、所属チーム試合数の85%以上に出場した選手のみに
  // 絞り込む（出場が少なく数値が振れやすい選手を母集団から除くため。DESIGN.md参照）。
  // ただし閲覧中の選手自身は、この条件を満たさなくても常にプロット対象に含める
  // （比較先の母集団を絞るだけで、自分の値が消えるわけではないようにする）
  const radarEligiblePool = players ? filterPlayersByGamesPlayedRatio(players, teams ?? []) : [];
  const radarPool = radarEligiblePool.some((p) => p.playerId === player.playerId)
    ? radarEligiblePool
    : [...radarEligiblePool, player];
  const radarData = radarPool.length > 1 ? buildPlayerRadarData(player, radarPool) : [];

  // 「シチュエーション別成績」: 選択中シーズンの試合ログをレギュラー/プレーオフ/合算で絞った上で、
  // 各グループ・各行（例: ホーム/アウェイ）ごとに、試合ログから動的に導出した所属チーム単位で
  // 個別のSeasonBoxscoreCtxを組み立てる（シーズン内移籍でチームが複数に分かれる場合は
  // buildTeamSplitRowsがチーム別行＋合計行に分ける。1チームのみなら1行のみ）。
  // 表示は常に平均（1試合あたり）固定（合計だと行ごとの試合数の違いで比較しづらいため）
  const situationalStatsScopedLogs = situationalStatsLogs
    ? filterByGameType(situationalStatsLogs, situationalStatsGameType)
    : [];

  const situationalStatsPeriodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === situationalStatsPeriod);

  const buildSituationalStatsRows = (rowKey: string, rowLabel: string, matched: PlayerGameLog[]): SituationalStatsRow[] => {
    const seasonStartYear = Number(situationalStatsSeason.split("-")[0]);
    return buildTeamSplitRowsForPeriod(
      rowKey,
      matched,
      situationalStatsOwnTeamByScheduleKey,
      situationalStatsTeamTotalsByTeamId,
      situationalStatsDisplayMode,
      seasonStartYear,
      player.playerId,
      situationalStatsPeriodOption,
      periodRawGames,
    ).map((r) => ({ key: r.key, label: rowLabel, teamLabel: r.teamLabel, teamId: r.teamId, ctx: r.ctx, isCombined: r.isCombined, logs: r.logs }));
  };

  const situationalStatsMonthsWithData = new Set(
    situationalStatsScopedLogs.filter((g) => g.min > 0).map((g) => Number(g.date.slice(5, 7))),
  );

  const situationalStatsGroupDefs: SituationalStatsGroupDef[] = [
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
        { key: "east", label: "対東地区", predicate: (g) => matchesDivision(g, "east", divisionHistory, situationalStatsSeason) },
        { key: "west", label: "対西地区", predicate: (g) => matchesDivision(g, "west", divisionHistory, situationalStatsSeason) },
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
        .filter((m) => situationalStatsMonthsWithData.has(m))
        .map((m) => ({ key: `m${m}`, label: `${m}月`, predicate: (g) => matchesMonth(g, m) })),
    },
    {
      key: "opponentStrength",
      label: "対戦相手の強さ",
      rows: situationalStatsOpponentRecords
        ? (
            [
              ["under50", "対5割未満"],
              ["atLeast50", "対5割以上"],
              ["atLeast60", "対6割以上"],
            ] as const
          ).map(([tier, label]) => ({
            key: tier,
            label,
            predicate: (g: PlayerGameLog) => matchesOpponentWinRateTier(g, tier, situationalStatsOpponentRecords),
          }))
        : [],
    },
    {
      key: "backToBack",
      label: "連戦",
      // 連戦GAME1/GAME2はチーム単位の判定（buildBackToBackStatus）のため、シーズン内移籍選手は
      // その試合ごとの所属チーム（動的導出）で引く（固定の1チームだと移籍前後のどちらかが
      // 常に不一致になってしまうため）
      rows:
        situationalStatsBackToBack
          ? (["GAME1", "GAME2"] as const).map((status) => ({
              key: status,
              label: status,
              predicate: (g: PlayerGameLog) =>
                situationalStatsBackToBack
                  .get(g.scheduleKey)
                  ?.get(situationalStatsOwnTeamByScheduleKey.get(g.scheduleKey)?.teamId ?? "") === status,
            }))
          : [],
    },
    {
      key: "foreignPlayerCount",
      label: "自チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `own${n}`,
        label: `${n}人`,
        predicate: (g: PlayerGameLog) => g.foreignPlayerCount === n,
      })),
    },
    {
      key: "opponentForeignPlayerCount",
      label: "相手チーム外国籍人数",
      rows: [0, 1, 2, 3].map((n) => ({
        key: `opp${n}`,
        label: `${n}人`,
        predicate: (g: PlayerGameLog) => g.opponentForeignPlayerCount === n,
      })),
    },
  ];

  // シューティングタブ選択時のみ、グループ横断で各行のショット内訳（breakdown）を組み立てる。
  // 列（シュートタイプ×2P/3P×M/A/%）はグループ横断の全行に出現するシュートタイプの和集合から作る
  // （TeamsListPage・shotTypeEntityColumnsと同じ「エンティティ1行=1エンティティ」パターン）
  const situationalStatsRawGroups = situationalStatsGroupDefs
    .map((group) => ({
      key: group.key,
      label: group.label,
      rows: group.rows.flatMap((row) => buildSituationalStatsRows(row.key, row.label, situationalStatsScopedLogs.filter(row.predicate))),
    }))
    .filter((group) => group.rows.length > 0);

  if (situationalStatsTab === "shooting") {
    for (const group of situationalStatsRawGroups) {
      for (const row of group.rows) {
        row.breakdown = buildShotTypeBreakdown(row.logs.flatMap((l) => careerShots.get(l.scheduleKey) ?? []));
      }
    }
  }
  const situationalStatsShotTypeKeys =
    situationalStatsTab === "shooting"
      ? sortShotTypeKeys([
          ...new Set(situationalStatsRawGroups.flatMap((g) => g.rows.flatMap((r) => Object.keys(r.breakdown ?? {})))),
        ])
      : [];
  const situationalStatsShotColumns: Column<SituationalStatsRow>[] =
    situationalStatsTab === "shooting"
      ? shotTypeEntityColumns<SituationalStatsRow>(
          situationalStatsShotTypeKeys,
          (r) => r.breakdown,
          situationalStatsDisplayMode === "total" ? "total" : "perGame",
          (r) => r.ctx.raw.gamesPlayed,
        )
      : [];

  const situationalStatsRowSortValue = (row: SituationalStatsRow, key: string): number | string => {
    switch (key) {
      case "label":
        return row.label;
      case "team":
        return row.teamLabel;
      default: {
        if (situationalStatsTab === "shooting") {
          const col = situationalStatsShotColumns.find((c) => c.key === key);
          return col ? col.sortValue(row) : 0;
        }
        const col = SEASON_BOX_COLUMNS[situationalStatsTab].find((c) => c.key === key);
        return col ? col.value(row.ctx, situationalStatsDisplayMode) : 0;
      }
    }
  };
  const sortSituationalStatsRows = (rows: SituationalStatsRow[]): SituationalStatsRow[] => {
    if (!situationalStatsSortKey) return rows;
    const factor = situationalStatsSortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = situationalStatsRowSortValue(a, situationalStatsSortKey);
      const bv = situationalStatsRowSortValue(b, situationalStatsSortKey);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
  };
  const handleSituationalStatsHeaderClick = (key: string) => {
    if (key === situationalStatsSortKey) {
      setSituationalStatsSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSituationalStatsSortKey(key);
      setSituationalStatsSortDir("desc");
    }
  };
  const situationalStatsSortIndicator = (key: string) =>
    situationalStatsSortKey === key ? (situationalStatsSortDir === "asc" ? " ▲" : " ▼") : "";
  const situationalStatsSortAria = (key: string) =>
    situationalStatsSortKey === key ? (situationalStatsSortDir === "asc" ? "ascending" : "descending") : undefined;

  const situationalStatsGroups: SituationalStatsGroup[] = situationalStatsRawGroups.map((group) => ({
    ...group,
    rows: sortSituationalStatsRows(group.rows),
  }));

  return (
    <div>
      <Link to="/players" className="back-link">
        ← 個人一覧に戻る
      </Link>
      <div className="player-detail-title" style={accentColor ? { borderTopColor: accentColor } : undefined}>
        <h1>
          {player.name}
          <ExternalLinkIcon href={bleaguePlayerUrl(player.playerId)} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
        </h1>
        <p className="page-subtitle">
          {player.teamName}・{season}シーズン・{player.gamesPlayed}試合出場
        </p>
        {nameHistory.length > 1 && (
          <p className="page-subtitle">
            登録名変更履歴:{" "}
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
      </div>

      <div className="player-header-columns">
        <div className="player-header-photo">
          <PlayerPhoto playerId={player.playerId} size={280} />
        </div>

        <div className="player-header-profile">
          <div className="player-profile-grid">
            {player.position && <ProfileItem label="ポジション" value={player.position} />}
            {player.classification && <ProfileItem label="登録区分" value={player.classification} />}
            {player.nationality && <ProfileItem label="国籍" value={player.nationality} />}
            {player.heightCm && <ProfileItem label="身長" value={`${player.heightCm}cm`} />}
            {player.weightKg && <ProfileItem label="体重" value={`${player.weightKg}kg`} />}
            {player.birthDate && (
              <ProfileItem
                label="生年月日"
                value={`${formatBirthDate(player.birthDate)}（${calcAge(player.birthDate)}歳）`}
              />
            )}
          </div>
          {playerAwardList.length > 0 && (
            <div className="player-awards">
              <div className="player-awards-title">個人賞受賞歴</div>
              <ul className="player-awards-list">
                {playerAwardList.map((a, i) => (
                  <li key={i}>
                    {a.season} {a.name}
                    {a.category ? `(${a.category})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="player-header-radar">
          {radarData.length === 0 ? (
            <p className="empty-message">比較対象の選手がいません</p>
          ) : (
            <div className="radar-chart-wrapper">
              <ResponsiveContainer width="100%" height={280}>
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="label" tick={{ fill: "var(--muted)", fontSize: 12 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar
                    name={player.name}
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

      <div className="stat-grid player-header-stat-grid">
        {TILE_STAT_DEFS.map((def) => (
          <StatTile
            key={def.key}
            label={def.label}
            value={def.format(player)}
            rank={players && players.length > 0 ? formatRank(rankAmong(player, players, def)) : undefined}
          />
        ))}
      </div>

      <div className="tab-bar">
        {(Object.keys(TAB_LABELS) as DetailTab[]).map((t) => (
          <button
            key={t}
            className={`tab-button${tab === t ? " active" : ""}`}
            onClick={() => setTab(t)}
            type="button"
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {tab === "stats" && (
        <>
          <h2>シーズン別成績</h2>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button
                key={g}
                className={g === gameTypeFilter ? "active" : ""}
                onClick={() => setGameTypeFilter(g)}
                type="button"
              >
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          <PeriodRangeToggle
            options={SEASON_BOX_PERIOD_OPTIONS}
            value={seasonBreakdownPeriod}
            onChange={setSeasonBreakdownPeriod}
          />
          {periodRawGamesLoading && seasonBreakdownPeriod !== "all" && (
            <p className="loading">この期間の再集計中...</p>
          )}
          <SeasonBreakdownTable
            careerData={careerData}
            gameTypeFilter={gameTypeFilter}
            teamData={careerTeamData}
            displayMode={seasonDisplayMode}
            onDisplayModeChange={setSeasonDisplayMode}
            playerId={player.playerId}
            period={seasonBreakdownPeriod}
            gamesByScheduleKey={periodRawGames}
            activeTab={seasonBreakdownTab}
            onTabChange={setSeasonBreakdownTab}
            careerShots={careerShots}
            careerShotsLoading={careerShotsLoading}
          />

          <h2>シチュエーション別成績</h2>
          <div className="mode-toggle">
            <select value={situationalStatsSeason} onChange={(e) => setSituationalStatsSeason(e.target.value)}>
              {[...(careerData ?? [])]
                .map((cd) => cd.season)
                .reverse()
                .map((s) => (
                  <option key={s} value={s}>
                    {s}シーズン
                  </option>
                ))}
            </select>
          </div>
          <div className="mode-toggle">
            {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
              <button
                key={g}
                className={g === situationalStatsGameType ? "active" : ""}
                onClick={() => setSituationalStatsGameType(g)}
                type="button"
              >
                {SEASON_GAME_TYPE_LABELS[g]}
              </button>
            ))}
          </div>
          <PeriodRangeToggle
            options={SEASON_BOX_PERIOD_OPTIONS}
            value={situationalStatsPeriod}
            onChange={setSituationalStatsPeriod}
          />
          {periodRawGamesLoading && situationalStatsPeriod !== "all" && (
            <p className="loading">この期間の再集計中...</p>
          )}
          <div className="tab-bar-with-toggle">
            <div className="tab-bar">
              {SEASON_BOX_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-button${situationalStatsTab === t.key ? " active" : ""}`}
                  onClick={() => setSituationalStatsTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
              <button
                className={`tab-button${situationalStatsTab === "shooting" ? " active" : ""}`}
                onClick={() => setSituationalStatsTab("shooting")}
                title={SHOOTING_TAB_TOOLTIP}
                type="button"
              >
                シューティング
              </button>
            </div>
            <div className="mode-toggle">
              {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
                <button
                  key={m}
                  className={m === situationalStatsDisplayMode ? "active" : ""}
                  onClick={() => setSituationalStatsDisplayMode(m)}
                  type="button"
                >
                  {SEASON_DISPLAY_MODE_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
          {!careerData ? (
            <p className="loading">読み込み中...</p>
          ) : situationalStatsTab === "shooting" && careerShotsLoading ? (
            <p className="loading">読み込み中...</p>
          ) : situationalStatsGroups.length === 0 ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : situationalStatsTab === "shooting" && situationalStatsShotTypeKeys.length === 0 ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table situational-groups-table">
                <thead>
                  <tr>
                    <th
                      className="align-left sortable-col"
                      onClick={() => handleSituationalStatsHeaderClick("label")}
                      aria-sort={situationalStatsSortAria("label")}
                    >
                      区分{situationalStatsSortIndicator("label")}
                    </th>
                    <th
                      className="align-left sortable-col"
                      onClick={() => handleSituationalStatsHeaderClick("team")}
                      aria-sort={situationalStatsSortAria("team")}
                    >
                      チーム{situationalStatsSortIndicator("team")}
                    </th>
                    {(situationalStatsTab === "shooting" ? situationalStatsShotColumns : SEASON_BOX_COLUMNS[situationalStatsTab]).map(
                      (col) => (
                        <th
                          key={col.key}
                          className="align-right sortable-col"
                          title={"description" in col ? col.description : undefined}
                          onClick={() => handleSituationalStatsHeaderClick(col.key)}
                          aria-sort={situationalStatsSortAria(col.key)}
                        >
                          {col.label}
                          {situationalStatsSortIndicator(col.key)}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {situationalStatsGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td
                          colSpan={
                            (situationalStatsTab === "shooting" ? situationalStatsShotColumns : SEASON_BOX_COLUMNS[situationalStatsTab])
                              .length + 2
                          }
                        >
                          {group.label}
                        </td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key} className={row.isCombined ? "season-team-total-row" : undefined}>
                          <td className="align-left">{row.label}</td>
                          <td className="align-left">
                            {row.teamId ? (
                              <RouterLink to={`/teams/${row.teamId}?season=${situationalStatsSeason}`} className="cell-link">
                                {row.teamLabel}
                              </RouterLink>
                            ) : (
                              row.teamLabel
                            )}
                          </td>
                          {situationalStatsTab === "shooting"
                            ? situationalStatsShotColumns.map((col) => (
                                <td key={col.key} className="align-right">
                                  {col.format!(row)}
                                </td>
                              ))
                            : SEASON_BOX_COLUMNS[situationalStatsTab].map((col) => (
                                <td key={col.key} className="align-right">
                                  {col.format(row.ctx, situationalStatsDisplayMode)}
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
              onClick={() => setSituationalGroupsLegendExpanded((v) => !v)}
            >
              {situationalGroupsLegendExpanded ? "▼ " : "▶ "}
              説明
            </h3>
            {situationalGroupsLegendExpanded && (
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

          <h2
            className={shotChartSupported ? "collapsible-heading" : undefined}
            onClick={shotChartSupported ? () => setSeasonShotChartExpanded((v) => !v) : undefined}
          >
            {shotChartSupported ? (seasonShotChartExpanded ? "▼ " : "▶ ") : ""}
            ショットチャート
          </h2>
          {!shotChartSupported ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : !seasonShotChartExpanded ? null : seasonShotChartLoading || !seasonShotGameData ? (
            <p className="loading">読み込み中...</p>
          ) : (
            <>
              <ShotChartFilterPicker
                filters={shotChartFilters}
                onChange={setShotChartFilters}
                opponentWinRateSupported={!!shotChartGameSummaries}
                teamOptions={shotChartTeamOptions}
              />
              <PeriodRangeToggle
                options={SEASON_SHOT_CHART_PERIOD_OPTIONS}
                value={shotChartPeriod}
                onChange={setShotChartPeriod}
              />
              <div className="shot-chart-grid shot-chart-grid-single">
                <ShotChartPanel
                  teamName={player.name}
                  players={[]}
                  shots={filteredSeasonShotEvents}
                  color={accentColor ?? "var(--accent)"}
                  accentColor={accentColor}
                  showPlayerSelector={false}
                />
              </div>
              <p className="page-subtitle">
                選手が出場した各試合の生データ（GeniusAPI由来のショット座標）をシーズン合計したもの。試合詳細ページのショットチャートと同じ形式で、個別ショット/エリア別成功率を切り替えられる（2022-23シーズン以降のみ対応。DESIGN.md参照）。上の「シーズン別成績」のレギュラー/プレーオフ/合算トグルに連動する。フィルタ・Q別トグルは複数選択でき、選択した条件をすべて満たす試合・ショットに絞り込む。既定は全チーム合算表示で、同一シーズンに複数チームでプレーした場合のみチーム別ボタンが表示される
              </p>
            </>
          )}
        </>
      )}

      {tab === "gamelog" &&
        (logsLoading ? (
          <p className="loading">読み込み中...</p>
        ) : !gameLogs || gameLogs.length === 0 ? (
          <p className="empty-message">試合ログがありません</p>
        ) : (
          <>
            <div className="tab-bar">
              {BOXSCORE_TABS.map((t) => (
                <button
                  key={t.key}
                  className={`tab-button${gameBoxTab === t.key ? " active" : ""}`}
                  onClick={() => setGameBoxTab(t.key)}
                  type="button"
                >
                  {t.label}
                </button>
              ))}
            </div>
            {gameBoxLoading || !gameBoxRows ? (
              <p className="loading">読み込み中...</p>
            ) : (
              <div className="table-scroll">
                <SortableTable
                  key={gameBoxTab}
                  columns={toGameLogColumns(gameBoxTab)}
                  rows={gameBoxRows}
                  rowKey={(r) => r.gameLog.scheduleKey}
                  defaultSortKey="date"
                  linkTo={(r) => `/games/${r.gameLog.scheduleKey}`}
                />
              </div>
            )}
          </>
        ))}

      {tab === "career" && (
        <>
          <div className="mode-toggle">
            {CAREER_CATEGORY_OPTIONS.map((c) => (
              <button
                key={c}
                className={c === careerCategory ? "active" : ""}
                onClick={() => setCareerCategory(c)}
                type="button"
              >
                {CAREER_CATEGORY_LABELS[c]}
              </button>
            ))}
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
          {(careerCategory === "one" ? careerOneLoading : careerLoading) ? (
            <p className="loading">読み込み中...</p>
          ) : careerCategory === "premier" && careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerCountTotals ? (
            <p className="empty-message">
              {careerCategory === "one" ? "この選手のB.ONEでの出場歴はありません" : "通算成績がありません"}
            </p>
          ) : (
            <div className="stat-grid">
              <StatTile label="PTS" value={formatDecimal(careerCountTotals.pts, 0)} />
              <StatTile label="FG成功数" value={formatDecimal(careerCountTotals.fgm, 0)} />
              <StatTile label="3PT成功数" value={formatDecimal(careerCountTotals.tpm, 0)} />
              <StatTile label="2PT成功数" value={formatDecimal(careerCountTotals.twoPm, 0)} />
              <StatTile label="FT成功数" value={formatDecimal(careerCountTotals.ftm, 0)} />
              <StatTile label="AST" value={formatDecimal(careerCountTotals.ast, 0)} />
              <StatTile label="REB" value={formatDecimal(careerCountTotals.reb, 0)} />
              <StatTile label="BLK" value={formatDecimal(careerCountTotals.blk, 0)} />
              <StatTile label="STL" value={formatDecimal(careerCountTotals.stl, 0)} />
              <StatTile label="試合数" value={String(careerCountTotals.gamesPlayed)} />
              <StatTile label="出場時間" value={formatMinutesFromSeconds(careerCountTotals.minSeconds)} />
              <StatTile label="DD数" value={String(careerCountTotals.dd)} />
              <StatTile label="TD数" value={String(careerCountTotals.td)} />
              <StatTile label="OR" value={formatDecimal(careerCountTotals.oreb, 0)} />
              <StatTile label="DR" value={formatDecimal(careerCountTotals.dreb, 0)} />
              <StatTile label="F" value={formatDecimal(careerCountTotals.pf, 0)} />
              <StatTile label="FD" value={formatDecimal(careerCountTotals.foulsDrawn, 0)} />
              <StatTile label="PITP" value={formatDecimal(careerCountTotals.pt2in, 0)} />
              <StatTile label="FBPS" value={formatDecimal(careerCountTotals.ptfb, 0)} />
              <StatTile label="2ND PTS" value={formatDecimal(careerCountTotals.pt2nd, 0)} />
              <StatTile label="PTSOFFTO" value={formatDecimal(careerCountTotals.ptsOffTov, 0)} />
              <StatTile label="DUNK" value={formatDecimal(careerCountTotals.dunks, 0)} />
              <StatTile label="AND1" value={formatDecimal(careerCountTotals.basketCounts, 0)} />
              <StatTile label="UFOUL" value={formatDecimal(careerCountTotals.unsportsmanlikeFouls, 0)} />
            </div>
          )}
        </>
      )}

      {tab === "highs" && (
        <>
          <div className="mode-toggle">
            {CAREER_CATEGORY_OPTIONS.map((c) => (
              <button key={c} className={c === careerCategory ? "active" : ""} onClick={() => setCareerCategory(c)} type="button">
                {CAREER_CATEGORY_LABELS[c]}
              </button>
            ))}
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
          {(careerCategory === "one" ? careerOneLoading : careerLoading) ? (
            <p className="loading">読み込み中...</p>
          ) : careerCategory === "premier" && careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerCountTotalsSource || (careerHighs.length === 0 && !careerTotal) ? (
            <p className="empty-message">
              {careerCategory === "one" ? "この選手のB.ONEでの出場歴はありません" : "キャリアハイのデータがありません"}
            </p>
          ) : (
            <>
              <h3 className="career-highs-subheading">キャリアハイ</h3>
              <div className="career-highs-grid">
                {careerHighs.map((h) => (
                  <CareerHighCard
                    key={h.key}
                    tieKey={`high:${h.key}`}
                    label={h.label}
                    display={h.display}
                    game={h.game}
                    otherGames={h.otherGames}
                    expandedKeys={expandedCareerTieCards}
                    onToggle={toggleCareerTieCard}
                  />
                ))}
                {careerTotal && (
                  <>
                    <div className="career-high-card" key="dd2">
                      <div className="career-high-label">ダブルダブル達成数</div>
                      <div className="career-high-value">{careerTotal.ddtd.dd}</div>
                    </div>
                    <div className="career-high-card" key="td3">
                      <div className="career-high-label">トリプルダブル達成数</div>
                      <div className="career-high-value">{careerTotal.ddtd.td}</div>
                    </div>
                  </>
                )}
              </div>
              <h3 className="career-highs-subheading">キャリアワースト</h3>
              <div className="career-highs-grid">
                {careerWorsts.map((h) => (
                  <CareerHighCard
                    key={h.key}
                    tieKey={`worst:${h.key}`}
                    label={h.label}
                    display={h.display}
                    game={h.game}
                    otherGames={h.otherGames}
                    expandedKeys={expandedCareerTieCards}
                    onToggle={toggleCareerTieCard}
                  />
                ))}
              </div>
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
                        const next: [CompareSlotState, CompareSlotState] = [...prev];
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
                          const next: [CompareSlotState, CompareSlotState] = [...prev];
                          next[i] = { ...next[i], filter: f };
                          return next;
                        })
                      }
                      seasonHalfBoundary={compareBoundaries[i]}
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
          <div className="tab-bar">
            {SEASON_BOX_TABS.map((t) => (
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
          {careerLoading ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : (
            <ComparisonTable
              rows={compareRows}
              defs={seasonBoxCompareDefs(compareTab)}
              rowKey={(r) => r.key}
              name={(r) => r.label}
              linkTo={() => `/players/${player.playerId}`}
            />
          )}
        </>
      )}
    </div>
  );
}

/**
 * シーズンごとの内訳（レギュラー/プレーオフ/合算トグル込み）を表示するテーブル。
 * 「シーズン成績」（当該シーズン単体のボックススコア）で使っていたのと同じ
 * トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブをこちらに統合し、
 * 「シーズン成績」セクション自体は削除した（47章・49章で指摘した「片方にしかカテゴリ
 * 切り替えが無い」食い違いの解消。DESIGN.md参照）。表示モードは平均/合計を選べる
 * （当初は「平均」固定だったが、切り替えられるようにする要望を受けて解除した）。
 * DD2/TD3のみ列定義に無いため、末尾に独自の列として追加する。
 */
function SeasonBreakdownTable({
  careerData,
  gameTypeFilter,
  teamData,
  displayMode,
  onDisplayModeChange,
  playerId,
  period,
  gamesByScheduleKey,
  activeTab: controlledActiveTab,
  onTabChange,
  careerShots,
  careerShotsLoading,
}: {
  careerData: CareerSeasonLogs[] | null;
  gameTypeFilter: SeasonGameTypeFilter;
  teamData: Map<string, CareerSeasonTeamInfo> | null;
  displayMode: SeasonDisplayMode;
  onDisplayModeChange: (m: SeasonDisplayMode) => void;
  playerId: string;
  period: PeriodRangeValue;
  gamesByScheduleKey: Map<string, StoredGame>;
  /**
   * カテゴリタブ（シューティングを含む）を外部から制御する場合に指定する（試合詳細ページの
   * BoxscoreTable.tsxのactiveTab/onTabChangeと同じパターン。DESIGN.md参照）。未指定なら
   * コンポーネント内部のstateでタブを管理する
   */
  activeTab?: SeasonBoxTabKey | "shooting";
  onTabChange?: (tab: SeasonBoxTabKey | "shooting") => void;
  /** シューティングタブ用: scheduleKeyごとのこの選手のショット（Yahoo PBP対応シーズンのみ） */
  careerShots: Map<string, YahooShotEvent[]>;
  careerShotsLoading: boolean;
}) {
  const [internalTab, setInternalTab] = useState<SeasonBoxTabKey | "shooting">("traditional");
  const tab = controlledActiveTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;
  // 列ヘッダークリックソート（RankingsPage等のSortableTableと同じ「1回目クリックで降順、
  // もう一度クリックで昇順」の切り替え方式を踏襲。DESIGN.md参照）。未選択（null）時は
  // 元の並び順（シーズン降順）のまま。「通算」行は常に最下部に固定し、ソート対象に含めない
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const playedFilteredLogs = (logs: PlayerGameLog[]) => filterByGameType(logs.filter((g) => g.min > 0), gameTypeFilter);
  const periodOption = SEASON_BOX_PERIOD_OPTIONS.find((o) => o.value === period);

  // シーズン内移籍対応: 所属チームごとにbuildTeamSplitRowsForPeriodで分割する（1チームのみなら
  // 1行、複数チームにまたがる場合はチーム別の行＋「複数チーム」の合計行）。「試合」選択時は
  // 追加取得不要の既存ロジックにそのまま委譲し、Q別/前後半選択時のみgamesByScheduleKeyの
  // 生データから再集計する（DESIGN.md参照）。通算（total）の集計対象はisCombinedがtrueの行、
  // または単一チームの行のみ（countsTowardTotal）にし、チーム別の内訳行を二重に足し込まないようにする
  const seasonRows = useMemo(() => {
    if (!careerData) return [];
    const rows: (TeamSplitRow & { season: string; ddtd: { dd: number; td: number }; countsTowardTotal: boolean })[] = [];
    for (const cd of [...careerData].reverse()) {
      const played = playedFilteredLogs(cd.logs);
      if (played.length === 0) continue;
      const info = teamData?.get(cd.season);
      const seasonStartYear = Number(cd.season.split("-")[0]);
      const splitRows = buildTeamSplitRowsForPeriod(
        cd.season,
        played,
        info?.ownTeamByScheduleKey ?? new Map(),
        info?.teamTotalsByTeamId ?? new Map(),
        displayMode,
        seasonStartYear,
        playerId,
        periodOption,
        gamesByScheduleKey,
      );
      for (const row of splitRows) {
        rows.push({
          ...row,
          season: cd.season,
          ddtd: countDoubleTripleDoubles(row.logs),
          countsTowardTotal: row.isCombined || splitRows.length === 1,
        });
      }
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerData, gameTypeFilter, teamData, displayMode, playerId, periodOption, gamesByScheduleKey]);

  // 通算行のEFFは、複数シーズンの生カウント値を先に合算してから1回だけeff()を呼ぶと
  // 年度で異なる計算式（DESIGN.md参照）を誤って混在適用してしまうため、シーズンごとに
  // 正しい式で算出した合計EFFをここで合算してから、表示モードに応じた係数（modeFactor、
  // 平均/合計とも同じ考え方）をかける（seasonTotalEff参照）。通算行のraw合計は、「試合」選択時は
  // 既存のsumPlayerGameLogs（永続集計）、Q別/前後半選択時は全シーズンの出場試合の生データから
  // 再集計したbuildPeriodFilteredRawTotalsを使う（seasonRows自体が既にどちらの方式でも
  // 期間フィルタ反映済みのため、EFF合算部分はperiod分岐不要でそのまま動く）
  const total = useMemo(() => {
    if (!careerData || seasonRows.length === 0) return null;
    const allPlayed = careerData.flatMap((cd) => playedFilteredLogs(cd.logs));
    if (allPlayed.length === 0) return null;
    const totalRows = seasonRows.filter((r) => r.countsTowardTotal);
    const totalTeam = totalRows.reduce((acc, r) => sumTeamSeasonTotals(acc, r.ctx.team), EMPTY_TEAM_TOTALS);
    const latestSeasonStartYear = Math.max(...seasonRows.map((r) => r.ctx.seasonStartYear));

    const totalRaw = !periodOption || periodOption.periods === null
      ? sumPlayerGameLogs(allPlayed)
      : buildPeriodFilteredRawTotals(
          allPlayed
            .map((log) => {
              const game = gamesByScheduleKey.get(log.scheduleKey);
              return game ? computeGamePeriodTotals(game, log.isHome, playerId, periodOption) : null;
            })
            .filter((c): c is GamePeriodTotals => c !== null),
        ).raw;
    if (totalRaw.gamesPlayed === 0) return null;
    const ctx = buildSeasonBoxscoreCtx(totalRaw, totalTeam, displayMode, latestSeasonStartYear);
    const totalEffSum = totalRows.reduce((sum, r) => sum + seasonTotalEff(r.ctx.raw, r.ctx.seasonStartYear), 0);
    return {
      ctx,
      ddtd: countDoubleTripleDoubles(allPlayed),
      effValue: totalEffSum * modeFactor(totalRaw, displayMode),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerData, gameTypeFilter, seasonRows, displayMode, playerId, periodOption, gamesByScheduleKey]);

  const columns = tab === "shooting" ? [] : SEASON_BOX_COLUMNS[tab];

  // シューティングタブ: 各行（シーズン・チーム別内訳）に属する試合ログのscheduleKeyから
  // careerShotsを引いてShotTypeBreakdownを組み立てる。列（シュートタイプ×2P/3P×M/A/%）は
  // 全行（通算行込み）を横断したシュートタイプの和集合から作る
  const seasonShotBreakdownByKey = useMemo(() => {
    if (tab !== "shooting") return new Map<string, ShotTypeBreakdown>();
    const map = new Map<string, ShotTypeBreakdown>();
    for (const r of seasonRows) {
      map.set(r.key, buildShotTypeBreakdown(r.logs.flatMap((l) => careerShots.get(l.scheduleKey) ?? [])));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasonRows, careerShots]);
  const seasonTotalShotBreakdown = useMemo(() => {
    if (tab !== "shooting") return {};
    const totalRows = seasonRows.filter((r) => r.countsTowardTotal);
    return buildShotTypeBreakdown(totalRows.flatMap((r) => r.logs.flatMap((l) => careerShots.get(l.scheduleKey) ?? [])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, seasonRows, careerShots]);
  const seasonTotalShotGamesPlayed = seasonRows.filter((r) => r.countsTowardTotal).reduce((sum, r) => sum + r.ctx.raw.gamesPlayed, 0);
  const seasonShotTypeKeys = useMemo(
    () =>
      sortShotTypeKeys([
        ...new Set([...seasonShotBreakdownByKey.values(), seasonTotalShotBreakdown].flatMap((b) => Object.keys(b))),
      ]),
    [seasonShotBreakdownByKey, seasonTotalShotBreakdown],
  );
  const seasonShotColumns = shotTypeEntityColumns<{ breakdown?: ShotTypeBreakdown; gamesPlayed?: number }>(
    seasonShotTypeKeys,
    (r) => r.breakdown,
    displayMode === "total" ? "total" : "perGame",
    (r) => r.gamesPlayed ?? 0,
  );

  const seasonRowSortValue = (r: (typeof seasonRows)[number], key: string): number | string => {
    switch (key) {
      case "season":
        return r.season;
      case "team":
        return r.teamLabel;
      case "dd2":
        return r.ddtd.dd;
      case "td3":
        return r.ddtd.td;
      default: {
        if (tab === "shooting") {
          const col = seasonShotColumns.find((c) => c.key === key);
          return col ? col.sortValue({ breakdown: seasonShotBreakdownByKey.get(r.key), gamesPlayed: r.ctx.raw.gamesPlayed }) : 0;
        }
        const col = columns.find((c) => c.key === key);
        return col ? col.value(r.ctx, displayMode) : 0;
      }
    }
  };

  const sortedSeasonRows = useMemo(() => {
    if (!sortKey) return seasonRows;
    const factor = sortDir === "asc" ? 1 : -1;
    return [...seasonRows].sort((a, b) => {
      const av = seasonRowSortValue(a, sortKey);
      const bv = seasonRowSortValue(b, sortKey);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv)) * factor;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seasonRows, sortKey, sortDir, columns, displayMode, tab, seasonShotColumns, seasonShotBreakdownByKey]);

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

  if (!careerData || seasonRows.length === 0) {
    return <p className="empty-message">通算成績がありません</p>;
  }

  const tabBar = (
    <div className="tab-bar-with-toggle">
      <div className="tab-bar">
        {SEASON_BOX_TABS.map((t) => (
          <button key={t.key} className={`tab-button${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)} type="button">
            {t.label}
          </button>
        ))}
        <button
          className={`tab-button${tab === "shooting" ? " active" : ""}`}
          onClick={() => setTab("shooting")}
          title={SHOOTING_TAB_TOOLTIP}
          type="button"
        >
          シューティング
        </button>
      </div>
      <div className="mode-toggle">
        {DISPLAY_MODE_TOGGLE_OPTIONS.map((m) => (
          <button key={m} className={m === displayMode ? "active" : ""} onClick={() => onDisplayModeChange(m)} type="button">
            {SEASON_DISPLAY_MODE_LABELS[m]}
          </button>
        ))}
      </div>
    </div>
  );

  if (tab === "shooting" && careerShotsLoading) {
    return (
      <>
        {tabBar}
        <p className="loading">読み込み中...</p>
      </>
    );
  }
  if (tab === "shooting" && seasonShotTypeKeys.length === 0) {
    return (
      <>
        {tabBar}
        <p className="empty-message">このシーズンのデータには対応していません</p>
      </>
    );
  }

  return (
    <>
      {tabBar}
      <div className="table-scroll">
        <table className="stats-table">
          <thead>
            <tr>
              <th className="align-left sortable-col" onClick={() => handleHeaderClick("season")} aria-sort={sortAria("season")}>
                シーズン{sortIndicator("season")}
              </th>
              <th className="align-left sortable-col" onClick={() => handleHeaderClick("team")} aria-sort={sortAria("team")}>
                チーム{sortIndicator("team")}
              </th>
              {(tab === "shooting" ? seasonShotColumns : columns).map((col) => (
                <th
                  key={col.key}
                  className="align-right sortable-col"
                  title={"description" in col ? col.description : undefined}
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
            {sortedSeasonRows.map((r) => (
              <tr key={r.key} className={r.isCombined ? "season-team-total-row" : undefined}>
                <td className="align-left">{r.season}</td>
                <td className="align-left">
                  {r.teamId ? (
                    <RouterLink to={`/teams/${r.teamId}?season=${r.season}`} className="cell-link">
                      {r.teamLabel}
                    </RouterLink>
                  ) : (
                    r.teamLabel
                  )}
                </td>
                {tab === "shooting"
                  ? seasonShotColumns.map((col) => (
                      <td key={col.key} className="align-right">
                        {col.format!({ breakdown: seasonShotBreakdownByKey.get(r.key), gamesPlayed: r.ctx.raw.gamesPlayed })}
                      </td>
                    ))
                  : columns.map((col) => (
                      <td key={col.key} className="align-right">
                        {col.format(r.ctx, displayMode)}
                      </td>
                    ))}
                <td className="align-right">{r.ddtd.dd}</td>
                <td className="align-right">{r.ddtd.td}</td>
              </tr>
            ))}
            {total && (
              <tr className="career-total-row">
                <td className="align-left">通算</td>
                <td className="align-left" />
                {tab === "shooting"
                  ? seasonShotColumns.map((col) => (
                      <td key={col.key} className="align-right">
                        {col.format!({ breakdown: seasonTotalShotBreakdown, gamesPlayed: seasonTotalShotGamesPlayed })}
                      </td>
                    ))
                  : columns.map((col) => (
                      <td key={col.key} className="align-right">
                        {col.key === "eff"
                          ? formatDecimal(total.effValue, countDigits(displayMode))
                          : col.format(total.ctx, displayMode)}
                      </td>
                    ))}
                <td className="align-right">{total.ddtd.dd}</td>
                <td className="align-right">{total.ddtd.td}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function ProfileItem({ label, value }: { label: string; value: string }) {
  return (
    <span className="profile-item">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
    </span>
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
 * キャリアハイ/ワーストの1項目カード。同値の試合が複数ある場合、代表試合（最新）を主表示にし、
 * 残りは「他◯試合」ボタンで展開できるようにする（日付・対戦カードの一覧、各試合は試合詳細へリンク）
 */
function CareerHighCard({
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
  game: CareerHighGame;
  otherGames: CareerHighGame[];
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
