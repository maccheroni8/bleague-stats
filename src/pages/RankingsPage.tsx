import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchPlayerGameLogs, fetchPlayers, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { PLAYER_STAT_DEFS } from "../lib/statDefs";
import { ExportImageButton } from "../components/ExportImageButton";
import { ExternalLinkIcon } from "../components/ExternalLinkIcon";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { BOXSCORE_TABS, type BoxscoreTabKey } from "../components/BoxscoreTable";
import type { Column } from "../components/SortableTable";
import { SituationalFilterPicker } from "../components/SituationalFilterPicker";
import { computePlayerSituationalStats, filterGameLogs, isDefaultFilter, type PlayerSituationalStats, type SituationalFilter } from "../lib/situational";
import {
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  filterByGameType,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
} from "../lib/playerSeasonBoxscore";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  DEFAULT_SORT_KEY,
  sumTeamGameLogs,
  TEAM_PERSPECTIVE_LABELS,
  type AllTeamsRow,
  type TeamPerspective,
} from "../lib/teamStatsColumns";
import { useAllTeamGameLogs, useLeagueSituationalContext } from "../lib/teamRankingData";
import { isShotChartSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import { CLASSIFICATION_OPTIONS, matchesClassificationFilter, toggleInSet } from "../lib/classificationFilter";
import {
  EXTRA_ELIGIBILITY_RULES,
  MIN_GAMES_PLAYED_RATIO_FOR_RANKING,
  filterEligiblePlayers,
} from "../lib/playerRankingEligibility";
import { formatDecimal, formatPct, formatSigned } from "../lib/format";
import type { PlayerGameLog, PlayerSummary, TeamColors } from "../../shared/types";

type Mode = "team" | "player";

/**
 * RankedListが実際に使う最小限の形（key/label/value/format）。statDefs.tsのStatDef<T>は
 * これを内包する上位互換の型のため、PLAYER_STAT_DEFS等をそのまま渡せる（構造的部分型）。
 * チーム版ランキング（COLUMNS_BY_TAB由来のColumn<AllTeamsRow>から都度組み立てる）は
 * formulaText等のグロッサリー用メタ情報を持たないため、この最小型にしてある
 */
interface RankableStat<T> {
  key: string;
  label: string;
  value: (row: T) => number;
  format: (row: T) => string;
}

interface RankedListProps<T> {
  rows: T[];
  def: RankableStat<T>;
  rowKey: (row: T) => string;
  name: (row: T) => string;
  subLabel?: (row: T) => string;
  linkTo: (row: T) => string;
  /** 指定時、名前の直後にBリーグ公式サイトへの外部リンクアイコンを表示する（選手モードのみ） */
  externalLinkTo?: (row: T) => string | undefined;
  teamColor?: (row: T) => string | undefined;
  /** 指定時、名前の左にロゴ・写真等を表示する */
  avatar?: (row: T) => ReactNode;
  /** 指定時、ソート後の上位この件数だけを表示する（未指定は全件） */
  limit?: number;
}

function RankedList<T>({ rows, def, rowKey, name, subLabel, linkTo, externalLinkTo, teamColor, avatar, limit }: RankedListProps<T>) {
  const sorted = [...rows].sort((a, b) => def.value(b) - def.value(a));
  const limited = limit !== undefined ? sorted.slice(0, limit) : sorted;
  return (
    <div className="table-scroll">
      <table className="sortable-table rankings-table">
        <thead>
          <tr>
            <th className="align-right">#</th>
            <th className="align-left">名前</th>
            <th className="align-right">{def.label}</th>
          </tr>
        </thead>
        <tbody>
          {limited.map((row, i) => {
            const accent = teamColor?.(row);
            return (
              <tr key={rowKey(row)}>
                <td
                  className={`align-right rank-cell${accent ? " row-accent-cell" : ""}`}
                  style={accent ? { borderLeftColor: accent } : undefined}
                >
                  {i + 1}
                </td>
                <td className={`align-left${externalLinkTo?.(row) ? " has-external-link" : ""}`}>
                  <Link to={linkTo(row)} className="cell-link">
                    <span className="rank-name-with-logo">
                      {avatar?.(row)}
                      <span className="rank-name-cell">
                        <span className="rank-name">{name(row)}</span>
                        {subLabel && <span className="rank-sublabel">{subLabel(row)}</span>}
                      </span>
                    </span>
                  </Link>
                  {externalLinkTo?.(row) && (
                    <ExternalLinkIcon href={externalLinkTo(row)!} title="Bリーグ公式サイトで見る（新しいタブで開く）" />
                  )}
                </td>
                <td className="align-right rank-value">{def.format(row)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function buildTeamCategoryColumns(
  category: BoxscoreTabKey,
  mode: SeasonDisplayMode,
  perspective: TeamPerspective,
  paintSupported: boolean,
): Column<AllTeamsRow>[] {
  switch (category) {
    case "traditional":
      return buildTraditionalColumns(mode, perspective);
    case "advanced":
      return buildAdvancedColumns(mode, perspective);
    case "misc":
      return buildMiscColumns(mode, perspective);
    case "scoring":
      return buildScoringColumns(perspective, paintSupported);
  }
}

const DISPLAY_MODE_OPTIONS: SeasonDisplayMode[] = ["perGame", "total"];
const TEAM_PERSPECTIVE_OPTIONS: TeamPerspective[] = ["own", "opp", "diff"];

/**
 * ランキングページのチーム版。チーム詳細ページ「チームスタッツ」タブ・「チーム」ページ
 * 「全チームスタッツ」タブと同じ項目（トラディショナル/アドバンスド/Misc/スコアリング、
 * シチュエーション別成績、自チーム/opp/+/-、平均/合計、レギュラー/プレーオフ/合算）を
 * 使い、スタッツ項目を1つ選んで全所属チームをランキング表示する形にしたもの（DESIGN.md参照）。
 * データ計算そのものはTeamsListPage.tsxの「全チームスタッツ」タブと同じ
 * src/lib/teamStatsColumns.ts・src/lib/teamRankingData.tsを共通利用しており、
 * 見せ方だけが「多数列の一覧表」か「1項目ずつのランキング」かで異なる
 */
function TeamRankingSection({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season), [season]);
  const { coverage } = useSeasonCoverage(season);
  const paintSupported = isShotChartSupported(coverage);

  const { gameLogsByTeam, loading: gameLogsLoading } = useAllTeamGameLogs(season, teams);
  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season);

  const [category, setCategory] = useState<BoxscoreTabKey>("traditional");
  const [statKey, setStatKey] = useState(DEFAULT_SORT_KEY.traditional);
  const [displayMode, setDisplayMode] = useState<SeasonDisplayMode>("perGame");
  const [gameType, setGameType] = useState<SeasonGameTypeFilter>("regular");
  const [perspective, setPerspective] = useState<TeamPerspective>("own");
  const [filter, setFilter] = useState<SituationalFilter>({ range: { kind: "all" } });

  const selectCategory = (next: BoxscoreTabKey) => {
    setCategory(next);
    setStatKey(DEFAULT_SORT_KEY[next]);
  };

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    return teams.map((team) => {
      const logs = gameLogsByTeam.get(team.teamId) ?? [];
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season);
      const scoped = filterByGameType(situational, gameType);
      const wins = scoped.filter((g) => g.win).length;
      return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals: sumTeamGameLogs(scoped) };
    });
  }, [teams, gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season]);

  const columns = useMemo(
    () => buildTeamCategoryColumns(category, displayMode, perspective, paintSupported),
    [category, displayMode, perspective, paintSupported],
  );
  const selectedColumn = columns.find((c) => c.key === statKey) ?? columns[0]!;
  const teamDef: RankableStat<AllTeamsRow> = {
    key: selectedColumn.key,
    label: selectedColumn.label,
    value: (row) => Number(selectedColumn.sortValue(row)),
    format: (row) => (selectedColumn.format ? selectedColumn.format(row) : String(selectedColumn.sortValue(row))),
  };

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <>
      <SituationalFilterPicker
        filter={filter}
        onChange={setFilter}
        opponentWinRateSupported={!!opponentRecords}
        hideGameTypeToggle
      />
      <div className="mode-toggle">
        {(Object.keys(SEASON_GAME_TYPE_LABELS) as SeasonGameTypeFilter[]).map((g) => (
          <button key={g} className={g === gameType ? "active" : ""} onClick={() => setGameType(g)} type="button">
            {SEASON_GAME_TYPE_LABELS[g]}
          </button>
        ))}
      </div>
      <div className="mode-toggle">
        {TEAM_PERSPECTIVE_OPTIONS.map((p) => (
          <button key={p} className={p === perspective ? "active" : ""} onClick={() => setPerspective(p)} type="button">
            {TEAM_PERSPECTIVE_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="tab-bar-with-toggle">
        <div className="tab-bar">
          {BOXSCORE_TABS.map((t) => (
            <button
              key={t.key}
              className={`tab-button${category === t.key ? " active" : ""}`}
              onClick={() => selectCategory(t.key)}
              type="button"
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mode-toggle">
          {DISPLAY_MODE_OPTIONS.map((m) => (
            <button key={m} className={m === displayMode ? "active" : ""} onClick={() => setDisplayMode(m)} type="button">
              {SEASON_DISPLAY_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </div>

      <div className="stat-picker">
        {columns.map((c) => (
          <button key={c.key} className={c.key === statKey ? "active" : ""} onClick={() => setStatKey(c.key)} type="button">
            {c.label}
          </button>
        ))}
      </div>

      {gameLogsLoading || !gameLogsByTeam ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <ExportImageButton
            targetRef={exportRef}
            filename={`ranking-team-${category}-${teamDef.key}-${perspective}-${displayMode}-${gameType}.png`}
          />
          <div ref={exportRef} className="export-target">
            <RankedList
              rows={rows}
              def={teamDef}
              rowKey={(r) => r.team.teamId}
              name={(r) => r.team.teamName}
              linkTo={(r) => `/teams/${r.team.teamId}`}
              teamColor={(r) => teamColors?.[r.team.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.team.teamId} size={22} />}
            />
          </div>
        </>
      )}
    </>
  );
}

const PLAYER_RANK_TOP_N = 20;

/** シチュエーション別フィルタ適用時、computePlayerSituationalStats()の結果から値を取り出す
 * アクセサ。対応するキーが無いスタッツ（EFF・Usage%・FTR・PER・PPS・PPP等）は、フィルタが
 * 選択されていてもシーズン合計値のまま表示する（DESIGN.md参照、既知の制約） */
const SITUATIONAL_STAT_ACCESSORS: Partial<Record<string, (s: PlayerSituationalStats) => number>> = {
  pts: (s) => s.perGame.pts,
  reb: (s) => s.perGame.reb,
  ast: (s) => s.perGame.ast,
  stl: (s) => s.perGame.stl,
  blk: (s) => s.perGame.blk,
  tov: (s) => s.perGame.tov,
  min: (s) => s.perGame.min,
  plusMinus: (s) => s.perGame.plusMinus,
  fgPct: (s) => s.shooting.fgPct,
  twoPct: (s) => s.shooting.twoPct,
  tpPct: (s) => s.shooting.tpPct,
  ftPct: (s) => s.shooting.ftPct,
  efgPct: (s) => s.shooting.efgPct,
  tsPct: (s) => s.shooting.tsPct,
};
const SITUATIONAL_PCT_KEYS = new Set(["fgPct", "twoPct", "tpPct", "ftPct", "efgPct", "tsPct"]);

function formatSituationalValue(key: string, value: number): string {
  if (key === "plusMinus") return formatSigned(value);
  if (SITUATIONAL_PCT_KEYS.has(key)) return formatPct(value);
  return formatDecimal(value);
}

/** 出場率スライダー・追加基準スライダーで共通利用する単一ハンドルの範囲スライダー
 * （PlayersListPage.tsxのGamesPlayedRatioSlider＝2本のtype="range"を重ねる下限/上限指定と
 * 同じ.dual-range系CSSクラスを流用するが、こちらはハンドルが1本の最低ライン指定のみ） */
function EligibilitySlider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="dual-range">
      <div className="dual-range-labels">
        {label}: {format(value)}以上
      </div>
      <div className="dual-range-track-wrap">
        <div className="dual-range-track">
          <div className="dual-range-fill" style={{ left: 0, width: `${pct}%` }} />
        </div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="dual-range-input"
          aria-label={label}
        />
      </div>
    </div>
  );
}

/**
 * ランキングページの選手版。掲載基準（所属チーム試合数の85%以上に出場、3P%/FT%/FG%/2P%は
 * さらに1試合あたりの試投/成功数の下限を併用）をスライダーで調整できるようにし、トップ20を
 * 表示する（DESIGN.md参照）。国籍区分の複数選択フィルタ・シチュエーション別フィルタにも対応する。
 *
 * シチュエーション別フィルタ選択時のみ、対象選手（掲載基準・国籍区分フィルタ通過後）の
 * PlayerGameLogを取得し、computePlayerSituationalStats()でフィルタ後の値を再計算する
 * （PlayersListPage.tsxの「全選手スタッツ」タブと同じ「フィルタ選択時のみ取得する」遅延方式）
 */
function PlayerRankingSection({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const { data: players, loading: playersLoading, error: playersError } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);

  const [statKey, setStatKey] = useState("pts");
  const [gamesRatio, setGamesRatio] = useState(MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
  const [extraThreshold, setExtraThreshold] = useState(EXTRA_ELIGIBILITY_RULES.pts?.defaultValue ?? 0);
  const [selectedClassifications, setSelectedClassifications] = useState<Set<NonNullable<PlayerSummary["classification"]>>>(
    () => new Set(),
  );
  const [filter, setFilter] = useState<SituationalFilter>({ range: { kind: "all" } });
  const filterActive = !isDefaultFilter(filter);

  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season);

  const [gameLogsByPlayer, setGameLogsByPlayer] = useState<Map<string, PlayerGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(false);
  const fetchedPlayerIdsRef = useRef<Set<string>>(new Set());

  const selectStat = (next: string) => {
    setStatKey(next);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[next]?.defaultValue ?? 0);
  };

  const eligible: PlayerSummary[] = useMemo(() => {
    if (!players || !teams) return [];
    return filterEligiblePlayers(players, teams, gamesRatio, statKey, extraThreshold).filter((p) =>
      matchesClassificationFilter(p, selectedClassifications),
    );
  }, [players, teams, gamesRatio, statKey, extraThreshold, selectedClassifications]);

  const covered = SITUATIONAL_STAT_ACCESSORS[statKey] !== undefined;

  // シーズンが変わったら取得済みキャッシュをリセットする
  useEffect(() => {
    fetchedPlayerIdsRef.current = new Set();
    setGameLogsByPlayer(null);
  }, [season]);

  // シチュエーション別フィルタが選択されている間だけ、対象選手（掲載基準・国籍区分フィルタ通過後）分の
  // PlayerGameLogを取得する（PlayersListPage.tsxの「全選手スタッツ」タブと同じ遅延取得方針）。
  // 出場率スライダー等で対象選手が増えても、既に取得済みの選手は再取得せず差分だけ追加する
  useEffect(() => {
    if (!filterActive || !covered || eligible.length === 0) return;
    const missing = eligible.filter((p) => !fetchedPlayerIdsRef.current.has(p.playerId));
    if (missing.length === 0) return;
    let cancelled = false;
    setGameLogsLoading(true);
    for (const p of missing) fetchedPlayerIdsRef.current.add(p.playerId);
    Promise.all(
      missing.map(async (p): Promise<readonly [string, PlayerGameLog[]]> => {
        try {
          return [p.playerId, await fetchPlayerGameLogs(season, p.playerId)] as const;
        } catch {
          return [p.playerId, [] as PlayerGameLog[]] as const;
        }
      }),
    )
      .then((results) => {
        if (cancelled) return;
        setGameLogsByPlayer((prev) => {
          const next = new Map(prev ?? []);
          for (const [id, logs] of results) next.set(id, logs);
          return next;
        });
      })
      .finally(() => {
        if (!cancelled) setGameLogsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filterActive, covered, eligible, season]);

  const situationalByPlayer = useMemo<Map<string, PlayerSituationalStats | null> | null>(() => {
    if (!filterActive || !covered || !gameLogsByPlayer) return null;
    const map = new Map<string, PlayerSituationalStats | null>();
    for (const p of eligible) {
      const logs = gameLogsByPlayer.get(p.playerId) ?? [];
      const filtered = filterGameLogs(logs, filter, opponentRecords, divisionHistory, season);
      map.set(p.playerId, computePlayerSituationalStats(filtered));
    }
    return map;
  }, [filterActive, covered, gameLogsByPlayer, eligible, filter, opponentRecords, divisionHistory, season]);

  const rows: PlayerSummary[] = useMemo(() => {
    if (!situationalByPlayer) return eligible;
    return eligible.filter((p) => situationalByPlayer.get(p.playerId) !== null);
  }, [eligible, situationalByPlayer]);

  const playerDefs = PLAYER_STAT_DEFS.filter((d) => !d.hiddenFromPicker);
  const statDef = PLAYER_STAT_DEFS.find((d) => d.key === statKey) ?? PLAYER_STAT_DEFS[0]!;
  const accessor = SITUATIONAL_STAT_ACCESSORS[statKey];

  const rankDef: RankableStat<PlayerSummary> = {
    key: statDef.key,
    label: statDef.label,
    value: (p) => {
      if (situationalByPlayer && accessor) {
        const s = situationalByPlayer.get(p.playerId);
        return s ? accessor(s) : Number.NEGATIVE_INFINITY;
      }
      return statDef.value(p);
    },
    format: (p) => {
      if (situationalByPlayer && accessor) {
        const s = situationalByPlayer.get(p.playerId);
        return s ? formatSituationalValue(statKey, accessor(s)) : "-";
      }
      return statDef.format(p);
    },
  };

  const extraRule = EXTRA_ELIGIBILITY_RULES[statKey];
  const waitingForGameLogs = filterActive && covered && (gameLogsLoading || !situationalByPlayer);

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;
  if (!players || players.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <>
      <div className="filter-block">
        <h3>登録区分</h3>
        <div className="mode-toggle">
          <button
            className={selectedClassifications.size === 0 ? "active" : ""}
            onClick={() => setSelectedClassifications(new Set())}
            type="button"
          >
            全選手
          </button>
          {CLASSIFICATION_OPTIONS.map((c) => (
            <button
              key={c}
              className={selectedClassifications.has(c) ? "active" : ""}
              onClick={() => setSelectedClassifications((prev) => toggleInSet(prev, c))}
              type="button"
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <SituationalFilterPicker filter={filter} onChange={setFilter} opponentWinRateSupported={!!opponentRecords} />

      <div className="stat-picker">
        {playerDefs.map((d) => (
          <button key={d.key} className={d.key === statKey ? "active" : ""} onClick={() => selectStat(d.key)} type="button">
            {d.label}
          </button>
        ))}
      </div>

      <div className="filter-block">
        <h3>掲載基準</h3>
        <EligibilitySlider
          label="出場率"
          value={Math.round(gamesRatio * 100)}
          min={0}
          max={100}
          step={1}
          format={(v) => `${v}%`}
          onChange={(v) => setGamesRatio(v / 100)}
        />
        {extraRule && (
          <EligibilitySlider
            label={extraRule.label}
            value={extraThreshold}
            min={extraRule.min}
            max={extraRule.max}
            step={extraRule.step}
            format={(v) => `${v.toFixed(1)}${extraRule.unit}`}
            onChange={setExtraThreshold}
          />
        )}
        <p className="page-subtitle">対象{eligible.length}名中、上位{PLAYER_RANK_TOP_N}名を表示</p>
        {filterActive && !covered && (
          <p className="page-subtitle">
            「{statDef.label}」はシチュエーション別フィルタの対象外のため、シーズン合計の値をそのまま表示しています
          </p>
        )}
      </div>

      {waitingForGameLogs ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={`ranking-player-${statDef.key}.png`} />
          <div ref={exportRef} className="export-target">
            <RankedList
              rows={rows}
              def={rankDef}
              rowKey={(p) => p.playerId}
              name={(p) => p.name}
              subLabel={(p) => p.teamName}
              linkTo={(p) => `/players/${p.playerId}`}
              teamColor={(p) => teamColors?.[p.teamId]?.primary}
              avatar={(p) => <PlayerPhoto playerId={p.playerId} size={28} className="player-cell-photo" />}
              limit={PLAYER_RANK_TOP_N}
            />
          </div>
        </>
      )}
    </>
  );
}

export function RankingsPage({ season }: { season: string }) {
  const [mode, setMode] = useState<Mode>("team");
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);

  return (
    <div>
      <h1>ランキング</h1>
      <p className="page-subtitle">{season}シーズン</p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
          個人
        </button>
      </div>

      {mode === "team" ? (
        <TeamRankingSection season={season} teamColors={teamColors ?? undefined} />
      ) : (
        <PlayerRankingSection season={season} teamColors={teamColors ?? undefined} />
      )}
    </div>
  );
}
