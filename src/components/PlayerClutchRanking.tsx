import { useEffect, useMemo, useRef } from "react";
import type { TeamColors } from "../../shared/types";
import { buildExportFilename, classificationLabels, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { classificationAxis, gameTypeAxis, simpleSelectAxis, statItemAxis, type FilterAxis } from "../lib/filterAxes";
import { DEFAULT_GAME_RECORD_CONDITIONS, cleanGameConditionsForSeason, gameRecordConditionLabels, gameRecordConditionsParam } from "../lib/gameRecordConditions";
import { gameRecordAdvancedAxes, gameRecordPrimaryAxes } from "../lib/gameRecordAxes";
import { GAME_RECORD_TIE_EXPAND_MAX } from "../lib/gameRecordQuery";
import {
  CLUTCH_MEASURES,
  CLUTCH_MEASURE_LABELS,
  CLUTCH_WINDOWS,
  CLUTCH_WINDOW_LABELS,
  queryClutch,
  type ClutchRow,
} from "../lib/clutchQuery";
import { useGameIndexViews, useGameRecordOptions, useRookieFile } from "../lib/useGameRecordData";
import { ROOKIE_NOTE, ROOKIE_UNSUPPORTED_REASON, rookieSupportedSeason } from "../lib/rookieFilter";
import { useNarrow } from "../lib/teamLabel";
import { useUrlState } from "../lib/urlState";
import { CLUTCH_MEASURE_PARAM, CLUTCH_WINDOW_PARAM, GAME_TYPE_PARAM, PLAYER_GROUP_PARAM, RECORDS_SCOPE_PARAM } from "../lib/urlFilterParams";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { RankedList } from "./RankedList";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * ランキング > 個人 > 勝負所（DESIGN.md 221章）。勝ち越し弾・同点弾・決勝点を、選手ごとの回数で並べる。単位は通算（全シーズン）とシーズン（選んでいるシーズン）。
 * 第4Qと各延長の、残り5分・2分・1分以内の得点（窓は2分が初期値。FTを含み、FGとFTの内訳を添える。点差の上限は付けない）。
 * 決勝点は、勝ったチームの最後の勝ち越し（その後、一度もリードを失わない）で、窓の中にあるもの。
 * 試合の条件（勝敗・会場・対戦相手・延長・最終点差・試合中の点差・地区）で絞ると、その条件に当てはまる試合の分だけを足し上げる。1試合行の索引（219章）を読んで集計する
 */
const RANK_TOP_N = 20;

function ClutchLine({ r, allTime }: { r: ClutchRow; allTime: boolean }) {
  const span = r.firstSeason === r.lastSeason ? r.lastSeason : `${r.firstSeason}〜${r.lastSeason}`;
  return (
    <>
      <span className="record-date-nowrap">
        FG {r.fg}・FT {r.ft}
      </span>
      {"　"}
      <ResponsiveTeamName teamId={r.teamId} name={r.teamName} always />
      {allTime && <span className="record-date-nowrap">　{span}</span>}
    </>
  );
}

export function PlayerClutchRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [scope] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [group, setGroup] = useUrlState(PLAYER_GROUP_PARAM, "all");
  const [measure, setMeasure] = useUrlState(CLUTCH_MEASURE_PARAM, "goAhead");
  const [window, setWindow] = useUrlState(CLUTCH_WINDOW_PARAM, "2");
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const allTime = scope === "allTime";
  const seasonForTitle = allTime ? null : season;

  const options = useGameRecordOptions(scope, season);
  const index = useGameIndexViews("player", scope, season, true);
  const rookies = useRookieFile(group === "rookie");
  const result = useMemo(
    () =>
      index.views && (group !== "rookie" || rookies.file)
        ? queryClutch({ views: index.views, gameType, conditions, group, rookies: rookies.file, measure, window })
        : null,
    [index.views, gameType, conditions, group, rookies.file, measure, window],
  );

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
  const conditionLabels = composeLabels(
    group !== "all" && classificationLabels(group),
    gameTypeLabels(gameType, seasonForTitle),
    gameRecordConditionLabels(conditions, teamName, true),
  );
  const measureLabel = CLUTCH_MEASURE_LABELS[measure];
  const windowLabel = CLUTCH_WINDOW_LABELS[window];
  const title = `${allTime ? "通算" : `${season}シーズン`} ${measureLabel}（第4Q・延長の${windowLabel}）`;
  const filename = buildExportFilename(["勝負所", allTime ? "通算" : season, measureLabel, windowLabel, ...conditionLabels]);
  const entries = result?.rows;
  const failure = index.error ?? rookies.error;

  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial: true, includeSpecialDefault: true };
  const axes: FilterAxis[] = [
    classificationAxis(group, setGroup, {
      rookie: { disabledReason: !allTime && !rookieSupportedSeason(season) ? ROOKIE_UNSUPPORTED_REASON : undefined },
    }),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    simpleSelectAxis({
      id: "clutchWindow",
      label: "残り時間",
      options: CLUTCH_WINDOWS.map((w) => ({ value: w, label: CLUTCH_WINDOW_LABELS[w] })),
      value: window,
      defaultValue: "2",
      onChange: (v) => setWindow(v as typeof window),
    }),
    ...gameRecordPrimaryAxes(axesInput),
    // 前後半5分の特別な試合には第4Q・延長が無いので、その扱いの軸は出さない
    ...gameRecordAdvancedAxes(axesInput).filter((a) => a.id !== "g.special"),
  ];
  const clearAll = () => {
    setGroup("all");
    setGameType("regular");
    setWindow("2");
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
  };

  return (
    <>
      <FilterBar axes={axes} stateKey="rankings:player:clutch" onClearAll={clearAll} />
      <FilterBar
        simple
        wide
        stateKey="rankings:player:clutch:measure"
        axes={[statItemAxis(CLUTCH_MEASURES.map((m) => ({ key: m, label: CLUTCH_MEASURE_LABELS[m] })), measure, (k) => setMeasure(k as typeof measure))]}
      />
      {failure ? (
        <div className="error-message">
          <p>勝負所の記録を読み込めませんでした（{failure}）。</p>
          <button type="button" className="load-more-button" onClick={index.retry}>
            再読み込み
          </button>
        </div>
      ) : index.loading || rookies.loading || !result ? (
        <p className="loading">読み込み中...</p>
      ) : !entries || entries.length === 0 ? (
        <p className="empty-message">この条件の記録がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditionLabels} />
            <PlayerNamePool names={entries.map((e) => e.playerName)}>
              <RankedList
                rows={entries}
                def={{ key: `clutch:${measure}:${window}`, label: measureLabel, value: (e) => e.value, format: (e) => String(e.value), higherIsBetter: true }}
                tieKey={(e) => String(e.value)}
                rowKey={(e) => e.playerId}
                name={(e) => <ResponsivePlayerName name={e.playerName} playerId={e.playerId} season={allTime ? undefined : e.lastSeason} />}
                subLabel={(e) => <ClutchLine r={e} allTime={allTime} />}
                linkTo={(e) => `/players/${e.playerId}?season=${e.lastSeason}`}
                teamColor={(e) => teamColors?.[e.teamId]?.primary}
                avatar={(e) => <PlayerPhoto playerId={e.playerId} size={56} className="player-cell-photo" placeholder />}
                limit={RANK_TOP_N}
                tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
                sortable={false}
                compact
              />
              <p className="rule-change-footnote">
                ※ 第4Qと各延長で、残り時間が{windowLabel.replace("残り", "")}以内の得点です（残り{windowLabel.replace("残り", "").replace("分", "")}:00ちょうども含みます）。フリースローを含み、点差の上限はありません。
                {measure === "winner" ? "決勝点は、勝ったチームの最後の勝ち越し（その後、一度もリードを失わない）が、この時間の中にあるものです。" : ""}
                {measure === "goAhead" ? "勝ち越しは、得点の前に同点か負けていて、得点でリードしたものです。" : ""}
                {measure === "tie" ? "同点は、得点の前に負けていて、得点で同点にしたものです。" : ""}
              </p>
              {group === "rookie" && <p className="rule-change-footnote">※ {ROOKIE_NOTE}{allTime ? "2016-17は、ルーキーを判定できないため、含めていません。" : ""}</p>}
            </PlayerNamePool>
          </div>
        </>
      )}
    </>
  );
}
