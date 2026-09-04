import { useEffect, useMemo, useRef, useState } from "react";
import { fetchPlayerGameLogs, fetchPlayers, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { useYahooPbpCoverage } from "../lib/useSeasonCoverage";
import type { PlayerGameLog, PlayerSummary } from "../../shared/types";
import { SortableTable, type Column } from "../components/SortableTable";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { formatDecimal, formatPct, formatPct100, formatSigned } from "../lib/format";
import { astToTovRatio, formatAstToRatio, formatMinutesFromSeconds } from "../lib/boxscoreAggregate";
import { safeDiv, tovPct } from "../../shared/formulas";
import { teamShortName } from "../../shared/teamNames";
import { shotTypeEntityColumns, sortShotTypeKeys } from "../lib/shotTypeBreakdown";
import {
  buildSeasonBoxscoreCtx,
  EMPTY_TEAM_TOTALS,
  SEASON_BOX_TABS,
  SEASON_MISC_COLUMNS,
  SEASON_SCORING_COLUMNS,
  sumPlayerGameLogs,
  type SeasonBoxTabKey,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type TeamSeasonRawTotals,
} from "../lib/playerSeasonBoxscore";

// 「個人」ページを、チーム版の「全チームスタッツ」（TeamsListPage.tsx）と同じ考え方で
// 「全選手スタッツ一覧」に統合したもの（ユーザー依頼、2026-09-04）。
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

const LEADING_COLUMNS: Column<PlayerRow>[] = [nameColumn, teamColumn, gamesColumn];

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

// Misc/スコアリングは、シーズン別成績等と同じSeasonBoxscoreColumnをそのまま流用する
// （先頭3列=G/MIN/PTSは既に上のminColumn/ptsColumn/gamesColumnで賄っているため除く）。
// ctx未取得（player-games取得前）の間は "-" / 0 を返す
function toRowColumns(cols: SeasonBoxscoreColumn[]): Column<PlayerRow>[] {
  return cols.slice(3).map((col) => ({
    key: col.key,
    label: col.label,
    sortValue: (r: PlayerRow) => (r.ctx ? col.value(r.ctx, "perGame") : 0),
    format: (r: PlayerRow) => (r.ctx ? col.format(r.ctx, "perGame") : "-"),
  }));
}

const MISC_COLUMNS: Column<PlayerRow>[] = [...LEADING_COLUMNS, minColumn, ptsColumn, ...toRowColumns(SEASON_MISC_COLUMNS)];
const SCORING_COLUMNS: Column<PlayerRow>[] = [...LEADING_COLUMNS, minColumn, ptsColumn, ...toRowColumns(SEASON_SCORING_COLUMNS)];

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

export function PlayersListPage({ season }: { season: string }) {
  const { data: players, loading: playersLoading, error: playersError } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  const { supported: yahooPbpSupported } = useYahooPbpCoverage(season);

  const [tab, setTab] = useState<PlayersPageTab>("traditional");
  const [minRatio, setMinRatio] = useState(DEFAULT_MIN_RATIO);
  const [maxRatio, setMaxRatio] = useState(DEFAULT_MAX_RATIO);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const [gameLogs, setGameLogs] = useState<Map<string, PlayerGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(false);
  const gameLogsFetchedForSeasonRef = useRef<string | null>(null);

  useEffect(() => {
    setTab("traditional");
    setMinRatio(DEFAULT_MIN_RATIO);
    setMaxRatio(DEFAULT_MAX_RATIO);
    setVisibleCount(PAGE_SIZE);
    setGameLogs(null);
    gameLogsFetchedForSeasonRef.current = null;
  }, [season]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [minRatio, maxRatio]);

  useEffect(() => {
    const needsLogs = tab === "misc" || tab === "scoring";
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
  }, [tab, players, season]);

  const teamGamesById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t.gamesPlayed])), [teams]);
  const teamTotalsById = useMemo(() => new Map((teams ?? []).map((t) => [t.teamId, t.totals])), [teams]);
  const seasonStartYear = Number(season.split("-")[0]);

  const filteredPlayers = useMemo(() => {
    if (!players) return [];
    return players.filter((p) => {
      const teamGames = teamGamesById.get(p.teamId);
      if (!teamGames) return false;
      const ratio = (100 * p.gamesPlayed) / teamGames;
      return ratio >= minRatio && ratio <= maxRatio;
    });
  }, [players, teamGamesById, minRatio, maxRatio]);

  // limit（SortableTable側で全件ソートしてから先頭visibleCount件だけ描画する）と組み合わせる
  // ため、rowsは常にフィルタ後の全選手分を作る（もっと見るを押す前でも列ソートが正しく
  // 全選手を対象に機能するようにするため）
  const rows: PlayerRow[] = useMemo(
    () =>
      filteredPlayers.map((p) => {
        if (!gameLogs) return { player: p };
        const logs = gameLogs.get(p.playerId) ?? [];
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
    [filteredPlayers, gameLogs, teamTotalsById, seasonStartYear],
  );

  const shootingRows = rows.filter((r) => r.player.shotTypes);
  const shotTypeKeys = sortShotTypeKeys([...new Set(shootingRows.flatMap((r) => Object.keys(r.player.shotTypes ?? {})))]);
  const shootingColumns: Column<PlayerRow>[] = [nameColumn, teamColumn, ...shotTypeEntityColumns<PlayerRow>(shotTypeKeys, (r) => r.player.shotTypes)];

  const columns =
    tab === "shooting"
      ? shootingColumns
      : tab === "traditional"
        ? TRADITIONAL_COLUMNS
        : tab === "advanced"
          ? ADVANCED_COLUMNS
          : tab === "misc"
            ? MISC_COLUMNS
            : SCORING_COLUMNS;

  const tableRows = tab === "shooting" ? shootingRows : rows;
  const defaultSort = DEFAULT_SORT[tab];
  const needsGameLogs = tab === "misc" || tab === "scoring";

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;
  if (!players || players.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <h1>個人スタッツ</h1>
      <p className="page-subtitle">
        {season}シーズン・全{players.length}選手
      </p>

      <GamesPlayedRatioSlider
        min={minRatio}
        max={maxRatio}
        onChange={(mn, mx) => {
          setMinRatio(mn);
          setMaxRatio(mx);
        }}
      />

      <div className="tab-bar">
        {TAB_LABELS.map((t) => (
          <button key={t.key} className={`tab-button${tab === t.key ? " active" : ""}`} onClick={() => setTab(t.key)} type="button">
            {t.label}
          </button>
        ))}
      </div>

      {tab === "shooting" && !yahooPbpSupported ? (
        <p className="empty-message">このシーズンのデータには対応していません</p>
      ) : needsGameLogs && (gameLogsLoading || !gameLogs) ? (
        <p className="loading">読み込み中...</p>
      ) : filteredPlayers.length === 0 ? (
        <p className="empty-message">条件に該当する選手がいません</p>
      ) : (
        <>
          <div className="table-scroll">
            <SortableTable
              key={tab}
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
            {Math.min(visibleCount, tableRows.length)}/{tableRows.length}人を表示中（初期表示は得点（PTS）降順）。列見出しクリックでの並び替えは常に全選手が対象です。Misc/スコアリングタブは選手ごとの試合ログをまとめて取得するため、初めて開いたときのみ読み込みに時間がかかります
          </p>
        </>
      )}
    </div>
  );
}
