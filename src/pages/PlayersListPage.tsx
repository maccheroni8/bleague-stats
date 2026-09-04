import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  fetchDivisionHistory,
  fetchGameSummaries,
  fetchLeaguePlayerRankings,
  fetchPlayerAwards,
  fetchPlayerGameLogs,
  fetchPlayers,
  fetchPlayersMaster,
  fetchTeamGameLogs,
  fetchTeams,
} from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type {
  DivisionHistoryFile,
  GameSummary,
  LeaguePlayerRankEntry,
  LeaguePlayerRankingsFile,
  PlayerAwardsFile,
  PlayerGameLog,
  PlayerMasterEntry,
  PlayerSummary,
  TeamGameLog,
} from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "../lib/format";
import { astToTovRatio, formatAstToRatio, formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { efgPct, eff, safeDiv, tovPct, tsPct } from "../../shared/formulas";
import { teamShortName } from "../../shared/teamNames";
import { buildRecordsBeforeGame, filterGameLogs, isDefaultFilter, type RecordBeforeGame, type SituationalFilter } from "../lib/situational";
import { shotTypeEntityColumns, sortShotTypeKeys } from "../lib/shotTypeBreakdown";
import { PLAYER_CAREER_TOTAL_DEFS } from "../../shared/playerRecords";
import { SEASON_GAME_TYPE_LABELS, type SeasonGameTypeFilter } from "../../shared/gameType";
import {
  buildSeasonBoxscoreCtx,
  EMPTY_TEAM_TOTALS,
  SEASON_ADVANCED_COLUMNS,
  SEASON_BOX_TABS,
  SEASON_MISC_COLUMNS,
  SEASON_SCORING_COLUMNS,
  SEASON_TRADITIONAL_COLUMNS,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  type SeasonBoxTabKey,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type TeamSeasonRawTotals,
} from "../lib/playerSeasonBoxscore";

// 「個人」ページ。「全選手スタッツ」タブ（チーム版の「全チームスタッツ」と同じ考え方）・
// 「歴代記録」タブ（チーム版の「歴代記録」から通算成績部分のみ、ユーザー依頼2026-09-04）・
// 「歴代アワード」タブ（data/player-awards.json、チーム版の「歴代王者」と同じ発想のシーズン軸
// 年表、ユーザー依頼2026-09-04）・「直近成績」タブ（チーム版の「直近成績」と同じ考え方、
// ユーザー依頼2026-09-05）の4タブ構成。「歴代記録」のクラブレコード相当（1試合単位の
// 最高記録）は今回対象外（別途RankingsページのTaskとして進める予定）。

type PlayersOuterTab = "stats" | "records" | "awards" | "recent";

const OUTER_TAB_LABELS: Record<PlayersOuterTab, string> = {
  stats: "全選手スタッツ",
  records: "歴代記録",
  awards: "歴代アワード",
  recent: "直近成績",
};

export function PlayersListPage({ season }: { season: string }) {
  const [tab, setTab] = useState<PlayersOuterTab>("stats");

  return (
    <div>
      <h1>個人スタッツ</h1>
      <div className="tab-bar">
        {(Object.keys(OUTER_TAB_LABELS) as PlayersOuterTab[]).map((t) => (
          <button key={t} className={`tab-button${tab === t ? " active" : ""}`} onClick={() => setTab(t)} type="button">
            {OUTER_TAB_LABELS[t]}
          </button>
        ))}
      </div>
      {tab === "stats" ? (
        <AllPlayersStatsTab season={season} />
      ) : tab === "records" ? (
        <LeaguePlayerRecordsTab />
      ) : tab === "awards" ? (
        <PlayerAwardsTimelineTab />
      ) : (
        <PlayerRecentFormTab season={season} />
      )}
    </div>
  );
}

// 「全選手スタッツ」タブ。チーム版の「全チームスタッツ」（TeamsListPage.tsx）と同じ考え方で
// 「個人」ページを統合したもの（ユーザー依頼、2026-09-04）。
//
// チーム版との違い（依頼で明示されたスコープ）:
// - カテゴリタブはトラディショナル/アドバンスド/Misc/スコアリング/シューティングの5つ
//   （個人には無関係な「強制ターンオーバー」は対象外）
// - 自チーム/opp/+/-トグルは実装しない（個人版では不要）
// - 選手名の左に写真、チーム名は略称表記
// - 出場試合率（所属チームの試合数に対する出場試合数の割合）で絞り込む範囲スライダーを
//   設置し、デフォルトは60%以上
// - 初期表示はPTS降順の上位100人。「もっと見る」で表示人数を増やす。列ヘッダークリックでの
//   ソートは常にフィルタ後の全選手が対象（SortableTable.tsxのlimitプロパティ、2026-09-04追加。
//   全選手を先にソートしてから先頭N件だけ描画する設計にしたため、「もっと見る」を押さなくても
//   正しい全選手中の順位で並び替えられる）
//
// データソース:
// - トラディショナル/アドバンスド/シューティング: fetchPlayers(season)で一括取得済みの
//   PlayerSummary（totals/perGame/shooting/advanced/shotTypes）だけで完結し、追加の
//   通信は発生しない
// - Misc/スコアリング: PlayerSummaryにはPlayByPlays由来の項目（PITP・DUNK・被アシスト内訳等）が
//   無いため、これらのタブを初めて開いたときに全選手分のplayer-games/{playerId}.jsonを
//   まとめて取得し、個人詳細ページ「シーズン別成績」等と同じsumPlayerGameLogs/
//   buildSeasonBoxscoreCtx/SEASON_MISC_COLUMNS/SEASON_SCORING_COLUMNSをそのまま再利用する
//   （表示件数に関わらず常に全選手分を取得するため、「もっと見る」で表示人数を増やしても
//   追加の通信は発生しない）。スコアリングタブの%-share系（%PTS等）の分母は、移籍選手も
//   直近所属チームで近似する既存方針（PPP実装時と同じ）を踏襲し、fetchTeams(season)で
//   一括取得済みのteams.jsonのシーズン合計値をそのまま使う（26チーム分のteam-games
//   個別取得はしない）

type PlayersPageTab = SeasonBoxTabKey | "shooting";

interface PlayerRow {
  player: PlayerSummary;
  ctx?: SeasonBoxscoreCtx;
}

function pgAvg(total: number, games: number): number {
  return safeDiv(total, games);
}

const nameColumn: Column<PlayerRow> = {
  key: "name",
  label: "選手",
  align: "left",
  sortValue: (r) => r.player.name,
  render: (r) => (
    <span className="player-cell">
      <PlayerPhoto playerId={r.player.playerId} size={32} className="player-cell-photo" />
      <span className="player-cell-name">{r.player.name}</span>
    </span>
  ),
};

const teamColumn: Column<PlayerRow> = {
  key: "team",
  label: "チーム",
  align: "left",
  sortValue: (r) => teamShortName(r.player.teamId, r.player.teamName),
  format: (r) => teamShortName(r.player.teamId, r.player.teamName),
};

const classificationColumn: Column<PlayerRow> = {
  key: "classification",
  label: "登録区分",
  align: "left",
  sortValue: (r) => r.player.classification ?? "",
  format: (r) => r.player.classification ?? "-",
};

const heightColumn: Column<PlayerRow> = {
  key: "height",
  label: "身長",
  sortValue: (r) => r.player.heightCm ?? -1,
  format: (r) => (r.player.heightCm !== undefined ? `${r.player.heightCm}cm` : "-"),
};

const weightColumn: Column<PlayerRow> = {
  key: "weight",
  label: "体重",
  sortValue: (r) => r.player.weightKg ?? -1,
  format: (r) => (r.player.weightKg !== undefined ? `${r.player.weightKg}kg` : "-"),
};

const gamesColumn: Column<PlayerRow> = {
  key: "g",
  label: "G",
  sortValue: (r) => r.player.gamesPlayed,
  format: (r) => String(r.player.gamesPlayed),
};

const minColumn: Column<PlayerRow> = {
  key: "min",
  label: "MIN",
  sortValue: (r) => r.player.perGame.min,
  format: (r) => formatMinutesFromSeconds(Math.round(r.player.perGame.min * 60)),
};

const ptsColumn: Column<PlayerRow> = {
  key: "pts",
  label: "PTS",
  sortValue: (r) => r.player.perGame.pts,
  format: (r) => formatDecimal(r.player.perGame.pts),
};

const LEADING_COLUMNS: Column<PlayerRow>[] = [nameColumn, teamColumn, classificationColumn, heightColumn, weightColumn, gamesColumn];

// シチュエーション別フィルタ選択時（ctxベースの列に切り替わる）用の先頭列。G/MIN/PTSは
// SEASON_*_COLUMNS自体が既に含んでいるため、ここではプロフィール系の列のみ持つ
const LEADING_COLUMNS_MINIMAL: Column<PlayerRow>[] = [nameColumn, teamColumn, classificationColumn, heightColumn, weightColumn];

/**
 * playerSeasonBoxscore.tsのSeasonBoxscoreColumn（ctx.raw/ctx.scaledベース）を、この一覧の
 * Column<PlayerRow>にそのまま変換する。個人詳細ページの「シーズン別成績」「シチュエーション別
 * 成績」と同じ列定義を再利用することで、シチュエーション別フィルタ選択時も表示項目の意味が
 * 揃う（DESIGN.md参照）
 */
function buildCtxColumns(cols: SeasonBoxscoreColumn[]): Column<PlayerRow>[] {
  return [
    ...LEADING_COLUMNS_MINIMAL,
    ...cols.map((col) => ({
      key: col.key,
      label: col.label,
      sortValue: (r: PlayerRow) => (r.ctx ? col.value(r.ctx, "perGame") : 0),
      format: (r: PlayerRow) => (r.ctx ? col.format(r.ctx, "perGame") : "-"),
    })),
  ];
}

function countColumn(key: string, label: string, pick: (p: PlayerSummary) => number): Column<PlayerRow> {
  return { key, label, sortValue: (r) => pick(r.player), format: (r) => formatDecimal(pick(r.player)) };
}

function pctColumn(key: string, label: string, pick: (p: PlayerSummary) => number): Column<PlayerRow> {
  return { key, label, sortValue: (r) => pick(r.player), format: (r) => formatPct(pick(r.player)) };
}

// トラディショナル/アドバンスドはPlayerSummaryのみで完結する（追加の通信なし）。
// 列構成・ラベルはplayerSeasonBoxscore.tsのSEASON_TRADITIONAL_COLUMNS/SEASON_ADVANCED_COLUMNSを
// 踏襲しているが、値の出所はPlayerGameLogの積み上げ（ctx）ではなくPlayerSummaryの既存集計値
// （シーズン平均）をそのまま使う。ORtg/DRtg/NetRtg/PACE/POSSは、リーグ全選手分を正確に出すには
// 選手ごとのplayer-gamesとチームごとのteam-games（相手チーム分含む）が必要で通信量が
// 大きくなりすぎるため、advanced.ppp（個人ORtg/100、季集計済みの正確な値）から求まるORtgのみ
// 含め、DRtg/NetRtg/PACE/POSSはこの一覧には含めていない
const TRADITIONAL_COLUMNS: Column<PlayerRow>[] = [
  ...LEADING_COLUMNS,
  minColumn,
  ptsColumn,
  countColumn("fgm", "FGM", (p) => pgAvg(p.totals.fgm, p.gamesPlayed)),
  countColumn("fga", "FGA", (p) => pgAvg(p.totals.fga, p.gamesPlayed)),
  pctColumn("fgpct", "FG%", (p) => p.shooting.fgPct),
  countColumn("2pm", "2PM", (p) => pgAvg(p.totals.fgm - p.totals.tpm, p.gamesPlayed)),
  countColumn("2pa", "2PA", (p) => pgAvg(p.totals.fga - p.totals.tpa, p.gamesPlayed)),
  pctColumn("2ppct", "2P%", (p) => p.shooting.pt2Pct),
  countColumn("3pm", "3PM", (p) => pgAvg(p.totals.tpm, p.gamesPlayed)),
  countColumn("3pa", "3PA", (p) => pgAvg(p.totals.tpa, p.gamesPlayed)),
  pctColumn("3ppct", "3P%", (p) => p.shooting.tpPct),
  countColumn("ftm", "FTM", (p) => pgAvg(p.totals.ftm, p.gamesPlayed)),
  countColumn("fta", "FTA", (p) => pgAvg(p.totals.fta, p.gamesPlayed)),
  pctColumn("ftpct", "FT%", (p) => p.shooting.ftPct),
  pctColumn("efg", "eFG%", (p) => p.shooting.efgPct),
  pctColumn("ts", "TS%", (p) => p.shooting.tsPct),
  countColumn("or", "OR", (p) => p.perGame.oreb),
  countColumn("dr", "DR", (p) => p.perGame.dreb),
  countColumn("tr", "TR", (p) => p.perGame.reb),
  countColumn("ast", "AST", (p) => p.perGame.ast),
  countColumn("tov", "TOV", (p) => p.perGame.tov),
  {
    key: "asttov",
    label: "AST/TOV",
    sortValue: (r) => astToTovRatio(r.player.totals.ast, r.player.totals.tov),
    format: (r) => formatAstToRatio(r.player.totals.ast, r.player.totals.tov),
  },
  countColumn("stl", "STL", (p) => p.perGame.stl),
  countColumn("blk", "BLK", (p) => p.perGame.blk),
  countColumn("bsr", "BSR", (p) => pgAvg(p.totals.blockedAgainst, p.gamesPlayed)),
  countColumn("f", "F", (p) => p.perGame.pf),
  countColumn("fd", "FD", (p) => pgAvg(p.totals.foulsDrawn, p.gamesPlayed)),
  countColumn("eff", "EFF", (p) => p.advanced.eff),
  {
    key: "plusminus",
    label: "+/-",
    sortValue: (r) => r.player.perGame.plusMinus,
    format: (r) => formatSigned(r.player.perGame.plusMinus),
  },
];

const ADVANCED_COLUMNS: Column<PlayerRow>[] = [
  ...LEADING_COLUMNS,
  minColumn,
  ptsColumn,
  {
    key: "usg",
    label: "USG%",
    sortValue: (r) => r.player.advanced.usagePct,
    format: (r) => formatPct100(r.player.advanced.usagePct),
  },
  {
    key: "tovpct",
    label: "TOV%",
    sortValue: (r) => tovPct(r.player.totals.tov, r.player.totals.fga, r.player.totals.fta),
    format: (r) => formatPct100(tovPct(r.player.totals.tov, r.player.totals.fga, r.player.totals.fta)),
  },
  pctColumn("efg", "eFG%", (p) => p.shooting.efgPct),
  pctColumn("ts", "TS%", (p) => p.shooting.tsPct),
  pctColumn("ftr", "FTR", (p) => p.shooting.ftRate),
  {
    key: "pps",
    label: "PPS",
    sortValue: (r) => safeDiv(r.player.totals.pts, r.player.totals.fga),
    format: (r) => formatDecimal(safeDiv(r.player.totals.pts, r.player.totals.fga), 2),
  },
  countColumn("per", "PER", (p) => p.advanced.per),
  {
    key: "ortg",
    label: "ORtg",
    sortValue: (r) => (r.player.advanced.ppp !== undefined ? r.player.advanced.ppp * 100 : 0),
    format: (r) => (r.player.advanced.ppp !== undefined ? formatDecimal(r.player.advanced.ppp * 100) : "-"),
  },
  {
    key: "plusminus",
    label: "+/-",
    sortValue: (r) => r.player.perGame.plusMinus,
    format: (r) => formatSigned(r.player.perGame.plusMinus),
  },
];

// Misc/スコアリング/シチュエーション別フィルタ選択時のトラディショナル・アドバンスドは、
// いずれも個人詳細ページ「シーズン別成績」等と同じSeasonBoxscoreColumn（ctxベース）を
// buildCtxColumns()でそのまま流用する。ctx未取得（player-games取得前）の間は "-" / 0 を返す
const MISC_COLUMNS: Column<PlayerRow>[] = buildCtxColumns(SEASON_MISC_COLUMNS);
const SCORING_COLUMNS: Column<PlayerRow>[] = buildCtxColumns(SEASON_SCORING_COLUMNS);
const TRADITIONAL_FILTERED_COLUMNS: Column<PlayerRow>[] = buildCtxColumns(SEASON_TRADITIONAL_COLUMNS);
const ADVANCED_FILTERED_COLUMNS: Column<PlayerRow>[] = buildCtxColumns(SEASON_ADVANCED_COLUMNS);

const TAB_LABELS: { key: PlayersPageTab; label: string }[] = [
  ...SEASON_BOX_TABS,
  { key: "shooting", label: "シューティング" },
];

const DEFAULT_SORT: Record<PlayersPageTab, { key: string; dir: "asc" | "desc" }> = {
  traditional: { key: "pts", dir: "desc" },
  advanced: { key: "pts", dir: "desc" },
  misc: { key: "pts", dir: "desc" },
  scoring: { key: "pts", dir: "desc" },
  shooting: { key: "name", dir: "asc" },
};

const PAGE_SIZE = 100;
const DEFAULT_MIN_RATIO = 60;
const DEFAULT_MAX_RATIO = 100;

// 出場試合率（所属チームの試合数に対する出場試合数の割合）を絞り込む、下限・上限を
// それぞれ動かせる範囲スライダー。旅行予約サイトの価格帯フィルタと同じ実装パターン
// （2本のtype="range"を重ね、トラックはpointer-events:noneでつまみだけ操作可能にする）
function GamesPlayedRatioSlider({
  min,
  max,
  onChange,
}: {
  min: number;
  max: number;
  onChange: (min: number, max: number) => void;
}) {
  return (
    <div className="dual-range">
      <div className="dual-range-labels">
        出場試合率: {min}%〜{max}%
      </div>
      <div className="dual-range-track-wrap">
        <div className="dual-range-track">
          <div className="dual-range-fill" style={{ left: `${min}%`, width: `${max - min}%` }} />
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={min}
          onChange={(e) => onChange(Math.min(Number(e.target.value), max), max)}
          className="dual-range-input"
          aria-label="出場試合率の下限"
        />
        <input
          type="range"
          min={0}
          max={100}
          value={max}
          onChange={(e) => onChange(min, Math.max(Number(e.target.value), min))}
          className="dual-range-input"
          aria-label="出場試合率の上限"
        />
      </div>
    </div>
  );
}

const CLASSIFICATION_OPTIONS: NonNullable<PlayerSummary["classification"]>[] = ["日本人", "外国籍", "帰化選手", "アジア特別枠"];
const POSITION_OPTIONS = ["PG", "SG", "SF", "PF", "C"] as const;
const DEFAULT_SITUATIONAL_FILTER: SituationalFilter = { range: { kind: "all" } };

function toggleInSet<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function matchesClassificationFilter(p: PlayerSummary, selected: Set<NonNullable<PlayerSummary["classification"]>>): boolean {
  return selected.size === 0 || (p.classification !== undefined && selected.has(p.classification));
}

function matchesTeamFilter(p: PlayerSummary, selected: Set<string>): boolean {
  return selected.size === 0 || selected.has(p.teamId);
}

/** ポジションは「SG/SF」のような複数区分の併記がありうるため、"/"区切りのいずれかが
 * 選択中の区分に含まれていれば一致とみなす */
function matchesPositionFilter(p: PlayerSummary, selected: Set<string>): boolean {
  if (selected.size === 0) return true;
  if (!p.position) return false;
  return p.position.split("/").some((token) => selected.has(token));
}

function AllPlayersStatsTab({ season }: { season: string }) {
  const { data: players, loading: playersLoading, error: playersError } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  const { supported: yahooPbpSupported } = useYahooPbpCoverage(season);
  // シチュエーション別フィルタ（地区・対勝率別）用。いずれもシーズン非依存/軽量なため
  // タブの開閉に関わらず常に取得する（チーム詳細ページ・個人詳細ページと同じ方針）
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);
  const { data: gameSummaries } = useJsonData(() => fetchGameSummaries(season), [season]);
  const opponentRecords = useMemo(
    () => (gameSummaries ? buildRecordsBeforeGame(gameSummaries) : undefined),
    [gameSummaries],
  );

  const [tab, setTab] = useState<PlayersPageTab>("traditional");
  const [minRatio, setMinRatio] = useState(DEFAULT_MIN_RATIO);
  const [maxRatio, setMaxRatio] = useState(DEFAULT_MAX_RATIO);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [classificationFilter, setClassificationFilter] = useState<Set<NonNullable<PlayerSummary["classification"]>>>(
    () => new Set(),
  );
  const [teamFilter, setTeamFilter] = useState<Set<string>>(() => new Set());
  const [positionFilter, setPositionFilter] = useState<Set<string>>(() => new Set());
  const [situationalFilter, setSituationalFilter] = useState<SituationalFilter>(DEFAULT_SITUATIONAL_FILTER);
  const filterActive = !isDefaultFilter(situationalFilter);

  const [gameLogs, setGameLogs] = useState<Map<string, PlayerGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(false);
  const gameLogsFetchedForSeasonRef = useRef<string | null>(null);

  // シチュエーション別フィルタ選択時のみ、USG%・ORtg/DRtg等に必要なチーム総計
  // （sumTeamGameLogsFor、個人詳細ページ「シチュエーション別成績」と同じ方式）のため
  // 全チーム分のTeamGameLogをまとめて取得する
  const [teamGameLogsByTeam, setTeamGameLogsByTeam] = useState<Map<string, TeamGameLog[]> | null>(null);
  const [teamGameLogsLoading, setTeamGameLogsLoading] = useState(false);
  const teamGameLogsFetchedForSeasonRef = useRef<string | null>(null);

  useEffect(() => {
    setTab("traditional");
    setMinRatio(DEFAULT_MIN_RATIO);
    setMaxRatio(DEFAULT_MAX_RATIO);
    setVisibleCount(PAGE_SIZE);
    setClassificationFilter(new Set());
    setTeamFilter(new Set());
    setPositionFilter(new Set());
    setSituationalFilter(DEFAULT_SITUATIONAL_FILTER);
    setGameLogs(null);
    gameLogsFetchedForSeasonRef.current = null;
    setTeamGameLogsByTeam(null);
    teamGameLogsFetchedForSeasonRef.current = null;
  }, [season]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [minRatio, maxRatio, classificationFilter, teamFilter, positionFilter]);

  useEffect(() => {
    const needsLogs = tab === "misc" || tab === "scoring" || filterActive;
    if (!needsLogs || !players || gameLogsFetchedForSeasonRef.current === season) return;
    gameLogsFetchedForSeasonRef.current = season;
    let cancelled = false;
    setGameLogsLoading(true);
    Promise.all(
      players.map(async (p): Promise<readonly [string, PlayerGameLog[]]> => {
        try {
          return [p.playerId, await fetchPlayerGameLogs(season, p.playerId)] as const;
        } catch {
          return [p.playerId, [] as PlayerGameLog[]] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setGameLogs(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setGameLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tab, players, season, filterActive]);

  useEffect(() => {
    if (!filterActive || !teams || teamGameLogsFetchedForSeasonRef.current === season) return;
    teamGameLogsFetchedForSeasonRef.current = season;
    let cancelled = false;
    setTeamGameLogsLoading(true);
    Promise.all(
      teams.map(async (t): Promise<readonly [string, TeamGameLog[]]> => {
        try {
          return [t.teamId, await fetchTeamGameLogs(season, t.teamId)] as const;
        } catch {
          return [t.teamId, [] as TeamGameLog[]] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setTeamGameLogsByTeam(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setTeamGameLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterActive, teams, season]);

  const teamGamesById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t.gamesPlayed])), [teams]);
  const teamTotalsById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t.totals])), [teams]);
  const seasonStartYear = Number(season.split("-")[0]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter((p) => {
      const teamGames = teamGamesById.get(p.teamId);
      if (!teamGames) return false;
      const ratio = (100 * p.gamesPlayed) / teamGames;
      if (ratio < minRatio || ratio > maxRatio) return false;
      if (!matchesClassificationFilter(p, classificationFilter)) return false;
      if (!matchesTeamFilter(p, teamFilter)) return false;
      if (!matchesPositionFilter(p, positionFilter)) return false;
      return true;
    });
  }, [players, teamGamesById, minRatio, maxRatio, classificationFilter, teamFilter, positionFilter]);

  // limit（SortableTable側で全件ソートしてから先頭visibleCount件だけ描画する）と組み合わせる
  // ため、rowsは常にフィルタ後の全選手分を作る（もっと見るを押す前でも列ソートが正しく
  // 全選手を対象に機能するようにするため）。シチュエーション別フィルタ選択時は、絞り込んだ
  // 試合ログの合算値（+その試合に絞ったチーム総計、個人詳細ページ「シチュエーション別成績」と
  // 同じsumTeamGameLogsFor方式）からctxを組み立てる
  const rows: PlayerRow[] = useMemo(
    () =>
      filteredPlayers.map((p) => {
        if (!gameLogs) return { player: p };
        const logs = gameLogs.get(p.playerId) ?? [];
        if (filterActive) {
          const filteredLogs = filterGameLogs(logs, situationalFilter, opponentRecords, divisionHistory, season);
          const raw = sumPlayerGameLogs(filteredLogs);
          const scheduleKeys = new Set(filteredLogs.map((g) => g.scheduleKey));
          const teamLogs = teamGameLogsByTeam?.get(p.teamId) ?? [];
          const team = sumTeamGameLogsFor(teamLogs, scheduleKeys);
          return { player: p, ctx: buildSeasonBoxscoreCtx(raw, team, "perGame", seasonStartYear) };
        }
        const raw = sumPlayerGameLogs(logs);
        const teamTotals = teamTotalsById.get(p.teamId);
        const team: TeamSeasonRawTotals = teamTotals
          ? {
              ...EMPTY_TEAM_TOTALS,
              pts: teamTotals.pts,
              fgm: teamTotals.fgm,
              fga: teamTotals.fga,
              tpm: teamTotals.tpm,
              tpa: teamTotals.tpa,
              ftm: teamTotals.ftm,
              fta: teamTotals.fta,
            }
          : EMPTY_TEAM_TOTALS;
        return { player: p, ctx: buildSeasonBoxscoreCtx(raw, team, "perGame", seasonStartYear) };
      }),
    [
      filteredPlayers,
      gameLogs,
      teamTotalsById,
      seasonStartYear,
      filterActive,
      situationalFilter,
      opponentRecords,
      divisionHistory,
      season,
      teamGameLogsByTeam,
    ],
  );

  const shootingRows = rows.filter((r) => r.player.shotTypes);
  const shotTypeKeys = sortShotTypeKeys([...new Set(shootingRows.flatMap((r) => Object.keys(r.player.shotTypes ?? {})))]);
  const shootingColumns: Column<PlayerRow>[] = [
    nameColumn,
    teamColumn,
    classificationColumn,
    heightColumn,
    weightColumn,
    ...shotTypeEntityColumns<PlayerRow>(shotTypeKeys, (r) => r.player.shotTypes),
  ];

  const columns =
    tab === "shooting"
      ? shootingColumns
      : tab === "traditional"
        ? filterActive
          ? TRADITIONAL_FILTERED_COLUMNS
          : TRADITIONAL_COLUMNS
        : tab === "advanced"
          ? filterActive
            ? ADVANCED_FILTERED_COLUMNS
            : ADVANCED_COLUMNS
          : tab === "misc"
            ? MISC_COLUMNS
            : SCORING_COLUMNS;

  const tableRows = tab === "shooting" ? shootingRows : rows;
  const defaultSort = DEFAULT_SORT[tab];
  const needsGameLogs = tab === "misc" || tab === "scoring" || filterActive;
  const gameDataLoading = needsGameLogs && (gameLogsLoading || !gameLogs);
  const teamDataLoading = filterActive && (teamGameLogsLoading || !teamGameLogsByTeam);

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;
  if (!players || players.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <p className="page-subtitle">
        {season}シーズン・全{players.length}選手
      </p>

      <div className="filter-block">
        <h3>国籍区分</h3>
        <div className="mode-toggle">
          {CLASSIFICATION_OPTIONS.map((c) => (
            <button
              key={c}
              className={classificationFilter.has(c) ? "active" : ""}
              onClick={() => setClassificationFilter((prev) => toggleInSet(prev, c))}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <h3>ポジション</h3>
        <div className="mode-toggle">
          {POSITION_OPTIONS.map((pos) => (
            <button
              key={pos}
              className={positionFilter.has(pos) ? "active" : ""}
              onClick={() => setPositionFilter((prev) => toggleInSet(prev, pos))}
              type="button"
            >
              {pos}
            </button>
          ))}
        </div>
      </div>

      <div className="filter-block">
        <h3>クラブ</h3>
        <div className="mode-toggle">
          {(teams ?? [])
            .slice()
            .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja"))
            .map((t) => (
              <button
                key={t.teamId}
                className={teamFilter.has(t.teamId) ? "active" : ""}
                onClick={() => setTeamFilter((prev) => toggleInSet(prev, t.teamId))}
                type="button"
              >
                {teamShortName(t.teamId, t.teamName)}
              </button>
            ))}
        </div>
      </div>

      <GamesPlayedRatioSlider
        min={minRatio}
        max={maxRatio}
        onChange={(mn, mx) => {
          setMinRatio(mn);
          setMaxRatio(mx);
        }}
      />

      <div className="filter-block">
        <h3>シチュエーション別フィルタ</h3>
        <SituationalFilterPicker filter={situationalFilter} onChange={setSituationalFilter} opponentWinRateSupported={!!gameSummaries} />
        {filterActive && (
          <p className="page-subtitle">
            シチュエーション別フィルタ選択中は、トラディショナル/アドバンスド/Misc/スコアリングの各タブとも選手ごとの試合ログを絞り込んで再集計した値を表示します（シューティングタブは対象外）
          </p>
        )}
      </div>

      <div className="tab-bar">
        {TAB_LABELS.map((t) => (
          <button key={t.key} className={`tab-button${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)} type="button">
            {t.label}
          </button>
        ))}
      </div>

      {tab === "shooting" && !yahooPbpSupported ? (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      ) : gameDataLoading || teamDataLoading ? (
        <p className="loading">読み込み中...</p>
      ) : filteredPlayers.length === 0 ? (
        <p className="empty-message">条件に該当する選手がいません</p>
      ) : (
        <>
          <div className="table-scroll">
            <SortableTable
              key={`${tab}|${tab === "traditional" || tab === "advanced" ? filterActive : false}`}
              columns={columns}
              rows={tableRows}
              rowKey={(r) => r.player.playerId}
              defaultSortKey={defaultSort.key}
              defaultSortDir={defaultSort.dir}
              linkTo={(r) => `/players/${r.player.playerId}`}
              limit={visibleCount}
            />
          </div>
          {visibleCount < tableRows.length && (
            <button className="load-more-button" type="button" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
              もっと見る（あと{tableRows.length - visibleCount}人）
            </button>
          )}
          <p className="page-subtitle">
            {Math.min(visibleCount, tableRows.length)}/{tableRows.length}人を表示中（初期表示は得点（PTS）降順）。列見出しクリックでの並び替えは常に全選手が対象です。Misc/スコアリングタブ、またはシチュエーション別フィルタ選択中は選手ごとの試合ログをまとめて取得するため、初めて開いたときのみ読み込みに時間がかかります
          </p>
        </>
      )}
    </div>
  );
}

// 「歴代記録」タブ。data/league-player-rankings.json（scripts/aggregate-league-player-rankings.ts、
// 手動実行のバッチ処理）を使い、過去在籍した全選手横断で通算成績（PLAYER_CAREER_TOTAL_DEFS）の
// ランキングを表示する。チーム版のLeagueRecordsTabと同じ構成（ホーム/アウェイ/トータル・
// レギュラー/プレーオフ/合算の切り替え＋項目ピッカー）だが、通算成績のみでカテゴリ切り替えは
// 無い（クラブレコード相当は今回のスコープ外、ユーザー指定）。順位・対象選手数はJSON側で
// 既に算出済みのため、フロントエンドは項目・ホーム/アウェイ/トータル・レギュラー/プレーオフ/
// 合算を選んで該当の[gameType][statKey][playerId]テーブルをrank昇順に並べ替えるだけでよい
type LeagueVenue = "total" | "home" | "away";
const LEAGUE_VENUE_LABELS: Record<LeagueVenue, string> = { total: "トータル", home: "ホーム", away: "アウェイ" };

function leagueTableFor(rankings: LeaguePlayerRankingsFile, venue: LeagueVenue, gameType: SeasonGameTypeFilter, statKey: string) {
  const table = venue === "total" ? rankings.career : venue === "home" ? rankings.careerHome : rankings.careerAway;
  return table[gameType][statKey];
}

/** minMinutes（出場時間）はformatMinutesFromSecondsで、plusMinus（プラスマイナス）は符号付きで、
 * それ以外は桁区切り整数で表示する */
function formatLeaguePlayerRecordValue(statKey: string, value: number): string {
  if (statKey === "minMinutes") return formatMinutesFromSeconds(Math.round(value * 60));
  if (statKey === "plusMinus") return formatSigned(value, 0);
  return Math.round(value).toLocaleString();
}

interface LeaguePlayerRecordRow {
  playerId: string;
  entry: LeaguePlayerRankEntry;
}

function LeaguePlayerRecordsTab() {
  const {
    data: rankings,
    loading: rankingsLoading,
    error: rankingsError,
  } = useJsonData(() => fetchLeaguePlayerRankings(), []);

  const [venue, setVenue] = useState<LeagueVenue>("total");
  const [gameType, setGameType] = useState<SeasonGameTypeFilter>("regular");
  const [statKey, setStatKey] = useState("pts");

  if (rankingsLoading) return <p className="loading">読み込み中...</p>;
  if (rankingsError) return <p className="error-message">{rankingsError}</p>;
  if (!rankings) return <p className="empty-message">データがありません</p>;

  const entries = leagueTableFor(rankings, venue, gameType, statKey);
  const rows: LeaguePlayerRecordRow[] = entries
    ? Object.entries(entries)
        .map(([playerId, entry]) => ({ playerId, entry }))
        .sort((a, b) => a.entry.rank - b.entry.rank)
    : [];
  const totalPlayers = Object.keys(rankings.career.regular.pts ?? {}).length;
  const activeLabel = PLAYER_CAREER_TOTAL_DEFS.find((d) => d.key === statKey)?.label ?? statKey;

  return (
    <div>
      <p className="page-subtitle">
        過去在籍した全{totalPlayers}選手横断のランキング（{rankings.generatedAt.slice(0, 10)}
        時点。手動バッチで随時更新）。1試合単位の最高記録（クラブレコード相当）は対象外です
      </p>

      <div className="mode-toggle">
        {(Object.keys(LEAGUE_VENUE_LABELS) as LeagueVenue[]).map((v) => (
          <button key={v} className={v === venue ? "active" : ""} onClick={() => setVenue(v)} type="button">
            {LEAGUE_VENUE_LABELS[v]}
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
          <button key={g} className={g === gameType ? "active" : ""} onClick={() => setGameType(g)} type="button">
            {SEASON_GAME_TYPE_LABELS[g]}
          </button>
        ))}
      </div>
      <div className="stat-picker">
        {PLAYER_CAREER_TOTAL_DEFS.map((d) => (
          <button key={d.key} className={d.key === statKey ? "active" : ""} onClick={() => setStatKey(d.key)} type="button">
            {d.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="empty-message">この条件（ホーム/アウェイ/トータル・レギュラー/プレーオフ区分・項目）では該当選手がいません</p>
      ) : (
        <div className="table-scroll">
          <table className="sortable-table rankings-table">
            <thead>
              <tr>
                <th className="align-right">#</th>
                <th className="align-left">選手</th>
                <th className="align-right">{activeLabel}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const info = rankings.players[r.playerId];
                return (
                  <tr key={r.playerId}>
                    <td className="align-right rank-cell">{r.entry.rank}</td>
                    <td className="align-left">
                      <Link to={`/players/${r.playerId}?season=${info?.latestSeason ?? ""}`} className="cell-link">
                        <span className="player-cell">
                          <PlayerPhoto playerId={r.playerId} size={32} className="player-cell-photo" />
                          <span className="rank-name-cell">
                            <span className="rank-name">{info?.name ?? r.playerId}</span>
                            <span className="rank-sublabel">
                              {info ? teamShortName(info.teamId, info.teamName) : ""}・{info?.latestSeason}シーズンまで在籍確認
                            </span>
                          </span>
                        </span>
                      </Link>
                    </td>
                    <td className="align-right rank-value">{formatLeaguePlayerRecordValue(statKey, r.entry.value)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// 「歴代アワード」タブ。data/player-awards.json（PlayerAwardsFile、シーズン非依存のRecord<
// playerId, PlayerAwardEntry[]>）を、チーム版の「歴代王者」タブ（ChampionsTab）と同じ発想で
// シーズン軸の年表として表示する（ユーザー依頼2026-09-04）。取得済みの全区分
// （MVP・ベストファイブ・新人賞・各部門王等）が対象。
//
// 部門別表彰（得点王等）は末尾に"(B1)"のような`category`を持ち、年間表彰（MVP・ベストファイブ・
// 新人賞等）は`category`を持たない、という既存データの性質（44-2章）をそのままグループ分けの
// 判定に使う（要件2: 年間表彰と部門別表彰を分ける）。
//
// PlayerAwardEntryにはplayerIdとseason・賞名・categoryしか無く、選手名・所属チームは
// 含まれていないため、その受賞シーズンのplayers.json（PlayerSummary、B.PREMIER=B1のみ）から
// 解決する（players-master.jsonは「最近確認できた」所属のスナップショットのため、受賞シーズン
// 時点の所属とズレうる。歴代記録タブと同じ理由でシーズン別のplayers.jsonを優先する）。
// ただし部門別表彰にはB2区分（例:「得点王(B2)」）も含まれ、その受賞者はB.PREMIER側の
// players.jsonには登場しない（B.ONEのシーズン別バックフィルは2025-26のみ、DESIGN.md参照）。
// この場合のみ、季非依存のplayers-master.jsonから名前・チームをフォールバック解決する
// （「最近確認できた」値のため、受賞当時と異なるチーム名になりうる点は許容する）。個人詳細ページへの
// リンクは、歴代記録タブのlatestSeason方式とは異なり、その受賞シーズン自体をそのまま
// `?season=`に付ける（要件1。B.PREMIER受賞者はそのシーズンのplayers.jsonに選手が存在するため、
// 引退・移籍済み選手でも「選手が見つかりませんでした」を確実に回避できる）。
// ⚠️ 既知の制約: B2区分の受賞者はPlayerDetailPage側が常にcategory="premier"のplayers.jsonしか
// 参照しないため（サイト全体の既存の仕様、B.ONEの個人詳細ページ自体が未対応）、リンク自体は
// 生成されるが遷移先は「選手が見つかりませんでした」になる。今回のタブ固有の不具合ではなく、
// B.ONEバックフィルが2025-26シーズンのみ（DESIGN.md 14章）という既存のスコープ制約のため対応外
const ANNUAL_AWARD_ORDER = [
  "レギュラーシーズン最優秀選手賞",
  "レギュラーシーズンベストファイブ",
  "最優秀新人賞",
  "新人賞ベストファイブ",
];
const STAT_AWARD_ORDER = ["得点王", "リバウンド王", "アシスト王", "スティール王", "ブロック王", "ベスト3P成功率賞", "ベストFT成功率賞"];

interface AwardTimelineEntry {
  playerId: string;
  name: string;
  category?: string;
}

function awardsBySeasonFrom(awards: PlayerAwardsFile): Map<string, AwardTimelineEntry[]> {
  const map = new Map<string, AwardTimelineEntry[]>();
  for (const [playerId, entries] of Object.entries(awards)) {
    for (const e of entries) {
      const arr = map.get(e.season) ?? [];
      arr.push({ playerId, name: e.name, category: e.category });
      map.set(e.season, arr);
    }
  }
  return map;
}

function awardSortIndex(order: string[], name: string): number {
  const idx = order.indexOf(name);
  return idx === -1 ? order.length : idx;
}

function awardLabel(name: string, category: string | undefined): string {
  return category ? `${name}(${category})` : name;
}

function PlayerAwardsTimelineTab() {
  const { data: awards, loading: awardsLoading, error: awardsError } = useJsonData(() => fetchPlayerAwards(), []);
  const { data: playersMaster } = useJsonData(() => fetchPlayersMaster(), []);
  const playersMasterById = useMemo(
    () => new Map((playersMaster ?? []).map((p) => [p.playerId, p])),
    [playersMaster],
  );

  const awardsBySeason = useMemo(
    () => (awards ? awardsBySeasonFrom(awards) : new Map<string, AwardTimelineEntry[]>()),
    [awards],
  );
  const seasonsDesc = useMemo(() => [...awardsBySeason.keys()].sort().reverse(), [awardsBySeason]);

  const [playersBySeason, setPlayersBySeason] = useState<Map<string, PlayerSummary[]> | null>(null);
  const [playersLoading, setPlayersLoading] = useState(true);

  useEffect(() => {
    if (seasonsDesc.length === 0) {
      setPlayersBySeason(new Map());
      setPlayersLoading(false);
      return;
    }
    let cancelled = false;
    setPlayersLoading(true);
    Promise.all(
      seasonsDesc.map(async (s): Promise<readonly [string, PlayerSummary[]]> => {
        try {
          return [s, await fetchPlayers(s)] as const;
        } catch {
          return [s, []] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setPlayersBySeason(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setPlayersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [seasonsDesc]);

  if (awardsLoading) return <p className="loading">読み込み中...</p>;
  if (awardsError) return <p className="error-message">{awardsError}</p>;
  if (!awards) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <p className="page-subtitle">
        シーズン別の個人受賞歴年表（MVP・ベストファイブ・新人賞・各部門王等、取得済みの全区分）。選手名クリックで受賞シーズン時点の個人詳細ページへ遷移できる
      </p>

      {playersLoading && !playersBySeason ? (
        <p className="loading">読み込み中...</p>
      ) : seasonsDesc.length === 0 ? (
        <p className="empty-message">受賞データがありません</p>
      ) : (
        <div className="award-timeline">
          {seasonsDesc.map((season) => {
            const entries = awardsBySeason.get(season) ?? [];
            const annual = entries
              .filter((e) => e.category === undefined)
              .sort((a, b) => awardSortIndex(ANNUAL_AWARD_ORDER, a.name) - awardSortIndex(ANNUAL_AWARD_ORDER, b.name));
            const stat = entries
              .filter((e) => e.category !== undefined)
              .sort((a, b) => {
                const byName = awardSortIndex(STAT_AWARD_ORDER, a.name) - awardSortIndex(STAT_AWARD_ORDER, b.name);
                return byName !== 0 ? byName : (a.category ?? "").localeCompare(b.category ?? "");
              });
            const playerLookup = new Map((playersBySeason?.get(season) ?? []).map((p) => [p.playerId, p]));

            return (
              <div className="award-season-block" key={season}>
                <h2 className="award-season-heading">{season}</h2>
                <div className="award-season-groups">
                  {annual.length > 0 && (
                    <div className="honors-group award-group">
                      <h3>年間表彰</h3>
                      <ul>
                        {annual.map((e, i) => (
                          <AwardEntryRow
                            key={`${e.playerId}-${e.name}-${i}`}
                            entry={e}
                            season={season}
                            player={playerLookup.get(e.playerId)}
                            master={playersMasterById.get(e.playerId)}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                  {stat.length > 0 && (
                    <div className="honors-group award-group">
                      <h3>部門別表彰</h3>
                      <ul>
                        {stat.map((e, i) => (
                          <AwardEntryRow
                            key={`${e.playerId}-${e.name}-${e.category}-${i}`}
                            entry={e}
                            season={season}
                            player={playerLookup.get(e.playerId)}
                            master={playersMasterById.get(e.playerId)}
                          />
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AwardEntryRow({
  entry,
  season,
  player,
  master,
}: {
  entry: AwardTimelineEntry;
  season: string;
  player: PlayerSummary | undefined;
  master: PlayerMasterEntry | undefined;
}) {
  const name = player?.name ?? master?.name ?? entry.playerId;
  const team = player
    ? teamShortName(player.teamId, player.teamName)
    : master
      ? teamShortName(master.teamId, master.teamName)
      : undefined;
  return (
    <li className="award-entry">
      <Link to={`/players/${entry.playerId}?season=${season}`} className="cell-link">
        <span className="player-cell">
          <PlayerPhoto playerId={entry.playerId} size={32} className="player-cell-photo" />
          <span className="rank-name-cell">
            <span className="rank-name">{name}</span>
            <span className="rank-sublabel">
              {awardLabel(entry.name, entry.category)}
              {team ? `・${team}` : ""}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

// 「直近成績」タブ。チーム版RecentFormTab（TeamsListPage.tsx）と同じ考え方で、直近5試合/
// 直近10試合の成績を軸にした選手ランキングを表示する（ユーザー依頼2026-09-05）。対象は
// このシーズンのplayers.jsonに登場する全選手（移籍選手も直近所属チームでそのまま扱う、
// 既存の「全選手スタッツ」タブと同じ前提）。表示項目はチーム版の構成（得点/失点/勝率/
// レーティング等）を選手向けに読み替え、基本スタッツ（PTS/REB/AST/STL/BLK/TOV）・シュート
// 効率（FG%/3P%/FT%/eFG%/TS%）・EFF（貢献度）・+/-・対戦相手の加重平均勝率を対象にした（要件2）。
//
// データソース: 全選手分のPlayerGameLogを一括取得し（既存のMisc/スコアリングタブと同じ方式、
// タブを開いたときに1回だけ取得する）、situational.tsのfilterGameLogs({range:{kind:"recent",
// n}, includePlayoffs:true})でその選手の直近N試合に絞り込む。EFFはshared/formulas.tsのeff()を、
// 絞り込んだ直近N試合分のEffTotals合計値に対して1回だけ適用する（シーズン集計・チーム版
// ORtg/DRtgと同じ「合計してから式を1回適用する」方針、非線形性を避けるため）。対戦相手の
// 加重平均勝率は、チーム版と全く同じbuildRecordsBeforeGame()（48章）をそのまま再利用する
// （対戦相手はチーム単位のため、選手のopponentTeamIdでそのまま引ける）。
//
// 要件4: 出場機会が極端に少ない選手（直近5試合中1試合のみ出場等）が上位に出やすい問題への
// 対処として、直近N試合中の出場試合数がN/2未満（切り上げ。N=5→3試合未満、N=10→5試合未満）の
// 選手はランキング対象から除外する。既存のPER・シュート成功率のランキング足切り
// （statDefs.tsのminMinutesForRanking・MIN_GAMES_PLAYED_RATIO_FOR_RANKING）と同じ考え方を、
// 「直近N試合」という短い窓に合わせて適用したもの
const RECENT_FORM_N_OPTIONS = [5, 10] as const;
type PlayerRecentFormRecentN = (typeof RECENT_FORM_N_OPTIONS)[number];
const MIN_GAMES_FOR_PLAYER_RECENT_FORM: Record<PlayerRecentFormRecentN, number> = { 5: 3, 10: 5 };

interface PlayerRecentFormRow {
  player: PlayerSummary;
  gamesPlayed: number;
  minAvg: number;
  ptsAvg: number;
  rebAvg: number;
  astAvg: number;
  stlAvg: number;
  blkAvg: number;
  tovAvg: number;
  fgPct: number;
  tpPct: number;
  ftPct: number;
  efgPctValue: number;
  tsPctValue: number;
  effValue: number;
  plusMinusAvg: number;
  /** 対戦相手のその試合時点までの勝率の単純平均。算出対象の試合が1件も無ければundefined */
  oppWinPctAvg: number | undefined;
}

function PlayerRecentFormTab({ season }: { season: string }) {
  const { data: players, loading: playersLoading, error: playersError } = useJsonData(() => fetchPlayers(season), [season]);

  const [gameLogs, setGameLogs] = useState<Map<string, PlayerGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(true);
  const [summaries, setSummaries] = useState<GameSummary[] | null>(null);
  const [recentN, setRecentN] = useState<PlayerRecentFormRecentN>(5);

  useEffect(() => {
    if (!players) return;
    let cancelled = false;
    setGameLogsLoading(true);
    setGameLogs(null);
    Promise.all(
      players.map(async (p): Promise<readonly [string, PlayerGameLog[]]> => {
        try {
          return [p.playerId, await fetchPlayerGameLogs(season, p.playerId)] as const;
        } catch {
          return [p.playerId, [] as PlayerGameLog[]] as const;
        }
      }),
    )
      .then((results) => {
        if (!cancelled) setGameLogs(new Map(results));
      })
      .finally(() => {
        if (!cancelled) setGameLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [players, season]);

  // 「対戦相手の加重平均勝率」用。チーム版RecentFormTabと同じbuildRecordsBeforeGame()（48章の
  // 対勝率別フィルタと同じロジック）をそのまま再利用し、各対戦相手のその試合時点までの
  // 勝敗数を求める
  useEffect(() => {
    let cancelled = false;
    setSummaries(null);
    fetchGameSummaries(season)
      .then((s) => {
        if (!cancelled) setSummaries(s);
      })
      .catch(() => {
        // 対戦相手の加重平均勝率が算出できなくなるだけなので、失敗しても他の項目は継続する
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const opponentRecords = useMemo<Map<string, Map<string, RecordBeforeGame>> | undefined>(
    () => (summaries ? buildRecordsBeforeGame(summaries) : undefined),
    [summaries],
  );

  const seasonStartYear = Number(season.split("-")[0]);
  const minGames = MIN_GAMES_FOR_PLAYER_RECENT_FORM[recentN];

  const rows: PlayerRecentFormRow[] = useMemo(() => {
    if (!players || !gameLogs) return [];
    return players
      .map((player): PlayerRecentFormRow => {
        const logs = gameLogs.get(player.playerId) ?? [];
        const recentLogs = filterGameLogs(logs, { range: { kind: "recent", n: recentN }, includePlayoffs: true });
        const gamesPlayed = recentLogs.length;
        const sum = (pick: (g: PlayerGameLog) => number) => recentLogs.reduce((s, g) => s + pick(g), 0);
        const ptsSum = sum((g) => g.pts);
        const fgmSum = sum((g) => g.fgm);
        const fgaSum = sum((g) => g.fga);
        const tpmSum = sum((g) => g.tpm);
        const tpaSum = sum((g) => g.tpa);
        const ftmSum = sum((g) => g.ftm);
        const ftaSum = sum((g) => g.fta);
        const effValue = eff(
          seasonStartYear,
          {
            pts: ptsSum,
            ast: sum((g) => g.ast),
            blk: sum((g) => g.blk),
            stl: sum((g) => g.stl),
            reb: sum((g) => g.reb),
            tov: sum((g) => g.tov),
            pf: sum((g) => g.pf),
            fgm: fgmSum,
            fga: fgaSum,
            ftm: ftmSum,
            fta: ftaSum,
            foulsDrawn: sum((g) => g.foulsDrawn),
            blockedAgainst: sum((g) => g.blockedAgainst),
            technicalFouls: sum((g) => g.technicalFouls),
          },
          gamesPlayed,
        );
        const oppWinPcts = recentLogs.flatMap((g) => {
          const rec = opponentRecords?.get(g.scheduleKey)?.get(g.opponentTeamId);
          if (!rec || rec.wins + rec.losses === 0) return [];
          return [safeDiv(rec.wins, rec.wins + rec.losses)];
        });
        const oppWinPctAvg =
          oppWinPcts.length > 0 ? safeDiv(oppWinPcts.reduce((s, v) => s + v, 0), oppWinPcts.length) : undefined;
        return {
          player,
          gamesPlayed,
          minAvg: safeDiv(sum((g) => g.min), gamesPlayed),
          ptsAvg: safeDiv(ptsSum, gamesPlayed),
          rebAvg: safeDiv(sum((g) => g.reb), gamesPlayed),
          astAvg: safeDiv(sum((g) => g.ast), gamesPlayed),
          stlAvg: safeDiv(sum((g) => g.stl), gamesPlayed),
          blkAvg: safeDiv(sum((g) => g.blk), gamesPlayed),
          tovAvg: safeDiv(sum((g) => g.tov), gamesPlayed),
          fgPct: safeDiv(fgmSum, fgaSum),
          tpPct: safeDiv(tpmSum, tpaSum),
          ftPct: safeDiv(ftmSum, ftaSum),
          efgPctValue: efgPct(fgmSum, tpmSum, fgaSum),
          tsPctValue: tsPct(ptsSum, fgaSum, ftaSum),
          effValue,
          plusMinusAvg: safeDiv(sum((g) => g.plusMinus), gamesPlayed),
          oppWinPctAvg,
        };
      })
      .filter((r) => r.gamesPlayed >= minGames);
  }, [players, gameLogs, recentN, opponentRecords, seasonStartYear, minGames]);

  const columns: Column<PlayerRecentFormRow>[] = [
    {
      key: "name",
      label: "選手",
      align: "left",
      sortValue: (r) => r.player.name,
      render: (r) => (
        <span className="player-cell">
          <PlayerPhoto playerId={r.player.playerId} size={32} className="player-cell-photo" />
          <span className="player-cell-name">{r.player.name}</span>
        </span>
      ),
    },
    {
      key: "team",
      label: "チーム",
      align: "left",
      sortValue: (r) => teamShortName(r.player.teamId, r.player.teamName),
      format: (r) => teamShortName(r.player.teamId, r.player.teamName),
    },
    { key: "g", label: "G", sortValue: (r) => r.gamesPlayed, format: (r) => String(r.gamesPlayed) },
    {
      key: "min",
      label: "MIN",
      sortValue: (r) => r.minAvg,
      format: (r) => formatMinutesFromSeconds(Math.round(r.minAvg * 60)),
    },
    { key: "pts", label: "PTS", sortValue: (r) => r.ptsAvg, format: (r) => formatDecimal(r.ptsAvg) },
    { key: "reb", label: "REB", sortValue: (r) => r.rebAvg, format: (r) => formatDecimal(r.rebAvg) },
    { key: "ast", label: "AST", sortValue: (r) => r.astAvg, format: (r) => formatDecimal(r.astAvg) },
    { key: "stl", label: "STL", sortValue: (r) => r.stlAvg, format: (r) => formatDecimal(r.stlAvg) },
    { key: "blk", label: "BLK", sortValue: (r) => r.blkAvg, format: (r) => formatDecimal(r.blkAvg) },
    { key: "tov", label: "TOV", sortValue: (r) => r.tovAvg, format: (r) => formatDecimal(r.tovAvg) },
    { key: "fgpct", label: "FG%", sortValue: (r) => r.fgPct, format: (r) => formatPct(r.fgPct) },
    { key: "3ppct", label: "3P%", sortValue: (r) => r.tpPct, format: (r) => formatPct(r.tpPct) },
    { key: "ftpct", label: "FT%", sortValue: (r) => r.ftPct, format: (r) => formatPct(r.ftPct) },
    { key: "efgpct", label: "eFG%", sortValue: (r) => r.efgPctValue, format: (r) => formatPct(r.efgPctValue) },
    { key: "tspct", label: "TS%", sortValue: (r) => r.tsPctValue, format: (r) => formatPct(r.tsPctValue) },
    { key: "eff", label: "EFF", sortValue: (r) => r.effValue, format: (r) => formatDecimal(r.effValue) },
    { key: "plusMinus", label: "+/-", sortValue: (r) => r.plusMinusAvg, format: (r) => formatSigned(r.plusMinusAvg) },
    {
      key: "oppWinPct",
      label: "対戦相手の加重平均勝率",
      sortValue: (r) => r.oppWinPctAvg ?? -1,
      format: (r) => (r.oppWinPctAvg !== undefined ? formatPct(r.oppWinPctAvg) : "-"),
    },
  ];

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;
  if (!players || players.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <p className="page-subtitle">
        {season}シーズン、直近{recentN}試合中{minGames}試合以上出場した選手による成績ランキング
        （レギュラーシーズン・プレーオフ合算）。出場試合数が少なすぎる選手は数値が振れやすいため
        対象外にしています。EFFは直近{recentN}試合の合計値から算出。対戦相手の加重平均勝率は、
        直近{recentN}試合の各対戦相手のその試合時点までの勝率を単純平均したもの（対戦相手が
        未消化の試合は対象外）
      </p>
      <div className="mode-toggle">
        {RECENT_FORM_N_OPTIONS.map((n) => (
          <button key={n} className={n === recentN ? "active" : ""} onClick={() => setRecentN(n)} type="button">
            直近{n}試合
          </button>
        ))}
      </div>
      {gameLogsLoading || !gameLogs ? (
        <p className="loading">読み込み中...</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件では該当選手がいません</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.player.playerId}
            defaultSortKey="pts"
            linkTo={(r) => `/players/${r.player.playerId}`}
          />
        </div>
      )}
    </div>
  );
}
