import { useRef } from "react";
import type { TeamColors } from "../../shared/types";
import { buildExportFilename, composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { fetchLeagueTeamRankings, fetchTeamHistory } from "../lib/data";
import { gameTypeAxis, statItemAxis } from "../lib/filterAxes";
import { leagueTeamDisplayName } from "../lib/leagueTeamNames";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { teamNameInSeason } from "../lib/teamLabel";
import { stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { useJsonData } from "../lib/useJsonData";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { RankedList } from "./RankedList";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > チーム > 1シーズン記録（DESIGN.md 194章）: 1つのシーズンの記録。過去に在籍した全クラブの、全シーズンの中の上位20位
 * （同じ記録のシーズンはすべて）。項目は、最多勝利数（1シーズン）と最多連勝（シーズン内）。試合区分はレギュラーシーズン／ポストシーズン／合算。
 * 値は data/league-team-rankings.json の seasonSpecialTop20。同じクラブが何度も入ることがある（1行が「クラブのあるシーズン」）
 */

/** 項目: 「最多連勝（シーズン内）」は、シーズンをまたいだ連勝を含まない */
export const TEAM_SEASON_RECORD_ITEMS = [
  { key: "wins", label: "最多勝利数", unit: "勝" },
  { key: "streak", label: "最多連勝（シーズン内）", unit: "連勝" },
] as const;
const STAT_PARAM = stringParam("stat", "wins", (v) => TEAM_SEASON_RECORD_ITEMS.some((d) => d.key === v));
const RANK_TOP_N = 20;

/** チームの1シーズン記録のランキングの URL（チーム一覧の記録タブのカードから移るとき） */
export function teamSeasonRecordRankingUrl(opts: { gameType: SeasonGameTypeFilter; statKey: string }): string {
  const p = new URLSearchParams();
  p.set("k", "special");
  GAME_TYPE_PARAM.write(p, opts.gameType);
  p.set("stat", opts.statKey);
  return `/rankings?${p.toString()}`;
}

export function TeamSeasonRecordRanking({ teamColors }: { teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [statParam, setStatKey] = useUrlState(STAT_PARAM, "wins");
  const { data: rankings, loading } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: history } = useJsonData(() => fetchTeamHistory(), []);

  const item = TEAM_SEASON_RECORD_ITEMS.find((d) => d.key === statParam) ?? TEAM_SEASON_RECORD_ITEMS[0]!;
  const entries = rankings?.seasonSpecialTop20[gameType]?.[item.key] ?? [];
  const conditions = composeLabels(gameTypeLabels(gameType, null));
  const title = `歴代 チーム1シーズン記録：${item.label}`;
  const filename = buildExportFilename(["チーム1シーズン記録", "歴代", item.label, ...conditions]);

  return (
    <>
      <FilterBar simple stateKey="rankings:team:special" axes={[gameTypeAxis(gameType, setGameType, null)]} />
      <FilterBar
        simple
        wide
        stateKey="rankings:team:special:stat"
        axes={[statItemAxis(TEAM_SEASON_RECORD_ITEMS.map((d) => ({ key: d.key, label: d.label })), item.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !rankings ? (
        <p className="empty-message">データがありません</p>
      ) : entries.length === 0 ? (
        <p className="empty-message">この条件の記録がありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
            <ConditionTitle title={title} conditions={conditions} />
            <RankedList
              rows={entries}
              def={{
                key: item.key,
                label: item.label,
                value: (e) => e.value,
                format: (e) => `${e.value}${item.unit}`,
                higherIsBetter: true,
              }}
              tieKey={(e) => String(e.value)}
              rowKey={(e) => `${e.teamId}-${e.season}`}
              name={(e) => <ResponsiveTeamName teamId={e.teamId} name={teamNameInSeason(history, e.teamId, e.season, leagueTeamDisplayName(e.teamId))} />}
              subLabel={(e) => `${e.season}シーズン`}
              linkTo={(e) => `/teams/${e.teamId}?season=${e.season}`}
              teamColor={(e) => teamColors?.[e.teamId]?.primary}
              avatar={(e) => <TeamLogo teamId={e.teamId} size={48} placeholder />}
              limit={RANK_TOP_N}
              unit="シーズン"
              sortable={false}
              statScope="team"
              compact
            />
            {item.key === "streak" && <p className="rule-change-footnote">※ シーズンをまたいだ連勝は含みません。</p>}
          </div>
        </>
      )}
    </>
  );
}
