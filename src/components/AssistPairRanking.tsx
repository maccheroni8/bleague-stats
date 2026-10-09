import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import type { TeamColors } from "../../shared/types";
import { ACTIVE_LABEL, ACTIVE_PARAM, activeAxis, activeNote, useActivePlayerIds } from "../lib/activePlayers";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { gameTypeAxis, type FilterAxis } from "../lib/filterAxes";
import { DEFAULT_GAME_RECORD_CONDITIONS, cleanGameConditionsForSeason, gameRecordConditionLabels, gameRecordConditionsParam } from "../lib/gameRecordConditions";
import { gameRecordAdvancedAxes, gameRecordPrimaryAxes } from "../lib/gameRecordAxes";
import { GAME_RECORD_TIE_EXPAND_MAX } from "../lib/gameRecordQuery";
import { PAIR_UNIT_LABELS, queryAssistPairs, type PairRow } from "../lib/clutchQuery";
import { useAssistPairData, useGameRecordOptions } from "../lib/useGameRecordData";
import { useNarrow } from "../lib/teamLabel";
import { useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, PAIR_UNIT_PARAM } from "../lib/urlFilterParams";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { RankedList } from "./RankedList";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * ランキング > 個人 > アシストペア（DESIGN.md 221章）。アシストした選手から、そのアシストを受けて得点した選手への得点（2P×2＋3P×3＋FT）を、
 * 組ごとに並べる。単位は1試合（全シーズンの中の1試合）・シーズン（選んでいるシーズンの合計）・通算（全シーズンの合計）。
 * 試合の条件（勝敗・会場・対戦相手・延長・最終点差・試合中の点差・地区。得点した選手のチームから見る）で絞ると、当てはまる試合の分だけを足し上げる。
 * 同じ値の中の並びは、アシストした選手ID → 得点した選手ID → 日付（1試合）の順
 */
const RANK_TOP_N = 20;

function PairLine({ r, unit }: { r: PairRow; unit: "game" | "season" | "career" }) {
  const narrow = useNarrow();
  const parts = `2P×${r.n2}・3P×${r.n3}・FT×${r.nf}`;
  if (unit === "game") {
    const date = narrow ? r.date!.replace(/-/g, "/").slice(2) : r.date!;
    return (
      <>
        <span className="record-date-nowrap">
          {date}（{r.season}）
        </span>
        {narrow ? " " : "　"}
        <ResponsiveTeamName teamId={r.teamId} name={r.teamName} always /> {r.isHome ? "vs" : "@"} <ResponsiveTeamName teamId={r.opponentTeamId!} name={r.opponentTeamName!} always />
        <span className="record-date-nowrap">　{parts}</span>
      </>
    );
  }
  const span = r.firstSeason === r.lastSeason ? r.lastSeason : `${r.firstSeason}〜${r.lastSeason}`;
  return (
    <>
      <span className="record-date-nowrap">{r.games}試合</span>
      {"　"}
      <span className="record-date-nowrap">{parts}</span>
      {"　"}
      <ResponsiveTeamName teamId={r.teamId} name={r.teamName} always />
      {unit === "career" && <span className="record-date-nowrap">　{span}</span>}
    </>
  );
}

/** 1人分: 写真と名前（個人ページへのリンク）。幅が狭いとき（stacked）は、写真の下に名前（名字）を置く */
function PairPerson({ playerId, name, season, among, rookieSeason, stacked }: { playerId: string; name: string; season: string; among: readonly string[]; rookieSeason?: string; stacked: boolean }) {
  return (
    <Link to={`/players/${playerId}?season=${season}`} className={`cell-link pair-person${stacked ? " pair-person-stacked" : ""}`}>
      <PlayerPhoto playerId={playerId} size={44} className="player-cell-photo" placeholder />
      <span className="pair-person-name">
        <ResponsivePlayerName name={name} among={among} playerId={rookieSeason ? playerId : undefined} season={rookieSeason} />
      </span>
    </Link>
  );
}

export function AssistPairRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const narrow = useNarrow();
  const [unit] = useUrlState(PAIR_UNIT_PARAM, "season");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [conditions, setConditions] = useUrlState(gameRecordConditionsParam, DEFAULT_GAME_RECORD_CONDITIONS);
  const [activeParam, setActive] = useUrlState(ACTIVE_PARAM, "all");
  const singleSeason = unit === "season";
  // 現役の絞り込みは1試合（歴代）と通算だけ（過去の選手が混ざる範囲）
  const activeOn = !singleSeason && activeParam === "active";
  const seasonForTitle = singleSeason ? season : null;

  const options = useGameRecordOptions(singleSeason ? "season" : "allTime", season);
  const pairs = useAssistPairData(singleSeason, season);
  const active = useActivePlayerIds(activeOn);
  const result = useMemo(
    () => (pairs.data && (!activeOn || active.ids) ? queryAssistPairs({ data: pairs.data, gameType, conditions, unit, activeIds: activeOn ? active.ids : null }) : null),
    [pairs.data, gameType, conditions, unit, activeOn, active.ids],
  );

  // シーズンを変えたとき（とページを開いたとき）に、そのシーズンに無い対戦相手・地区を外す
  useEffect(() => {
    if (!singleSeason || !options.ready) return;
    const next = cleanGameConditionsForSeason(conditions, options.teams.map((t) => t.value), options.divisions);
    if (next) setConditions(next);
  }, [singleSeason, season, conditions, options, setConditions]);

  const teamName = (id: string) => {
    const t = options.teams.find((o) => o.value === id);
    return t ? (narrow ? t.label : t.name) : id;
  };
  const conditionLabels = composeLabels(activeOn && ACTIVE_LABEL, gameTypeLabels(gameType, seasonForTitle), gameRecordConditionLabels(conditions, teamName, true));
  const scopeText = unit === "season" ? `${season}シーズン` : unit === "career" ? "通算" : "歴代 1試合";
  const title = `${scopeText} アシストペアの得点`;
  const filename = buildExportFilename(["アシストペア", PAIR_UNIT_LABELS[unit], unit === "season" ? season : "", ...conditionLabels]);
  const entries = result?.rows;
  const among = useMemo(() => (entries ?? []).flatMap((x) => [x.assisterName, x.scorerName]), [entries]);
  const seasonOf = (e: PairRow) => e.season ?? e.lastSeason ?? season;

  const axesInput = { conditions, onChange: setConditions, teams: options.teams, divisions: options.divisions, includeSpecial: true, includeSpecialDefault: true };
  const axes: FilterAxis[] = [
    ...(singleSeason ? [] : [activeAxis(activeParam, setActive)]),
    gameTypeAxis(gameType, setGameType, seasonForTitle),
    ...gameRecordPrimaryAxes(axesInput),
    ...gameRecordAdvancedAxes(axesInput).filter((a) => a.id !== "g.special"),
  ];
  const clearAll = () => {
    setActive("all");
    setGameType("regular");
    setConditions(DEFAULT_GAME_RECORD_CONDITIONS);
  };

  return (
    <>
      <FilterBar axes={axes} stateKey="rankings:player:assistPair" onClearAll={clearAll} />
      {pairs.error || active.error ? (
        <div className="error-message">
          <p>アシストペアの記録を読み込めませんでした（{pairs.error ?? active.error}）。</p>
          <button
            type="button"
            className="load-more-button"
            onClick={() => {
              pairs.retry();
              active.retry();
            }}
          >
            再読み込み
          </button>
        </div>
      ) : pairs.loading || active.loading || !result ? (
        <p className="loading">読み込み中...</p>
      ) : !entries || entries.length === 0 ? (
        <p className="empty-message">この条件の記録がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditionLabels} />
            <PlayerNamePool names={among}>
              <RankedList
                rows={entries}
                def={{ key: `assistPair:${unit}`, label: "得点", value: (e) => e.value, format: (e) => String(e.value), higherIsBetter: true }}
                tieKey={(e) => String(e.value)}
                rowKey={(e) => `${e.assisterId}>${e.scorerId}${e.scheduleKey ? `-${e.scheduleKey}` : ""}`}
                name={(e) => (
                  <span className={`pair-people${narrow ? " pair-people-stacked" : ""}`}>
                    <PairPerson playerId={e.assisterId} name={e.assisterName} season={seasonOf(e)} among={among} rookieSeason={unit === "career" ? undefined : seasonOf(e)} stacked={narrow} />
                    <span className="pair-arrow" aria-label="アシスト">
                      ⇒
                    </span>
                    <PairPerson playerId={e.scorerId} name={e.scorerName} season={seasonOf(e)} among={among} rookieSeason={unit === "career" ? undefined : seasonOf(e)} stacked={narrow} />
                  </span>
                )}
                subLabel={(e) => <PairLine r={e} unit={unit} />}
                subLinkTo={unit === "game" ? (e) => `/games/${e.scheduleKey}?season=${e.season}` : undefined}
                linkTo={() => undefined}
                teamColor={(e) => teamColors?.[e.teamId]?.primary}
                limit={RANK_TOP_N}
                tieExpandMax={GAME_RECORD_TIE_EXPAND_MAX}
                unit={unit === "game" ? "試合" : "組"}
                sortable={false}
                compact
              />
              <p className="rule-change-footnote">
                ※ アシストした選手 → そのアシストを受けて得点した選手の組です。得点は、2Pの成功×2・3Pの成功×3・フリースローの成功×1の合計です（フリースローは、シュートファウルでのアシストを含みます）。
                試合の条件は、得点した選手のチームから見ます。
              </p>
              {activeOn && <p className="rule-change-footnote">※ {activeNote()}アシストした選手と得点した選手の両方が現役の組だけを表示しています。</p>}
            </PlayerNamePool>
          </div>
        </>
      )}
    </>
  );
}
