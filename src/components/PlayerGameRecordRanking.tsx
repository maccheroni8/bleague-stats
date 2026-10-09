import { useEffect, useMemo, useRef } from "react";
import type { PlayerGameRecordDef } from "../../shared/playerGameRecords";
import type { TeamColors } from "../../shared/types";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { fetchLeaguePlayerGameRecords, fetchPlayerGameRecords } from "../lib/data";
import { classificationAxis, gameTypeAxis, multiSelectAxis, simpleSelectAxis, statItemAxis, type FilterAxis } from "../lib/filterAxes";
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
  GAME_RECORD_TIE_EXPAND_MAX,
  PLAYER_RECORD_MODE_LABELS,
  PLAYER_STAT_CONDITION_ITEMS,
  playerQueryStats,
  playerStatUnavailableIn,
  queryPlayerGameRecords,
  type PlayerRecordMode,
  type PlayerRecordRow,
} from "../lib/gameRecordQuery";
import { useGameIndexViews, useGameRecordOptions, useRookieFile } from "../lib/useGameRecordData";
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
const POSITION_OPTIONS = positionFilterOptions(["PG", "PG/SG", "SG", "SG/SF", "SF", "SF/PF", "PF", "C/PF", "C"].map((position) => ({ position })));

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
      <ResponsiveTeamName teamId={e.teamId} name={e.teamName} always /> {e.isHome ? "vs" : "@"}{" "}
      <ResponsiveTeamName teamId={e.opponentTeamId} name={e.opponentTeamName} always />
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
  const allTime = scope === "allTime";
  const seasonForTitle = allTime ? null : season;

  // 項目: 記録＝今の36項目、ワースト＝成功率6つ・EFF・+/-（少ない順）とTOV（多い順）。その項目を算出できないシーズン（2016-17のPTSOFFTO）は選べない
  const stats = useMemo(() => playerQueryStats(mode), [mode]);
  const unavailableHere = (s: { column?: string }) => !allTime && playerStatUnavailableIn(season, s);
  const stat = stats.find((s) => s.key === statParam && !unavailableHere(s)) ?? stats.find((s) => s.key === "pts") ?? stats.find((s) => !unavailableHere(s)) ?? stats[0]!;
  const def: PlayerGameRecordDef = stat.def;
  const includeSpecialDefault = effectiveIncludeSpecial(DEFAULT_GAME_RECORD_CONDITIONS, stat.lowerFirst);
  const includeSpecial = effectiveIncludeSpecial(conditions, stat.lowerFirst);
  const hasStatConditions = statConditionMatcher(statConditions, PLAYER_STAT_CONDITION_ITEMS) !== null;

  // 条件が無く、上位20位のファイルで出せる間は索引を読まない。ファイルに無い表（ワースト）・条件・ルーキー・ポジション・前後半5分の特別試合を除く指定は索引から
  const useIndex = stat.indexOnly || hasGameConditions(conditions) || positions.length > 0 || group === "rookie" || hasStatConditions || !includeSpecial;

  const options = useGameRecordOptions(scope, season);
  const { data: file, loading: fileLoading } = useJsonData(
    () => (useIndex ? Promise.resolve(null) : allTime ? fetchLeaguePlayerGameRecords() : fetchPlayerGameRecords(season)),
    [allTime, season, useIndex],
  );
  const index = useGameIndexViews("player", scope, season, useIndex);
  const rookies = useRookieFile(useIndex && group === "rookie");

  const result = useMemo(
    () =>
      index.views && (group !== "rookie" || rookies.file)
        ? queryPlayerGameRecords({ views: index.views, gameType, conditions, group, positions, statConditions, rookies: rookies.file, stat, includeSpecial })
        : null,
    [index.views, gameType, conditions, group, positions, statConditions, rookies.file, stat, includeSpecial],
  );

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
  const loading = useIndex ? index.loading || rookies.loading : fileLoading;
  const failure = useIndex ? (index.error ?? rookies.error) : null;
  const noData = !useIndex && !loading && !tables;

  const teamName = (id: string) => {
    const t = options.teams.find((o) => o.value === id);
    return t ? (narrow ? t.label : t.name) : id;
  };
  const positionLabels = positions.length > 0 ? multiSelectLabels("ポジション", selectedPositionLabels(POSITION_OPTIONS, positions), "全ポジション") : [];
  const conditionLabels = composeLabels(
    group !== "all" && classificationLabels(group),
    positionLabels,
    gameTypeLabels(gameType, seasonForTitle),
    gameRecordConditionLabels(conditions, teamName, includeSpecialDefault),
  );
  const modeLabel = mode === "worst" ? "ワースト" : "記録";
  const title = allTime ? `歴代 個人1試合${modeLabel}：${def.label}` : `${season}シーズン 個人1試合${modeLabel}：${def.label}`;
  const filename = buildExportFilename([`個人1試合${modeLabel}`, allTime ? "歴代" : season, def.label, ...conditionLabels]);
  const minNote = playerGameRecordMinAttemptsNote(def.key);
  const seasonOf = (e: PlayerRecordRow) => e.season ?? season;

  const clearAll = () => {
    setGroup("all");
    setGameType("regular");
    setPositions(EMPTY_POSITIONS);
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
    setStatConditions({ ...statConditions, conditions: [] });
  };
  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial, includeSpecialDefault };
  const axes: FilterAxis[] = [
    classificationAxis(group, setGroup, {
      rookie: { disabledReason: !allTime && !rookieSupportedSeason(season) ? ROOKIE_UNSUPPORTED_REASON : undefined },
    }),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    simpleSelectAxis({
      id: "recordMode",
      label: "記録の種類",
      options: (Object.keys(PLAYER_RECORD_MODE_LABELS) as PlayerRecordMode[]).map((m) => ({ value: m, label: PLAYER_RECORD_MODE_LABELS[m] })),
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
              disabled: unavailableHere(s),
              disabledReason: unavailableHere(s) ? `${season}は、公式の記録にターンオーバーからの得点が無いため選べません。` : undefined,
            })),
            def.key,
            setStatKey,
          ),
        ]}
      />
      {failure ? (
        <div className="error-message">
          <p>1試合の記録を読み込めませんでした（{failure}）。</p>
          <button type="button" className="load-more-button" onClick={index.retry}>
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
          {result && <GameRecordNotes excludedSpecial={result.excludedSpecial} ascendingDefault={includeSpecialDefault === false} unavailableSeasons={result.unavailableSeasons} unavailableLabel="ターンオーバーからの得点" positionFallback={false} />}
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
              {result && (
                <GameRecordNotes
                  excludedSpecial={result.excludedSpecial}
                  ascendingDefault={includeSpecialDefault === false}
                  unavailableSeasons={result.unavailableSeasons}
                  unavailableLabel="ターンオーバーからの得点"
                  rookie={group === "rookie" ? { allTime } : undefined}
                  positionFallback={positions.length > 0 && entries.some((e) => e.positionFallback)}
                />
              )}
            </PlayerNamePool>
          </div>
        </>
      )}
    </>
  );
}
