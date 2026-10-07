import { RankedList, type RankCompare, type RankableStat } from "../components/RankedList";
import { PlayerGameRecordRanking } from "../components/PlayerGameRecordRanking";
import { TeamGameRecordRanking } from "../components/TeamGameRecordRanking";
import { TeamSeasonRecordRanking } from "../components/TeamSeasonRecordRanking";
import { PlayerCareerRecordRanking, TeamCareerRecordRanking } from "../components/CareerRecordRanking";
import { EligibilitySlider } from "../components/EligibilitySlider";
import { useCompareCleanup, useFoulConditionCleanup, useFoulStatKeyCleanup, useRookieFilterCleanup, useSeasonFilterCleanup } from "../lib/seasonFilterCleanup";
import { RawGamesFailure } from "../components/RawGamesFailure";
import { COMPARE_LABEL, COMPARE_PARAM, buildCompare, compareUnsupportedReason, previousSeason } from "../lib/seasonCompare";
import { postseasonLabel } from "../../shared/gameType";
import { isPastSeason } from "../lib/season";
import { useMemo, useRef } from "react";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { fetchPlayerPageSeasons, fetchTeamColors } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { ExportImageButton } from "../components/ExportImageButton";
import { ConditionTitle } from "../components/ConditionTitle";
import { RuleChangeFootnote } from "../components/RuleChangeFootnote";
import { isRuleChangeStatKey } from "../lib/ruleChange";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerPhoto } from "../components/PlayerPhoto";
import { BOXSCORE_TABS } from "../components/BoxscoreTable";
import { FilterBar } from "../components/FilterBar";
import {
  classificationAxis,
  displayModeAxis,
  gameTypeAxis,
  multiSelectAxis,
  periodAxis,
  perspectiveAxis,
  simpleSelectAxis,
  situationalAxes,
  statItemAxis,
  type FilterAxis,
} from "../lib/filterAxes";
import type { SituationalFilter } from "../lib/situational";
import { SEASON_BOX_PERIOD_OPTIONS, SEASON_BOX_TABS } from "../lib/playerSeasonBoxscore";
import { SHOT_TYPE_DISPLAY_ORDER, shotTypeLabel } from "../lib/shotTypeBreakdown";
import { positionFilterOptions, selectedPositionLabels, type PlayerGroupFilter } from "../lib/classificationFilter";
import { EXTRA_ELIGIBILITY_RULES, MIN_GAMES_PLAYED_RATIO_FOR_RANKING } from "../lib/playerRankingEligibility";
import {
  buildExportFilename,
  classificationLabels,
  composeLabels,
  displayModeLabels,
  eligibilityLabels,
  multiSelectLabels,
  gameTypeLabels,
  perspectiveLabels,
  periodLabels,
  SEASON_TOTAL_ONLY_LABELS,
  SITUATIONAL_DEFAULT_LABEL,
  situationalFilterLabels,
} from "../lib/conditionLabels";
import { HeightWeightNote } from "../components/HeightWeightNote";
import { AGE_BASE_NOTE, ageBaseDateLabel } from "../lib/age";
import { positionText } from "../lib/profileMark";
import type { TeamColors } from "../../shared/types";
import { useTeamLabel } from "../lib/teamLabel";
import { usePlayerLabel } from "../lib/playerLabel";
import { DEFAULT_STAT_CONDITIONS, statConditionsTitle } from "../lib/statConditions";
import { statConditionsBarExtra } from "../components/StatConditionsEditor";
import { clearUrlParams, enumParam, numberParam, situationalParam, statConditionsParam, stringParam, useUrlState, type UrlCodec } from "../lib/urlState";
import { seasonDivisions } from "../lib/divisionGroups";
import { DISPLAY_MODE_PARAM, GAME_TYPE_PARAM, PERIOD_PARAM, PERSPECTIVE_PARAM, POSITION_PARAM, RECORDS_SCOPE_PARAM, PLAYER_GROUP_PARAM } from "../lib/urlFilterParams";
import { ROOKIE_NOTE, ROOKIE_UNSUPPORTED_REASON, rookieSupportedSeason, useSeasonRookies } from "../lib/rookieFilter";
import {
  FORCED_TURNOVER_ITEMS,
  TURNOVER_DIRECTION_LABELS,
  isBoxscoreCategory,
  teamDefaultStatKey,
  useTeamSeasonRanking,
  type TeamRankingCategory,
  type TurnoverDirection,
} from "../lib/teamSeasonRanking";
import {
  CAREER_NOTE,
  DDTD_PERIOD_REASON,
  PLAYER_RANK_TOP_N,
  extraRuleKey,
  usePlayerSeasonRanking,
  type PlayerRankCategory,
} from "../lib/playerSeasonRanking";

type Mode = "team" | "player";


/**
 * ランキングの表・画像出力の直上に出すタイトルと、画像ファイル名。選択中の全軸を条件ラベルとして
 * 持ち、タイトル表示とファイル名を同じラベル配列から作る（src/lib/conditionLabels.ts参照）
 */
interface RankingTitleInfo {
  title: string;
  conditions: string[];
  filename: string;
}

function makeRankingTitle(kind: "チーム" | "個人", season: string, statLabel: string, conditions: string[]): RankingTitleInfo {
  return {
    title: `${season}シーズン ${kind}ランキング：${statLabel}`,
    conditions,
    filename: buildExportFilename([`${kind}ランキング`, season, statLabel, ...conditions]),
  };
}

/**
 * 前シーズン比較の行と列（DESIGN.md 218章）。今季の表（currentRows）と前季の全体（prevRows）から、両方にある行だけを並べる。
 * 差は今季・前季の表示値どうし
 */
function compareView<T, P>(args: {
  currentRows: readonly T[];
  currentKey: (row: T) => string;
  currentDef: RankableStat<T>;
  prevRows: readonly P[];
  prevKey: (row: P) => string;
  prevDef: RankableStat<P>;
  /** 比べない組を外す */
  accept?: (row: T, prev: P) => boolean;
}): { rows: T[]; compare: RankCompare<T> } {
  const { rows, entries } = buildCompare({
    currentRows: args.currentRows,
    currentKey: args.currentKey,
    currentDef: args.currentDef,
    prevRows: args.prevRows,
    prevKey: args.prevKey,
    prevDef: args.prevDef,
    accept: args.accept,
  });
  const entryOf = (row: T) => entries.get(args.currentKey(row))!;
  return {
    rows,
    compare: {
      prevLabel: "前季",
      diffLabel: "差",
      prevCell: (row) => entryOf(row).prevText,
      diff: (row) => entryOf(row).diff,
      diffText: (row) => entryOf(row).diffText,
      tone: (row) => entryOf(row).tone,
      rankPool: [...args.currentRows],
    },
  };
}

/** 前シーズン比較の表の下の注記（画像にも入る） */
function CompareNotes({
  season,
  prevSeason,
  mode,
  narrowed,
  kind,
  empty,
}: {
  season: string;
  prevSeason: string;
  mode: "perGame" | "total";
  /** 今季だけに当てはめている条件（ルーキー・スタッツの条件）があるか */
  narrowed: boolean;
  kind: "player" | "team";
  /** 比べられる行が1つも無いとき */
  empty: boolean;
}) {
  return (
    <>
      {empty && (
        <p className="empty-message">
          {kind === "player" ? "今季・前季の両方で掲載基準を満たし、値のある選手がいません。" : "今季・前季の両方で値のあるチームがありません。"}
        </p>
      )}
      <p className="rule-change-footnote">
        ※ 前季は{prevSeason}シーズンです。{kind === "player" ? "今季・前季の両方で掲載基準を満たす選手" : "今季・前季の両方にあるチーム"}だけを表示しています。差は、表示している値どうしの差です（％の項目はポイントの差）。
      </p>
      {narrowed && (
        <p className="rule-change-footnote">
          ※ {kind === "player" ? "ルーキーとスタッツの条件" : "スタッツの条件"}は今季だけに当てはめています（前季は、{kind === "player" ? "これらを" : "これを"}使わずに比べます）。
        </p>
      )}
      {mode === "total" && !isPastSeason(season) && (
        <p className="rule-change-footnote">※ {season}は進行中のため、合計の差には、試合数の違いが含まれます。</p>
      )}
    </>
  );
}

/** 前シーズン比較の軸（ランキングのシーズン成績の個人・チーム）。使えないときは、理由つきで無効にする */
function compareAxis(value: "off" | "on", onChange: (v: "off" | "on") => void, disabledReason: string | null): FilterAxis {
  return simpleSelectAxis({
    id: "compare",
    label: COMPARE_LABEL,
    options: [
      { value: "off", label: "しない" },
      { value: "on", label: "する" },
    ],
    value,
    defaultValue: "off",
    onChange: (v) => onChange(v as "off" | "on"),
    disabledReason: disabledReason ?? undefined,
  });
}

/** シューティングの項目（キー「{シュート種別}_2pm」等）を、シュート種別ごとのグループにする（項目数が多いため） */
function shootingStatItems(columns: { key: string; label: string }[]): { key: string; label: string; group: string }[] {
  return columns.map((c) => ({
    key: c.key,
    label: c.label,
    group: shotTypeLabel(c.key.replace(/_(2pm|2pa|2ppct|3pm|3pa|3ppct)$/, "")),
  }));
}

/**
 * ランキングのURLのキー（DESIGN.md 163章）。m＝チーム/個人、cat＝カテゴリ、stat＝項目、tov＝Forced TOV の向き、
 * elig＝掲載基準の出場率（%）、ex＝項目ごとの追加の基準。共通のキー（mode・gt・v・q・cls・pos・シチュエーション・スタッツの条件）は
 * src/lib/urlFilterParams.ts・src/lib/urlState.ts
 */
const RANKING_MODE_PARAM = enumParam<Mode>("m", ["team", "player"], "team");
/** 種類（DESIGN.md 190〜192章）: シーズン成績（今までのランキング）／1試合記録／通算記録（過去に在籍した全選手・全クラブの全シーズン合算） */
type RankingKind = "season" | "game" | "career" | "special";
const RANKING_KIND_PARAM = enumParam<RankingKind>("k", ["season", "game", "career", "special"], "season");
const RANKING_KIND_LABELS: Record<RankingKind, string> = { season: "シーズン成績", game: "1試合記録", career: "通算記録", special: "1シーズン記録" };
const TEAM_CATEGORY_PARAM = enumParam<TeamRankingCategory>(
  "cat",
  ["traditional", "advanced", "misc", "scoring", "shooting", "forcedTurnovers"],
  "traditional",
  { traditional: "trad", advanced: "adv", shooting: "shoot", forcedTurnovers: "tov" },
);
const PLAYER_CATEGORY_PARAM = enumParam<PlayerRankCategory>(
  "cat",
  ["traditional", "advanced", "misc", "scoring", "shooting", "profile", "career"],
  "traditional",
  { traditional: "trad", advanced: "adv", shooting: "shoot" },
);
const TURNOVER_DIRECTION_PARAM = enumParam<TurnoverDirection>("tov", ["forced", "committed"], "forced");
const DEFAULT_RANKING_FILTER: SituationalFilter = { range: { kind: "all" } };
const EMPTY_POSITIONS: string[] = [];
/** 項目のキーとして読める値か（シュートタイプの項目は日本語を含む） */
function isStatKeyLike(v: string): boolean {
  return v.length <= 64 && !/[\s,&=]/.test(v);
}
function playerDefaultStatKey(category: PlayerRankCategory): string {
  return category === "shooting" ? `${SHOT_TYPE_DISPLAY_ORDER[0]}_2pm` : category === "profile" ? "height" : category === "career" ? "titles" : "pts";
}
/** 掲載基準の出場率は、URLでは%の整数（elig=70）、中では割合（0.7） */
const GAMES_RATIO_ELIG_PARAM: UrlCodec<number> = {
  keys: ["elig"],
  read: (p) => {
    const v = Number(p.get("elig"));
    return p.get("elig") !== null && Number.isFinite(v) && v >= 0 && v <= 100 ? v / 100 : undefined;
  },
  write: (p, v) => {
    if (Math.round(v * 100) !== Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100)) p.set("elig", String(Math.round(v * 100)));
  },
};


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
  const teamLabel = useTeamLabel();
  const exportRef = useRef<HTMLDivElement>(null);

  // ブラウザバック等でページが一度アンマウント・再マウントされても、直前のフィルタ条件を
  // 復元する（src/lib/pageStateCache.ts参照。個人・チーム詳細ページと同じ仕組み。
  // RankingsPageはteamId/playerIdのような動的パラメータを持たないため固定キーを使う）
  // カテゴリ・項目・フィルタはURLのクエリに持つ（DESIGN.md 163章）。変えても履歴は増やさず、別のページから戻るとURLから元に戻る
  const [category, setCategory] = useUrlState(TEAM_CATEGORY_PARAM, "traditional");
  const defaultTeamStat = teamDefaultStatKey(category);
  const [statKey, setStatKey] = useUrlState(stringParam("stat", defaultTeamStat, isStatKeyLike), defaultTeamStat);
  const [displayMode, setDisplayMode] = useUrlState(DISPLAY_MODE_PARAM, "perGame");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [perspective, setPerspective] = useUrlState(PERSPECTIVE_PARAM, "own");
  const [filter, setFilter] = useUrlState(situationalParam, DEFAULT_RANKING_FILTER);
  const [turnoverDirection, setTurnoverDirection] = useUrlState(TURNOVER_DIRECTION_PARAM, "forced");
  // Q別/前後半トグル。「試合」（既定値）選択時は追加の生データ取得を発生させず、既存の
  // TeamGameLog永続集計（sumTeamGameLogs）をそのまま使う。Q別/前後半選択時のみ、対象チーム
  // 全員分の生データ（StoredGame）を一括取得する（useLeagueRawGames、DESIGN.md参照）
  const [period, setPeriod] = useUrlState(PERIOD_PARAM, "all");
  // スタッツの条件（DESIGN.md 162章）。ブラウザバックで戻っても保持する
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);

  // 集計（行・値の定義・スタッツの条件の項目）は src/lib/teamSeasonRanking.ts。前シーズン比較の前季でも同じ処理を使う（DESIGN.md 218章）
  const {
    teams,
    teamsLoading,
    teamsError,
    gameLogsByTeam,
    gameLogsLoading,
    divisionHistory,
    opponentRecords,
    periodOption,
    foulSplit,
    rawGamesLoading,
    rawGamesFailedCount,
    retryRawGames,
    periodDataReady,
    conditionItems,
    conditionActive,
    columns,
    teamDef,
    boxRows,
    shootingColumns,
    shootingDef,
    teamsWithShotTypes,
    forcedTurnoverDef,
    teamsWithForcedTurnovers,
  } = useTeamSeasonRanking(season, { category, statKey, displayMode, gameType, perspective, filter, turnoverDirection, period, statConditions });
  // 前シーズン比較（DESIGN.md 218章）。試合の条件・試合区分・視点・平均/合計は前季にも同じように当てはめ、スタッツの条件は今季だけに当てはめる。
  // 前季のデータは、比較をオンにしたときだけ読む
  const [compareParam, setCompareParam] = useUrlState(COMPARE_PARAM, "off");
  const prevSeason = previousSeason(season);
  const compareReason = compareUnsupportedReason({
    season,
    categoryKind: isBoxscoreCategory(category) ? "boxscore" : "seasonTotal",
    statKey,
    subject: "team",
    fromGameLogs: false,
    filter,
    gameType,
    period,
    prevDivisions: prevSeason && divisionHistory ? seasonDivisions(divisionHistory, prevSeason) : null,
  });
  const compareActive = compareParam === "on" && !compareReason && prevSeason !== null;
  useCompareCleanup(season, compareParam, () => setCompareParam("off"));
  const prevRanking = useTeamSeasonRanking(
    prevSeason ?? season,
    { category, statKey, displayMode, gameType, perspective, filter, turnoverDirection, period, statConditions: DEFAULT_STAT_CONDITIONS },
    { enabled: compareActive, skipConditionItems: true },
  );
  // ファウルの列は、2026-27以降のシーズンではTF1・TF2・FLAG・DISR、それ以前ではUFOUL・TF。そのシーズンに無い項目・条件は外す（DESIGN.md 16-8章）
  useFoulConditionCleanup(season, statConditions, setStatConditions);
  useFoulStatKeyCleanup(season, statKey, () => setStatKey(defaultTeamStat));
  // シーズンで意味が変わるフィルタ（地区・月・期間指定・ポストシーズン）は、そのシーズンに無ければ外す（DESIGN.md 164・165章）
  useSeasonFilterCleanup({ season, filter, setFilter, gameType, setGameType });

  const selectCategory = (next: TeamRankingCategory) => {
    setCategory(next);
    setStatKey(teamDefaultStatKey(next));
  };

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  const isBoxscore = isBoxscoreCategory(category);

  // 前シーズン比較の行と列。前季が読み込めるまでは「読み込み中」、前季の読み込みに失敗したときはエラーを出す
  const prevPending =
    compareActive &&
    (prevRanking.teamsLoading || !prevRanking.teams || (isBoxscore && (prevRanking.gameLogsLoading || !prevRanking.gameLogsByTeam)));
  const comparable = compareActive && !!prevSeason && !prevPending;
  const boxCompare =
    comparable && isBoxscore && teamDef && prevRanking.teamDef
      ? compareView({
          currentRows: boxRows,
          currentKey: (r) => r.team.teamId,
          currentDef: teamDef,
          prevRows: prevRanking.boxRows,
          prevKey: (r) => r.team.teamId,
          prevDef: prevRanking.teamDef,
          // 条件に当てはまる試合が、今季か前季で0のチーム（例: ポストシーズンに出ていない）は、値が0になるだけなので比べない
          accept: (r, prev) => r.gamesPlayed > 0 && prev.gamesPlayed > 0,
        })
      : null;
  const shootingCompare =
    comparable && category === "shooting" && shootingDef && prevRanking.shootingDef
      ? compareView({
          currentRows: teamsWithShotTypes,
          currentKey: (t) => t.teamId,
          currentDef: shootingDef,
          prevRows: prevRanking.teamsWithShotTypes,
          prevKey: (t) => t.teamId,
          prevDef: prevRanking.shootingDef,
        })
      : null;
  const turnoverCompare =
    comparable && category === "forcedTurnovers"
      ? compareView({
          currentRows: teamsWithForcedTurnovers,
          currentKey: (t) => t.teamId,
          currentDef: forcedTurnoverDef,
          prevRows: prevRanking.teamsWithForcedTurnovers,
          prevKey: (t) => t.teamId,
          prevDef: prevRanking.forcedTurnoverDef,
        })
      : null;
  const compareNotes = (empty: boolean) => (
    <CompareNotes season={season} prevSeason={prevSeason ?? ""} mode={displayMode === "total" ? "total" : "perGame"} narrowed={conditionActive} kind="team" empty={empty} />
  );

  // 表・画像出力に出すタイトル。カテゴリごとに実際に効いている軸だけを並べる
  // （シューティング・強制ターンオーバーはシーズン通算値のみで、シチュエーション別フィルタ・
  // レギュラー/プレーオフ・自チーム/opp・Q別/前後半は対象外。その旨をラベルで明示する）
  const boxscoreCategoryLabel = BOXSCORE_TABS.find((t) => t.key === category)?.label ?? category;
  const teamBoxscoreTitle = makeRankingTitle(
    "チーム",
    season,
    teamDef?.label ?? "",
    composeLabels(
      boxscoreCategoryLabel,
      compareActive && COMPARE_LABEL,
      displayModeLabels(displayMode),
      gameTypeLabels(gameType, season),
      perspectiveLabels(perspective),
      situationalFilterLabels(filter),
      periodLabels(periodOption),
    ),
  );
  const teamShootingTitle = makeRankingTitle(
    "チーム",
    season,
    shootingDef?.label ?? "",
    composeLabels(CATEGORY_LABELS.shooting, compareActive && COMPARE_LABEL, displayModeLabels(displayMode), SEASON_TOTAL_ONLY_LABELS),
  );
  const teamForcedTurnoverTitle = makeRankingTitle(
    "チーム",
    season,
    forcedTurnoverDef.label,
    composeLabels(CATEGORY_LABELS.forcedTurnovers, compareActive && COMPARE_LABEL, TURNOVER_DIRECTION_LABELS[turnoverDirection], SEASON_TOTAL_ONLY_LABELS),
  );

  // フィルタバー（DESIGN.md 105章）。シューティングは表示（平均/合計）のみ、強制ターンオーバーは
  // すべて対象外（シーズン通算値のみ。方向の切替はタブ右のトグルに残す）
  const isTeamShooting = category === "shooting";
  const teamFilterDisabledReason = isBoxscore
    ? undefined
    : isTeamShooting
      ? "このカテゴリはレギュラーシーズンの通算集計値のみ対応です（表示の平均/合計だけ連動します。2023-24シーズン以降のみ対応）。"
      : "このカテゴリはレギュラーシーズンの通算集計値のみ対応で、上の絞り込みは連動しません（2023-24シーズン以降のみ対応）。";
  const teamDisplayDisabledReason = isBoxscore || isTeamShooting ? undefined : teamFilterDisabledReason;
  const teamFilterAxes: FilterAxis[] = [
    gameTypeAxis(gameType, setGameType, season, { disabledReason: teamFilterDisabledReason }),
    perspectiveAxis(perspective, setPerspective, { disabledReason: teamFilterDisabledReason }),
    displayModeAxis(displayMode, setDisplayMode, { disabledReason: teamDisplayDisabledReason }),
    periodAxis(period, setPeriod, SEASON_BOX_PERIOD_OPTIONS, { disabledReason: teamFilterDisabledReason }),
    ...situationalAxes(filter, setFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
      ownDivisions: seasonDivisions(divisionHistory, season),
      disabledReason: teamFilterDisabledReason,
    }),
    compareAxis(compareParam, setCompareParam, compareReason),
  ];
  const clearTeamFilters = () => {
    setGameType("regular");
    setPerspective("own");
    setDisplayMode("perGame");
    setPeriod("all");
    setFilter({ range: { kind: "all" } });
    setCompareParam("off");
    setStatConditions({ ...statConditions, conditions: [] });
  };

  return (
    <>
      <FilterBar
        axes={teamFilterAxes}
        stateKey="rankings:team"
        onClearAll={clearTeamFilters}
        advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, conditionItems, { defaultKey: "pts" })}
      />
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
            {CATEGORY_LABELS.shooting}
          </button>
          <button
            className={`tab-button${category === "forcedTurnovers" ? " active" : ""}`}
            onClick={() => selectCategory("forcedTurnovers")}
            type="button"
          >
            {CATEGORY_LABELS.forcedTurnovers}
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
        ) : null}
      </div>

      <FilterBar
        axes={[
          statItemAxis(
            category === "shooting"
              ? shootingStatItems(shootingColumns)
              : category === "forcedTurnovers"
                ? FORCED_TURNOVER_ITEMS
                : columns,
            statKey,
            setStatKey,
          ),
        ]}
        stateKey="rankings:team:stat"
        simple
        wide
      />

      {compareActive && prevRanking.teamsError ? (
        <p className="error-message">前のシーズンのデータを読み込めませんでした。{prevRanking.teamsError}</p>
      ) : (conditionActive && (gameLogsLoading || !gameLogsByTeam)) || prevPending ? (
        <p className="loading">読み込み中...</p>
      ) : category === "shooting" ? (
        !shootingDef ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ExportImageButton targetRef={exportRef} filename={teamShootingTitle.filename} />
            <div ref={exportRef} className={`export-target export-target-compact export-target-rankings-team${shootingCompare ? " export-target-compare" : ""}`}>
              <ConditionTitle title={teamShootingTitle.title} conditions={teamShootingTitle.conditions} statConditions={statConditionsTitle(statConditions, conditionItems)} />
              <RankedList
                statScope="team"
                rows={shootingCompare ? shootingCompare.rows : teamsWithShotTypes}
                compare={shootingCompare?.compare}
                def={shootingDef}
                rowKey={(t) => t.teamId}
                name={(t) => teamLabel(t.teamId, t.teamName)}
                linkTo={(t) => `/teams/${t.teamId}`}
                teamColor={(t) => teamColors?.[t.teamId]?.primary}
                avatar={(t) => <TeamLogo teamId={t.teamId} size={48} />}
                compact
              />
              {shootingCompare && compareNotes(shootingCompare.rows.length === 0)}
            </div>
          </>
        )
      ) : category === "forcedTurnovers" ? (
        teamsWithForcedTurnovers.length === 0 ? (
          <p className="empty-message">このシーズンのデータには対応していません</p>
        ) : (
          <>
            <ExportImageButton targetRef={exportRef} filename={teamForcedTurnoverTitle.filename} />
            <div ref={exportRef} className={`export-target export-target-compact export-target-rankings-team${turnoverCompare ? " export-target-compare" : ""}`}>
              <ConditionTitle title={teamForcedTurnoverTitle.title} conditions={teamForcedTurnoverTitle.conditions} statConditions={statConditionsTitle(statConditions, conditionItems)} />
              <RankedList
                statScope="team"
                rows={turnoverCompare ? turnoverCompare.rows : teamsWithForcedTurnovers}
                compare={turnoverCompare?.compare}
                def={forcedTurnoverDef}
                rowKey={(t) => t.teamId}
                name={(t) => teamLabel(t.teamId, t.teamName)}
                linkTo={(t) => `/teams/${t.teamId}`}
                teamColor={(t) => teamColors?.[t.teamId]?.primary}
                avatar={(t) => <TeamLogo teamId={t.teamId} size={48} />}
                compact
              />
              {turnoverCompare && compareNotes(turnoverCompare.rows.length === 0)}
            </div>
          </>
        )
      ) : rawGamesFailedCount > 0 ? (
        <RawGamesFailure count={rawGamesFailedCount} onRetry={retryRawGames} />
      ) : gameLogsLoading || !gameLogsByTeam || !teamDef || rawGamesLoading || !periodDataReady ? (
        <p className="loading">読み込み中...</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={teamBoxscoreTitle.filename} />
          <div ref={exportRef} className={`export-target export-target-compact export-target-rankings-team${boxCompare ? " export-target-compare" : ""}`}>
            <ConditionTitle title={teamBoxscoreTitle.title} conditions={teamBoxscoreTitle.conditions} statConditions={statConditionsTitle(statConditions, conditionItems)} />
            <RankedList
                statScope="team"
              rows={boxCompare ? boxCompare.rows : boxRows}
              compare={boxCompare?.compare}
              def={teamDef}
              rowKey={(r) => r.team.teamId}
              name={(r) => teamLabel(r.team.teamId, r.team.teamName)}
              linkTo={(r) => `/teams/${r.team.teamId}`}
              teamColor={(r) => teamColors?.[r.team.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.team.teamId} size={48} />}
              compact
            />
            {category === "misc" && isRuleChangeStatKey(teamDef.key) && <RuleChangeFootnote seasons={[season]} />}
            {boxCompare && compareNotes(boxCompare.rows.length === 0)}
          </div>
        </>
      )}
    </>
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

  // ブラウザバック等でページが一度アンマウント・再マウントされても、直前のフィルタ条件を
  // 復元する（src/lib/pageStateCache.ts参照）
  // カテゴリ・項目・フィルタはURLのクエリに持つ（DESIGN.md 163章）。elig＝掲載基準の出場率（%）、ex＝項目ごとの追加の基準
  const [category, setCategory] = useUrlState(PLAYER_CATEGORY_PARAM, "traditional");
  const defaultPlayerStat = playerDefaultStatKey(category);
  const [statKey, setStatKey] = useUrlState(stringParam("stat", defaultPlayerStat, isStatKeyLike), defaultPlayerStat);
  const [gamesRatio, setGamesRatio] = useUrlState(GAMES_RATIO_ELIG_PARAM, MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
  const defaultExtra = EXTRA_ELIGIBILITY_RULES[extraRuleKey(statKey)]?.defaultValue ?? 0;
  const [extraThreshold, setExtraThreshold] = useUrlState(numberParam("ex", defaultExtra, { min: 0 }), defaultExtra);
  // 登録区分（全選手・日本人・外国籍/帰化/アジア）と、4つ目の「ルーキー」（cls=rookie。DESIGN.md 217章）。ルーキーを選べないシーズン（2016-17）では「全選手」として扱う
  const [selectedGroup, setSelectedGroup] = useUrlState(PLAYER_GROUP_PARAM, "all");
  const rookieSupported = rookieSupportedSeason(season);
  const selectedClassification: PlayerGroupFilter = selectedGroup === "rookie" && !rookieSupported ? "all" : selectedGroup;
  const rookieActive = selectedClassification === "rookie";
  // そのシーズンのルーキー。ランキングの名前の下に「Rookie」を出すので、登録区分の選択によらず読む
  const rookies = useSeasonRookies(season, true);
  useRookieFilterCleanup(season, selectedGroup, () => setSelectedGroup("all"));
  // ポジション（複数選択、未選択＝全ポジション）。登録どおり（PG・PG/SG 等の完全一致）で、どれかに当てはまる選手（DESIGN.md 171章）
  const [positions, setPositions] = useUrlState(POSITION_PARAM, EMPTY_POSITIONS);
  const [filter, setFilter] = useUrlState(situationalParam, DEFAULT_RANKING_FILTER);
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  // 平均/合計（チーム版と同じ URL のキー mode。DESIGN.md 179章）
  const [displayMode, setDisplayMode] = useUrlState(DISPLAY_MODE_PARAM, "perGame");
  // Q別/前後半トグル。「試合」（既定値）選択時は追加の生データ取得を発生させず、既存の
  // PlayerSummary/PlayerGameLogベースの経路をそのまま使う。Q別/前後半選択時のみ、対象選手
  // 全員分の生データ（StoredGame）を一括取得する（useLeagueRawGames、DESIGN.md参照）
  const [period, setPeriod] = useUrlState(PERIOD_PARAM, "all");
  // スタッツの条件（DESIGN.md 162章）。ブラウザバックで戻っても保持する
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);

  // 集計（掲載基準・試合ログの読み込み・行・値の定義・スタッツの条件の項目）は src/lib/playerSeasonRanking.ts。前シーズン比較の前季でも同じ処理を使う（DESIGN.md 218章）
  const {
    players,
    playersLoading,
    playersError,
    eligible,
    shownRows,
    selectedItem,
    currentItems,
    rankDef,
    rankMode,
    modeApplies,
    ddtdPeriodOff,
    effPeriodActive,
    periodActive,
    filterActive,
    gameTypeActive,
    periodOption,
    needsGameLogRecompute,
    conditionItems,
    conditionActive,
    conditionKeys,
    clubOf,
    registeredTarget,
    registeredPlayers,
    divisionHistory,
    opponentRecords,
    waiting,
    rawGamesFailedCount,
    retryRawGames,
  } = usePlayerSeasonRanking(season, {
    category,
    statKey,
    gamesRatio,
    extraThreshold,
    group: selectedClassification,
    rookieIds: rookies.ids,
    positions,
    filter,
    gameType,
    displayMode,
    period,
    statConditions,
  });
  const positionOptions = useMemo(() => positionFilterOptions(players, positions), [players, positions]);

  // 前シーズン比較（DESIGN.md 218章）。試合の条件・試合区分・平均/合計・登録区分（日本人／外国籍・帰化・アジア）・ポジション・掲載基準は前季にも同じように当てはめ、
  // スタッツの条件とルーキーは今季だけに当てはめる（前季に条件を満たさなかった選手を、比較から外さないため）。前季のデータは、比較をオンにしたときだけ読む
  const [compareParam, setCompareParam] = useUrlState(COMPARE_PARAM, "off");
  const prevSeason = previousSeason(season);
  const compareReason = compareUnsupportedReason({
    season,
    categoryKind: category === "profile" || category === "career" ? "registered" : category === "shooting" ? "seasonTotal" : "boxscore",
    statKey,
    subject: "player",
    fromGameLogs: needsGameLogRecompute,
    filter,
    gameType,
    period,
    prevDivisions: prevSeason && divisionHistory ? seasonDivisions(divisionHistory, prevSeason) : null,
  });
  const compareActive = compareParam === "on" && !compareReason && prevSeason !== null;
  useCompareCleanup(season, compareParam, () => setCompareParam("off"));
  const prevRanking = usePlayerSeasonRanking(
    prevSeason ?? season,
    {
      category,
      statKey,
      gamesRatio,
      extraThreshold,
      group: selectedClassification === "rookie" ? "all" : selectedClassification,
      rookieIds: null,
      positions,
      filter,
      gameType,
      displayMode,
      period,
      statConditions: DEFAULT_STAT_CONDITIONS,
    },
    { enabled: compareActive, skipConditionItems: true },
  );
  // ファウルの列は、2026-27以降のシーズンではTF1・TF2・FLAG・DISR、それ以前ではUFOUL・TF。そのシーズンに無い項目・条件は外す（DESIGN.md 16-8章）
  useFoulConditionCleanup(season, statConditions, setStatConditions);
  useFoulStatKeyCleanup(season, statKey, () => setStatKey(defaultPlayerStat));
  // シーズンで意味が変わるフィルタ（地区・月・期間指定・ポストシーズン）は、そのシーズンに無ければ外す（DESIGN.md 164・165章）
  useSeasonFilterCleanup({ season, filter, setFilter, gameType, setGameType });

  const selectCategory = (next: PlayerRankCategory) => {
    setCategory(next);
    const nextKey = playerDefaultStatKey(next);
    setStatKey(nextKey);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[extraRuleKey(nextKey)]?.defaultValue ?? 0);
  };
  const selectStat = (next: string) => {
    setStatKey(next);
    setExtraThreshold(EXTRA_ELIGIBILITY_RULES[extraRuleKey(next)]?.defaultValue ?? 0);
  };

  const registeredOnlyIds = useMemo(() => new Set((registeredPlayers ?? []).map((p) => p.playerId)), [registeredPlayers]);
  // 名簿から足した選手（このシーズンに個人ページが無い）の名前は、個人ページがある一番新しいシーズンへつなぐ（表示は待たない。DESIGN.md 174章）
  const { data: playerPageSeasons } = useJsonData(
    () => (registeredTarget ? fetchPlayerPageSeasons() : Promise.resolve(null)),
    [registeredTarget],
  );

  // スマホ幅では名字だけ（同じ一覧で名字が重なる選手はフルネーム）
  const playerLabel = usePlayerLabel(shownRows.map((p) => p.name));
  const teamLabel = useTeamLabel();

  // 「プロフィール」カテゴリの年齢の基準日ラベル（表・画像出力に出す。そのシーズンの6月30日か今日の早い方。DESIGN.md 172章）。
  // 身長・体重は当時の値（補った値には＊。DESIGN.md 148章）なので基準日は出さない
  const profileBaseDateLabel = category === "profile" && selectedItem.key === "age" ? ageBaseDateLabel(season) : null;

  const extraRule = EXTRA_ELIGIBILITY_RULES[extraRuleKey(statKey)];
  const waitingForGameLogs = (rookieActive && rookies.loading) || waiting || (compareActive && prevRanking.waiting && !prevRanking.playersError);
  const comparison =
    compareActive && prevSeason && !waitingForGameLogs && !ddtdPeriodOff
      ? compareView({
          currentRows: shownRows,
          currentKey: (p) => p.playerId,
          currentDef: rankDef,
          prevRows: prevRanking.rows,
          prevKey: (p) => p.playerId,
          prevDef: prevRanking.rankDef,
        })
      : null;

  if (playersLoading) return <p className="loading">読み込み中...</p>;
  if (playersError) return <p className="error-message">{playersError}</p>;
  if (!players || players.length === 0) return <p className="empty-message">データがありません</p>;

  // 表・画像出力に出すタイトル。EFF/PER/PPPはシチュエーション・G・Q別の対象外（シーズン合計値を
  // そのまま表示している。上の注記と同じ条件）ため、いずれかの絞り込みが有効なときは実際の値の
  // 範囲（レギュラーシーズン・シーズン全体・試合全体）を出し、対象外である旨を添える
  const filterIgnoredForItem =
    category !== "shooting" &&
    ["eff", "per", "ppp"].includes(selectedItem.key) &&
    (filterActive || gameTypeActive || periodActive);
  const playerCategoryLabel =
    category === "shooting"
      ? CATEGORY_LABELS.shooting
      : category === "profile" || category === "career"
        ? CATEGORY_LABELS[category]
        : (SEASON_BOX_TABS.find((t) => t.key === category)?.label ?? category);
  const playerScopeLabels =
    category === "shooting"
      ? SEASON_TOTAL_ONLY_LABELS
      : category === "profile"
        ? []
        : category === "career"
          ? ["Bリーグ（2016-17）以降の累計"]
        : filterIgnoredForItem
          ? composeLabels(gameTypeLabels("regular", null), SITUATIONAL_DEFAULT_LABEL, "試合全体", "※この項目はフィルタ対象外")
          : composeLabels(gameTypeLabels(gameType, season), situationalFilterLabels(filter), periodLabels(periodOption));
  const playerTitle = makeRankingTitle(
    "個人",
    season,
    selectedItem.label,
    composeLabels(
      playerCategoryLabel,
      compareActive && COMPARE_LABEL,
      // Career は、そのシーズンの登録選手を、そのシーズン終了時点の累計で並べる（通算記録の「歴代」と区別する。DESIGN.md 193章）
      category === "career" ? "シーズン終了時点の累計" : [],
      // 登録区分は選手名の下に書かないので、指定したときはタイトルの下の行に書く（「全選手」は書かない。DESIGN.md 170章）
      classificationLabels(selectedClassification),
      // ポジションは選択肢が9つだけなので、選んだものを省略せずに全部書く（「他N」にしない。DESIGN.md 178章）
      multiSelectLabels("ポジション", selectedPositionLabels(positionOptions, positions), "全ポジション", Infinity),
      // 平均/合計は初期値（平均）でも必ず書く（画像だけ見ても分かるように。初期値を書かないルールの例外。DESIGN.md 179章）。
      // 切り替えの対象外の項目（割合・Profile・Career）では書かない
      modeApplies ? displayModeLabels(rankMode) : [],
      playerScopeLabels,
      registeredTarget ? "登録選手" : eligibilityLabels({ gamesRatio, extra: extraRule, extraThreshold }),
      `上位${PLAYER_RANK_TOP_N}名`,
    ),
  );

  // フィルタバー（DESIGN.md 105章）。掲載基準（出場率＋項目固有の追加基準）はスライダーを
  // ポップオーバーに入れた軸として置く。シューティング・プロフィールは試合種別・S軸・Q別/前後半が対象外
  const playerFilterDisabledReason =
    category === "shooting"
      ? "このカテゴリはレギュラーシーズンの通算集計値のみ対応です（登録区分・掲載基準のみ連動します。2023-24シーズン以降のみ対応）。"
      : category === "profile"
        ? "このカテゴリは試合種別・シチュエーション別フィルタ・Q別/前後半の対象外です（登録区分・ポジションのみ適用されます）。"
        : category === "career"
          ? "このカテゴリは試合種別・シチュエーション別フィルタ・Q別/前後半の対象外です（登録区分・ポジションのみ適用されます）。"
        : undefined;
  const eligibilityDefaultExtra = extraRule?.defaultValue ?? 0;
  const eligibilitySummary = eligibilityLabels({ gamesRatio, extra: extraRule, extraThreshold }).join("・");
  const eligibilityAxis: FilterAxis = {
    kind: "popover",
    id: "eligibility",
    label: "掲載基準",
    tier: "primary",
    disabledReason: registeredTarget
      ? "このカテゴリは、このシーズンに登録していた選手全員が対象です（出場の有無を問わず、掲載基準は使いません）。"
      : undefined,
    value: `${Math.round(gamesRatio * 100)}|${extraRule ? extraThreshold : ""}`,
    defaultValue: `${Math.round(MIN_GAMES_PLAYED_RATIO_FOR_RANKING * 100)}|${extraRule ? eligibilityDefaultExtra : ""}`,
    onChange: () => {
      setGamesRatio(MIN_GAMES_PLAYED_RATIO_FOR_RANKING);
      setExtraThreshold(eligibilityDefaultExtra);
    },
    summary: eligibilitySummary,
    chipValue: eligibilitySummary,
    content: (
      <>
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
      </>
    ),
  };
  const playerFilterAxes: FilterAxis[] = [
    classificationAxis(selectedGroup, setSelectedGroup, { rookie: { disabledReason: rookieSupported ? undefined : ROOKIE_UNSUPPORTED_REASON } }),
    multiSelectAxis({
      id: "position",
      label: "ポジション",
      options: positionOptions,
      selected: positions,
      onChangeSelected: setPositions,
      allLabel: "全ポジション",
      maxShown: Infinity,
    }),
    gameTypeAxis(gameType, setGameType, season, { disabledReason: playerFilterDisabledReason }),
    // 対象外の項目では無効にし、平均のまま見せる（URL の mode は残すので、対象の項目に戻ると合計に戻る）
    displayModeAxis(rankMode, setDisplayMode, {
      disabledReason: modeApplies
        ? undefined
        : ddtdPeriodOff
          ? DDTD_PERIOD_REASON(selectedItem.label)
          : category === "profile" || category === "career"
          ? "このカテゴリは平均/合計の切り替えの対象外です。"
          : `「${selectedItem.label}」は割合・率（または試合数）の項目のため、平均/合計の切り替えの対象外です。`,
    }),
    periodAxis(period, setPeriod, SEASON_BOX_PERIOD_OPTIONS, { disabledReason: playerFilterDisabledReason }),
    ...situationalAxes(filter, setFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
      ownDivisions: seasonDivisions(divisionHistory, season),
      disabledReason: playerFilterDisabledReason,
    }),
    eligibilityAxis,
    compareAxis(compareParam, setCompareParam, compareReason),
  ];
  const clearPlayerFilters = () => {
    setSelectedGroup("all");
    setPositions([]);
    setGameType("regular");
    setDisplayMode("perGame");
    setPeriod("all");
    setFilter({ range: { kind: "all" } });
    setCompareParam("off");
    eligibilityAxis.onChange("");
    setStatConditions({ ...statConditions, conditions: [] });
  };

  return (
    <>
      <FilterBar
        axes={playerFilterAxes}
        stateKey="rankings:player"
        onClearAll={clearPlayerFilters}
        advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, conditionItems, { defaultKey: "min" })}
      />

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
          {CATEGORY_LABELS.shooting}
        </button>
        <button
          className={`tab-button${category === "profile" ? " active" : ""}`}
          onClick={() => selectCategory("profile")}
          type="button"
        >
          {CATEGORY_LABELS.profile}
        </button>
        <button
          className={`tab-button${category === "career" ? " active" : ""}`}
          onClick={() => selectCategory("career")}
          type="button"
        >
          {CATEGORY_LABELS.career}
        </button>
      </div>

      <FilterBar
        axes={[
          statItemAxis(
            category === "shooting"
              ? shootingStatItems(currentItems)
              : currentItems.map((i) =>
                  effPeriodActive && (i.key === "dd2" || i.key === "td3")
                    ? { ...i, label: `${i.label}（Q別・前後半は対象外）`, disabled: true }
                    : i,
                ),
            statKey,
            selectStat,
          ),
        ]}
        stateKey="rankings:player:stat"
        simple
        wide
      />

      <div className="filter-block">
        <p className="page-subtitle">
          対象{comparison ? comparison.rows.length : conditionActive ? shownRows.length : eligible.length}名中、上位{PLAYER_RANK_TOP_N}名を表示
          {comparison && `（今季・前季（${prevSeason}）とも掲載基準を満たす選手）`}
          {conditionActive && "（スタッツの条件で絞り込んだ中での順位）"}
        </p>
        {(needsGameLogRecompute || periodActive) && ["eff", "per", "ppp"].includes(selectedItem.key) && (
          <p className="page-subtitle">
            「{selectedItem.label}」はシチュエーション別フィルタ・レギュラー/{postseasonLabel(season)}選択・Q別/前後半トグルの対象外のため、シーズン合計の値をそのまま表示しています
          </p>
        )}
      </div>

      {rookieActive && rookies.error ? (
        <p className="error-message">ルーキーの一覧を読み込めませんでした。{rookies.error}</p>
      ) : compareActive && prevRanking.playersError ? (
        <p className="error-message">前のシーズンのデータを読み込めませんでした。{prevRanking.playersError}</p>
      ) : rawGamesFailedCount > 0 ? (
        <RawGamesFailure count={rawGamesFailedCount} onRetry={retryRawGames} />
      ) : waitingForGameLogs ? (
        <p className="loading">読み込み中...</p>
      ) : ddtdPeriodOff ? (
        <p className="empty-message">Q別・前後半を選んでいるため、「{selectedItem.label}」の順位は表示しません。</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={playerTitle.filename} />
          <div ref={exportRef} className={`export-target export-target-compact export-target-rankings-player${comparison ? " export-target-compare" : ""}`}>
            <ConditionTitle
              title={playerTitle.title}
              conditions={playerTitle.conditions}
              statConditions={statConditionsTitle(statConditions, conditionItems)}
            />
            {profileBaseDateLabel && <p className="rule-change-footnote ranking-base-date">{profileBaseDateLabel}</p>}
            <RankedList
              rows={comparison ? comparison.rows : shownRows}
              compare={comparison?.compare}
              def={rankDef}
              rowKey={(p) => p.playerId}
              name={(p) => playerLabel(p.name)}
              // 選手名の下はチーム名とポジション、そのシーズンのルーキーには「Rookie」（登録区分の選択によらず。DESIGN.md 217章。登録区分はタイトルの下の行）。ポジションの「＊」（当時の値でない印）と注意書きは、
              // 身長・体重・年齢を並べる Profile でだけ出す（DESIGN.md 170章）
              subLabel={(p) =>
                [teamLabel(clubOf(p).teamId, clubOf(p).teamName), category === "profile" ? positionText(p) : p.position, rookies.ids?.has(p.playerId) ? "Rookie" : undefined]
                  .filter(Boolean)
                  .join("・")
              }
              linkTo={(p) => {
                if (!registeredOnlyIds.has(p.playerId)) return `/players/${p.playerId}`;
                const s = playerPageSeasons?.latestSeason[p.playerId];
                return s ? `/players/${p.playerId}?season=${s}` : undefined;
              }}
              teamColor={(p) => teamColors?.[clubOf(p).teamId]?.primary}
              avatar={(p) => <PlayerPhoto playerId={p.playerId} size={56} className="player-cell-photo" placeholder />}
              limit={PLAYER_RANK_TOP_N}
              compact
            />
            {category === "profile" && <HeightWeightNote players={eligible} />}
            {/* 年齢の基準日の注意書きは、年齢を表示しているとき（Profile の年齢）と、スタッツの条件で年齢を使っているときだけ（DESIGN.md 172章） */}
            {((category === "profile" && selectedItem.key === "age") || conditionKeys.includes("age")) && (
              <p className="rule-change-footnote">※ {AGE_BASE_NOTE}</p>
            )}
            {category === "career" && <p className="rule-change-footnote">※ {CAREER_NOTE}</p>}
            {category === "misc" && isRuleChangeStatKey(selectedItem.key) && <RuleChangeFootnote seasons={[season]} />}
            {rookieActive && <p className="rule-change-footnote">※ {ROOKIE_NOTE}</p>}
            {comparison && <CompareNotes season={season} prevSeason={prevSeason!} mode={rankMode} narrowed={rookieActive || conditionActive} kind="player" empty={comparison.rows.length === 0} />}
          </div>
        </>
      )}
    </>
  );
}

export function RankingsPage({ season }: { season: string }) {
  // チーム/個人はURLのクエリ（m=player）に持つ。切り替えたら前の側のフィルタのクエリは消す（DESIGN.md 163章）
  const [mode, setModeParam] = useUrlState(RANKING_MODE_PARAM, "team");
  const [kindParam, setKindParam] = useUrlState(RANKING_KIND_PARAM, "season");
  const [scope, setScopeParam] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  // 個人には1シーズン記録が無いので、URLに k=special があっても通常のシーズン成績にする
  const kind: RankingKind = mode === "player" && kindParam === "special" ? "season" : kindParam;
  const setMode = (next: Mode) => {
    if (next === mode) return;
    clearUrlParams();
    setModeParam(next);
  };
  // 種類を切り替えたら、前の種類のフィルタのクエリは消す（チーム／個人は残す）
  const setKind = (next: RankingKind) => {
    if (next === kind) return;
    clearUrlParams();
    setModeParam(mode);
    setKindParam(next);
  };
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const gameRecords = kind === "game";
  // 1シーズン記録はチームだけ（個人には1シーズンの記録の項目が無い）
  const kinds: RankingKind[] = mode === "team" ? ["season", "game", "career", "special"] : ["season", "game", "career"];
  // 歴代（通算記録は常に歴代）はシーズンに依らないので、シーズンを出さない
  const allTimeRecords = kind === "career" || kind === "special" || (gameRecords && scope === "allTime");

  return (
    <div data-design="v2">
      <h1>ランキング</h1>
      <p className="page-subtitle">{allTimeRecords ? "歴代" : `${season}シーズン`}</p>

      <div className="mode-toggle">
        <button className={mode === "team" ? "active" : ""} onClick={() => setMode("team")}>
          チーム
        </button>
        <button className={mode === "player" ? "active" : ""} onClick={() => setMode("player")}>
          個人
        </button>
      </div>

      {kinds.length > 1 && (
        <div className="mode-toggle ranking-kind-toggle">
          {kinds.map((k) => (
            <button key={k} type="button" className={kind === k ? "active" : ""} onClick={() => setKind(k)}>
              {RANKING_KIND_LABELS[k]}
            </button>
          ))}
        </div>
      )}
      {gameRecords && (
        <div className="mode-toggle records-scope-toggle">
          {(
            [
              ["allTime", "歴代"],
              ["season", "シーズン"],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={scope === key ? "active" : ""} onClick={() => setScopeParam(key)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* カテゴリのタブを「ページの主タブ」ではなく従のタブとして扱うため、ルート直下に置かない（v2のCSSは > .tab-bar だけを主タブにする） */}
      <div>
        {kind === "special" ? (
          <TeamSeasonRecordRanking teamColors={teamColors ?? undefined} />
        ) : kind === "career" ? (
          mode === "player" ? (
            <PlayerCareerRecordRanking teamColors={teamColors ?? undefined} />
          ) : (
            <TeamCareerRecordRanking teamColors={teamColors ?? undefined} />
          )
        ) : gameRecords ? (
          mode === "player" ? (
            <PlayerGameRecordRanking season={season} teamColors={teamColors ?? undefined} />
          ) : (
            <TeamGameRecordRanking season={season} teamColors={teamColors ?? undefined} />
          )
        ) : mode === "team" ? (
          <TeamRankingSection season={season} teamColors={teamColors ?? undefined} />
        ) : (
          <PlayerRankingSection season={season} teamColors={teamColors ?? undefined} />
        )}
      </div>
    </div>
  );
}