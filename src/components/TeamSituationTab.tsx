import { useMemo } from "react";
import { FilterBar } from "./FilterBar";
import { ConditionTitle } from "./ConditionTitle";
import { GlossaryNote } from "./GlossaryNote";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { RuleChangeFootnote } from "./RuleChangeFootnote";
import { SavableBlock } from "./SavableBlock";
import { SortableTable, type Column } from "./SortableTable";
import { TeamLogo } from "./TeamLogo";
import { CATEGORY_LABELS } from "../lib/categoryLabels";
import { buildExportFilename, composeLabels, displayModeLabels, gameTypeLabels, periodLabels, perspectiveLabels, situationalFilterLabels } from "../lib/conditionLabels";
import { fetchSchedule, fetchTeams } from "../lib/data";
import {
  displayModeAxis,
  gameTypeAxis,
  periodAxis,
  perspectiveAxis,
  simpleSelectAxis,
  situationalAxes,
  type FilterAxis,
} from "../lib/filterAxes";
import { opponentDivisionChoices } from "../lib/divisionGroups";
import { formatWinPct } from "../lib/format";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import type { League } from "../lib/league";
import { foulColumnsSplit } from "../lib/ruleChange";
import { buildPeriodColumns } from "../lib/teamPeriodColumns";
import { aggregatePeriodScoring, type PeriodScoringRow } from "../lib/teamPeriodScoring";
import { filterByGameType } from "../lib/playerSeasonBoxscore";
import { SEASON_PERIOD_OPTIONS, seasonPeriodOption } from "../lib/seasonPeriod";
import { filterGameLogs, buildBackToBackStatus, type SituationalFilter } from "../lib/situational";
import {
  buildAdvancedColumns,
  buildMiscColumns,
  buildScoringColumns,
  buildTraditionalColumns,
  DEFAULT_SORT_KEY,
  sumTeamGameLogs,
  withoutSelfPctColumns,
  type AllTeamsRow,
  type TeamPerspective,
} from "../lib/teamStatsColumns";
import { sumTeamPeriodTotals, useTeamPeriodSource, type TeamPeriodValue } from "../lib/teamPeriodTotals";
import { buildTeamSituationGroupDefs, type TeamSituationGroupDef } from "../lib/teamSituationGroups";
import { useAllTeamGameLogs, useLeagueSituationalContext } from "../lib/teamRankingData";
import { useSeasonFilterCleanup } from "../lib/seasonFilterCleanup";
import { enumParam, situationalParam, stringParam, useUrlState } from "../lib/urlState";
import { DISPLAY_MODE_PARAM, GAME_TYPE_PARAM, PERSPECTIVE_PARAM, TEAM_SEASON_PERIOD_PARAM } from "../lib/urlFilterParams";
import { useJsonData } from "../lib/useJsonData";
import { ResultOnlyNote } from "./ResultOnlyNote";
import { safeDiv } from "../../shared/formulas";
import type { TeamGameLog } from "../../shared/types";

type SituationBoxTab = "traditional" | "advanced" | "misc" | "scoring" | "periods";
const SITUATION_BOX_TAB_PARAM = enumParam<SituationBoxTab>(
  "tab",
  ["traditional", "advanced", "misc", "scoring", "periods"],
  "traditional",
  { traditional: "trad", advanced: "adv" },
);
const SITUATION_TABS: { key: SituationBoxTab; label: string }[] = [
  { key: "traditional", label: CATEGORY_LABELS.traditional },
  { key: "advanced", label: CATEGORY_LABELS.advanced },
  { key: "misc", label: CATEGORY_LABELS.misc },
  { key: "scoring", label: CATEGORY_LABELS.scoring },
  { key: "periods", label: CATEGORY_LABELS.periods },
];

/** 条件は「グループ:行」の形で URL に持つ（sit）。書かなければチーム詳細の先頭の条件（勝った試合） */
export const DEFAULT_SITUATION = "result:win";
const SITUATION_PARAM = stringParam("sit", DEFAULT_SITUATION, (v) => /^[\w]+:[\w]+$/.test(v));
const DEFAULT_FILTER: SituationalFilter = { range: { kind: "all" } };

const situationValue = (g: { key: string }, r: { key: string }) => `${g.key}:${r.key}`;

/** 外国籍の人数の行は「0人」だけでは何の人数か分からないので、グループ名を前に付ける */
function isCountGroup(g: { key: string }): boolean {
  return /PlayedCount$|PlayerCount$/.test(g.key);
}

/** 条件の名前（見出し・ファイル名用）。「勝った試合」のように「試合」で終わる名前はそのまま、それ以外は「ホームの試合」の形 */
export function situationName(group: { key: string; label: string }, row: { label: string }): string {
  const base = isCountGroup(group) ? `${group.label} ${row.label}` : row.label;
  return base.endsWith("試合") ? base : `${base}の試合`;
}

/** 試合ログ（全チーム）に勝敗の0試合を「-」で出すため、値の列を包む */
function dashWhenEmpty(col: Column<AllTeamsRow>): Column<AllTeamsRow> {
  return {
    ...col,
    sortValue: (r) => (r.gamesPlayed === 0 ? Number.NaN : col.sortValue(r)),
    format: col.format ? (r) => (r.gamesPlayed === 0 ? "-" : col.format!(r)) : undefined,
    render: col.render ? (r) => (r.gamesPlayed === 0 ? "-" : col.render!(r)) : undefined,
  };
}

const teamColumn: Column<AllTeamsRow> = {
  key: "team",
  label: "チーム",
  align: "left",
  sortValue: (r) => r.team.teamName,
  render: (r) => (
    <span className="team-name-cell">
      <TeamLogo teamId={r.team.teamId} size={20} />
      <ResponsiveTeamName teamId={r.team.teamId} name={r.team.teamName} />
    </span>
  ),
};

/** 左に置く「試合数・勝・負・勝率」。試合が無いチームは「-」 */
const LEADING: Column<AllTeamsRow>[] = [
  teamColumn,
  { key: "g", label: "G", sortValue: (r) => r.gamesPlayed, format: (r) => (r.gamesPlayed === 0 ? "-" : String(r.gamesPlayed)) },
  { key: "w", label: "勝", sortValue: (r) => (r.gamesPlayed === 0 ? Number.NaN : r.wins), format: (r) => (r.gamesPlayed === 0 ? "-" : String(r.wins)) },
  { key: "l", label: "負", sortValue: (r) => (r.gamesPlayed === 0 ? Number.NaN : r.losses), format: (r) => (r.gamesPlayed === 0 ? "-" : String(r.losses)) },
  {
    key: "winPct",
    label: "勝率",
    sortValue: (r) => (r.gamesPlayed === 0 ? Number.NaN : safeDiv(r.wins, r.wins + r.losses)),
    format: (r) => (r.gamesPlayed === 0 ? "-" : formatWinPct(safeDiv(r.wins, r.wins + r.losses))),
  },
];

interface PeriodRow extends AllTeamsRow {
  scoring: PeriodScoringRow;
}

/**
 * 全チームスタッツの「シチュエーション別」タブ（設計書443章）。選んだ1つの条件（チーム詳細のシチュエーション別と同じ一覧・同じ判定）に
 * 当てはまる試合だけで、全チームの成績を並べる。値は全チームスタッツと同じ列の式を、その試合の合計に掛けて出す
 */
export function TeamSituationTab({ season, league }: { season: string; league: League }) {
  const { data: teams, loading: teamsLoading, error: teamsError } = useJsonData(() => fetchTeams(season, league), [season, league]);
  const { gameLogsByTeam } = useAllTeamGameLogs(season, teams, league);
  const { data: scheduleForNote } = useJsonData(() => fetchSchedule(season, league).catch(() => null), [season, league]);
  const { summaries, divisionHistory, opponentRecords } = useLeagueSituationalContext(season, true, league);

  const [boxTab, setBoxTab] = useUrlState(SITUATION_BOX_TAB_PARAM, "traditional");
  const [situation, setSituation] = useUrlState(SITUATION_PARAM, DEFAULT_SITUATION);
  const [displayMode, setDisplayMode] = useUrlState(DISPLAY_MODE_PARAM, "perGame");
  const [gameType, setGameType] = useUrlState(GAME_TYPE_PARAM, "regular");
  const [filter, setFilter] = useUrlState(situationalParam, DEFAULT_FILTER);
  const [teamPerspective, setTeamPerspective] = useUrlState(PERSPECTIVE_PARAM, "own");
  const [period, setPeriod] = useUrlState(TEAM_SEASON_PERIOD_PARAM, "all");
  useSeasonFilterCleanup({ season, filter, setFilter, gameType, setGameType, league });

  const periodOption = seasonPeriodOption(period);
  const periodTab = boxTab !== "periods";
  const periodActive = periodTab && period !== "all";
  const { source: periodSource, loading: periodLoading } = useTeamPeriodSource(season, periodActive, league);
  const foulSplit = foulColumnsSplit([season]);

  const backToBack = useMemo(() => (summaries ? buildBackToBackStatus(summaries) : undefined), [summaries]);
  const context = { backToBack, opponentRecords, divisionHistory, season, league };

  // 試合区分で絞った各チームの試合ログ（チーム詳細と同じく、月別・直近N試合はこの中で決める）
  const typedLogsByTeam = useMemo(() => {
    const map = new Map<string, TeamGameLog[]>();
    for (const team of teams ?? []) map.set(team.teamId, filterByGameType(gameLogsByTeam?.get(team.teamId) ?? [], gameType));
    return map;
  }, [teams, gameLogsByTeam, gameType]);

  // プルダウンの一覧: 月別は全チームのどこかにある月、連戦は日程にある番号まで
  const optionGroups: TeamSituationGroupDef[] = useMemo(
    () => buildTeamSituationGroupDefs({ scopedLogs: [...typedLogsByTeam.values()].flat(), teamId: "", ...context }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typedLogsByTeam, backToBack, opponentRecords, divisionHistory, season, league],
  );
  const options = useMemo(
    () => optionGroups.flatMap((g) => g.rows.map((r) => ({ value: situationValue(g, r), label: isCountGroup(g) ? `${g.label}：${r.label}` : r.label, group: g.label }))),
    [optionGroups],
  );
  // 一覧に無い条件（別のシーズンのURLなど）は先頭の条件に戻して扱う
  const selected = options.find((o) => o.value === situation) ?? options[0];
  const selectedGroup = optionGroups.find((g) => selected && selected.value.startsWith(`${g.key}:`));
  const selectedRow = selectedGroup?.rows.find((r) => selected && selected.value === situationValue(selectedGroup, r));
  const sitName = selectedGroup && selectedRow ? situationName(selectedGroup, selectedRow) : "";

  // 条件に当てはまる、チームごとの試合ログ。ほかの絞り込み（期間・会場など）とは両方満たす試合
  const scopedLogsByTeam = useMemo(() => {
    const map = new Map<string, TeamGameLog[]>();
    if (!teams || !gameLogsByTeam || !selectedGroup || !selectedRow) return map;
    for (const team of teams) {
      const typed = typedLogsByTeam.get(team.teamId) ?? [];
      const defs = buildTeamSituationGroupDefs({ scopedLogs: typed, teamId: team.teamId, ...context });
      const row = defs.find((g) => g.key === selectedGroup.key)?.rows.find((r) => r.key === selectedRow.key);
      const keys = new Set(typed.filter((g) => row?.predicate(g)).map((g) => g.scheduleKey));
      const filtered = filterByGameType(
        filterGameLogs(gameLogsByTeam.get(team.teamId) ?? [], { ...filter, includePlayoffs: true }, opponentRecords, divisionHistory, season, () => team.teamId, league),
        gameType,
      );
      map.set(team.teamId, filtered.filter((g) => keys.has(g.scheduleKey)));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams, gameLogsByTeam, typedLogsByTeam, selectedGroup, selectedRow, filter, gameType, backToBack, opponentRecords, divisionHistory, season, league]);

  const rows: AllTeamsRow[] = useMemo(() => {
    if (!teams || !gameLogsByTeam) return [];
    if (periodActive && !periodSource) return [];
    return teams.map((team) => {
      const scoped = scopedLogsByTeam.get(team.teamId) ?? [];
      if (periodActive && periodSource) {
        const { games, totals } = sumTeamPeriodTotals(periodSource, scoped, period as TeamPeriodValue);
        const wins = games.filter((g) => g.win).length;
        return { team, gamesPlayed: games.length, wins, losses: games.length - wins, totals };
      }
      const wins = scoped.filter((g) => g.win).length;
      return { team, gamesPlayed: scoped.length, wins, losses: scoped.length - wins, totals: sumTeamGameLogs(scoped) };
    });
  }, [teams, gameLogsByTeam, scopedLogsByTeam, periodActive, periodSource, period]);

  const periodRows: PeriodRow[] = useMemo(
    () => (boxTab === "periods" ? rows.map((r) => ({ ...r, scoring: aggregatePeriodScoring(scopedLogsByTeam.get(r.team.teamId) ?? []) })) : []),
    [boxTab, rows, scopedLogsByTeam],
  );

  const columns: Column<AllTeamsRow>[] = useMemo(() => {
    const stat = (cols: Column<AllTeamsRow>[]) => cols.map(dashWhenEmpty);
    switch (boxTab) {
      case "traditional":
        return [...LEADING, ...stat(buildTraditionalColumns(displayMode, teamPerspective))];
      case "advanced":
        return [...LEADING, ...stat(buildAdvancedColumns(displayMode, teamPerspective))];
      case "misc":
        return [...LEADING, ...stat(buildMiscColumns(displayMode, teamPerspective, true, foulSplit))];
      case "scoring":
        return [...LEADING, ...stat(withoutSelfPctColumns(buildScoringColumns(displayMode, teamPerspective, true)))];
      case "periods":
        return LEADING;
    }
  }, [boxTab, displayMode, teamPerspective, foulSplit]);
  const periodColumns = useMemo(
    () =>
      [...LEADING, ...buildPeriodColumns<PeriodRow>(displayMode === "total" ? "total" : "perGame", teamPerspective as TeamPerspective).map((c) => ({
        ...c,
        sortValue: (r: PeriodRow) => (r.gamesPlayed === 0 ? Number.NaN : c.sortValue(r)),
        format: c.format ? (r: PeriodRow) => (r.gamesPlayed === 0 ? "-" : c.format!(r)) : undefined,
        render: c.render ? (r: PeriodRow) => (r.gamesPlayed === 0 ? "-" : c.render!(r)) : undefined,
      }))] as Column<PeriodRow>[],
    [displayMode, teamPerspective],
  );

  if (teamsLoading) return <p className="loading">読み込み中...</p>;
  if (teamsError) return <p className="error-message">{teamsError}</p>;
  if (!teams || teams.length === 0) return <p className="empty-message">データがありません</p>;

  const periodReason = boxTab === "periods" ? "このタブは区間別の得点の表のため、区間の選択はほかのタブでだけ効きます。" : undefined;
  const filterAxes: FilterAxis[] = [
    simpleSelectAxis({
      id: "situation",
      label: "シチュエーション",
      options,
      value: selected?.value ?? DEFAULT_SITUATION,
      defaultValue: DEFAULT_SITUATION,
      onChange: setSituation,
    }),
    gameTypeAxis(gameType, setGameType, season),
    perspectiveAxis(teamPerspective, setTeamPerspective),
    displayModeAxis(displayMode, setDisplayMode),
    periodAxis(period, setPeriod, SEASON_PERIOD_OPTIONS, { disabledReason: periodReason }),
    ...situationalAxes(filter, setFilter, {
      opponentWinRateSupported: !!opponentRecords,
      ownTeamDivisionSupported: !!divisionHistory,
      opponentDivisions: opponentDivisionChoices(divisionHistory, season, league),
    }),
  ];
  const clearAll = () => {
    setSituation(DEFAULT_SITUATION);
    setGameType("regular");
    setTeamPerspective("own");
    setDisplayMode("perGame");
    setPeriod("all");
    setFilter(DEFAULT_FILTER);
  };

  const categoryLabel = SITUATION_TABS.find((t) => t.key === boxTab)?.label ?? "";
  const conditions = composeLabels(
    categoryLabel,
    displayModeLabels(displayMode),
    gameTypeLabels(gameType, season),
    perspectiveLabels(teamPerspective),
    situationalFilterLabels(filter),
    periodTab ? periodLabels(periodOption) : [],
  );
  const title = `${season}シーズン ${sitName}　チームスタッツ`;
  const loading = periodActive && periodLoading;
  const empty = rows.length > 0 && rows.every((r) => r.gamesPlayed === 0);

  return (
    <div>
      <p className="page-subtitle">全{teams.length}チーム</p>
      <FilterBar axes={filterAxes} stateKey="teams:situation" onClearAll={clearAll} />
      <div className="tab-bar">
        {SITUATION_TABS.map((t) => (
          <button key={t.key} className={`tab-button${boxTab === t.key ? " active" : ""}`} onClick={() => setBoxTab(t.key)} type="button">
            {t.label}
          </button>
        ))}
      </div>
      <SavableBlock
        filename={buildExportFilename([`${season}シーズン`, sitName, "チームスタッツ", categoryLabel, ...conditions])}
        baseDate={{ kind: "season", season, gameType }}
        className="export-target-standings"
      >
        <ConditionTitle title={title} exportScope={`${season}シーズン`} conditions={conditions} />
        <ResultOnlyNote variant="stats" games={scheduleForNote?.resultOnlyGames} />
        {loading ? (
          <p className="loading">読み込み中...</p>
        ) : periodActive && !periodSource ? (
          <p className="empty-message">このシーズンの区間別の値を読み込めませんでした。時間をおいて開き直すか、区間を「試合全体」にしてください。</p>
        ) : !gameLogsByTeam ? (
          <p className="loading">読み込み中...</p>
        ) : empty ? (
          <p className="empty-message">該当する試合がありません</p>
        ) : (
          <div className="table-scroll">
            {boxTab === "periods" ? (
              <SortableTable
                rowNumbers
                statScope="team"
                key={`${boxTab}-${teamPerspective}`}
                columns={periodColumns}
                rows={periodRows}
                rowKey={(r) => r.team.teamId}
                defaultSortKey="g"
                linkTo={(r) => `/teams/${r.team.teamId}`}
              />
            ) : (
              <SortableTable
                rowNumbers
                statScope="team"
                key={`${boxTab}-${teamPerspective}`}
                columns={columns}
                rows={rows}
                rowKey={(r) => r.team.teamId}
                defaultSortKey={DEFAULT_SORT_KEY[boxTab]}
                linkTo={(r) => `/teams/${r.team.teamId}`}
              />
            )}
          </div>
        )}
        {boxTab === "misc" && <RuleChangeFootnote seasons={[season]} />}
      </SavableBlock>
      <GlossaryNote anchor={GLOSSARY_ANCHORS.teamSituation} label="シチュエーション別" scope="選んだ条件に当てはまる試合だけで、各チームの試合ログから集計し直した値です。" />
    </div>
  );
}
