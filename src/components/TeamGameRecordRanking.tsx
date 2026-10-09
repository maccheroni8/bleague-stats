import { useEffect, useMemo, useRef } from "react";
import type { TeamColors } from "../../shared/types";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeagueTeamRankings, fetchTeamHistory, fetchTeams } from "../lib/data";
import { gameTypeAxis, simpleSelectAxis, statItemAxis, type FilterAxis } from "../lib/filterAxes";
import { filterByGameType } from "../../shared/gameType";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import {
  TEAM_RECORD_MODE_LABELS,
  TEAM_RECORD_TOP_N,
  allTimeTeamRecordRows,
  formatTeamRecordDetail,
  formatTeamRecordValue,
  leagueTeamDisplayName,
  seasonTeamRecordRows,
  teamRecordLowerFirst,
  teamRecordItems,
  type TeamGameRecordRow,
  type TeamRecordGame,
  type TeamRecordMode,
} from "../lib/teamGameRecords";
import { TEAM_PCT_MIN_ATTEMPTS_NOTE } from "../lib/topRecords";
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
  TEAM_STAT_CONDITION_ITEMS,
  queryTeamGameRecords,
  teamQueryStat,
} from "../lib/gameRecordQuery";
import { useGameIndexViews, useGameRecordOptions } from "../lib/useGameRecordData";
import { DEFAULT_STAT_CONDITIONS, statConditionMatcher, statConditionsTitle } from "../lib/statConditions";
import { enumParam, statConditionsParam, stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, RECORDS_SCOPE_PARAM, type RecordsScope } from "../lib/urlFilterParams";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { useJsonData } from "../lib/useJsonData";
import { useNarrow } from "../lib/teamLabel";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { GameRecordNotes } from "./GameRecordNotes";
import { RankedList } from "./RankedList";
import { RecordValue } from "./RecordValue";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { statConditionsBarExtra } from "./StatConditionsEditor";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > チーム > 1試合記録（DESIGN.md 191章）。範囲「歴代」は全シーズン（data/league-team-rankings.json の上位20位）、
 * 「シーズン」はページで選んでいるシーズンの全クラブの試合ログから作る。記録の種類は、記録／ワースト／被記録。
 * 項目は1試合の記録（TEAM_RECORD_STATS）と、記録・ワーストのクォーター別・前後半別。試合区分はレギュラーシーズン／ポストシーズン／合算。
 * 試合の条件・スタッツの条件・前後半5分の特別な試合を除く指定（少ない方から並べるときの既定）を付けたときだけ、1試合行の索引（219章）を読んで集計する（220章）。
 * 条件が無いときは、これまでどおり、歴代は上位20位のファイル、シーズンは全クラブの試合ログから作る
 */

// 項目キーは「q1:mostPts」のようにコロンを含む
const STAT_PARAM = stringParam("stat", "pts", (v) => /^[\w%:]+$/.test(v));
export const RECORD_MODE_PARAM = enumParam<TeamRecordMode>("rmode", ["record", "worst", "against"], "record");
const PBP_NOTE = "公式のクォーター別スコアが欠けている試合のため、プレーバイプレーの得点から出した値です。";

/** チームの1試合記録のランキングの URL（チーム一覧の記録タブのカードから移るとき） */
export function teamGameRecordRankingUrl(opts: {
  scope: RecordsScope;
  gameType: SeasonGameTypeFilter;
  mode: TeamRecordMode;
  statKey: string;
  season?: string;
}): string {
  const p = new URLSearchParams();
  p.set("k", "game");
  RECORDS_SCOPE_PARAM.write(p, opts.scope);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  RECORD_MODE_PARAM.write(p, opts.mode);
  p.set("stat", opts.statKey);
  if (opts.season) p.set("season", opts.season);
  return `/rankings?${p.toString()}`;
}

/** 名前の下の行: 日付（シーズン）・対戦相手（クォーター別・前後半別は区間のスコアも） */
function TeamGameRecordLine({ r }: { r: TeamGameRecordRow }) {
  const narrow = useNarrow();
  const date = narrow ? r.date.replace(/-/g, "/").slice(2) : r.date;
  return (
    <>
      <span className="record-date-nowrap">
        {date}（{r.season}）
      </span>
      {narrow ? " " : "　"}
      {r.isHome ? "vs" : "@"} <ResponsiveTeamName teamId={r.opponentTeamId} name={r.opponentTeamName} always nowrap />
      {r.ownPoints !== undefined && <span className="record-date-nowrap">　区間 {r.ownPoints}-{r.oppPoints}</span>}
      {r.detail && <span className="record-detail">　{formatTeamRecordDetail(r.detail, r.value)}</span>}
    </>
  );
}

export function TeamGameRecordRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [scope] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [mode, setMode] = useUrlState(RECORD_MODE_PARAM, "record");
  const [statParam, setStatKey] = useUrlState(STAT_PARAM, "pts");
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const [statConditions, setStatConditions] = useUrlState(statConditionsParam, DEFAULT_STAT_CONDITIONS);
  const allTime = scope === "allTime";

  // 項目
  const items = useMemo(() => teamRecordItems(mode), [mode]);
  const item = items.find((i) => i.key === statParam) ?? items.find((i) => i.key === "pts") ?? items[0]!;
  const stat = useMemo(() => teamQueryStat(mode, item.key)!, [mode, item.key]);
  const includeSpecialDefault = effectiveIncludeSpecial(DEFAULT_GAME_RECORD_CONDITIONS, stat.lowerFirst);
  const includeSpecial = effectiveIncludeSpecial(conditions, stat.lowerFirst);
  const hasStatConditions = statConditionMatcher(statConditions, TEAM_STAT_CONDITION_ITEMS) !== null;
  // 条件が無く、前後半5分の特別な試合も除かない間は、これまでどおり（歴代は上位20位のファイル、シーズンは全クラブの試合ログ）。条件を付けたときだけ索引を読む
  const useIndex = hasGameConditions(conditions) || hasStatConditions || !includeSpecial;
  const options = useGameRecordOptions(scope, season);

  // 歴代: 集計ファイルと名称の履歴。シーズン: そのシーズンの全クラブの試合ログ（使わない範囲・索引を使うときは読み込まない）
  const useFiles = !useIndex;
  const { data: rankings, loading: rankingsLoading } = useJsonData(
    () => (allTime && useFiles ? fetchLeagueTeamRankings() : Promise.resolve(null)),
    [allTime, useFiles],
  );
  const { data: history } = useJsonData(() => (allTime && useFiles ? fetchTeamHistory() : Promise.resolve(null)), [allTime, useFiles]);
  const { data: teams, loading: teamsLoading } = useJsonData(
    () => (allTime || !useFiles ? Promise.resolve(null) : fetchTeams(season)),
    [allTime, season, useFiles],
  );
  const { gameLogsByTeam, loading: logsLoading } = useAllTeamGameLogs(season, allTime || !useFiles ? null : (teams ?? null));
  const index = useGameIndexViews("team", scope, season, useIndex);

  const games = useMemo<TeamRecordGame[]>(() => {
    if (allTime || !useFiles || !teams || !gameLogsByTeam) return [];
    const all = teams.flatMap((t) =>
      (gameLogsByTeam.get(t.teamId) ?? []).map((g) => ({ ...g, season, teamId: t.teamId, teamName: t.teamName })),
    );
    return filterByGameType(all, gameType);
  }, [allTime, useFiles, teams, gameLogsByTeam, season, gameType]);

  const result = useMemo(
    () => (index.views ? queryTeamGameRecords({ views: index.views, gameType, conditions, statConditions, stat, includeSpecial }) : null),
    [index.views, gameType, conditions, statConditions, stat, includeSpecial],
  );

  const rows = useMemo<TeamGameRecordRow[]>(
    () =>
      useIndex
        ? (result?.rows ?? [])
        : allTime
          ? allTimeTeamRecordRows(rankings, history, mode, gameType, item.key, leagueTeamDisplayName)
          : seasonTeamRecordRows(games, mode, item.key),
    [useIndex, result, allTime, rankings, history, mode, gameType, item.key, games],
  );
  const loading = useIndex ? index.loading || !result : allTime ? rankingsLoading : teamsLoading || logsLoading;

  // シーズンを変えたとき（とページを開いたとき）に、そのシーズンに無い対戦相手・地区を外す
  useEffect(() => {
    if (allTime || !options.ready) return;
    const next = cleanGameConditionsForSeason(conditions, options.teams.map((t) => t.value), options.divisions);
    if (next) setConditions(next);
  }, [allTime, options, conditions, setConditions]);

  const seasonForTitle = allTime ? null : season;
  const teamName = (id: string) => {
    const t = options.teams.find((o) => o.value === id);
    return t ? (narrow ? t.label : t.name) : id;
  };
  const conditionLabels = composeLabels(gameTypeLabels(gameType, seasonForTitle), gameRecordConditionLabels(conditions, teamName, includeSpecialDefault));
  const modeLabel = TEAM_RECORD_MODE_LABELS[mode];
  const title = allTime ? `歴代 チーム1試合${modeLabel}：${item.label}` : `${season}シーズン チーム1試合${modeLabel}：${item.label}`;
  const filename = buildExportFilename([`チーム1試合${modeLabel}`, allTime ? "歴代" : season, item.label, ...conditionLabels]);
  const isPct = ["fgPct", "twoPct", "tpPct", "ftPct"].includes(item.key);
  const hasPbp = rows.some((r) => r.fromPbp);

  const modeAxis = simpleSelectAxis({
    id: "recordMode",
    label: "記録の種類",
    options: (Object.keys(TEAM_RECORD_MODE_LABELS) as TeamRecordMode[]).map((m) => ({ value: m, label: TEAM_RECORD_MODE_LABELS[m] })),
    value: mode,
    defaultValue: "record",
    onChange: (v) => setMode(v as TeamRecordMode),
  });
  const clearAll = () => {
    setGameType("regular");
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
    setStatConditions({ ...statConditions, conditions: [] });
  };
  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial, includeSpecialDefault };
  const axes: FilterAxis[] = [
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    modeAxis,
    ...gameRecordPrimaryAxes(axesInput),
    ...gameRecordAdvancedAxes(axesInput),
  ];

  return (
    <>
      <FilterBar
        axes={axes}
        stateKey="rankings:team:game"
        onClearAll={clearAll}
        advancedExtra={statConditionsBarExtra(statConditions, setStatConditions, TEAM_STAT_CONDITION_ITEMS, { defaultKey: "pts" })}
      />
      <FilterBar
        simple
        wide
        stateKey="rankings:team:game:stat"
        axes={[
          statItemAxis(
            items,
            item.key,
            setStatKey,
          ),
        ]}
      />
      {useIndex && index.error ? (
        <div className="error-message">
          <p>1試合の記録を読み込めませんでした（{index.error}）。</p>
          <button type="button" className="load-more-button" onClick={index.retry}>
            再読み込み
          </button>
        </div>
      ) : loading ? (
        <p className="loading">読み込み中...</p>
      ) : rows.length === 0 ? (
        <>
          <p className="empty-message">この条件の試合がありません</p>
          {result && (
            <GameRecordNotes excludedSpecial={result.excludedSpecial} ascendingDefault={!includeSpecialDefault} positionFallback={false} />
          )}
        </>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
            <ConditionTitle title={title} conditions={conditionLabels} statConditions={statConditionsTitle(statConditions, TEAM_STAT_CONDITION_ITEMS)} />
            <RankedList
              rows={rows}
              def={{
                key: item.key,
                label: item.label,
                value: (r) => r.value,
                format: (r) => formatTeamRecordValue(item.key, r.value),
                higherIsBetter: !teamRecordLowerFirst(mode, item.key),
              }}
              renderValue={(r) => (
                <>
                  <RecordValue
                    text={formatTeamRecordValue(item.key, r.value)}
                    fraction={r.made !== undefined && r.attempted !== undefined ? [r.made, r.attempted] : undefined}
                  />
                  {r.fromPbp && <span title={PBP_NOTE}>※</span>}
                </>
              )}
              tieKey={(r) => String(r.value)}
              rowKey={(r) => `${r.scheduleKey}-${r.teamId}`}
              name={(r) => <ResponsiveTeamName teamId={r.teamId} name={r.teamName} />}
              subLabel={(r) => <TeamGameRecordLine r={r} />}
              linkTo={(r) => `/teams/${r.teamId}?season=${r.season}`}
              subLinkTo={(r) => `/games/${r.scheduleKey}?season=${r.season}`}
              teamColor={(r) => teamColors?.[r.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.teamId} size={48} placeholder />}
              limit={TEAM_RECORD_TOP_N}
              tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
              unit="試合"
              sortable={false}
              statScope="team"
              compact
            />
            {isPct && <p className="rule-change-footnote">※ {TEAM_PCT_MIN_ATTEMPTS_NOTE}同じ率の中は試投数の多い試合から並べます。</p>}
            {hasPbp && <p className="rule-change-footnote">※ {PBP_NOTE}</p>}
            {mode === "against" && (
              <p className="rule-change-footnote">※ 被記録は、対戦相手がそのチーム相手に記録した値です。チーム名は、その値を記録された側のクラブです。</p>
            )}
            {useIndex && hasStatConditions && (
              <p className="rule-change-footnote">※ スタッツの条件は、記録したチーム自身のその試合の値で判定します{mode === "against" ? "（被記録でも、対戦相手の値ではありません）" : ""}。</p>
            )}
            {result && (
              <GameRecordNotes
                excludedSpecial={result.excludedSpecial}
                ascendingDefault={!includeSpecialDefault}
                positionFallback={false}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
