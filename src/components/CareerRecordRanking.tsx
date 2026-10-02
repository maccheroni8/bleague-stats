import { useMemo, useRef } from "react";
import { PLAYER_CAREER_TOTAL_DEFS } from "../../shared/playerRecords";
import { CAREER_TOTAL_DEFS } from "../../shared/teamRecords";
import type { LeagueRankingGameType, LeagueTeamRankEntry, TeamColors } from "../../shared/types";
import { buildExportFilename, composeLabels, gameTypeLabels, leagueVenueLabels, type LeagueVenue } from "../lib/conditionLabels";
import { formatLeaguePlayerRecordValue, formatLeagueTeamCareerValue } from "../lib/careerRecords";
import { fetchDivisionHistory, fetchLeaguePlayerCareerTop, fetchLeagueTeamRankings } from "../lib/data";
import { gameTypeAxis, leagueVenueAxis, statItemAxis } from "../lib/filterAxes";
import { lastPremierSeasonFor, leagueTeamCurrentCategoryLabel, leagueTeamDisplayName } from "../lib/leagueTeamNames";
import type { SeasonGameTypeFilter } from "../lib/playerSeasonBoxscore";
import { stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM, VENUE_PARAM } from "../lib/urlFilterParams";
import { useJsonData } from "../lib/useJsonData";
import { TEAM_DIVISIONS } from "../../scripts/lib/divisions";
import { ConditionTitle } from "./ConditionTitle";
import { ExportImageButton } from "./ExportImageButton";
import { FilterBar } from "./FilterBar";
import { PlayerNamePool } from "./PlayerNamePool";
import { PlayerPhoto } from "./PlayerPhoto";
import { RankedList } from "./RankedList";
import { ResponsivePlayerName } from "./ResponsivePlayerName";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { TeamLogo } from "./TeamLogo";

/**
 * ランキング > 個人／チーム > 通算記録（DESIGN.md 192章）: 過去に在籍した全選手・全クラブの通算成績（全シーズン合算）の順位。
 * 会場（トータル／ホーム／アウェイ）・試合区分（レギュラーシーズン／ポストシーズン／合算）・項目を選ぶ。
 * 個人は夜間の集計が書き出した上位20位（data/league-player-career-top.json。同じ値はすべて含む）、チームは全クラブ（data/league-team-rankings.json）
 */

const PLAYER_STAT_PARAM = stringParam("stat", "pts", (v) => PLAYER_CAREER_TOTAL_DEFS.some((d) => d.key === v));
const TEAM_STAT_PARAM = stringParam("stat", "wins", (v) => CAREER_TOTAL_DEFS.some((d) => d.key === v));
const PLAYER_RANK_TOP_N = 20;

/** 通算記録のランキングの URL（個人・チームの記録タブのカードから移るとき） */
export function careerRecordRankingUrl(opts: {
  mode: "player" | "team";
  venue: LeagueVenue;
  gameType: SeasonGameTypeFilter;
  statKey: string;
}): string {
  const p = new URLSearchParams();
  if (opts.mode === "player") p.set("m", "player");
  p.set("k", "career");
  VENUE_PARAM.write(p, opts.venue);
  GAME_TYPE_PARAM.write(p, opts.gameType);
  p.set("stat", opts.statKey);
  return `/rankings?${p.toString()}`;
}

export function PlayerCareerRecordRanking({ teamColors }: { teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [venue, setVenue] = useUrlState(VENUE_PARAM, "total");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [statParam, setStatKey] = useUrlState(PLAYER_STAT_PARAM, "pts");
  const { data: file, loading } = useJsonData(() => fetchLeaguePlayerCareerTop(), []);

  const def = PLAYER_CAREER_TOTAL_DEFS.find((d) => d.key === statParam) ?? PLAYER_CAREER_TOTAL_DEFS[0]!;
  const table = file ? (venue === "total" ? file.career : venue === "home" ? file.careerHome : file.careerAway) : undefined;
  const entries = table?.[gameType as LeagueRankingGameType]?.[def.key] ?? [];
  const rows = entries.flatMap((e) => (file?.players[e.playerId] ? [{ ...e, info: file.players[e.playerId]! }] : []));

  const conditions = composeLabels(leagueVenueLabels(venue), gameTypeLabels(gameType, null));
  const title = `歴代 個人通算記録：${def.label}`;
  const filename = buildExportFilename(["個人通算記録", "歴代", def.label, ...conditions]);

  return (
    <>
      <FilterBar
        simple
        stateKey="rankings:player:career"
        axes={[leagueVenueAxis(venue, setVenue), gameTypeAxis(gameType, setGameType, null)]}
      />
      <FilterBar
        simple
        wide
        stateKey="rankings:player:career:stat"
        axes={[statItemAxis(PLAYER_CAREER_TOTAL_DEFS.map((d) => ({ key: d.key, label: d.label })), def.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !file ? (
        <p className="empty-message">データがありません</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件では該当選手がいません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-player">
            <ConditionTitle title={title} conditions={conditions} />
            <PlayerNamePool names={rows.map((r) => r.info.name)}>
              <RankedList
                rows={rows}
                def={{
                  key: def.key,
                  label: def.label,
                  value: (r) => r.value,
                  format: (r) => formatLeaguePlayerRecordValue(def.key, r.value),
                  higherIsBetter: true,
                }}
                tieKey={(r) => String(r.value)}
                rowKey={(r) => r.playerId}
                name={(r) => <ResponsivePlayerName name={r.info.name} />}
                subLabel={(r) => (
                  <>
                    <ResponsiveTeamName teamId={r.info.teamId} name={r.info.teamName} always />・{r.info.latestSeason}シーズンまで在籍確認
                  </>
                )}
                linkTo={(r) => `/players/${r.playerId}?season=${r.info.latestSeason}`}
                teamColor={(r) => teamColors?.[r.info.teamId]?.primary}
                avatar={(r) => <PlayerPhoto playerId={r.playerId} size={56} className="player-cell-photo" placeholder />}
                limit={PLAYER_RANK_TOP_N}
                sortable={false}
                compact
              />
            </PlayerNamePool>
          </div>
        </>
      )}
    </>
  );
}

export function TeamCareerRecordRanking({ teamColors }: { teamColors: Record<string, TeamColors> | undefined }) {
  const exportRef = useRef<HTMLDivElement>(null);
  const [venue, setVenue] = useUrlState(VENUE_PARAM, "total");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [statParam, setStatKey] = useUrlState(TEAM_STAT_PARAM, "wins");
  const { data: rankings, loading } = useJsonData(() => fetchLeagueTeamRankings(), []);
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory(), []);

  const def = CAREER_TOTAL_DEFS.find((d) => d.key === statParam) ?? CAREER_TOTAL_DEFS[0]!;
  const rows = useMemo(() => {
    if (!rankings) return [];
    const table = venue === "total" ? rankings.career : venue === "home" ? rankings.careerHome : rankings.careerAway;
    const entries: Record<string, LeagueTeamRankEntry> | undefined = table[gameType as LeagueRankingGameType]?.[def.key];
    return Object.entries(entries ?? {})
      .map(([teamId, entry]) => ({ teamId, entry }))
      .sort((a, b) => a.entry.rank - b.entry.rank || Number(a.teamId) - Number(b.teamId));
  }, [rankings, venue, gameType, def.key]);

  const conditions = composeLabels(leagueVenueLabels(venue), gameTypeLabels(gameType, null));
  const title = `歴代 チーム通算記録：${def.label}`;
  const filename = buildExportFilename(["チーム通算記録", "歴代", def.label, ...conditions]);

  return (
    <>
      <FilterBar
        simple
        stateKey="rankings:team:career"
        axes={[leagueVenueAxis(venue, setVenue), gameTypeAxis(gameType, setGameType, null)]}
      />
      <FilterBar
        simple
        wide
        stateKey="rankings:team:career:stat"
        axes={[statItemAxis(CAREER_TOTAL_DEFS.map((d) => ({ key: d.key, label: d.label })), def.key, setStatKey)]}
      />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : !rankings ? (
        <p className="empty-message">データがありません</p>
      ) : rows.length === 0 ? (
        <p className="empty-message">この条件では該当クラブがありません</p>
      ) : (
        <>
          <ExportImageButton targetRef={exportRef} filename={filename} />
          <div ref={exportRef} className="export-target export-target-compact export-target-rankings-team">
            <ConditionTitle title={title} conditions={conditions} />
            <RankedList
              rows={rows}
              def={{
                key: def.key,
                label: def.label,
                value: (r) => r.entry.value,
                format: (r) => formatLeagueTeamCareerValue(r.entry.value),
                higherIsBetter: true,
              }}
              tieKey={(r) => String(r.entry.value)}
              rowKey={(r) => r.teamId}
              name={(r) => <ResponsiveTeamName teamId={r.teamId} name={leagueTeamDisplayName(r.teamId)} />}
              subLabel={(r) => leagueTeamCurrentCategoryLabel(r.teamId)}
              // 現行のB.PREMIERクラブは今のシーズン、それ以外（B.ONEへ降格済み等）は最後にB.PREMIERにいたシーズンのチーム詳細へ
              linkTo={(r) => {
                if (r.teamId in TEAM_DIVISIONS) return `/teams/${r.teamId}`;
                const last = lastPremierSeasonFor(divisionHistory, r.teamId);
                return last ? `/teams/${r.teamId}?season=${last}` : `/teams/${r.teamId}`;
              }}
              teamColor={(r) => teamColors?.[r.teamId]?.primary}
              avatar={(r) => <TeamLogo teamId={r.teamId} size={48} placeholder />}
              unit="チーム"
              sortable={false}
              statScope="team"
              compact
            />
          </div>
        </>
      )}
    </>
  );
}
