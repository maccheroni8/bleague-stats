import { useEffect, useMemo, useRef } from "react";
import type { TeamColors } from "../../shared/types";
import { ACTIVE_LABEL, ACTIVE_PARAM, activeAxis, activeNote, useActivePlayerIds } from "../lib/activePlayers";
import { useCurrentPlayerNames } from "../lib/currentPlayerNames";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { selectedPositionLabels } from "../lib/classificationFilter";
import { classificationAxis, gameTypeAxis, multiSelectAxis, simpleSelectAxis, type FilterAxis } from "../lib/filterAxes";
import { currentSeason } from "../lib/season";
import { seasonGameTypeLabels } from "../../shared/gameType";
import { DEFAULT_GAME_RECORD_CONDITIONS, cleanGameConditionsForSeason, gameRecordConditionLabels, gameRecordConditionsParam } from "../lib/gameRecordConditions";
import { gameRecordAdvancedAxes, gameRecordPrimaryAxes } from "../lib/gameRecordAxes";
import { ROOKIE_NOTE, ROOKIE_UNSUPPORTED_REASON, rookieSupportedSeason } from "../lib/rookieFilter";
import { activeStatConditions, statConditionsSummary } from "../lib/statConditions";
import { useNarrow } from "../lib/teamLabel";
import {
  DEFAULT_THRESHOLD,
  THRESHOLD_ITEMS,
  THRESHOLD_CAREER_MIN_GAMES,
  THRESHOLD_QUICK_VALUES,
  queryThresholdAge,
  queryThresholdCount,
  queryThresholdStreaks,
  thresholdActive,
} from "../lib/thresholdQuery";
import { THRESHOLD_AGE_PARAM, THRESHOLD_ONGOING_PARAM, THRESHOLD_SORT_PARAM, THRESHOLD_UNIT_PARAM, thresholdParam } from "../lib/thresholdParams";
import { useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, PLAYER_GROUP_PARAM, POSITION_PARAM, RECORDS_SCOPE_PARAM } from "../lib/urlFilterParams";
import { useGameIndexViews, useGameRecordOptions, useRookieFile, useSeasonRosters } from "../lib/useGameRecordData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { POSITION_OPTIONS } from "./PlayerGameRecordRanking";
import { StatConditionsEditor } from "./StatConditionsEditor";
import { ThresholdAgeList, ThresholdCountList, ThresholdStreakList } from "./ThresholdLists";

const EMPTY_POSITIONS: string[] = [];

/**
 * ランキング > 個人 > 達成記録（DESIGN.md 223章）。「項目がしきい値以上（以下）の試合」を共通の条件にして、達成試合数・連続記録・達成時の年齢を並べる。
 * しきい値は1試合記録のスタッツの条件と同じ部品（項目・以上/以下・値。複数なら「すべて／どれか」）。試合の条件・登録区分・ポジション・現役も1試合記録と同じ。
 * 1試合行の索引（219章）を読んで集計する（画面だけの処理）。前後半5分の特別な試合は、既定で数えない
 */
export function PlayerThresholdRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [unit] = useUrlState(THRESHOLD_UNIT_PARAM, "count");
  const [scope] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const [gameTypeParam, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [group, setGroup] = useUrlState(PLAYER_GROUP_PARAM, "all");
  const [positions, setPositions] = useUrlState(POSITION_PARAM, EMPTY_POSITIONS);
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const [threshold, setThreshold] = useUrlState(thresholdParam, DEFAULT_THRESHOLD);
  const [activeParamValue, setActive] = useUrlState(ACTIVE_PARAM, "all");
  const [sort, setSort] = useUrlState(THRESHOLD_SORT_PARAM, "count");
  const [which, setWhich] = useUrlState(THRESHOLD_AGE_PARAM, "young");
  const [ongoingParam, setOngoing] = useUrlState(THRESHOLD_ONGOING_PARAM, "all");
  // 連続記録は、レギュラーシーズンとポストシーズンを別に数える（合算は無い）。URLに合算があればレギュラーシーズンにする
  const gameType = unit === "streak" && gameTypeParam === "both" ? "regular" : gameTypeParam;
  const ongoingOnly = unit === "streak" && ongoingParam === "ongoing";
  // 達成試合数だけ、通算（全シーズン）かシーズン（選んでいるシーズン）かを選べる。ほかは全シーズン
  const allTime = unit !== "count" || scope === "allTime";
  // 現役の絞り込みは全シーズンの表だけ（過去の選手が混ざる範囲）
  const activeOn = allTime && activeParamValue === "active";
  const seasonForTitle = allTime ? null : season;
  const includeSpecial = conditions.includeSpecial ?? false;
  const ready = thresholdActive(threshold);

  const options = useGameRecordOptions(allTime ? "allTime" : "season", season);
  const index = useGameIndexViews("player", allTime ? "allTime" : "season", season, ready);
  const rookies = useRookieFile(ready && group === "rookie");
  // 今季の名簿は、現役の絞り込みと、連続記録の「継続中」の判定に使う
  const active = useActivePlayerIds(activeOn || (ready && unit === "streak"));
  const rosters = useSeasonRosters(ready && unit === "streak");
  // 全シーズンの表は、選手名を今の登録名にそろえる
  const current = useCurrentPlayerNames(allTime);

  const result = useMemo(() => {
    if (!ready || !index.views || (group === "rookie" && !rookies.file) || ((activeOn || unit === "streak") && !active.ids) || (allTime && !current.names)) return null;
    const input = {
      views: index.views,
      gameType,
      conditions,
      group,
      positions,
      rookies: rookies.file,
      activeIds: activeOn ? active.ids : null,
      currentNames: allTime ? current.names : null,
      threshold,
      includeSpecial,
    };
    if (unit === "streak") {
      if (!rosters.rosters || (gameType !== "regular" && gameType !== "playoff")) return null;
      const r = queryThresholdStreaks({ ...input, gameType, rosters: rosters.rosters, currentIds: active.ids, ongoingOnly });
      return r && { kind: "streak" as const, ...r };
    }
    if (unit === "age") {
      const r = queryThresholdAge({ ...input, which });
      return r && { kind: "age" as const, ...r };
    }
    const r = queryThresholdCount({ ...input, sort, career: allTime });
    return r && { kind: "count" as const, ...r };
  }, [ready, unit, index.views, gameType, conditions, group, positions, rookies.file, activeOn, active.ids, rosters.rosters, ongoingOnly, which, allTime, current.names, threshold, includeSpecial, sort]);

  // シーズンを変えたとき（とページを開いたとき）に、そのシーズンに無い対戦相手・地区・ルーキーを外す
  useEffect(() => {
    if (allTime) return;
    if (group === "rookie" && !rookieSupportedSeason(season)) setGroup("all");
    if (!options.ready) return;
    const next = cleanGameConditionsForSeason(conditions, options.teams.map((t) => t.value), options.divisions);
    if (next) setConditions(next);
  }, [allTime, season, group, conditions, options, setGroup, setConditions]);

  const teamName = (id: string) => {
    const t = options.teams.find((o) => o.value === id);
    return t ? (narrow ? t.label : t.name) : id;
  };
  const thresholdText = statConditionsSummary(threshold, THRESHOLD_ITEMS);
  const positionLabels = positions.length > 0 ? multiSelectLabels("ポジション", selectedPositionLabels(POSITION_OPTIONS, positions), "全ポジション") : [];
  const conditionLabels = composeLabels(
    activeOn && ACTIVE_LABEL,
    group !== "all" && classificationLabels(group),
    positionLabels,
    gameTypeLabels(gameType, seasonForTitle),
    gameRecordConditionLabels(conditions, teamName, false),
  );
  const scopeText = allTime ? (unit === "count" ? "通算" : "歴代") : `${season}シーズン`;
  const unitText =
    unit === "streak"
      ? ongoingOnly
        ? "継続中の連続記録"
        : "連続記録"
      : unit === "age"
        ? `達成時の年齢 ${which === "young" ? "最年少" : "最年長"}`
        : sort === "rate"
          ? "達成率"
          : "達成試合数";
  const title = `${scopeText} ${unitText}（${thresholdText}）`;
  const filename = buildExportFilename(["達成記録", unitText, scopeText, thresholdText, ...conditionLabels]);
  // 通算の達成率の掲載基準の文（選んだ試合種別に合わせる。例: 「ポストシーズンの通算の出場試合数が20試合以上の選手だけです」）
  const careerRateBasis = `${gameTypeLabels(gameType, null)[0]}の通算の出場試合数が${THRESHOLD_CAREER_MIN_GAMES[gameType]}試合以上の選手だけです`;
  const failure = index.error ?? rookies.error ?? active.error ?? current.error ?? rosters.error;
  const hasLte = activeStatConditions(threshold, THRESHOLD_ITEMS).some((c) => c.condition.op === "lte");

  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial, includeSpecialDefault: false };
  const axes: FilterAxis[] = [
    classificationAxis(group, setGroup, {
      rookie: { disabledReason: !allTime && !rookieSupportedSeason(season) ? ROOKIE_UNSUPPORTED_REASON : undefined },
    }),
    ...(allTime ? [activeAxis(activeParamValue, setActive)] : []),
    unit === "streak"
      ? simpleSelectAxis({
          id: "gameType",
          label: "試合種別",
          options: (["regular", "playoff"] as const).map((k) => ({ value: k, label: seasonGameTypeLabels(null)[k] })),
          value: gameType,
          defaultValue: "regular",
          onChange: (v) => setGameType(v as "regular" | "playoff"),
        })
      : gameTypeAxis(gameType, setGameType, seasonForTitle),
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
  const clearAll = () => {
    setGroup("all");
    setActive("all");
    setGameType("regular");
    setPositions(EMPTY_POSITIONS);
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
  };

  const rows = result?.rows;
  const season0 = currentSeason();
  return (
    <>
      <FilterBar axes={axes} stateKey="rankings:player:threshold" onClearAll={clearAll} />
      <div className="threshold-editor">
        <StatConditionsEditor
          state={threshold}
          onChange={setThreshold}
          items={THRESHOLD_ITEMS}
          defaultKey="pts"
          title="しきい値"
          minConditions={1}
          quickValues={THRESHOLD_QUICK_VALUES}
          hint={hasLte ? "「以下」の条件は、出場時間が短い試合も満たします。出場時間（MIN）の条件を足すと、出場時間の長い試合に絞れます。" : undefined}
        />
      </div>
      {unit === "streak" && (
        <FilterBar
          simple
          wide
          stateKey="rankings:player:threshold:ongoing"
          axes={[
            {
              ...simpleSelectAxis({
                id: "thresholdOngoing",
                label: "範囲",
                options: [
                  { value: "all", label: "各選手の最長" },
                  { value: "ongoing", label: "今続いている連続（継続中）" },
                ],
                value: ongoingParam,
                defaultValue: "all",
                onChange: (v) => setOngoing(v as typeof ongoingParam),
              }),
              chip: false,
            },
          ]}
        />
      )}
      {unit === "age" && (
        <FilterBar
          simple
          wide
          stateKey="rankings:player:threshold:age"
          axes={[
            {
              ...simpleSelectAxis({
                id: "thresholdAge",
                label: "向き",
                options: [
                  { value: "young", label: "最年少（初めて達成した試合）" },
                  { value: "old", label: "最年長（最後に達成した試合）" },
                ],
                value: which,
                defaultValue: "young",
                onChange: (v) => setWhich(v as typeof which),
              }),
              chip: false,
            },
          ]}
        />
      )}
      {unit === "count" && (
        <FilterBar
          simple
          wide
          stateKey="rankings:player:threshold:sort"
          axes={[
            {
              ...simpleSelectAxis({
                id: "thresholdSort",
                label: "並び",
                options: [
                  { value: "count", label: "達成試合数の多い順" },
                  { value: "rate", label: "達成率の高い順" },
                ],
                value: sort,
                defaultValue: "count",
                onChange: (v) => setSort(v as typeof sort),
              }),
              chip: false,
            },
          ]}
        />
      )}
      {!ready ? (
        <p className="empty-message">しきい値の値を入力してください</p>
      ) : failure ? (
        <div className="error-message">
          <p>達成記録を読み込めませんでした（{failure}）。</p>
          <button
            type="button"
            className="load-more-button"
            onClick={() => {
              index.retry();
              active.retry();
              current.retry();
              rosters.retry();
            }}
          >
            再読み込み
          </button>
        </div>
      ) : index.loading || rookies.loading || active.loading || current.loading || rosters.loading || !result ? (
        <p className="loading">読み込み中...</p>
      ) : !rows || rows.length === 0 ? (
        <p className="empty-message">
          {unit === "count" && sort === "rate" && allTime
            ? `この条件の記録がありません（達成率の順は、${careerRateBasis}）`
            : "この条件の試合がありません"}
        </p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditionLabels} />
            {result.kind === "age" ? (
              <>
                <ThresholdAgeList rows={result.rows} which={which} teamColors={teamColors} />
                <p className="rule-change-footnote">
                  ※ 達成時の年齢は、その試合の当日の年齢（〇歳〇日）です。1選手につき、{which === "young" ? "初めて達成した試合（最年少）" : "最後に達成した試合（最年長）"}の年齢を出しています。同じ年齢は同じ順位です。
                  {result.unknownBirth > 0 ? `生年月日が不明の選手（${result.unknownBirth}人）は含めていません。` : ""}
                </p>
              </>
            ) : result.kind === "streak" ? (
              <>
                <ThresholdStreakList rows={result.rows} ongoingOnly={ongoingOnly} teamColors={teamColors} />
                <p className="rule-change-footnote">
                  ※ 条件に当てはまる試合だけを順に見て、途切れずに続いた試合数です。出場しなかった試合では途切れません。シーズンをまたいでも、移籍しても続きます（B.PREMIERの名簿に載っていないシーズンをはさむと途切れます）。レギュラーシーズンとポストシーズンは別に数えます。
                </p>
                <p className="rule-change-footnote">
                  ※ {ongoingOnly ? "今続いている連続（継続中）だけを、長い順に並べています。" : "1選手につき、最長の連続を1つ出しています（同じ長さが複数あるときは新しい方）。"}
                  継続中は、今季（{season0}シーズン）のB.PREMIERの名簿の選手で、最後に出場した試合まで記録が続いているものです。
                </p>
              </>
            ) : (
              <>
                <ThresholdCountList rows={result.rows} sort={sort} allTime={allTime} teamColors={teamColors} />
                <p className="rule-change-footnote">
                  ※ 達成試合数は、しきい値を満たした試合の数です。出場試合数は、試合の条件などに当てはまる試合のうち出場した試合の数、達成率は達成試合数÷出場試合数です。
                  {sort === "rate"
                    ? allTime
                      ? `達成率の順は、${careerRateBasis}。達成試合数の順には、この基準はありません。`
                      : "達成率の順は、ランキングの掲載基準（所属チームの試合数の85%以上に出場）を満たす選手だけです。"
                    : ""}
                </p>
              </>
            )}
            {result.excludedSpecial > 0 && (
              <p className="rule-change-footnote">
                ※ 前後半5分ずつで行った特別な試合（2016-17・2017-18のチャンピオンシップ。4試合）は、数えていません。詳細フィルタの「前後半5分の特別試合」で含められます。
              </p>
            )}
            {activeOn && <p className="rule-change-footnote">※ {activeNote()}</p>}
            {group === "rookie" && <p className="rule-change-footnote">※ {ROOKIE_NOTE}{allTime ? "2016-17は、ルーキーを判定できないため、含めていません。" : ""}</p>}
          </div>
        </>
      )}
    </>
  );
}
