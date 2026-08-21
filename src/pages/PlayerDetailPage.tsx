import { useEffect, useMemo, useRef, useState } from "react";
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
  fetchPlayerHistory,
  fetchPlayers,
  fetchSeasons,
  fetchTeamColors,
  fetchTeamGameLogs,
  fetchTeams,
  fetchYahooGamePbp,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { isPbpSupported, isShotChartSupported, useSeasonCoverage, useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type { PlayerGameLog, PlayerSummary } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { BOXSCORE_TABS, type BoxscoreColumn, type BoxscoreTabKey, COLUMNS_BY_TAB } from "../components/BoxscoreTable";
import { buildPlayerGameBoxscoreRow, type PlayerGameBoxscoreRow } from "../lib/playerGameBoxscore";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
import { formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { formatShotTypeCell, sortShotTypeKeys } from "../lib/shotTypeBreakdown";
import { filterPlayersByGamesPlayedRatio } from "../lib/statDefs";
import { safeDiv } from "../../shared/formulas";
import {
  SEASON_ADVANCED_COLUMNS,
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  SEASON_MISC_COLUMNS,
  SEASON_SCORING_COLUMNS,
  SEASON_TRADITIONAL_COLUMNS,
  buildSeasonBoxscoreCtx,
  filterByGameType,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  type SeasonBoxscoreColumn,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "../lib/playerSeasonBoxscore";
import {
  computePlayerSituationalStats,
  computeSeasonHalfBoundary,
  filterGameLogs,
  isDefaultFilter,
  type PlayerSituationalStats,
  type SeasonHalfBoundary,
  type SituationalFilter,
} from "../lib/situational";
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
  }
  return filter.includePlayoffs ? `${base}・PO込み` : base;
}

interface CompareColumnData {
  key: string;
  label: string;
  stats: PlayerSituationalStats;
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
  // シーズンボックススコア（%-share・USG%の分母）用。playerの解決を待つ必要があるが、
  // Hooksはトップレベルで呼ぶ必要があるため、playersが未取得の間はteamIdをundefinedのまま渡す
  const playerTeamId = players?.find((p) => p.playerId === playerId)?.teamId;
  const { data: teamGameLogs } = useJsonData(
    () => (playerTeamId ? fetchTeamGameLogs(season, playerTeamId) : Promise.resolve([])),
    [season, playerTeamId],
  );
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  // レーダーチャートのランキング母集団の足切り（所属チーム試合数の85%以上出場）に使う
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: playerHistory } = useJsonData(() => fetchPlayerHistory(), []);
  // シチュエーション別フィルタの「前半戦/後半戦」ボタン用（シーズン全体の試合日程が必要）
  const { data: gameSummaries } = useJsonData(() => fetchGameSummaries(season), [season]);
  const seasonHalfBoundary = useMemo(
    () => (gameSummaries ? computeSeasonHalfBoundary(gameSummaries) : null),
    [gameSummaries],
  );
  const [filter, setFilter] = useState<SituationalFilter>({ kind: "all" });
  const { coverage, loading: coverageLoading } = useSeasonCoverage(season);
  const pbpSupported = isPbpSupported(coverage);
  const shotChartSupported = isShotChartSupported(coverage);
  const { supported: yahooSeasonSupported } = useYahooPbpCoverage(season);

  const [seasonBoxTab, setSeasonBoxTab] = useState<SeasonBoxTabKey>("traditional");
  const [displayMode, setDisplayMode] = useState<SeasonDisplayMode>("perGame");
  const [gameTypeFilter, setGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");

  const [tab, setTab] = useState<DetailTab>("stats");
  const [careerData, setCareerData] = useState<CareerSeasonLogs[] | null>(null);
  const [careerLoading, setCareerLoading] = useState(false);
  const [careerError, setCareerError] = useState<string | null>(null);
  // 通算成績・キャリアハイ両タブで共有するレギュラー/プレーオフ/合算トグル（既存のgameType軸を再利用）
  const [careerGameTypeFilter, setCareerGameTypeFilter] = useState<SeasonGameTypeFilter>("regular");

  // 試合ログタブのボックススコア形式表示（試合詳細ページと同じトラディショナル/アドバンスド/
  // Misc/スコアリング切り替え）。各試合の生データ（PlayByPlays込み）を選手の出場試合数分
  // フェッチする必要があるため、タブを開いたときだけ遅延取得する（careerと同じ方針）
  const [gameBoxTab, setGameBoxTab] = useState<BoxscoreTabKey>("traditional");
  const [gameBoxRows, setGameBoxRows] = useState<PlayerGameBoxscoreRow[] | null>(null);
  const [gameBoxLoading, setGameBoxLoading] = useState(false);
  const gameBoxFetchStartedRef = useRef(false);

  // 比較タブ: 2スロット分の{シーズン, シチュエーション別フィルタ}。スロット1は現在選択中の
  // シーズン・シーズン全体、スロット2は未選択（ユーザーが選ぶ）がデフォルト
  const [compareSlots, setCompareSlots] = useState<[CompareSlotState, CompareSlotState]>(() =>
    defaultCompareSlots(season),
  );

  // careerLoading/careerDataをdeps配列に含めると、setCareerLoading(true)自体がeffectを
  // 再発火させcleanupで直前のfetchをcancelしてしまう（自己キャンセルのループ）。
  // そのためfetch開始済みかどうかはstateではなくrefで管理する
  const careerFetchStartedRef = useRef(false);

  useEffect(() => {
    setTab("stats");
    setCareerData(null);
    setCareerError(null);
    careerFetchStartedRef.current = false;
    setGameBoxRows(null);
    gameBoxFetchStartedRef.current = false;
    setCompareSlots(defaultCompareSlots(season));
    // 選手が変わった時だけリセットする（season変更では比較タブの選択を維持したいため、
    // 依存配列にseasonは含めない。ここで参照するのはリセット時点の最新値でよい）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerId]);

  // シーズン切り替え時も試合ログボックススコアを再取得する必要がある（careerは全シーズン
  // 横断のため season 変更の影響を受けないが、こちらは選択中シーズンのgameLogsに依存する）
  useEffect(() => {
    setGameBoxRows(null);
    gameBoxFetchStartedRef.current = false;
  }, [season]);

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
      (tab !== "career" && tab !== "highs" && tab !== "compare") ||
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

  // 通算成績・キャリアハイ共通: DNP（出場0分）を除いた上で、選択中のレギュラー/プレーオフ/合算
  // トグルで絞り込む（既存のSeasonGameTypeFilter/filterByGameTypeをそのまま再利用）
  const playedFilteredLogs = (logs: PlayerGameLog[]) => filterByGameType(logs.filter((g) => g.min > 0), careerGameTypeFilter);

  const seasonRows = useMemo(() => {
    if (!careerData) return [];
    return careerData
      .map((cd) => {
        const played = playedFilteredLogs(cd.logs);
        const stats = computePlayerSituationalStats(played);
        return stats ? { season: cd.season, stats, ddtd: countDoubleTripleDoubles(played) } : null;
      })
      .filter((r): r is { season: string; stats: PlayerSituationalStats; ddtd: { dd: number; td: number } } => r !== null);
  }, [careerData, careerGameTypeFilter]);

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

  const compareRows: ComparisonRow<CompareColumnData>[] = compareSlots
    .map((slot, i): ComparisonRow<CompareColumnData> | null => {
      if (!slot.season || !careerData) return null;
      const logs = careerData.find((cd) => cd.season === slot.season)?.logs;
      if (!logs) return null;
      const stats = computePlayerSituationalStats(filterGameLogs(logs, slot.filter));
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
  const filteredLogs = gameLogs ? filterGameLogs(gameLogs, filter) : [];
  const situational = isDefaultFilter(filter) ? null : computePlayerSituationalStats(filteredLogs);

  // レーダーチャートのパーセンタイル算出対象は、所属チーム試合数の85%以上に出場した選手のみに
  // 絞り込む（出場が少なく数値が振れやすい選手を母集団から除くため。DESIGN.md参照）。
  // ただし閲覧中の選手自身は、この条件を満たさなくても常にプロット対象に含める
  // （比較先の母集団を絞るだけで、自分の値が消えるわけではないようにする）
  const radarEligiblePool = players ? filterPlayersByGamesPlayedRatio(players, teams ?? []) : [];
  const radarPool = radarEligiblePool.some((p) => p.playerId === player.playerId)
    ? radarEligiblePool
    : [...radarEligiblePool, player];
  const radarData = radarPool.length > 1 ? buildPlayerRadarData(player, radarPool) : [];

  const seasonBoxGameLogs = gameLogs ? filterByGameType(gameLogs, gameTypeFilter) : [];
  const seasonBoxRawTotals = sumPlayerGameLogs(seasonBoxGameLogs);
  // sumPlayerGameLogs()はmin>0（実際に出場した試合）だけを合算するため、%-share/USG%の
  // 分母となるチーム総計も同じ試合集合に揃える（DNP試合をチーム側にだけ含めると分母が
  // 水増しされて%がズレる。2026-08-21のブラウザ検証で実際に0.7pt前後のズレとして発覚した）
  const seasonBoxScheduleKeys = new Set(seasonBoxGameLogs.filter((g) => g.min > 0).map((g) => g.scheduleKey));
  const seasonBoxTeamTotals = sumTeamGameLogsFor(teamGameLogs ?? [], seasonBoxScheduleKeys);
  const seasonBoxCtx = buildSeasonBoxscoreCtx(
    seasonBoxRawTotals,
    seasonBoxTeamTotals,
    displayMode,
    Number(season.split("-")[0]),
  );

  return (
    <div>
      <Link to="/players" className="back-link">
        ← 個人一覧に戻る
      </Link>
      <div className="player-detail-header" style={accentColor ? { borderTopColor: accentColor } : undefined}>
        <PlayerPhoto playerId={player.playerId} size={112} />
        <div className="player-detail-header-info">
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
        </div>
      </div>

      <h2>リーグ内比較</h2>
      {radarData.length === 0 ? (
        <p className="empty-message">比較対象の選手がいません</p>
      ) : (
        <div className="radar-section">
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
          <div className="radar-rank-list">
            {radarData.map((d) => (
              <div className="radar-rank-item" key={d.key}>
                <span className="radar-rank-label">{d.label}</span>
                <span className="radar-rank-value">
                  {d.rank}位/{d.total}（{d.actualValue}）
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <SituationalFilterPicker filter={filter} onChange={setFilter} seasonHalfBoundary={seasonHalfBoundary} />

          {isDefaultFilter(filter) ? (
            <div className="stat-grid">
              <StatTile label="MIN" value={formatDecimal(player.perGame.min)} />
              <StatTile label="PTS" value={formatDecimal(player.perGame.pts)} />
              <StatTile label="REB" value={formatDecimal(player.perGame.reb)} />
              <StatTile label="AST" value={formatDecimal(player.perGame.ast)} />
              <StatTile label="STL" value={formatDecimal(player.perGame.stl)} />
              <StatTile label="BLK" value={formatDecimal(player.perGame.blk)} />
              <StatTile label="TOV" value={formatDecimal(player.perGame.tov)} />
              <StatTile label="+/-" value={formatSigned(player.perGame.plusMinus)} />
              <StatTile label="FG%" value={formatPct(player.shooting.fgPct)} />
              <StatTile label="3P%" value={formatPct(player.shooting.tpPct)} />
              <StatTile label="FT%" value={formatPct(player.shooting.ftPct)} />
              <StatTile label="eFG%" value={formatPct(player.shooting.efgPct)} />
              <StatTile label="TS%" value={formatPct(player.shooting.tsPct)} />
            </div>
          ) : !situational ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="stat-grid">
              <StatTile label="試合数" value={String(situational.gamesPlayed)} />
              <StatTile label="MIN" value={formatDecimal(situational.perGame.min)} />
              <StatTile label="PTS" value={formatDecimal(situational.perGame.pts)} />
              <StatTile label="REB" value={formatDecimal(situational.perGame.reb)} />
              <StatTile label="AST" value={formatDecimal(situational.perGame.ast)} />
              <StatTile label="STL" value={formatDecimal(situational.perGame.stl)} />
              <StatTile label="BLK" value={formatDecimal(situational.perGame.blk)} />
              <StatTile label="TOV" value={formatDecimal(situational.perGame.tov)} />
              <StatTile label="+/-" value={formatSigned(situational.perGame.plusMinus)} />
              <StatTile label="FG%" value={formatPct(situational.shooting.fgPct)} />
              <StatTile label="3P%" value={formatPct(situational.shooting.tpPct)} />
              <StatTile label="FT%" value={formatPct(situational.shooting.ftPct)} />
              <StatTile label="eFG%" value={formatPct(situational.shooting.efgPct)} />
              <StatTile label="TS%" value={formatPct(situational.shooting.tsPct)} />
            </div>
          )}

          <section className="gd-card oncourt-card" style={accentColor ? { borderLeftColor: accentColor } : undefined}>
            <h2>オンコート/オフコートスタッツ</h2>
            {coverageLoading ? (
              <p className="loading">読み込み中...</p>
            ) : !pbpSupported ? (
              <p className="empty-message">このシーズンのデータには対応していません</p>
            ) : (
              <div className="stat-grid">
                <StatTile label="オンコート+/-" value={formatSigned(player.advanced.onCourtNetPerGame)} />
                <StatTile label="オフコート+/-" value={formatSigned(player.advanced.offCourtNetPerGame)} />
              </div>
            )}
          </section>

          <h2>シーズンボックススコア</h2>
          <div className="mode-toggle">
            {(Object.keys(SEASON_DISPLAY_MODE_LABELS) as SeasonDisplayMode[]).map((m) => (
              <button key={m} className={m === displayMode ? "active" : ""} onClick={() => setDisplayMode(m)} type="button">
                {SEASON_DISPLAY_MODE_LABELS[m]}
              </button>
            ))}
          </div>
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
          {seasonBoxRawTotals.gamesPlayed === 0 ? (
            <p className="empty-message">該当する試合がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    {SEASON_BOX_COLUMNS[seasonBoxTab].map((col) => (
                      <th key={col.key} className="align-right" title={col.description}>
                        {col.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {SEASON_BOX_COLUMNS[seasonBoxTab].map((col) => (
                      <td key={col.key} className="align-right">
                        {col.format(seasonBoxCtx, displayMode)}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <h2>シューティング</h2>
          {!player.shotTypes ? (
            <p className="empty-message">このシーズンのデータには対応していません</p>
          ) : (
            <>
              <div className="table-scroll">
                <table className="stats-table">
                  <thead>
                    <tr>
                      {sortShotTypeKeys(Object.keys(player.shotTypes)).map((key) => (
                        <th key={key} className="align-right">
                          {key}
                        </th>
                      ))}
                      <th className="align-right">合計</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      {sortShotTypeKeys(Object.keys(player.shotTypes)).map((key) => (
                        <td key={key} className="align-right">
                          {formatShotTypeCell(player.shotTypes![key])}
                        </td>
                      ))}
                      <td className="align-right">
                        {formatShotTypeCell(
                          Object.values(player.shotTypes).reduce(
                            (acc, c) => ({ made: acc.made + c.made, attempted: acc.attempted + c.attempted }),
                            { made: 0, attempted: 0 },
                          ),
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <p className="page-subtitle">
                Yahoo!スポーツplay-by-play由来のシュートタイプ別成功/試投（シーズン合計、2023-24シーズン以降・レギュラーシーズンのみ。DESIGN.md参照）。「キャッチアンドシュート」に相当する独立分類はデータ上存在せず、無印の「ジャンプショット」に一括りになっている点に注意
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
          ) : !careerData || seasonRows.length === 0 ? (
            <p className="empty-message">通算成績がありません</p>
          ) : (
            <div className="table-scroll">
              <table className="stats-table">
                <thead>
                  <tr>
                    <th className="align-left">シーズン</th>
                    <th className="align-right">試合数</th>
                    <th className="align-right">MIN</th>
                    <th className="align-right">PTS</th>
                    <th className="align-right">REB</th>
                    <th className="align-right">AST</th>
                    <th className="align-right">STL</th>
                    <th className="align-right">BLK</th>
                    <th className="align-right">TOV</th>
                    <th className="align-right">+/-</th>
                    <th className="align-right">FG%</th>
                    <th className="align-right">3P%</th>
                    <th className="align-right">FT%</th>
                    <th className="align-right">eFG%</th>
                    <th className="align-right">TS%</th>
                    <th className="align-right">DD2</th>
                    <th className="align-right">TD3</th>
                  </tr>
                </thead>
                <tbody>
                  {seasonRows.map((r) => (
                    <tr key={r.season}>
                      <td className="align-left">{r.season}</td>
                      <td className="align-right">{r.stats.gamesPlayed}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.min)}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.pts)}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.reb)}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.ast)}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.stl)}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.blk)}</td>
                      <td className="align-right">{formatDecimal(r.stats.perGame.tov)}</td>
                      <td className="align-right">{formatSigned(r.stats.perGame.plusMinus)}</td>
                      <td className="align-right">{formatPct(r.stats.shooting.fgPct)}</td>
                      <td className="align-right">{formatPct(r.stats.shooting.tpPct)}</td>
                      <td className="align-right">{formatPct(r.stats.shooting.ftPct)}</td>
                      <td className="align-right">{formatPct(r.stats.shooting.efgPct)}</td>
                      <td className="align-right">{formatPct(r.stats.shooting.tsPct)}</td>
                      <td className="align-right">{r.ddtd.dd}</td>
                      <td className="align-right">{r.ddtd.td}</td>
                    </tr>
                  ))}
                  {careerTotal && (
                    <tr className="career-total-row">
                      <td className="align-left">通算</td>
                      <td className="align-right">{careerTotal.stats.gamesPlayed}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.min)}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.pts)}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.reb)}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.ast)}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.stl)}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.blk)}</td>
                      <td className="align-right">{formatDecimal(careerTotal.stats.perGame.tov)}</td>
                      <td className="align-right">{formatSigned(careerTotal.stats.perGame.plusMinus)}</td>
                      <td className="align-right">{formatPct(careerTotal.stats.shooting.fgPct)}</td>
                      <td className="align-right">{formatPct(careerTotal.stats.shooting.tpPct)}</td>
                      <td className="align-right">{formatPct(careerTotal.stats.shooting.ftPct)}</td>
                      <td className="align-right">{formatPct(careerTotal.stats.shooting.efgPct)}</td>
                      <td className="align-right">{formatPct(careerTotal.stats.shooting.tsPct)}</td>
                      <td className="align-right">{careerTotal.ddtd.dd}</td>
                      <td className="align-right">{careerTotal.ddtd.td}</td>
                    </tr>
                  )}
                </tbody>
              </table>
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
