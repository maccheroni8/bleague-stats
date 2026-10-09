import { useEffect, useMemo, useRef } from "react";
import type { TeamColors } from "../../shared/types";
import { ACTIVE_LABEL, ACTIVE_PARAM, activeAxis, activeNote, useActivePlayerIds } from "../lib/activePlayers";
import { useCurrentPlayerNames } from "../lib/currentPlayerNames";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { selectedPositionLabels } from "../lib/classificationFilter";
import { classificationAxis, gameTypeAxis, multiSelectAxis, simpleSelectAxis, type FilterAxis } from "../lib/filterAxes";
import { DEFAULT_GAME_RECORD_CONDITIONS, cleanGameConditionsForSeason, gameRecordConditionLabels, gameRecordConditionsParam } from "../lib/gameRecordConditions";
import { gameRecordAdvancedAxes, gameRecordPrimaryAxes } from "../lib/gameRecordAxes";
import { ROOKIE_NOTE, ROOKIE_UNSUPPORTED_REASON, rookieSupportedSeason } from "../lib/rookieFilter";
import { activeStatConditions, statConditionsSummary } from "../lib/statConditions";
import { useNarrow } from "../lib/teamLabel";
import {
  DEFAULT_THRESHOLD,
  THRESHOLD_ITEMS,
  THRESHOLD_QUICK_VALUES,
  queryThresholdCount,
  thresholdActive,
} from "../lib/thresholdQuery";
import { THRESHOLD_SORT_PARAM, THRESHOLD_UNIT_PARAM, thresholdParam } from "../lib/thresholdParams";
import { useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, PLAYER_GROUP_PARAM, POSITION_PARAM, RECORDS_SCOPE_PARAM } from "../lib/urlFilterParams";
import { useGameIndexViews, useGameRecordOptions, useRookieFile } from "../lib/useGameRecordData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { POSITION_OPTIONS } from "./PlayerGameRecordRanking";
import { StatConditionsEditor } from "./StatConditionsEditor";
import { ThresholdCountList } from "./ThresholdLists";

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
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [group, setGroup] = useUrlState(PLAYER_GROUP_PARAM, "all");
  const [positions, setPositions] = useUrlState(POSITION_PARAM, EMPTY_POSITIONS);
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const [threshold, setThreshold] = useUrlState(thresholdParam, DEFAULT_THRESHOLD);
  const [activeParamValue, setActive] = useUrlState(ACTIVE_PARAM, "all");
  const [sort, setSort] = useUrlState(THRESHOLD_SORT_PARAM, "count");
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
  const active = useActivePlayerIds(activeOn);
  // 全シーズンの表は、選手名を今の登録名にそろえる
  const current = useCurrentPlayerNames(allTime);

  const result = useMemo(() => {
    if (!ready || !index.views || (group === "rookie" && !rookies.file) || (activeOn && !active.ids) || (allTime && !current.names)) return null;
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
    return queryThresholdCount({ ...input, sort });
  }, [ready, index.views, gameType, conditions, group, positions, rookies.file, activeOn, active.ids, allTime, current.names, threshold, includeSpecial, sort]);

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
  const scopeText = allTime ? "通算" : `${season}シーズン`;
  const unitText = sort === "rate" ? "達成率" : "達成試合数";
  const title = `${scopeText} ${unitText}（${thresholdText}）`;
  const filename = buildExportFilename(["達成記録", unitText, scopeText, thresholdText, ...conditionLabels]);
  const failure = index.error ?? rookies.error ?? active.error ?? current.error;
  const hasLte = activeStatConditions(threshold, THRESHOLD_ITEMS).some((c) => c.condition.op === "lte");

  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial, includeSpecialDefault: false };
  const axes: FilterAxis[] = [
    classificationAxis(group, setGroup, {
      rookie: { disabledReason: !allTime && !rookieSupportedSeason(season) ? ROOKIE_UNSUPPORTED_REASON : undefined },
    }),
    ...(allTime ? [activeAxis(activeParamValue, setActive)] : []),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
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
            }}
          >
            再読み込み
          </button>
        </div>
      ) : index.loading || rookies.loading || active.loading || current.loading || !result ? (
        <p className="loading">読み込み中...</p>
      ) : !rows || rows.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditionLabels} />
            <ThresholdCountList rows={rows} sort={sort} allTime={allTime} teamColors={teamColors} />
            <p className="rule-change-footnote">
              ※ 達成試合数は、しきい値を満たした試合の数です。出場試合数は、試合の条件などに当てはまる試合のうち出場した試合の数、達成率は達成試合数÷出場試合数です。
              {sort === "rate" ? "達成率の順は、ランキングの掲載基準（所属チームの試合数の85%以上に出場）を満たす選手だけです。通算は、出場した各シーズンの所属チームの試合数の合計に対する出場率で判定します。" : ""}
            </p>
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
