import { useEffect, useMemo, useRef } from "react";
import type { PlayerGameRecordDef } from "../../shared/playerGameRecords";
import type { TeamColors } from "../../shared/types";
import { ACTIVE_LABEL, ACTIVE_PARAM, activeAxis, activeNote, useActivePlayerIds } from "../lib/activePlayers";
import { useCurrentPlayerNames } from "../lib/currentPlayerNames";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { fetchLeaguePlayerGameRecords, fetchPlayerGameRecords } from "../lib/data";
import { classificationAxis, gameTypeAxis, multiSelectAxis, periodAxis, simpleSelectAxis, statItemAxis, type FilterAxis } from "../lib/filterAxes";
import { classKeyOfFilter, positionFilterOptions, selectedPositionLabels } from "../lib/classificationFilter";
import {
  DEFAULT_GAME_RECORD_CONDITIONS,
  cleanGameConditionsForSeason,
  effectiveIncludeSpecial,
  gameRecordConditionLabels,
  gameRecordConditionsParam,
  hasGameConditions,
} from "../lib/gameRecordConditions";
import { gameRecordAdvancedAxes, gameRecordPrimaryAxes } from "../lib/gameRecordAxes";
import {
  GAME_RECORD_PERIOD_OPTIONS,
  GAME_RECORD_PERIOD_PARAM,
  PERIOD_ASTED_UNSUPPORTED_REASON,
  PERIOD_PLUS_MINUS_UNSUPPORTED_REASON,
  PERIOD_WORST_UNSUPPORTED_REASON,
  gameRecordPeriodLabel,
  gameRecordPeriodOf,
  periodPlusMinusUnsupported,
} from "../lib/gameRecordPeriod";
import {
  GAME_RECORD_TIE_EXPAND_MAX,
  PLAYER_RECORD_MODE_LABELS,
  PLAYER_STAT_CONDITION_ITEMS,
  playerQueryStats,
  queryPlayerGameRecords,
  type PlayerRecordMode,
  type PlayerRecordRow,
} from "../lib/gameRecordQuery";
import { useGameIndexViews, useGameRecordOptions, usePlayerPeriodViews, useRookieFile } from "../lib/useGameRecordData";
import { formatPlayerGameRecordValue, playerGameRecordFraction, playerGameRecordMinAttemptsNote } from "../lib/playerGameRecordFormat";
import { ROOKIE_UNSUPPORTED_REASON, rookieSupportedSeason } from "../lib/rookieFilter";
import { DEFAULT_STAT_CONDITIONS, statConditionMatcher, statConditionsTitle } from "../lib/statConditions";
import { useNarrow } from "../lib/teamLabel";
import { enumParam, listParam, statConditionsParam, stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, PLAYER_GROUP_PARAM, POSITION_PARAM, RECORDS_SCOPE_PARAM, type RecordsScope } from "../lib/urlFilterParams";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { GameRecordNotes } from "./GameRecordNotes";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { RankedList } from "./RankedList";
import { RecordValue } from "./RecordValue";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { statConditionsBarExtra } from "./StatConditionsEditor";

/**
 * ランキング > 個人 > 1試合記録（DESIGN.md 190章・220章）。範囲「歴代」は全シーズン（data/league-player-game-records.json）、
 * 「シーズン」はページで選んでいるシーズン（data/{season}/player-game-records.json）の、選手の1試合の記録の上位20位。
 * 条件なしの初期表示は、夜間の集計が書き出した上位20位のファイルを使い、全選手の試合ログは読まない。
 * 試合の条件・ルーキー・ポジション・スタッツの条件・ワースト（少ない順）を付けたときだけ、1試合行の索引（219章）を読んで集計する。
 * 試合区分はレギュラーシーズン／ポストシーズン／合算
 */

const STAT_PARAM = stringParam("stat", "pts", (v) => /^\w+$/.test(v));
export const PLAYER_RECORD_MODE_PARAM = enumParam<PlayerRecordMode>("rmode", ["record", "worst"], "record");
const RANK_TOP_N = 20;
const EMPTY_POSITIONS: string[] = [];
/** ポジションの選択肢（そのシーズンに実際にいるかは見ず、すべて出す。索引を読まずに選べるように） */
export const POSITION_OPTIONS = positionFilterOptions(["PG", "PG/SG", "SG", "SG/SF", "SF", "SF/PF", "PF", "C/PF", "C"].map((position) => ({ position })));

/** 選手の1試合記録のランキングの URL（選手一覧の記録タブのカードから移るとき等） */
export function playerGameRecordRankingUrl(opts: { scope: RecordsScope; gameType: SeasonGameTypeFilter; statKey: string; season?: string }): string {
  const p = new URLSearchParams();
  p.set("m", "player");
  p.set("k", "game");
  RECORDS_SCOPE_PARAM.write(p, opts.scope);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  p.set("stat", opts.statKey);
  if (opts.season) p.set("season", opts.season);
  return `/rankings?${p.toString()}`;
}

/** 名前の下の行: 日付（シーズン）・当時のチーム・対戦相手（ポジションで絞り込んでいるときは当時のポジション） */
export function PlayerGameRecordLine({ e, season, showPosition = false }: { e: PlayerRecordRow; season: string; showPosition?: boolean }) {
  const narrow = useNarrow();
  const date = narrow ? e.date.replace(/-/g, "/").slice(2) : e.date;
  const position = showPosition && e.position ? `${e.position}${e.positionFallback ? "＊" : ""}` : null;
  return (
    <>
      <span className="record-date-nowrap">
        {date}（{season}）
      </span>
      {narrow ? " " : "　"}
      <ResponsiveTeamName teamId={e.teamId} name={e.teamName} always nowrap /> {e.isHome ? "vs" : "@"}{" "}
      <ResponsiveTeamName teamId={e.opponentTeamId} name={e.opponentTeamName} always nowrap />
      {position && <span className="record-date-nowrap">　{position}</span>}
    </>
  );
}

export function PlayerGameRecordRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [scope] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [group, setGroup] = useUrlState(PLAYER_GROUP_PARAM, "all");
  const [mode, setMode] = useUrlState(PLAYER_RECORD_MODE_PARAM, "record");
  const [statParam, setStatKey] = useUrlState(STAT_PARAM, "pts");
  const [positions, setPositions] = useUrlState(POSITION_PARAM, EMPTY_POSITIONS);
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);
  const [activeParam, setActive] = useUrlState(ACTIVE_PARAM, "all");
  const [periodParam, setPeriod] = useUrlState(GAME_RECORD_PERIOD_PARAM, "all");
  const allTime = scope === "allTime";
  // Q別・前後半・延長（試合全体は null）。選ぶと、その区間の値で条件・並びを決める（ピリオド別の索引。DESIGN.md 225章）
  const period = gameRecordPeriodOf(periodParam);
  // 現役の絞り込みは歴代だけ（過去の選手が混ざる範囲）
  const activeOn = allTime && activeParam === "active";
  const seasonForTitle = allTime ? null : season;

  // 項目: 記録＝今の36項目、ワースト＝成功率6つ・EFF・+/-（少ない順）とTOV（多い順）。
  // 区間を選んでいる間は、ワースト（少ない順）・被アシスト率は選べない。+/- は公式のQ別・前後半の値がある2022-23以降だけ
  const stats = useMemo(
    () =>
      playerQueryStats(mode).map((s) => {
        const disabledReason = !period
          ? undefined
          : s.key === "astedPct"
            ? PERIOD_ASTED_UNSUPPORTED_REASON
            : s.key === "plusMinus" && !allTime && periodPlusMinusUnsupported(season)
              ? PERIOD_PLUS_MINUS_UNSUPPORTED_REASON
              : undefined;
        return { ...s, disabled: !!disabledReason, disabledReason };
      }),
    [mode, period, allTime, season],
  );
  const selectableStats = stats.filter((s) => !s.disabled);
  const stat = selectableStats.find((s) => s.key === statParam) ?? selectableStats.find((s) => s.key === "pts") ?? selectableStats[0]!;
  const def: PlayerGameRecordDef = stat.def;
  const includeSpecialDefault = effectiveIncludeSpecial(DEFAULT_GAME_RECORD_CONDITIONS, stat.lowerFirst);
  const includeSpecial = effectiveIncludeSpecial(conditions, stat.lowerFirst);
  const hasStatConditions = statConditionMatcher(statConditions, PLAYER_STAT_CONDITION_ITEMS) !== null;

  // 条件が無く、上位20位のファイルで出せる間は索引を読まない。ファイルに無い表（ワースト）・条件・ルーキー・ポジション・前後半5分の特別試合を除く指定は索引から
  const useIndex = !!period || stat.indexOnly || hasGameConditions(conditions) || positions.length > 0 || group === "rookie" || hasStatConditions || !includeSpecial || activeOn;

  const options = useGameRecordOptions(scope, season);
  const { data: file, loading: fileLoading } = useJsonData(
    () => (useIndex ? Promise.resolve(null) : allTime ? fetchLeaguePlayerGameRecords() : fetchPlayerGameRecords(season)),
    [allTime, season, useIndex],
  );
  const index = useGameIndexViews("player", scope, season, useIndex);
  const periodIndex = usePlayerPeriodViews(index.views, useIndex && !!period);
  const rookies = useRookieFile(useIndex && group === "rookie");
  const active = useActivePlayerIds(activeOn);
  // 歴代で索引から作る表は、選手名を今の登録名にそろえる（上位20位のファイルは、作る側でそろえてある）
  const current = useCurrentPlayerNames(allTime && useIndex);

  const result = useMemo(
    () =>
      index.views && (!period || periodIndex.views) && (group !== "rookie" || rookies.file) && (!activeOn || active.ids) && (!allTime || current.names)
        ? queryPlayerGameRecords({
            views: index.views,
            gameType,
            conditions,
            group,
            positions,
            statConditions,
            rookies: rookies.file,
            activeIds: activeOn ? active.ids : null,
            currentNames: allTime ? current.names : null,
            stat,
            includeSpecial,
            period: period && periodIndex.views ? { period, views: periodIndex.views } : undefined,
          })
        : null,
    [index.views, periodIndex.views, period, gameType, conditions, group, positions, statConditions, rookies.file, activeOn, active.ids, allTime, current.names, stat, includeSpecial],
  );

  // 区間を選んだとき（とページを開いたとき）に、選べない「ワースト」を外す
  useEffect(() => {
    if (period && mode === "worst") setMode("record");
  }, [period, mode, setMode]);

  // シーズンを変えたとき（とページを開いたとき）に、そのシーズンに無い対戦相手・地区・ルーキーを外す
  useEffect(() => {
    if (allTime) return;
    if (group === "rookie" && !rookieSupportedSeason(season)) setGroup("all");
    if (!options.ready) return;
    const next = cleanGameConditionsForSeason(conditions, options.teams.map((t) => t.value), options.divisions);
    if (next) setConditions(next);
  }, [allTime, season, group, conditions, options, setGroup, setConditions]);

  // 登録区分を選んだときは、その区分の選手だけの中での上位（区分ごとの表。DESIGN.md 197章）
  const classKey = group === "rookie" ? undefined : classKeyOfFilter(group);
  const tables = classKey ? file?.byClassification?.[classKey] : file?.byGameType;
  const entries: PlayerRecordRow[] | undefined = useIndex ? result?.rows : (tables?.[gameType]?.[def.key] ?? []);
  const loading = useIndex ? index.loading || periodIndex.loading || rookies.loading || active.loading || current.loading : fileLoading;
  const failure = useIndex ? (index.error ?? periodIndex.error ?? rookies.error ?? active.error ?? current.error) : null;
  const noData = !useIndex && !loading && !tables;

  const teamName = (id: string) => {
    const t = options.teams.find((o) => o.value === id);
    return t ? (narrow ? t.label : t.name) : id;
  };
  const positionLabels = positions.length > 0 ? multiSelectLabels("ポジション", selectedPositionLabels(POSITION_OPTIONS, positions), "全ポジション") : [];
  const conditionLabels = composeLabels(
    gameRecordPeriodLabel(periodParam),
    activeOn && ACTIVE_LABEL,
    group !== "all" && classificationLabels(group),
    positionLabels,
    gameTypeLabels(gameType, seasonForTitle),
    gameRecordConditionLabels(conditions, teamName, includeSpecialDefault),
  );
  const modeLabel = mode === "worst" ? "ワースト" : "記録";
  const title = allTime ? `歴代 個人1試合${modeLabel}：${def.label}` : `${season}シーズン 個人1試合${modeLabel}：${def.label}`;
  const filename = buildExportFilename([`個人1試合${modeLabel}`, allTime ? "歴代" : season, def.label, ...conditionLabels]);
  const minNote = playerGameRecordMinAttemptsNote(def.key, period ? (period === "ot" ? "延長" : period === "h1" ? "前半" : period === "h2" ? "後半" : `${period.slice(1)}Q`) : undefined);
  const seasonOf = (e: PlayerRecordRow) => e.season ?? season;
  const periodNotes = period && result ? { overtime: period === "ot", shortGames: result.periodShortGames ?? 0, noPlusMinus: result.excludedNoPlusMinus ?? 0 } : undefined;

  const clearAll = () => {
    setGroup("all");
    setActive("all");
    setGameType("regular");
    setPeriod("all");
    setPositions(EMPTY_POSITIONS);
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
    setStatConditions({ ...statConditions, conditions: [] });
  };
  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial, includeSpecialDefault };
  const axes: FilterAxis[] = [
    classificationAxis(group, setGroup, {
      rookie: { disabledReason: !allTime && !rookieSupportedSeason(season) ? ROOKIE_UNSUPPORTED_REASON : undefined },
    }),
    ...(allTime ? [activeAxis(activeParam, setActive)] : []),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    periodAxis(periodParam, setPeriod, GAME_RECORD_PERIOD_OPTIONS, { label: "Q別・前後半・延長" }),
    simpleSelectAxis({
      id: "recordMode",
      label: "記録の種類",
      options: (Object.keys(PLAYER_RECORD_MODE_LABELS) as PlayerRecordMode[]).map((m) => ({
        value: m,
        label: PLAYER_RECORD_MODE_LABELS[m],
        ...(m === "worst" && period ? { disabled: true, disabledReason: PERIOD_WORST_UNSUPPORTED_REASON } : {}),
      })),
      value: mode,
      defaultValue: "record",
      onChange: (v) => setMode(v as PlayerRecordMode),
    }),
    ...gameRecordPrimaryAxes(axesInput),
    multiSelectAxis({
      id: "g.position",
      label: "ポジション",
      tier: "advanced",
      options: POSITION_OPTIONS,
      selected: positions,
      onChangeSelected: setPositions,
      allLabel: "全ポジション",
    }),
    ...gameRecordAdvancedAxes(axesInput),
  ];

  return (
    <>
      <FilterBar
        axes={axes}
        stateKey="rankings:player:game"
        onClearAll={clearAll}
        advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, PLAYER_STAT_CONDITION_ITEMS, { defaultKey: "pts" })}
      />
      <FilterBar
        simple
        wide
        stateKey="rankings:player:game:stat"
        axes={[
          statItemAxis(
            stats.map((s) => ({
              key: s.key,
              label: s.label,
              disabled: s.disabled,
              disabledReason: s.disabledReason,
            })),
            def.key,
            setStatKey,
          ),
        ]}
      />
      {failure ? (
        <div className="error-message">
          <p>1試合の記録を読み込めませんでした（{failure}）。</p>
          <button
            type="button"
            className="load-more-button"
            onClick={() => {
              index.retry();
              active.retry();
              current.retry();
            }}
          >
            再読み込み
          </button>
        </div>
      ) : loading || (useIndex && !result) ? (
        <p className="loading">読み込み中...</p>
      ) : noData ? (
        <p className="empty-message">データがありません</p>
      ) : !entries || entries.length === 0 ? (
        <>
          <p className="empty-message">この条件の試合がありません</p>
          {result && <GameRecordNotes excludedSpecial={result.excludedSpecial} ascendingDefault={includeSpecialDefault === false} positionFallback={false} period={periodNotes} />}
        </>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditionLabels} statConditions={statConditionsTitle(statConditions, PLAYER_STAT_CONDITION_ITEMS)} />
            <PlayerNamePool names={entries.map((e) => e.playerName)}>
              <RankedList
                rows={entries}
                def={{
                  key: def.key,
                  label: def.label,
                  value: (e) => e.value,
                  format: (e) => formatPlayerGameRecordValue(def, e.value),
                  higherIsBetter: !stat.lowerFirst,
                }}
                renderValue={(e) => <RecordValue text={formatPlayerGameRecordValue(def, e.value)} fraction={playerGameRecordFraction(e)} />}
                tieKey={(e) => String(e.value)}
                rowKey={(e) => `${e.scheduleKey}-${e.playerId}`}
                name={(e) => <ResponsivePlayerName name={e.playerName} playerId={e.playerId} season={seasonOf(e)} />}
                subLabel={(e) => <PlayerGameRecordLine e={e} season={seasonOf(e)} showPosition={positions.length > 0} />}
                linkTo={(e) => `/players/${e.playerId}?season=${seasonOf(e)}`}
                subLinkTo={(e) => `/games/${e.scheduleKey}?season=${seasonOf(e)}`}
                teamColor={(e) => teamColors?.[e.teamId]?.primary}
                avatar={(e) => <PlayerPhoto playerId={e.playerId} size={56} className="player-cell-photo" placeholder />}
                limit={RANK_TOP_N}
                tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
                unit="試合"
                sortable={false}
                compact
              />
              {minNote && <p className="rule-change-footnote">※ {minNote}</p>}
              {activeOn && <p className="rule-change-footnote">※ {activeNote()}</p>}
              {result && (
                <GameRecordNotes
                  excludedSpecial={result.excludedSpecial}
                  ascendingDefault={includeSpecialDefault === false}
                  rookie={group === "rookie" ? { allTime } : undefined}
                  positionFallback={positions.length > 0 && entries.some((e) => e.positionFallback)}
                  period={periodNotes}
                />
              )}
            </PlayerNamePool>
          </div>
        </>
      )}
    </>
  );
}
