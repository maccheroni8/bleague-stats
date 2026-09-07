import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { usePageState } from "../lib/pageStateCache";
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
import { filterGameLogs, isDefaultFilter, type SituationalFilter } from "../lib/situational";
import {
  SEASON_ADVANCED_COLUMNS,
  SEASON_BOX_TABS,
  SEASON_DISPLAY_MODE_LABELS,
  SEASON_GAME_TYPE_LABELS,
  SEASON_MISC_COLUMNS,
  SEASON_SCORING_COLUMNS,
  SEASON_TRADITIONAL_COLUMNS,
  EMPTY_TEAM_TOTALS,
  buildSeasonBoxscoreCtx,
  filterByGameType,
  sumPlayerGameLogs,
  sumTeamGameLogsFor,
  type PlayerSeasonRawTotals,
  type SeasonBoxTabKey,
  type SeasonBoxscoreColumn,
  type SeasonBoxscoreCtx,
  type SeasonDisplayMode,
  type SeasonGameTypeFilter,
  type TeamSeasonRawTotals,
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
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeEntityColumns } from "../lib/shotTypeBreakdown";
import { useAllTeamGameLogs, useLeagueSituationalContext } from "../lib/teamRankingData";
import { isShotChartSupported, useSeasonCoverage } from "../lib/useSeasonCoverage";
import { CLASSIFICATION_OPTIONS, matchesClassificationFilter, toggleInSet } from "../lib/classificationFilter";
import {
  EXTRA_ELIGIBILITY_RULES,
  MIN_GAMES_PLAYED_RATIO_FOR_RANKING,
  filterEligiblePlayers,
} from "../lib/playerRankingEligibility";
import { formatDecimal } from "../lib/format";
import type { PlayerGameLog, PlayerSummary, TeamColors, TeamForcedTurnovers, TeamSummary } from "../../shared/types";

type Mode = "team" | "player";

/** チームランキングのカテゴリ。既存のBOXSCORE_TABS（トラディショナル/アドバンスド/Misc/
 * スコアリング）に、チーム詳細ページ「チームスタッツ」タブと同じ2カテゴリ（シューティング・
 * 強制ターンオーバー）を追加したもの。この2つはteams.json（TeamSummary）に既に持っている
 * シーズン集計値（shotTypes・forcedTurnovers/turnoversCommitted）をそのまま使うため、
 * 他4カテゴリと異なりチーム試合ログの取得・シチュエーション別フィルタ・レギュラー/
 * プレーオフ切替・自チーム/opp切替の対象外（レギュラーシーズンの通算値のみ） */
type TeamRankingCategory = BoxscoreTabKey | "shooting" | "forcedTurnovers";

const BOXSCORE_TAB_KEYS = new Set<string>(BOXSCORE_TABS.map((t) => t.key));
function isBoxscoreCategory(c: TeamRankingCategory): c is BoxscoreTabKey {
  return BOXSCORE_TAB_KEYS.has(c);
}

/** 「強制ターンオーバー」カテゴリの項目定義（TeamForcedTurnoversの各フィールド＋合計）。
 * 奪った（forced）/記録した（committed）どちらの視点でも同じ項目を使う */
const FORCED_TURNOVER_ITEMS: { key: string; label: string; value: (d: TeamForcedTurnovers) => number }[] = [
  { key: "offensiveFoul", label: "オフェンスファウル", value: (d) => d.offensiveFoul },
  { key: "violation24sec", label: "24秒バイオレーション", value: (d) => d.violation24sec },
  { key: "backcourtViolation", label: "バックコート", value: (d) => d.backcourtViolation },
  { key: "violation5sec", label: "5秒バイオレーション", value: (d) => d.violation5sec },
  { key: "violation8sec", label: "8秒バイオレーション", value: (d) => d.violation8sec },
  { key: "otherDead", label: "その他デッドボール", value: (d) => d.otherDead },
  { key: "live", label: "ライブボール（参考）", value: (d) => d.live },
  {
    key: "total",
    label: "合計",
    value: (d) =>
      d.offensiveFoul + d.violation24sec + d.backcourtViolation + d.violation5sec + d.violation8sec + d.otherDead + d.live,
  },
];
type TurnoverDirection = "forced" | "committed";
const TURNOVER_DIRECTION_LABELS: Record<TurnoverDirection, string> = {
  forced: "奪った（自チームが強制）",
  committed: "記録した（相手に強制された）",
};

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
  /** falseならDRtg・opp PTS等のように値が小さいほど良い項目（未指定はtrue扱い）。
   * teamStatsColumns.tsのColumn.higherIsBetterをそのまま引き継ぐ */
  higherIsBetter?: boolean;
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

/** defの向き（higherIsBetter）から導く、そのdefにとって「正しい」既定のソート方向 */
function defaultSortDir<T>(def: RankableStat<T>): "asc" | "desc" {
  return def.higherIsBetter === false ? "asc" : "desc";
}

function RankedList<T>({ rows, def, rowKey, name, subLabel, linkTo, externalLinkTo, teamColor, avatar, limit }: RankedListProps<T>) {
  // 列見出しクリックでの昇順/降順切り替え（SortableTable.tsxと同じクリックパターン）。
  // ソート方向は「値の大小」ではなく「良い/悪い」の向き（def.higherIsBetter）を基準にした
  // asc/descで管理し、既定値は常にBatch 2で確立した「良い方が#1に来る」向きにする。
  // 項目（def.key）や向き（def.higherIsBetter、自チーム/opp/+/-トグルで変わりうる）が変わったら
  // 手動での反転状態をリセットし、常に新しい項目の「正しい既定順」から始める
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => defaultSortDir(def));
  const prevIdentityRef = useRef(`${def.key}:${def.higherIsBetter}`);
  useEffect(() => {
    const identity = `${def.key}:${def.higherIsBetter}`;
    if (prevIdentityRef.current !== identity) {
      prevIdentityRef.current = identity;
      setSortDir(defaultSortDir(def));
    }
  }, [def]);

  const factor = sortDir === "asc" ? 1 : -1;
  const sorted = [...rows].sort((a, b) => (def.value(a) - def.value(b)) * factor);
  const limited = limit !== undefined ? sorted.slice(0, limit) : sorted;
  const toggleSortDir = () => setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
  return (
    <div className="table-scroll">
      <table className="sortable-table rankings-table">
        <thead>
          <tr>
            <th className="align-right">#</th>
            <th className="align-left">名前</th>
            <th
              className="align-right"
              onClick={toggleSortDir}
              aria-sort={sortDir === "asc" ? "ascending" : "descending"}
            >
              {def.label}
              {sortDir === "asc" ? " ▲" : " ▼"}
            </th>
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

  // ブラウザバック等でページが一度アンマウント・再マウントされても、直前のフィルタ条件を
  // 復元する（src/lib/pageStateCache.ts参照。個人・チーム詳細ページと同じ仕組み。
  // RankingsPageはteamId/playerIdのような動的パラメータを持たないため固定キーを使う）
  const [category, setCategory] = usePageState<TeamRankingCategory>("rankings:team:category", "traditional");
  const [statKey, setStatKey] = usePageState("rankings:team:statKey", DEFAULT_SORT_KEY.traditional);
  const [displayMode, setDisplayMode] = usePageState<SeasonDisplayMode>("rankings:team:displayMode", "perGame");
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>("rankings:team:gameType", "regular");
  const [perspective, setPerspective] = usePageState<TeamPerspective>("rankings:team:perspective", "own");
  const [filter, setFilter] = usePageState<SituationalFilter>("rankings:team:filter", { range: { kind: "all" } });
  const [turnoverDirection, setTurnoverDirection] = usePageState<TurnoverDirection>("rankings:team:turnoverDirection", "forced");

  const selectCategory = (next: TeamRankingCategory) => {
    setCategory(next);
    if (next === "shooting") setStatKey(`${SHOT_TYPE_DISPLAY_ORDER[0]}_2pm`);
    else if (next === "forcedTurnovers") setStatKey("total");
    else setStatKey(DEFAULT_SORT_KEY[next]);
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
    () => (isBoxscoreCategory(category) ? buildTeamCategoryColumns(category, displayMode, perspective, paintSupported) : []),
    [category, displayMode, perspective, paintSupported],
  );
  const selectedColumn = columns.find((c) => c.key === statKey) ?? columns[0];
  const teamDef: RankableStat<AllTeamsRow> | null = selectedColumn
    ? {
        key: selectedColumn.key,
        label: selectedColumn.label,
        value: (row) => Number(selectedColumn.sortValue(row)),
        format: (row) => (selectedColumn.format ? selectedColumn.format(row) : String(selectedColumn.sortValue(row))),
        higherIsBetter: selectedColumn.higherIsBetter,
      }
    : null;

  // シューティングカテゴリ: teams.jsonのshotTypes（チーム全選手合算、2023-24シーズン以降のみ）を
  // shotTypeEntityColumns（RankingsPage/TeamsListPage/TeamDetailPageで共通利用する既存ライブラリ）に
  // そのまま渡す。試合ログ取得・シチュエーション別フィルタは不要（シーズン集計値をそのまま使う）
  const shootingColumns = useMemo(
    () =>
      shotTypeEntityColumns(
        SHOT_TYPE_DISPLAY_ORDER,
        (t: TeamSummary) => t.shotTypes,
        displayMode as "total" | "perGame",
        (t) => t.gamesPlayed,
      ),
    [displayMode],
  );
  const teamsWithShotTypes = useMemo(() => (teams ?? []).filter((t) => !!t.shotTypes), [teams]);
  const selectedShootingColumn = shootingColumns.find((c) => c.key === statKey) ?? shootingColumns[0];
  const shootingDef: RankableStat<TeamSummary> | null = selectedShootingColumn
    ? {
        key: selectedShootingColumn.key,
        label: selectedShootingColumn.label,
        value: (t) => Number(selectedShootingColumn.sortValue(t)),
        format: (t) => (selectedShootingColumn.format ? selectedShootingColumn.format(t) : String(selectedShootingColumn.sortValue(t))),
        higherIsBetter: selectedShootingColumn.higherIsBetter,
      }
    : null;

  // 強制ターンオーバーカテゴリ: teams.jsonのforcedTurnovers/turnoversCommitted
  // （Yahoo!スポーツplay-by-play由来、2023-24シーズン以降のみ）をそのまま使う
  const teamsWithForcedTurnovers = useMemo(
    () => (teams ?? []).filter((t) => !!t.forcedTurnovers && !!t.turnoversCommitted),
    [teams],
  );
  const selectedTurnoverItem = FORCED_TURNOVER_ITEMS.find((i) => i.key === statKey) ?? FORCED_TURNOVER_ITEMS[0]!;
  const forcedTurnoverDef: RankableStat<TeamSummary> = {
    key: selectedTurnoverItem.key,
    label: selectedTurnoverItem.label,
    value: (t) => selectedTurnoverItem.value(turnoverDirection === "forced" ? t.forcedTurnovers! : t.turnoversCommitted!),
    format: (t) =>
      String(selectedTurnoverItem.value(turnoverDirection === "forced" ? t.forcedTurnovers! : t.turnoversCommitted!)),
  };

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  const isBoxscore = isBoxscoreCategory(category);

  return (
    <>
      {isBoxscore ? (
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
        </>
      ) : (
        <p className="page-subtitle">
          このカテゴリはレギュラーシーズンの通算集計値のみに対応しています（シチュエーション別フィルタ・
          レギュラー/プレーオフ切替・自チーム/opp切替は適用されません。2023-24シーズン以降のみ対応）
        </p>
      )}
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
          <button
            className={`tab-button${category === "shooting" ? " active" : ""}`}
            onClick={() => selectCategory("shooting")}
            type="button"
          >
            シューティング
          </button>
          <button
            className={`tab-button${category === "forcedTurnovers" ? " active" : ""}`}
            onClick={() => selectCategory("forcedTurnovers")}
            type="button"
          >
            強制ターンオーバー
          </button>
        </div>
        {category === "forcedTurnovers" ? (
          <div className="mode-toggle">
            {(Object.keys(TURNOVER_DIRECTION_LABELS) as TurnoverDirection[]).map((d) => (
              <button
                key={d}
                className={d === turnoverDirection ? "active" : ""}
                onClick={() => setTurnoverDirection(d)}
                type="button"
              >
                {TURNOVER_DIRECTION_LABELS[d]}
              </button>
            ))}
          </div>
        ) : (
          <div className="mode-toggle">
            {DISPLAY_MODE_OPTIONS.map((m) => (
              <button key={m} className={m === displayMode ? "active" : ""} onClick={() => setDisplayMode(m)} type="button">
                {SEASON_DISPLAY_MODE_LABELS[m]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="stat-picker">
        {category === "shooting"
          ? shootingColumns.map((c) => (
              <button key={c.key} className={c.key === statKey ? "active" : ""} onClick={() => setStatKey(c.key)} type="button">
                {c.label}
              </button>
            ))
          : category === "forcedTurnovers"
            ? FORCED_TURNOVER_ITEMS.map((i) => (
                <button key={i.key} className={i.key === statKey ? "active" : ""} onClick={() => setStatKey(i.key)} type="button">
                  {i.label}
                </button>
              ))
            : columns.map((c) => (
                <button key={c.key} className={c.key === statKey ? "active" : ""} onClick={() => setStatKey(c.key)} type="button">
                  {c.label}
                </button>
              ))}
      </div>

      {category === "shooting" ? (
        !shootingDef ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ExportImageButton targetRef={exportRef} filename={`ranking-team-shooting-${shootingDef.key}-${displayMode}.png`} />
            <div ref={exportRef} className="export-target">
              <RankedList
                rows={teamsWithShotTypes}
                def={shootingDef}
                rowKey={(t) => t.teamId}
                name={(t) => t.teamName}
                linkTo={(t) => `/teams/${t.teamId}`}
                teamColor={(t) => teamColors?.[t.teamId]?.primary}
                avatar={(t) => <TeamLogo teamId={t.teamId} size={22} />}
              />
            </div>
          </>
        )
      ) : category === "forcedTurnovers" ? (
        teamsWithForcedTurnovers.length === 0 ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ExportImageButton
              targetRef={exportRef}
              filename={`ranking-team-forcedTurnovers-${forcedTurnoverDef.key}-${turnoverDirection}.png`}
            />
            <div ref={exportRef} className="export-target">
              <RankedList
                rows={teamsWithForcedTurnovers}
                def={forcedTurnoverDef}
                rowKey={(t) => t.teamId}
                name={(t) => t.teamName}
                linkTo={(t) => `/teams/${t.teamId}`}
                teamColor={(t) => teamColors?.[t.teamId]?.primary}
                avatar={(t) => <TeamLogo teamId={t.teamId} size={22} />}
              />
            </div>
          </>
        )
      ) : gameLogsLoading || !gameLogsByTeam || !teamDef ? (
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

/** ボックススコア列キー（SEASON_TRADITIONAL_COLUMNS等、小文字。例: "fgpct"）→掲載基準
 * （EXTRA_ELIGIBILITY_RULES、statDefs.ts由来のキャメルケース。例: "fgPct"）キーの対応 */
const BOX_KEY_TO_EXTRA_RULE_KEY: Record<string, string> = {
  fgpct: "fgPct",
  "2ppct": "twoPct",
  "3ppct": "tpPct",
  ftpct: "ftPct",
};
function extraRuleKey(statKey: string): string {
  return BOX_KEY_TO_EXTRA_RULE_KEY[statKey] ?? statKey;
}

/** 選手ランキングのカテゴリ項目1つを表す最小限の型。valueがctx（未計算ならnull）を
 * 受け取れるようにし、SeasonBoxscoreColumn（PlayerGameLog取得が要る）とPLAYER_STAT_DEFS・
 * shotTypeEntityColumns（PlayerSummaryのみで完結、ctx不要）の両方をこの形に揃えて扱う */
interface PlayerRankItem {
  key: string;
  label: string;
  higherIsBetter?: boolean;
  value: (p: PlayerSummary, ctx: SeasonBoxscoreCtx | null) => number;
  format: (p: PlayerSummary, ctx: SeasonBoxscoreCtx | null) => string;
}

/**
 * シチュエーション別フィルタ・レギュラー/プレーオフ選択が既定値のときだけ使う0コスト経路。
 * PlayerSummary.totals（シーズン合計、既に取得済み）からSeasonBoxscoreColumnが必要とする
 * PlayerSeasonRawTotalsを組み立てる。PlayByPlays由来の項目（PTSOFFTO・DUNK・被アシスト内訳・
 * ペイント/ミッドレンジ分割・在コート区間・テクニカルファウル等）はPlayerSummaryに存在しない
 * ため0で埋める（Misc/スコアリングカテゴリはこの経路を使わず常にPlayerGameLogを取得する。
 * PlayerRankingSection参照）
 */
function rawTotalsFromPlayerSummary(p: PlayerSummary): PlayerSeasonRawTotals {
  const t = p.totals;
  return {
    gamesPlayed: t.gamesPlayed,
    min: t.min,
    pts: t.pts,
    fgm: t.fgm,
    fga: t.fga,
    tpm: t.tpm,
    tpa: t.tpa,
    ftm: t.ftm,
    fta: t.fta,
    oreb: t.oreb,
    dreb: t.dreb,
    reb: t.reb,
    ast: t.ast,
    tov: t.tov,
    stl: t.stl,
    blk: t.blk,
    pf: t.pf,
    foulsDrawn: t.foulsDrawn,
    blockedAgainst: t.blockedAgainst,
    technicalFouls: 0,
    pt2in: 0,
    ptfb: 0,
    pt2nd: 0,
    plusMinus: t.plusMinus,
    ptsOffTov: 0,
    dunks: 0,
    basketCounts: 0,
    unsportsmanlikeFouls: 0,
    disqualifyingFouls: 0,
    offensiveFoulsCommitted: 0,
    chargesDrawn: 0,
    assisted2m: 0,
    assisted3m: 0,
    assistedFtm: 0,
    paint2m: 0,
    paint2a: 0,
    mid2m: 0,
    mid2a: 0,
    onCourtOwnPoss: 0,
    onCourtOppPoss: 0,
    onCourtSeconds: 0,
  };
}

/**
 * SeasonBoxscoreColumn（トラディショナル/アドバンスド/Misc/スコアリング共通の列定義、
 * 個人詳細ページ「シーズン別成績」・チーム詳細ページ「選手スタッツ」タブと同じ
 * src/lib/playerSeasonBoxscore.tsを再利用）をPlayerRankItemに変換する。
 * EFFのみ、0コスト経路だとtechnicalFoulsが常に0になり不正確になるため（rawTotalsFromPlayerSummary
 * 参照）、常にPlayerSummary.advanced.eff（バックエンドで正しく計算済みの値）を直接使う
 * （シチュエーション別フィルタ・レギュラー/プレーオフ選択の対象外。従来の実装と同じ扱い）
 */
function boxColumnItem(col: SeasonBoxscoreColumn): PlayerRankItem {
  if (col.key === "eff") {
    return {
      key: col.key,
      label: col.label,
      higherIsBetter: col.higherIsBetter,
      value: (p) => p.advanced.eff,
      format: (p) => formatDecimal(p.advanced.eff),
    };
  }
  return {
    key: col.key,
    label: col.label,
    higherIsBetter: col.higherIsBetter,
    value: (_p, ctx) => (ctx ? col.value(ctx, "perGame") : 0),
    format: (_p, ctx) => (ctx ? col.format(ctx, "perGame") : "-"),
  };
}

const SEASON_BOX_COLUMNS_BY_TAB: Record<SeasonBoxTabKey, SeasonBoxscoreColumn[]> = {
  traditional: SEASON_TRADITIONAL_COLUMNS,
  advanced: SEASON_ADVANCED_COLUMNS,
  misc: SEASON_MISC_COLUMNS,
  scoring: SEASON_SCORING_COLUMNS,
};

/** アドバンスドカテゴリのみ、SeasonBoxscoreColumnには無いPER・PPP（statDefs.ts、シーズン合計値の
 * みでフィルタ非対応）を追加する。ランキングページが従来から提供していた項目を引き続き
 * 使えるようにするための補完 */
const EXTRA_ADVANCED_PLAYER_ITEMS: PlayerRankItem[] = PLAYER_STAT_DEFS.filter((d) => d.key === "per" || d.key === "ppp").map(
  (d) => ({
    key: d.key,
    label: d.label,
    higherIsBetter: d.higherIsBetter,
    value: (p: PlayerSummary) => d.value(p),
    format: (p: PlayerSummary) => d.format(p),
  }),
);

/** 選手ランキングのカテゴリ。チーム版・チーム詳細ページ「選手スタッツ」タブと同じ
 * トラディショナル/アドバンスド/Misc/スコアリング（SeasonBoxTabKey）に、シューティングを
 * 追加したもの */
type PlayerRankCategory = SeasonBoxTabKey | "shooting";

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
 * 項目はチーム版ランキング・チーム詳細ページ「選手スタッツ」タブと同じトラディショナル/
 * アドバンスド/Misc/スコアリング（src/lib/playerSeasonBoxscore.ts）＋シューティング
 * （src/lib/shotTypeBreakdown.ts、shotTypeEntityColumns）のカテゴリから選べる。シチュエーション
 * 別フィルタ・レギュラー/プレーオフ選択が既定値のときは対象選手のPlayerSummary（既に取得済み）
 * だけで完結する0コスト経路を使い、フィルタが有効、またはMisc/スコアリングカテゴリ選択時
 * （PlayByPlays由来の項目のみでPlayerSummaryに存在しないため常に必要）だけ、対象選手
 * （掲載基準・国籍区分フィルタ通過後）分のPlayerGameLogを取得する
 * （PlayersListPage.tsxの「全選手スタッツ」タブと同じ「フィルタ選択時のみ取得する」遅延方式）
 */
function PlayerRankingSection({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const { data: players, loading: playersLoading, error: playersError } = useJsonData(() => fetchPlayers(season), [season]);
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  // USG%・%-shareスタッツ・個人ORtg/DRtgの分母（チーム総計）用に、チーム版ランキングと共通の
  // フックで26チーム分のTeamGameLogを取得する
  const { gameLogsByTeam } = useAllTeamGameLogs(season, teams);

  // ブラウザバック等でページが一度アンマウント・再マウントされても、直前のフィルタ条件を
  // 復元する（src/lib/pageStateCache.ts参照）
  const [category, setCategory] = usePageState<PlayerRankCategory>("rankings:player:category", "traditional");
  const [statKey, setStatKey] = usePageState("rankings:player:statKey", "pts");
  const [gamesRatio, setGamesRatio] = usePageState("rankings:player:gamesRatio", MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
  const [extraThreshold, setExtraThreshold] = usePageState(
    "rankings:player:extraThreshold",
    EXTRA_ELIGIBILITY_RULES.pts?.defaultValue ?? 0,
  );
  const [selectedClassifications, setSelectedClassifications] = usePageState<
    Set<NonNullable<PlayerSummary["classification"]>>
  >("rankings:player:selectedClassifications", () => new Set());
  const [filter, setFilter] = usePageState<SituationalFilter>("rankings:player:filter", { range: { kind: "all" } });
  const filterActive = !isDefaultFilter(filter);
  const [gameType, setGameType] = usePageState<SeasonGameTypeFilter>("rankings:player:gameType", "regular");
  const gameTypeActive = gameType !== "regular";

  const { divisionHistory, opponentRecords } = useLeagueSituationalContext(season);

  const [gameLogsByPlayer, setGameLogsByPlayer] = useState<Map<string, PlayerGameLog[]> | null>(null);
  const [gameLogsLoading, setGameLogsLoading] = useState(false);
  const fetchedPlayerIdsRef = useRef<Set<string>>(new Set());

  const selectCategory = (next: PlayerRankCategory) => {
    setCategory(next);
    const nextKey = next === "shooting" ? `${SHOT_TYPE_DISPLAY_ORDER[0]}_2pm` : "pts";
    setStatKey(nextKey);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[extraRuleKey(nextKey)]?.defaultValue ?? 0);
  };
  const selectStat = (next: string) => {
    setStatKey(next);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[extraRuleKey(next)]?.defaultValue ?? 0);
  };

  const eligible: PlayerSummary[] = useMemo(() => {
    if (!players || !teams) return [];
    const base = filterEligiblePlayers(players, teams, gamesRatio, extraRuleKey(statKey), extraThreshold).filter((p) =>
      matchesClassificationFilter(p, selectedClassifications),
    );
    return category === "shooting" ? base.filter((p) => !!p.shotTypes) : base;
  }, [players, teams, gamesRatio, statKey, extraThreshold, selectedClassifications, category]);

  // シーズンが変わったら取得済みキャッシュをリセットする
  useEffect(() => {
    fetchedPlayerIdsRef.current = new Set();
    setGameLogsByPlayer(null);
  }, [season]);

  // シチュエーション別フィルタ・レギュラー/プレーオフ切替が既定値以外、またはMisc/スコアリング
  // カテゴリ選択時（PlayByPlays由来の項目のみでシーズン集計に存在しない）だけ、対象選手
  // （掲載基準・国籍区分フィルタ通過後）分のPlayerGameLogを取得する（PlayersListPage.tsxの
  // 「全選手スタッツ」タブと同じ遅延取得方針）。出場率スライダー等で対象選手が増えても、
  // 既に取得済みの選手は再取得せず差分だけ追加する
  const needsGameLogRecompute = filterActive || gameTypeActive || category === "misc" || category === "scoring";
  useEffect(() => {
    if (!needsGameLogRecompute || eligible.length === 0) return;
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
  }, [needsGameLogRecompute, eligible, season]);

  // USG%・%-shareスタッツ・個人ORtg/DRtgの分母（チーム総計）。gameLogsByTeamから選手側と
  // 同じシチュエーション別フィルタ・レギュラー/プレーオフ条件で組み立てる
  const teamTotalsByTeamId = useMemo<Map<string, TeamSeasonRawTotals> | null>(() => {
    if (!gameLogsByTeam) return null;
    const map = new Map<string, TeamSeasonRawTotals>();
    for (const [teamId, logs] of gameLogsByTeam) {
      const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season);
      const scoped = filterByGameType(situational, gameType);
      map.set(teamId, sumTeamGameLogsFor(scoped, new Set(scoped.map((g) => g.scheduleKey))));
    }
    return map;
  }, [gameLogsByTeam, filter, gameType, opponentRecords, divisionHistory, season]);

  const seasonStartYear = Number(season.split("-")[0]);
  const ctxByPlayer = useMemo<Map<string, SeasonBoxscoreCtx> | null>(() => {
    if (!teamTotalsByTeamId) return null;
    if (needsGameLogRecompute && !gameLogsByPlayer) return null;
    const map = new Map<string, SeasonBoxscoreCtx>();
    for (const p of eligible) {
      const team = teamTotalsByTeamId.get(p.teamId) ?? EMPTY_TEAM_TOTALS;
      if (needsGameLogRecompute) {
        const logs = gameLogsByPlayer!.get(p.playerId) ?? [];
        const situational = filterGameLogs(logs, { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season);
        const scoped = filterByGameType(situational, gameType);
        map.set(p.playerId, buildSeasonBoxscoreCtx(sumPlayerGameLogs(scoped), team, "perGame", seasonStartYear));
      } else {
        map.set(p.playerId, buildSeasonBoxscoreCtx(rawTotalsFromPlayerSummary(p), team, "perGame", seasonStartYear));
      }
    }
    return map;
  }, [
    teamTotalsByTeamId,
    needsGameLogRecompute,
    gameLogsByPlayer,
    eligible,
    filter,
    gameType,
    opponentRecords,
    divisionHistory,
    season,
    seasonStartYear,
  ]);

  // シチュエーション別フィルタで対象試合が0件になった選手は、"0"のまま下位に並べず除外する
  // （旧situationalByPlayerが null を返していたときと同じ扱い）。シューティングカテゴリは
  // 常にシーズン集計（掲載基準通過者全員）をそのまま表示する
  const rows: PlayerSummary[] = useMemo(() => {
    if (category === "shooting" || !ctxByPlayer) return eligible;
    return eligible.filter((p) => (ctxByPlayer.get(p.playerId)?.raw.gamesPlayed ?? 0) > 0);
  }, [eligible, ctxByPlayer, category]);

  const shootingColumns = useMemo(
    () => shotTypeEntityColumns(SHOT_TYPE_DISPLAY_ORDER, (p: PlayerSummary) => p.shotTypes, "perGame", (p) => p.gamesPlayed),
    [],
  );
  const currentItems: PlayerRankItem[] = useMemo(() => {
    if (category === "shooting") {
      return shootingColumns.map((c) => ({
        key: c.key,
        label: c.label,
        higherIsBetter: c.higherIsBetter,
        value: (p: PlayerSummary) => Number(c.sortValue(p)),
        format: (p: PlayerSummary) => (c.format ? c.format(p) : String(c.sortValue(p))),
      }));
    }
    const items = SEASON_BOX_COLUMNS_BY_TAB[category].map(boxColumnItem);
    return category === "advanced" ? [...items, ...EXTRA_ADVANCED_PLAYER_ITEMS] : items;
  }, [category, shootingColumns]);

  const selectedItem = currentItems.find((i) => i.key === statKey) ?? currentItems[0]!;
  const rankDef: RankableStat<PlayerSummary> = {
    key: selectedItem.key,
    label: selectedItem.label,
    higherIsBetter: selectedItem.higherIsBetter,
    value: (p) => selectedItem.value(p, ctxByPlayer?.get(p.playerId) ?? null),
    format: (p) => selectedItem.format(p, ctxByPlayer?.get(p.playerId) ?? null),
  };

  const extraRule = EXTRA_ELIGIBILITY_RULES[extraRuleKey(statKey)];
  const waitingForGameLogs =
    (needsGameLogRecompute && (gameLogsLoading || !gameLogsByPlayer)) || !teamTotalsByTeamId || !ctxByPlayer;

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

      {category === "shooting" ? (
        <p className="page-subtitle">
          このカテゴリはレギュラーシーズンの通算集計値のみに対応しています（シチュエーション別フィルタ・
          レギュラー/プレーオフ切替は適用されません。2023-24シーズン以降のみ対応）
        </p>
      ) : (
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
        </>
      )}

      <div className="tab-bar">
        {SEASON_BOX_TABS.map((t) => (
          <button
            key={t.key}
            className={`tab-button${category === t.key ? " active" : ""}`}
            onClick={() => selectCategory(t.key)}
            type="button"
          >
            {t.label}
          </button>
        ))}
        <button
          className={`tab-button${category === "shooting" ? " active" : ""}`}
          onClick={() => selectCategory("shooting")}
          type="button"
        >
          シューティング
        </button>
      </div>

      <div className="stat-picker">
        {currentItems.map((i) => (
          <button key={i.key} className={i.key === statKey ? "active" : ""} onClick={() => selectStat(i.key)} type="button">
            {i.label}
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
        {needsGameLogRecompute && selectedItem.key === "eff" && (
          <p className="page-subtitle">
            「EFF」はシチュエーション別フィルタ・レギュラー/プレーオフ選択の対象外のため、シーズン合計の値をそのまま表示しています
          </p>
        )}
      </div>

      {waitingForGameLogs ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={`ranking-player-${category}-${selectedItem.key}.png`} />
          <div ref={exportRef} className="export-target">
            <RankedList
              rows={rows}
              def={rankDef}
              rowKey={(p) => p.playerId}
              name={(p) => p.name}
              subLabel={(p) => [p.teamName, p.position, p.classification].filter(Boolean).join("・")}
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
  const [mode, setMode] = usePageState<Mode>("rankings:mode", "team");
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
