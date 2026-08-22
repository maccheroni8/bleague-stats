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
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type { PlayerGameLog, PlayerSummary } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { BOXSCORE_TABS, type BoxscoreColumn, type BoxscoreTabKey, COLUMNS_BY_TAB } from "../components/BoxscoreTable";
import { buildPlayerGameBoxscoreRow, type PlayerGameBoxscoreRow } from "../lib/playerGameBoxscore";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatShotTypeCell, sortShotTypeKeys, sumShotTypeCounts } from "../lib/shotTypeBreakdown";
import { ShotChartPanel } from "../components/ShotChart";
import { buildShotEvents, type ShotEvent } from "../lib/shotChart";
import { ShotChartFilterPicker } from "../components/ShotChartFilterPicker";
import { PeriodRangeToggle } from "../components/PeriodRangeToggle";
import { periodInRange, type PeriodRangeOption, type PeriodRangeValue } from "../lib/periodRange";
import { filterPlayersByGamesPlayedRatio } from "../lib/statDefs";
import { safeDiv } from "../../shared/formulas";
import {
  SEASON_ADVANCED_COLUMNS,
  SEASON_GAME_TYPE_LABELS,
  SEASON_MISC_COLUMNS,
  SEASON_SCORING_COLUMNS,
  SEASON_TRADITIONAL_COLUMNS,
  buildSeasonBoxscoreCtx,
  filterByGameType,
  seasonTotalEff,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type SeasonGameTypeFilter,
  type TeamSeasonRawTotals,
} from "../lib/playerSeasonBoxscore";
import {
  buildBackToBackStatus,
  buildRecordsBeforeGame,
  computePlayerSituationalStats,
  computeSeasonHalfBoundary,
  filterGameLogs,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  matchesShotChartGameFilters,
  type PlayerSituationalStats,
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

type SeasonBoxTabKey = "traditional" | "advanced" | "misc" | "scoring";

const SEASON_BOX_TABS: { key: SeasonBoxTabKey; label: string }[] = [
  { key: "traditional", label: "トラディショナル" },
  { key: "advanced", label: "アドバンスド" },
  { key: "misc", label: "Misc" },
  { key: "scoring", label: "スコアリング" },
];

const SEASON_BOX_COLUMNS: Record<SeasonBoxTabKey, SeasonBoxscoreColumn[]> = {
  traditional: SEASON_TRADITIONAL_COLUMNS,
  advanced: SEASON_ADVANCED_COLUMNS,
  misc: SEASON_MISC_COLUMNS,
  scoring: SEASON_SCORING_COLUMNS,
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

// レーダーチャート用の10項目（MIN/PTS/REB/AST/STL/BLK/TOV/3P%/2P%/FT%）。TILE_STAT_DEFSの
// 定義済みaccessorをそのまま流用し、二重定義を避ける
const RADAR_STAT_KEYS = ["min", "pts", "reb", "ast", "stl", "blk", "tov", "tpPct", "pt2Pct", "ftPct"];
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
}

interface CareerHighDef {
  key: string;
  label: string;
  value: (g: PlayerGameLog) => number;
}

const CAREER_HIGH_STATS: CareerHighDef[] = [
  { key: "pts", label: "PTS", value: (g) => g.pts },
  { key: "reb", label: "REB", value: (g) => g.reb },
  { key: "ast", label: "AST", value: (g) => g.ast },
  { key: "stl", label: "STL", value: (g) => g.stl },
  { key: "blk", label: "BLK", value: (g) => g.blk },
  { key: "tpm", label: "3P成功数", value: (g) => g.tpm },
  { key: "technicalFouls", label: "テクニカルファウル数", value: (g) => g.technicalFouls },
];

/**
 * ダブルダブル/トリプルダブル判定（scripts/aggregate.tsのprocessPlayers()・
 * src/lib/boxscoreAggregate.tsのcomputeStatBadge()と同じ閾値: PTS/REB/AST/STL/BLKのうち
 * 2桁到達部門数が2以上でDD、3以上でTD）。トリプルダブルはダブルダブルの条件も満たすため、
 * aggregate.tsの季集計と同じくDD側にも計上する（バッジ表示のような排他処理はしない）
 */
function countDoubleTripleDoubles(logs: PlayerGameLog[]): { dd: number; td: number } {
  let dd = 0;
  let td = 0;
  for (const g of logs) {
    const doubleDigitCount = [g.pts, g.reb, g.ast, g.stl, g.blk].filter((v) => v >= 10).length;
    if (doubleDigitCount >= 2) dd += 1;
    if (doubleDigitCount >= 3) td += 1;
  }
  return { dd, td };
}

interface CompareSlotState {
  season: string;
  filter: SituationalFilter;
}

function defaultCompareSlots(season: string): [CompareSlotState, CompareSlotState] {
  return [
    { season, filter: { kind: "all" } },
    { season: "", filter: { kind: "all" } },
  ];
}

/**
 * シチュエーション別フィルタの選択内容を、比較表の列見出しに出す短い日本語ラベルに変換する。
 * 前半戦/後半戦は内部的には「期間指定」（dateRange）として保持されている（situational.ts参照）ため、
 * 境界日と一致するかどうかで判定し直す（SituationalFilterPickerのactive判定と同じロジック）
 */
function describeSituationalFilter(filter: SituationalFilter, boundary: SeasonHalfBoundary | null): string {
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
      if (boundary && filter.start === "" && filter.end === boundary.firstHalfEnd) base = "前半戦";
      else if (boundary && filter.start === boundary.secondHalfStart && filter.end === "") base = "後半戦";
      else if (!filter.start && !filter.end) base = "期間指定";
      else base = `${filter.start || "…"}〜${filter.end || "…"}`;
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

interface CompareColumnData {
  key: string;
  label: string;
  stats: PlayerSituationalStats;
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
  ctx: SeasonBoxscoreCtx;
}
interface SituationalStatsGroup {
  key: string;
  label: string;
  rows: SituationalStatsRow[];
}

// 「スタッツ」タブのstat-gridと同じ13項目＋試合数。シチュエーション別フィルタの結果
// （PlayerSituationalStats）はEFF・USG%等のシーズン集計限定の項目を持たないため、
// PLAYER_STAT_DEFSではなくこの専用の最小限のdefsを使う
const COMPARE_STAT_DEFS: ComparisonStatDef<CompareColumnData>[] = [
  { key: "gamesPlayed", label: "試合数", value: (r) => r.stats.gamesPlayed, format: (r) => String(r.stats.gamesPlayed) },
  { key: "min", label: "MIN", value: (r) => r.stats.perGame.min, format: (r) => formatDecimal(r.stats.perGame.min) },
  { key: "pts", label: "PTS", value: (r) => r.stats.perGame.pts, format: (r) => formatDecimal(r.stats.perGame.pts) },
  { key: "reb", label: "REB", value: (r) => r.stats.perGame.reb, format: (r) => formatDecimal(r.stats.perGame.reb) },
  { key: "ast", label: "AST", value: (r) => r.stats.perGame.ast, format: (r) => formatDecimal(r.stats.perGame.ast) },
  { key: "stl", label: "STL", value: (r) => r.stats.perGame.stl, format: (r) => formatDecimal(r.stats.perGame.stl) },
  { key: "blk", label: "BLK", value: (r) => r.stats.perGame.blk, format: (r) => formatDecimal(r.stats.perGame.blk) },
  {
    key: "tov",
    label: "TOV",
    value: (r) => r.stats.perGame.tov,
    format: (r) => formatDecimal(r.stats.perGame.tov),
    higherIsBetter: false,
  },
  {
    key: "plusMinus",
    label: "+/-",
    value: (r) => r.stats.perGame.plusMinus,
    format: (r) => formatSigned(r.stats.perGame.plusMinus),
  },
  { key: "fgPct", label: "FG%", value: (r) => r.stats.shooting.fgPct, format: (r) => formatPct(r.stats.shooting.fgPct) },
  { key: "tpPct", label: "3P%", value: (r) => r.stats.shooting.tpPct, format: (r) => formatPct(r.stats.shooting.tpPct) },
  { key: "ftPct", label: "FT%", value: (r) => r.stats.shooting.ftPct, format: (r) => formatPct(r.stats.shooting.ftPct) },
  {
    key: "efgPct",
    label: "eFG%",
    value: (r) => r.stats.shooting.efgPct,
    format: (r) => formatPct(r.stats.shooting.efgPct),
  },
  { key: "tsPct", label: "TS%", value: (r) => r.stats.shooting.tsPct, format: (r) => formatPct(r.stats.shooting.tsPct) },
];

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

const SHOOTING_SECTION_TOOLTIP =
  "Yahoo!スポーツplay-by-play由来のシュートタイプ別成功/試投（シーズン合計、2023-24シーズン以降・レギュラーシーズンのみ。DESIGN.md参照）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「ジャンプショット」に一括りになっている点に注意";

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
  const { coverage } = useSeasonCoverage(season);
  const shotChartSupported = isShotChartSupported(coverage);
  const { supported: yahooSeasonSupported } = useYahooPbpCoverage(season);

  const [gameTypeFilter, setGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");

  const [tab, setTab] = useState<DetailTab>("stats");
  const [careerData, setCareerData] = useState<CareerSeasonLogs[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);
  // 「シーズン別成績」テーブルのカテゴリタブ（トラディショナル/アドバンスド/Misc/スコアリング）用に、
  // careerData全シーズン分のチーム総計（USG%・%-shareスタッツの分母）をシーズンごとに取得する。
  // 選手の所属チームはシーズンごとに異なりうるため、まずfetchPlayers(season)でteamIdを解決してから
  // fetchTeamGameLogsを呼ぶ（ページ本体の現在シーズン用playerTeamId解決と同じパターンをシーズン数分
  // 繰り返す）
  const [careerTeamTotals, setCareerTeamTotals] = useState<Map<string, TeamSeasonRawTotals> | null>(null);
  const careerTeamTotalsFetchStartedRef = useRef(false);
  // 通算成績・キャリアハイ両タブで共有するレギュラー/プレーオフ/合算トグル（既存のgameType軸を再利用）
  const [careerGameTypeFilter, setCareerGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");

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

  // 「スタッツ」タブの「シチュエーション別成績」セクション: 独立したシーズン選択・
  // レギュラー/プレーオフ/合算トグル・ボックススコアのカテゴリタブを持つ
  // （ページ本体の現在シーズンとは別のシーズンを選べるため、上のシーズン成績/シーズン別成績とは
  // 独立させている）。デフォルトは現在選択中のシーズン
  const [situationalStatsSeason, setSituationalStatsSeason] = useState(season);
  const [situationalStatsGameType, setSituationalStatsGameType] = useState<SeasonGameTypeFilter>("regular");
  const [situationalStatsTab, setSituationalStatsTab] = useState<SeasonBoxTabKey>("traditional");

  // 「シューティング」セクション: シチュエーション別成績と同様、ページ本体の現在シーズンとは
  // 独立したシーズン選択を持つ（Yahoo PBP由来のシュートタイプ内訳はplayers.jsonにシーズン単位で
  // 保存済みのため、選択したシーズンのplayers.jsonを取得するだけで済む）。デフォルトは
  // 現在選択中のシーズン
  const [shootingSeason, setShootingSeason] = useState(season);

  // careerLoading/careerDataをdeps配列に含めると、setCareerLoading(true)自体がeffectを
  // 再発火させcleanupで直前のfetchをcancelしてしまう（自己キャンセルのループ）。
  // そのためfetch開始済みかどうかはstateではなくrefで管理する
  const careerFetchStartedRef = useRef(false);

  useEffect(() => {
    setTab("stats");
    setCareerData(null);
    setCareerError(null);
    careerFetchStartedRef.current = false;
    setCareerTeamTotals(null);
    careerTeamTotalsFetchStartedRef.current = false;
    setGameBoxRows(null);
    gameBoxFetchStartedRef.current = false;
    setSeasonShotChartExpanded(false);
    setSeasonShotGameData(null);
    seasonShotChartFetchStartedRef.current = false;
    setShotChartFilters({});
    setShotChartPeriod("all");
    setCompareSlots(defaultCompareSlots(season));
    setSituationalStatsSeason(season);
    setShootingSeason(season);
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

  const shotChartPeriodOption = SEASON_SHOT_CHART_PERIOD_OPTIONS.find((o) => o.value === shotChartPeriod);
  const filteredSeasonShotEvents = useMemo(() => {
    if (!seasonShotGameData) return [];
    return seasonShotGameData
      .filter(({ log }) => matchesShotChartGameFilters(log, shotChartFilters, shotChartOpponentRecords))
      .flatMap(({ shots }) => shots.filter((s) => periodInRange(shotChartPeriodOption, s.period)));
  }, [seasonShotGameData, shotChartFilters, shotChartOpponentRecords, shotChartPeriodOption]);

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

  // 「シーズン別成績」テーブルのUSG%・%-shareスタッツ用に、careerData取得済みの各シーズンについて
  // 選手の所属チームを解決してからチーム総計を取得する（careerData自体が揃うまで待つ必要があるため
  // 別effectに分離。careerFetchStartedRefと同じ「一度だけ・playerId変更時のみリセット」パターン）
  useEffect(() => {
    if (!careerData || careerTeamTotalsFetchStartedRef.current) return;
    careerTeamTotalsFetchStartedRef.current = true;
    Promise.all(
      careerData.map(async (cd) => {
        try {
          const seasonPlayers = await fetchPlayers(cd.season);
          const teamId = seasonPlayers.find((p) => p.playerId === playerId)?.teamId;
          if (!teamId) return null;
          const teamLogs = await fetchTeamGameLogs(cd.season, teamId);
          const scheduleKeys = new Set(cd.logs.filter((g) => g.min > 0).map((g) => g.scheduleKey));
          return [cd.season, sumTeamGameLogsFor(teamLogs, scheduleKeys)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      setCareerTeamTotals(new Map(entries.filter((e): e is readonly [string, TeamSeasonRawTotals] => e !== null)));
    });
  }, [careerData, playerId]);

  // 通算成績・キャリアハイ共通: DNP（出場0分）を除いた上で、選択中のレギュラー/プレーオフ/合算
  // トグルで絞り込む（既存のSeasonGameTypeFilter/filterByGameTypeをそのまま再利用）
  const playedFilteredLogs = (logs: PlayerGameLog[]) => filterByGameType(logs.filter((g) => g.min > 0), careerGameTypeFilter);

  // 通算成績タブ: 全シーズン合算の単一の合計値（平均ではなく合計）。PlayerSituationalStatsは
  // 平均値と割合しか持たないため、FGM/3PM/FTM等の合計はgameLogから直接合算し直す
  const careerCountTotals = useMemo((): CareerCountTotals | null => {
    if (!careerData) return null;
    const allPlayed = careerData.flatMap((cd) => playedFilteredLogs(cd.logs));
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
      }),
      { min: 0, pts: 0, fgm: 0, tpm: 0, ftm: 0, ast: 0, reb: 0, blk: 0, stl: 0 },
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
    };
  }, [careerData, careerGameTypeFilter]);

  // 「キャリアハイ」タブのDD/TD達成数カードで引き続き使用（通算成績タブの表示自体は
  // 上のcareerCountTotalsに置き換え済み）
  const careerTotal = useMemo(() => {
    if (!careerData) return null;
    const allPlayed = careerData.flatMap((cd) => playedFilteredLogs(cd.logs));
    const stats = computePlayerSituationalStats(allPlayed);
    return stats ? { stats, ddtd: countDoubleTripleDoubles(allPlayed) } : null;
  }, [careerData, careerGameTypeFilter]);

  const careerHighs = useMemo(() => {
    if (!careerData) return [];
    const allGames = careerData.flatMap((cd) =>
      playedFilteredLogs(cd.logs).map((g) => ({ ...g, season: cd.season })),
    );
    return CAREER_HIGH_STATS.map((def) => {
      const best = allGames.reduce<(typeof allGames)[number] | null>(
        (acc, g) => (acc === null || def.value(g) > def.value(acc) ? g : acc),
        null,
      );
      return best ? { ...def, game: best } : null;
    }).filter((r): r is CareerHighDef & { game: PlayerGameLog & { season: string } } => r !== null);
  }, [careerData, careerGameTypeFilter]);

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

  // 「シチュエーション別成績」セクション用データ。選択中シーズンのチーム総計（%-share・USG%の
  // 分母。ページ本体のteamGameLogsは現在シーズン専用のため、別シーズンを選んだ場合は
  // このセクション専用に取り直す）と、対勝率別フィルタ用の試合日程。「スタッツ」タブを
  // 開いている間だけ取得する
  const { data: situationalStatsPlayers } = useJsonData(
    () => (tab === "stats" ? fetchPlayers(situationalStatsSeason) : Promise.resolve(null)),
    [tab, situationalStatsSeason],
  );
  const situationalStatsTeamId = situationalStatsPlayers?.find((p) => p.playerId === playerId)?.teamId;
  const { data: situationalStatsTeamGameLogs } = useJsonData(
    () =>
      tab === "stats" && situationalStatsTeamId
        ? fetchTeamGameLogs(situationalStatsSeason, situationalStatsTeamId)
        : Promise.resolve([]),
    [tab, situationalStatsSeason, situationalStatsTeamId],
  );
  const { data: situationalStatsSummaries } = useJsonData(
    () => (tab === "stats" ? fetchGameSummaries(situationalStatsSeason) : Promise.resolve(null)),
    [tab, situationalStatsSeason],
  );
  const situationalStatsOpponentRecords = useMemo(
    () => (situationalStatsSummaries ? buildRecordsBeforeGame(situationalStatsSummaries) : undefined),
    [situationalStatsSummaries],
  );
  // 「シューティング」セクション用データ。選択したシーズンのplayers.jsonからこの選手の
  // shotTypesだけを取り出す（situationalStatsPlayersと同じフェッチパターン）
  const { data: shootingPlayers } = useJsonData(
    () => (tab === "stats" ? fetchPlayers(shootingSeason) : Promise.resolve(null)),
    [tab, shootingSeason],
  );
  const shootingPlayer = shootingPlayers?.find((p) => p.playerId === playerId);

  const situationalStatsBackToBack = useMemo(
    () => (situationalStatsSummaries ? buildBackToBackStatus(situationalStatsSummaries) : undefined),
    [situationalStatsSummaries],
  );

  const compareRows: ComparisonRow<CompareColumnData>[] = compareSlots
    .map((slot, i): ComparisonRow<CompareColumnData> | null => {
      if (!slot.season || !careerData) return null;
      const logs = careerData.find((cd) => cd.season === slot.season)?.logs;
      if (!logs) return null;
      const stats = computePlayerSituationalStats(filterGameLogs(logs, slot.filter, compareOpponentRecords[i]));
      if (!stats) return null;
      return {
        item: { key: `slot${i}`, label: describeSituationalFilter(slot.filter, compareBoundaries[i]!), stats },
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
  // 各グループ・各行（例: ホーム/アウェイ）ごとに個別のSeasonBoxscoreCtxを組み立てる。
  // 表示は常に平均（1試合あたり）固定（合計だと行ごとの試合数の違いで比較しづらいため）
  const situationalStatsLogs = careerData?.find((cd) => cd.season === situationalStatsSeason)?.logs;
  const situationalStatsScopedLogs = situationalStatsLogs
    ? filterByGameType(situationalStatsLogs, situationalStatsGameType)
    : [];

  const buildSituationalStatsRowCtx = (matched: PlayerGameLog[]): SeasonBoxscoreCtx | null => {
    const raw = sumPlayerGameLogs(matched);
    if (raw.gamesPlayed === 0) return null;
    const scheduleKeys = new Set(matched.filter((g) => g.min > 0).map((g) => g.scheduleKey));
    const team = sumTeamGameLogsFor(situationalStatsTeamGameLogs ?? [], scheduleKeys);
    return buildSeasonBoxscoreCtx(raw, team, "perGame", Number(situationalStatsSeason.split("-")[0]));
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
      rows:
        situationalStatsBackToBack && situationalStatsTeamId
          ? (["GAME1", "GAME2"] as const).map((status) => ({
              key: status,
              label: status,
              predicate: (g: PlayerGameLog) =>
                situationalStatsBackToBack.get(g.scheduleKey)?.get(situationalStatsTeamId) === status,
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

  const situationalStatsGroups: SituationalStatsGroup[] = situationalStatsGroupDefs
    .map((group) => ({
      key: group.key,
      label: group.label,
      rows: group.rows
        .map((row) => {
          const ctx = buildSituationalStatsRowCtx(situationalStatsScopedLogs.filter(row.predicate));
          return ctx ? { key: row.key, label: row.label, ctx } : null;
        })
        .filter((r): r is SituationalStatsRow => r !== null),
    }))
    .filter((group) => group.rows.length > 0);

  return (
    <div>
      <Link to="/players" className="back-link">
        ← 個人一覧に戻る
      </Link>
      <div className="player-detail-title" style={accentColor ? { borderTopColor: accentColor } : undefined}>
        <h1>{player.name}</h1>
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

      <div className="stat-grid">
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
          <SeasonBreakdownTable careerData={careerData} gameTypeFilter={gameTypeFilter} teamTotalsBySeason={careerTeamTotals} />

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
          </div>
          {!careerData ? (
            <p className="loading">読み込み中...</p>
          ) : situationalStatsGroups.length === 0 ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table situational-groups-table">
                <thead>
                  <tr>
                    <th className="align-left">区分</th>
                    {SEASON_BOX_COLUMNS[situationalStatsTab].map((col) => (
                      <th key={col.key} className="align-right" title={col.description}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {situationalStatsGroups.map((group) => (
                    <Fragment key={group.key}>
                      <tr className="situational-group-heading">
                        <td colSpan={SEASON_BOX_COLUMNS[situationalStatsTab].length + 1}>{group.label}</td>
                      </tr>
                      {group.rows.map((row) => (
                        <tr key={row.key}>
                          <td className="align-left">{row.label}</td>
                          {SEASON_BOX_COLUMNS[situationalStatsTab].map((col) => (
                            <td key={col.key} className="align-right">
                              {col.format(row.ctx, "perGame")}
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

          <h2 title={SHOOTING_SECTION_TOOLTIP}>シューティング</h2>
          <div className="mode-toggle">
            <select value={shootingSeason} onChange={(e) => setShootingSeason(e.target.value)}>
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
          {!shootingPlayer?.shotTypes ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th />
                    {sortShotTypeKeys(Object.keys(shootingPlayer.shotTypes)).map((key) => (
                      <th key={key} className="align-right">
                        {key}
                      </th>
                    ))}
                    <th className="align-right">合計</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="align-left">2P</td>
                    {sortShotTypeKeys(Object.keys(shootingPlayer.shotTypes)).map((key) => (
                      <td key={key} className="align-right">
                        {formatShotTypeCell(shootingPlayer.shotTypes![key]!.twoPoint)}
                      </td>
                    ))}
                    <td className="align-right">
                      {formatShotTypeCell(
                        Object.values(shootingPlayer.shotTypes).reduce(
                          (acc, c) => sumShotTypeCounts(acc, c.twoPoint),
                          { made: 0, attempted: 0 },
                        ),
                      )}
                    </td>
                  </tr>
                  <tr>
                    <td className="align-left">3P</td>
                    {sortShotTypeKeys(Object.keys(shootingPlayer.shotTypes)).map((key) => (
                      <td key={key} className="align-right">
                        {formatShotTypeCell(shootingPlayer.shotTypes![key]!.threePoint)}
                      </td>
                    ))}
                    <td className="align-right">
                      {formatShotTypeCell(
                        Object.values(shootingPlayer.shotTypes).reduce(
                          (acc, c) => sumShotTypeCounts(acc, c.threePoint),
                          { made: 0, attempted: 0 },
                        ),
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

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
                選手が出場した各試合の生データ（GeniusAPI由来のショット座標）をシーズン合計したもの。試合詳細ページのショットチャートと同じ形式で、個別ショット/エリア別成功率を切り替えられる（2022-23シーズン以降のみ対応。DESIGN.md参照）。上の「シーズン別成績」のレギュラー/プレーオフ/合算トグルに連動する。フィルタ・Q別トグルは複数選択でき、選択した条件をすべて満たす試合・ショットに絞り込む
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
          {careerLoading ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerCountTotals ? (
            <p className="empty-message">通算成績がありません</p>
          ) : (
            <div className="stat-grid">
              <StatTile label="PTS" value={formatDecimal(careerCountTotals.pts)} />
              <StatTile label="FG成功数" value={formatDecimal(careerCountTotals.fgm)} />
              <StatTile label="3PT成功数" value={formatDecimal(careerCountTotals.tpm)} />
              <StatTile label="2PT成功数" value={formatDecimal(careerCountTotals.twoPm)} />
              <StatTile label="FT成功数" value={formatDecimal(careerCountTotals.ftm)} />
              <StatTile label="AST" value={formatDecimal(careerCountTotals.ast)} />
              <StatTile label="REB" value={formatDecimal(careerCountTotals.reb)} />
              <StatTile label="BLK" value={formatDecimal(careerCountTotals.blk)} />
              <StatTile label="STL" value={formatDecimal(careerCountTotals.stl)} />
              <StatTile label="試合数" value={String(careerCountTotals.gamesPlayed)} />
              <StatTile label="出場時間" value={formatMinutesFromSeconds(careerCountTotals.minSeconds)} />
              <StatTile label="DD数" value={String(careerCountTotals.dd)} />
              <StatTile label="TD数" value={String(careerCountTotals.td)} />
            </div>
          )}
        </>
      )}

      {tab === "highs" && (
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
          {careerLoading ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : !careerData || (careerHighs.length === 0 && !careerTotal) ? (
            <p className="empty-message">キャリアハイのデータがありません</p>
          ) : (
            <div className="career-highs-grid">
              {careerHighs.map((h) => (
                <div className="career-high-card" key={h.key}>
                  <div className="career-high-label">{h.label}</div>
                  <div className="career-high-value">{h.value(h.game)}</div>
                  <RouterLink to={`/games/${h.game.scheduleKey}?season=${h.game.season}`} className="career-high-game-link">
                    {h.game.date}　{h.game.isHome ? "vs" : "@"}
                    {h.game.opponentTeamName}
                  </RouterLink>
                </div>
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
                          const next: [CompareSlotState, CompareSlotState] = [...prev];
                          next[i] = { ...next[i], filter: f };
                          return next;
                        })
                      }
                      seasonHalfBoundary={compareBoundaries[i]}
                      opponentWinRateSupported={!!compareOpponentRecords[i]}
                    />
                  ) : (
                    <p className="compare-slot-note">シーズンを選択してください</p>
                  )}
                </div>
              );
            })}
          </div>
          {careerLoading ? (
            <p className="loading">読み込み中...</p>
          ) : careerError ? (
            <p className="error-message">{careerError}</p>
          ) : (
            <ComparisonTable
              rows={compareRows}
              defs={COMPARE_STAT_DEFS}
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

const ZERO_TEAM_SEASON_TOTALS: TeamSeasonRawTotals = {
  pts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  tov: 0,
  min: 0,
};

function sumTeamSeasonTotals(a: TeamSeasonRawTotals, b: TeamSeasonRawTotals): TeamSeasonRawTotals {
  return {
    pts: a.pts + b.pts,
    fgm: a.fgm + b.fgm,
    fga: a.fga + b.fga,
    tpm: a.tpm + b.tpm,
    tpa: a.tpa + b.tpa,
    ftm: a.ftm + b.ftm,
    fta: a.fta + b.fta,
    tov: a.tov + b.tov,
    min: a.min + b.min,
  };
}

/**
 * シーズンごとの内訳（レギュラー/プレーオフ/合算トグル込み）を表示するテーブル。
 * 「シーズン成績」（当該シーズン単体のボックススコア）で使っていたのと同じ
 * トラディショナル/アドバンスド/Misc/スコアリングのカテゴリタブをこちらに統合し、
 * 「シーズン成績」セクション自体は削除した（47章・49章で指摘した「片方にしかカテゴリ
 * 切り替えが無い」食い違いの解消。DESIGN.md参照）。表示モードは常に「平均」固定
 * （シチュエーション別成績と同じ方針。合計だと行ごとの試合数の違いで比較しづらいため）。
 * DD2/TD3のみ列定義に無いため、末尾に独自の列として追加する。
 */
function SeasonBreakdownTable({
  careerData,
  gameTypeFilter,
  teamTotalsBySeason,
}: {
  careerData: CareerSeasonLogs[] | null;
  gameTypeFilter: SeasonGameTypeFilter;
  teamTotalsBySeason: Map<string, TeamSeasonRawTotals> | null;
}) {
  const [tab, setTab] = useState<SeasonBoxTabKey>("traditional");
  const playedFilteredLogs = (logs: PlayerGameLog[]) => filterByGameType(logs.filter((g) => g.min > 0), gameTypeFilter);

  const seasonRows = useMemo(() => {
    if (!careerData) return [];
    return careerData
      .map((cd) => {
        const played = playedFilteredLogs(cd.logs);
        const raw = sumPlayerGameLogs(played);
        if (raw.gamesPlayed === 0) return null;
        const team = teamTotalsBySeason?.get(cd.season) ?? ZERO_TEAM_SEASON_TOTALS;
        const seasonStartYear = Number(cd.season.split("-")[0]);
        const ctx = buildSeasonBoxscoreCtx(raw, team, "perGame", seasonStartYear);
        return { season: cd.season, ctx, ddtd: countDoubleTripleDoubles(played) };
      })
      .filter((r): r is { season: string; ctx: SeasonBoxscoreCtx; ddtd: { dd: number; td: number } } => r !== null)
      .reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerData, gameTypeFilter, teamTotalsBySeason]);

  // 通算行のEFFは、複数シーズンの生カウント値を先に合算してから1回だけeff()を呼ぶと
  // 年度で異なる計算式（DESIGN.md参照）を誤って混在適用してしまうため、シーズンごとに
  // 正しい式で算出した合計EFFをここで合算してから平均する（seasonTotalEff参照）
  const total = useMemo(() => {
    if (!careerData || seasonRows.length === 0) return null;
    const allPlayed = careerData.flatMap((cd) => playedFilteredLogs(cd.logs));
    const totalRaw = sumPlayerGameLogs(allPlayed);
    if (totalRaw.gamesPlayed === 0) return null;
    const totalTeam = seasonRows.reduce((acc, r) => sumTeamSeasonTotals(acc, r.ctx.team), ZERO_TEAM_SEASON_TOTALS);
    const latestSeasonStartYear = Math.max(...seasonRows.map((r) => r.ctx.seasonStartYear));
    const ctx = buildSeasonBoxscoreCtx(totalRaw, totalTeam, "perGame", latestSeasonStartYear);
    const totalEffSum = seasonRows.reduce((sum, r) => sum + seasonTotalEff(r.ctx.raw, r.ctx.seasonStartYear), 0);
    return {
      ctx,
      ddtd: countDoubleTripleDoubles(allPlayed),
      effPerGame: totalRaw.gamesPlayed > 0 ? totalEffSum / totalRaw.gamesPlayed : 0,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [careerData, gameTypeFilter, seasonRows]);

  if (!careerData || seasonRows.length === 0) {
    return <p className="empty-message">通算成績がありません</p>;
  }

  const columns = SEASON_BOX_COLUMNS[tab];

  return (
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
              <th className="align-left">シーズン</th>
              {columns.map((col) => (
                <th key={col.key} className="align-right" title={col.description}>
                  {col.label}
                </th>
              ))}
              <th className="align-right">DD2</th>
              <th className="align-right">TD3</th>
            </tr>
          </thead>
          <tbody>
            {seasonRows.map((r) => (
              <tr key={r.season}>
                <td className="align-left">{r.season}</td>
                {columns.map((col) => (
                  <td key={col.key} className="align-right">
                    {col.format(r.ctx, "perGame")}
                  </td>
                ))}
                <td className="align-right">{r.ddtd.dd}</td>
                <td className="align-right">{r.ddtd.td}</td>
              </tr>
            ))}
            {total && (
              <tr className="career-total-row">
                <td className="align-left">通算</td>
                {columns.map((col) => (
                  <td key={col.key} className="align-right">
                    {col.key === "eff" ? formatDecimal(total.effPerGame) : col.format(total.ctx, "perGame")}
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
