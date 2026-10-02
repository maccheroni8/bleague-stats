import { useMemo } from "react";
import { stringParam, useUrlState } from "../lib/urlState";
import { GAME_TYPE_PARAM } from "../lib/urlFilterParams";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
import { filterByGameType } from "../../shared/gameType";
import { gameTypeAxis, simpleSelectAxis } from "../lib/filterAxes";
import { fetchSeasons, fetchTeams } from "../lib/data";
import { useAllTeamGameLogs } from "../lib/teamRankingData";
import {
  TEAM_RECORD_MODE_LABELS,
  seasonTeamRecordRows,
  teamRecordItems,
  type TeamRecordGame,
  type TeamRecordMode,
} from "../lib/teamGameRecords";
import { useJsonData } from "../lib/useJsonData";
import { composeLabels, gameTypeLabels } from "../lib/conditionLabels";
import { ConditionTitle } from "./ConditionTitle";
import { FilterBar } from "./FilterBar";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { ClubPeriodRecords } from "./TeamPeriodRecords";
import { RECORD_MODE_PARAM, teamGameRecordRankingUrl } from "./TeamGameRecordRanking";
import { TeamRecordLeaderCard } from "./TeamRecordLeaderCard";

/**
 * チーム全体「記録」タブの範囲「シーズン」: 選んだシーズン・試合区分の中の、全クラブの1試合の記録の1位（DESIGN.md 191章）。
 * 各項目の1位のカードを並べ、カードを押すとランキングページの同じ項目（範囲「シーズン」）へ移る。クォーター別・前後半別の表のマスも同じ。
 * 値は各クラブの試合ログ（team-games）からその場で求めるため、取り込みで試合ログが更新されれば、進行中のシーズンもそのまま新しい記録になる
 */
export function LeagueSeasonRecords({ defaultSeason }: { defaultSeason: string }) {
  // シーズン・試合種別・記録の種類はURLのクエリに持つ（rseason・gt・rmode。DESIGN.md 163章）
  const [season, setSeason] = useUrlState(stringParam("rseason", defaultSeason, (v) => /^\d{4}-\d{2}$/.test(v)), defaultSeason);
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [mode, setMode] = useUrlState(RECORD_MODE_PARAM, "record");

  const { data: seasons } = useJsonData(() => fetchSeasons(), []);
  const { data: teams, loading: teamsLoading } = useJsonData(() => fetchTeams(season), [season]);
  const { gameLogsByTeam, loading: logsLoading } = useAllTeamGameLogs(season, teams);

  const games = useMemo<TeamRecordGame[]>(() => {
    if (!teams || !gameLogsByTeam) return [];
    const all = teams.flatMap((t) =>
      (gameLogsByTeam.get(t.teamId) ?? []).map((g) => ({ ...g, season, teamId: t.teamId, teamName: t.teamName })),
    );
    return filterByGameType(all, gameType);
  }, [teams, gameLogsByTeam, season, gameType]);

  const cards = useMemo(
    () =>
      teamRecordItems(mode)
        .filter((i) => !i.group)
        .map((item) => ({ item, rows: seasonTeamRecordRows(games, mode, item.key) }))
        .filter((c) => c.rows.length > 0),
    [games, mode],
  );

  const seasonOptions = [...(seasons ?? [])]
    .map((s) => s.season)
    .sort((a, b) => b.localeCompare(a))
    .map((s) => ({ value: s, label: `${s}シーズン` }));
  const loading = teamsLoading || logsLoading;
  const modeLabel = TEAM_RECORD_MODE_LABELS[mode];

  return (
    <div>
      <FilterBar
        simple
        stateKey="teams:records:season"
        axes={[
          simpleSelectAxis({
            id: "recordsSeason",
            label: "シーズン",
            options: seasonOptions.length > 0 ? seasonOptions : [{ value: season, label: `${season}シーズン` }],
            value: season,
            defaultValue: defaultSeason,
            onChange: setSeason,
          }),
          gameTypeAxis(gameType, setGameType, season),
        ]}
      />
      <div className="mode-toggle period-range-toggle">
        {(["record", "worst", "against"] as const).map((m) => (
          <button key={m} type="button" className={mode === m ? "active" : ""} onClick={() => setMode(m as TeamRecordMode)}>
            {TEAM_RECORD_MODE_LABELS[m]}
          </button>
        ))}
      </div>
      <ConditionTitle title={`${season}シーズンの${modeLabel}`} conditions={composeLabels(gameTypeLabels(gameType, season))} />
      {loading ? (
        <p className="loading">読み込み中...</p>
      ) : games.length === 0 ? (
        <p className="empty-message">この条件の試合がありません</p>
      ) : (
        <>
          <h3 className="career-highs-subheading">1試合の{modeLabel}（各項目の1位。押すとランキングへ）</h3>
          <div className="career-highs-grid">
            {cards.map(({ item, rows }) => (
              <TeamRecordLeaderCard
                key={item.key}
                itemKey={item.key}
                label={item.label}
                rows={rows}
                to={teamGameRecordRankingUrl({ scope: "season", gameType, mode, statKey: item.key, season })}
              />
            ))}
          </div>
          <GlossaryNote anchor={GLOSSARY_ANCHORS.records} label="記録" scope="そのシーズンの全クラブの試合の中での1試合の記録です。" />

          {mode !== "against" && (
            <>
              <h3 className="career-highs-subheading">クォーター別レコード（押すとランキングへ）</h3>
              <ClubPeriodRecords
                games={games}
                stateKey="teams:records:season:period"
                mode={mode}
                linkFor={(period, kind) =>
                  teamGameRecordRankingUrl({ scope: "season", gameType, mode, statKey: `${period}:${kind}`, season })
                }
                teamLabel={(g) => (
                  <strong className="record-team">
                    <ResponsiveTeamName teamId={g.teamId} name={g.teamName} always />
                  </strong>
                )}
              />
              <GlossaryNote anchor={GLOSSARY_ANCHORS.periodRecords} label="クォーター別レコード" />
            </>
          )}
        </>
      )}
    </div>
  );
}
