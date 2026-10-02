import { useRef } from "react";
import { PLAYER_GAME_RECORD_STATS, type PlayerGameRecordDef } from "../../shared/playerGameRecords";
import type { PlayerGameRecordEntry, TeamColors } from "../../shared/types";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeaguePlayerGameRecords, fetchPlayerGameRecords } from "../lib/data";
import { gameTypeAxis, statItemAxis } from "../lib/filterAxes";
import { formatPlayerGameRecordValue, playerGameRecordFraction, playerGameRecordMinAttemptsNote } from "../lib/playerGameRecordFormat";
import { useNarrow } from "../lib/teamLabel";
import { stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, RECORDS_SCOPE_PARAM, type RecordsScope } from "../lib/urlFilterParams";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { RankedList } from "./RankedList";
import { RecordValue } from "./RecordValue";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * ランキング > 個人 > 1試合記録（DESIGN.md 190章）。範囲「歴代」は全シーズン（data/league-player-game-records.json）、
 * 「シーズン」はページで選んでいるシーズン（data/{season}/player-game-records.json）の、選手の1試合の記録の上位20位。
 * どちらも夜間の集計が書き出した上位で、画面は全選手の試合ログを読まない。試合区分はレギュラーシーズン／ポストシーズン／合算
 */

const STAT_PARAM = stringParam("stat", "pts", (v) => PLAYER_GAME_RECORD_STATS.some((d) => d.key === v));
const RANK_TOP_N = 20;

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

/** 名前の下の行: 日付（シーズン）・当時のチーム・対戦相手 */
export function PlayerGameRecordLine({ e, season }: { e: PlayerGameRecordEntry; season: string }) {
  const narrow = useNarrow();
  const date = narrow ? e.date.replace(/-/g, "/").slice(2) : e.date;
  return (
    <>
      <span className="record-date-nowrap">
        {date}（{season}）
      </span>
      {narrow ? " " : "　"}
      <ResponsiveTeamName teamId={e.teamId} name={e.teamName} always /> {e.isHome ? "vs" : "@"}{" "}
      <ResponsiveTeamName teamId={e.opponentTeamId} name={e.opponentTeamName} always />
    </>
  );
}

export function PlayerGameRecordRanking({ season, teamColors }: { season: string; teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [scope] = useUrlState(RECORDS_SCOPE_PARAM, "allTime");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [statKey, setStatKey] = useUrlState(STAT_PARAM, "pts");
  const { data: file, loading } = useJsonData(
    () => (scope === "allTime" ? fetchLeaguePlayerGameRecords() : fetchPlayerGameRecords(season)),
    [scope, season],
  );

  const def: PlayerGameRecordDef = PLAYER_GAME_RECORD_STATS.find((d) => d.key === statKey) ?? PLAYER_GAME_RECORD_STATS[0]!;
  const entries = file?.byGameType[gameType]?.[def.key] ?? [];
  const seasonOf = (e: PlayerGameRecordEntry) => e.season ?? season;
  const seasonForTitle = scope === "season" ? season : null;
  const conditions = composeLabels(gameTypeLabels(gameType, seasonForTitle));
  const title = scope === "allTime" ? `歴代 個人1試合記録：${def.label}` : `${season}シーズン 個人1試合記録：${def.label}`;
  const filename = buildExportFilename(["個人1試合記録", scope === "allTime" ? "歴代" : season, def.label, ...conditions]);
  const minNote = playerGameRecordMinAttemptsNote(def.key);

  return (
    <>
      <FilterBar
        simple
        stateKey="rankings:player:game"
        axes={[gameTypeAxis(gameType, setGameType, seasonForTitle)]}
      />
      <FilterBar
        simple
        wide
        stateKey="rankings:player:game:stat"
        axes={[statItemAxis(PLAYER_GAME_RECORD_STATS.map((d) => ({ key: d.key, label: d.label })), def.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !file ? (
        <p className="empty-message">データがありません</p>
      ) : entries.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditions} />
            <PlayerNamePool names={entries.map((e) => e.playerName)}>
              <RankedList
                rows={entries}
                def={{
                  key: def.key,
                  label: def.label,
                  value: (e) => e.value,
                  format: (e) => formatPlayerGameRecordValue(def, e.value),
                  higherIsBetter: true,
                }}
                renderValue={(e) => <RecordValue text={formatPlayerGameRecordValue(def, e.value)} fraction={playerGameRecordFraction(e)} />}
                tieKey={(e) => String(e.value)}
                rowKey={(e) => `${e.scheduleKey}-${e.playerId}`}
                name={(e) => <ResponsivePlayerName name={e.playerName} />}
                subLabel={(e) => <PlayerGameRecordLine e={e} season={seasonOf(e)} />}
                linkTo={(e) => `/players/${e.playerId}?season=${seasonOf(e)}`}
                subLinkTo={(e) => `/games/${e.scheduleKey}?season=${seasonOf(e)}`}
                teamColor={(e) => teamColors?.[e.teamId]?.primary}
                avatar={(e) => <PlayerPhoto playerId={e.playerId} size={56} className="player-cell-photo" />}
                limit={RANK_TOP_N}
                unit="試合"
                sortable={false}
                compact
              />
              {minNote && <p className="rule-change-footnote">※ {minNote}</p>}
            </PlayerNamePool>
          </div>
        </>
      )}
    </>
  );
}
