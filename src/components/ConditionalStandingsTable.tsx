import { useEffect, useMemo, useState } from "react";
import { GLOSSARY_ANCHORS } from "../lib/glossaryAnchors";
import { GlossaryNote } from "./GlossaryNote";
import { postseasonLabel } from "../../shared/gameType";
import { postseasonFormat } from "../../shared/postseasonFormat";
import { playoffZonePreset } from "../lib/playoffZone";
import { SortableTable, type Column } from "./SortableTable";
import { TeamLogo } from "./TeamLogo";
import { FilterBar } from "./FilterBar";
import { simpleSelectAxis, teamMultiAxis, type FilterAxis, type FilterAxisOption } from "../lib/filterAxes";
import { ConditionLine } from "./ConditionTitle";
import { clubSelectionLabels, composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { formatPct, formatSigned, formatWinPct } from "../lib/format";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak } from "../../shared/teamRecords";
import { teamShortName } from "../../shared/teamNames";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import { DIVISION_LABELS, divisionOrder, divisionPresets } from "../lib/divisionGroups";
import type { League } from "../lib/league";
import { isWeekdayGame } from "../lib/japaneseHolidays";
import { useLeagueSituationalContext } from "../lib/teamRankingData";
import {
  buildBackToBackStatus,
  backToBackGameLabels,
  buildBiweekPeriods,
  buildRecordsBeforeGame,
  matchesBiweekPeriod,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  MIN_GAMES_FOR_OPPONENT_WIN_RATE,
  type BackToBackGame,
  type BiweekPeriod,
  type RecordBeforeGame,
  MARGIN_CONDITION_LABELS,
  matchesMargin,
  type MarginCondition,
} from "../lib/situational";
import type {
  Division,
  DivisionHistoryFile,
  StandingsTeamSnapshot,
  TeamColors,
  TeamGameLog,
  UpcomingGameEntry,
} from "../../shared/types";
import { ResponsiveTeamName } from "./ResponsiveTeamName";
import { NumberTextInput } from "./NumberTextInput";
import {
  hasOvertimeLog,
  isCenturyGame,
  LEAD_LABELS,
  leadStatusFromLog,
  marginAtLeast,
  matchesBothScores,
  matchesForeignCount,
  matchesTeamScore,
  type CountMode,
  type Lead,
} from "../lib/situationalRecords";
import { buildOpponentSeasonWinRates, matchesOpponentSeasonWinRate, type OpponentSeasonTier } from "../lib/opponentSeasonWinRate";
import { resultOnlySummaries } from "../lib/resultOnlyGames";
import type { ResultOnlyGameEntry } from "../../shared/resultOnlyGames";

import {
  applyConditionalCondition,
  buildConditionGroups,
  conditionNumberKind,
  describeCondition,
  NUMBER_CONDITION_DEFAULTS,
  type ConditionalCondition,
  type ConditionGroup,
} from "../lib/conditionalCondition";
export { applyConditionalCondition, type ConditionalCondition } from "../lib/conditionalCondition";

interface UpcomingOwnGame {
  date: string;
  isHome: boolean;
  opponentTeamName: string;
}

/**
 * 選択中の条件について「残り対戦試合数」が算出できる場合のみ数値を返す（できない条件はnull）。
 * schedule.jsonのupcomingGames（チーム名のみ）をteamIdByNameで名寄せして判定する
 * （StandingsPageの星取り表タブと同じ手法）。日付・会場・地区・月別・年明け前後のように
 * 未来の試合でも決まっている情報に基づく条件のみ対応し、対戦相手の勝率・連戦・バイウィーク・
 * 直近N試合・シーズンの時期・点差決着のように結果や他の試合の進行に依存する条件は
 * 「表示できない」として扱う
 */
function computeRemainingCount(
  teamName: string,
  condition: ConditionalCondition,
  upcomingGames: UpcomingGameEntry[],
  teamIdByName: Map<string, string>,
  divisionHistory: DivisionHistoryFile | null | undefined,
  season: string,
  league: League,
): number | null {
  const myGames: UpcomingOwnGame[] = upcomingGames
    .filter((g) => g.homeTeamName === teamName || g.awayTeamName === teamName)
    .map((g) => ({
      date: g.date,
      isHome: g.homeTeamName === teamName,
      opponentTeamName: g.homeTeamName === teamName ? g.awayTeamName : g.homeTeamName,
    }));

  switch (condition.kind) {
    case "all":
      return myGames.length;
    case "homeAway":
      return myGames.filter((g) => (condition.value === "home" ? g.isHome : !g.isHome)).length;
    case "division":
      return myGames.filter((g) => {
        const oppId = teamIdByName.get(g.opponentTeamName);
        if (!oppId) return false;
        const oppDivision = teamDivisionForSeason(divisionHistory, oppId, season, league);
        if (condition.value !== "same" && condition.value !== "other") return oppDivision === condition.value;
        const ownId = teamIdByName.get(teamName);
        const ownDivision = ownId ? teamDivisionForSeason(divisionHistory, ownId, season, league) : undefined;
        if (!ownDivision || !oppDivision) return false;
        return condition.value === "same" ? ownDivision === oppDivision : ownDivision !== oppDivision;
      }).length;
    case "weekday":
      return myGames.filter((g) => isWeekdayGame(g.date) === condition.value).length;
    case "month":
      return myGames.filter((g) => Number(g.date.slice(5, 7)) === condition.value).length;
    case "newYear":
      return myGames.filter((g) => {
        const month = Number(g.date.slice(5, 7));
        return condition.half === "before" ? month >= 7 : month <= 6;
      }).length;
    case "biweekPeriod":
      return myGames.filter((g) => matchesBiweekPeriod(g, condition.period)).length;
    default:
      return null;
  }
}

interface ConditionalRow {
  team: StandingsTeamSnapshot;
  /** 順位。選んだ条件に当てはまる試合が1つも無いクラブは付けない（null。表示は「-」で、末尾にまとめる） */
  rank: number | null;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winPct: number;
  pts: number;
  oppPts: number;
  pointDiff: number;
  streakLabel: string;
  /** 試合割合＝その条件の試合数 ÷ そのクラブのレギュラーシーズンの対象試合数（347章）。対象試合が0のときは0 */
  gameShare: number;
  remaining: number | null;
}

export function ConditionalStandingsTable({
  season,
  league,
  teams,
  gameLogsByTeam,
  gameLogsLoading,
  upcomingGames,
  teamColors,
  resultOnlyGames,
}: {
  season: string;
  league: League;
  teams: StandingsTeamSnapshot[];
  /** 結果だけの試合の行（日付・ホーム/アウェイ・勝敗・得点・相手だけ）を含む、チームごとの試合ログ */
  gameLogsByTeam: Map<string, TeamGameLog[]> | null;
  gameLogsLoading: boolean;
  upcomingGames: UpcomingGameEntry[];
  teamColors?: Record<string, TeamColors>;
  /** 結果だけの試合（ボックススコアが無い試合・不戦勝）。対戦相手の勝率・連戦・バイウィークの判定にも含める */
  resultOnlyGames?: ResultOnlyGameEntry[];
}) {
  const { summaries: statSummaries, divisionHistory, opponentRecords: statOpponentRecords } = useLeagueSituationalContext(season, true, league);
  const summaries = useMemo(
    () => (statSummaries ? [...statSummaries, ...resultOnlySummaries(resultOnlyGames, statSummaries)] : statSummaries),
    [statSummaries, resultOnlyGames],
  );
  const opponentRecords = useMemo(
    () => (resultOnlyGames && resultOnlyGames.length > 0 ? (summaries ? buildRecordsBeforeGame(summaries) : undefined) : statOpponentRecords),
    [summaries, statOpponentRecords, resultOnlyGames],
  );
  const backToBackStatus = useMemo(() => (summaries ? buildBackToBackStatus(summaries) : undefined), [summaries]);
  const regularScheduleKeys = useMemo(
    () => new Set((summaries ?? []).filter((g) => g.gameType === "regular").map((g) => g.scheduleKey)),
    [summaries],
  );
  // シーズンをバイウィークで区切った区間一覧（例: 「開幕〜11月バイウィーク前」「11月
  // バイウィーク以降〜2月バイウィーク前」「2月バイウィーク以降〜」）。区間数はシーズンごとに
  // 検出されたギャップの数に応じて動的に変わる（buildBiweekPeriods参照）
  const biweekPeriods = useMemo(() => (summaries ? buildBiweekPeriods(summaries) : []), [summaries]);

  const [condition, setCondition] = useState<ConditionalCondition>({ kind: "all" });
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string> | null>(null);

  // シーズンが変わったら条件・チーム絞り込みをリセットする（前シーズンの選択を引き継がない）
  useEffect(() => {
    setCondition({ kind: "all" });
    setSelectedTeamIds(null);
  }, [season]);

  // 対戦相手の地区の選択肢: そのシーズンの順位表にいる地区だけを、リーグの並びで
  const presentDivisions = divisionOrder(league).filter((d) => teams.some((t) => t.division === d));
  // シーズンごとの出場形式（各地区の上位○クラブ＋ワイルドカード○クラブ。shared/postseasonFormat.ts）で算出する。
  // 形式の無いシーズン（CS中止の2019-20）と地区データの無いシーズンは null（進出圏のボタン自体を出さない）
  const format = postseasonFormat(season, league);
  const playoffZone = useMemo(() => playoffZonePreset(season, league, teams), [season, league, teams]);

  const teamIdByName = useMemo(() => new Map(teams.map((t) => [t.teamName, t.teamId])), [teams]);
  const teamOptions = useMemo(
    () =>
      teams
        .map((t) => ({ teamId: t.teamId, teamName: t.teamName }))
        .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja")),
    [teams],
  );

  // 「●人」「●点」の数（条件を切り替えても、打った数を覚えておく）
  const [numbers, setNumbers] = useState<{ count: number; score: number }>({ count: NUMBER_CONDITION_DEFAULTS.count, score: NUMBER_CONDITION_DEFAULTS.score });
  const opponentLatestWinRates = useMemo(() => buildOpponentSeasonWinRates(teams), [teams]);

  const conditionGroups: ConditionGroup[] = buildConditionGroups({ presentDivisions, backToBackStatus, regularScheduleKeys, biweekPeriods, numbers });

  // フィルタバー（DESIGN.md 105章 B6）。条件は排他の単一選択なので、グループ付きの1つのドロップダウンにする
  // （選ぶと「条件」のチップが1つだけ出る）。月別も同じドロップダウンの1グループにまとめた
  const conditionKeyOf = (c: ConditionalCondition) => JSON.stringify(c);
  // 「●人」「●点」の条件は、数を除いた形で選択肢と照らす
  const withoutNumber = (c: ConditionalCondition): ConditionalCondition =>
    conditionNumberKind(c) ? ({ ...c, n: 0 } as ConditionalCondition) : c;
  const conditionOptions: FilterAxisOption[] = [
    { value: "all", label: "条件なし（シーズン全体）" },
    ...conditionGroups.flatMap((g) => g.options.map((o) => ({ value: o.key, label: o.label, group: g.label }))),
    ...Array.from({ length: 12 }, (_, i) => ({ value: `month-${i + 1}`, label: `${i + 1}月`, group: "月別" })),
  ];
  const conditionByKey = new Map<string, ConditionalCondition>([
    ...conditionGroups.flatMap((g) => g.options.map((o) => [o.key, o.condition] as const)),
    ...Array.from({ length: 12 }, (_, i) => [`month-${i + 1}`, { kind: "month", value: i + 1 } as ConditionalCondition] as const),
  ]);
  const activeConditionKey =
    condition.kind === "all"
      ? "all"
      : condition.kind === "month"
        ? `month-${condition.value}`
        : (conditionGroups.flatMap((g) => g.options).find((o) => conditionKeyOf(withoutNumber(o.condition)) === conditionKeyOf(withoutNumber(condition)))?.key ?? "all");
  const divisionByTeamId = new Map(teams.map((t) => [t.teamId, t.division]));
  const filterAxes: FilterAxis[] = [
    simpleSelectAxis({
      id: "condition",
      label: "条件",
      options: conditionOptions,
      value: activeConditionKey,
      defaultValue: "all",
      onChange: (key) => setCondition(conditionByKey.get(key) ?? { kind: "all" }),
    }),
    teamMultiAxis({
      options: teamOptions,
      selected: selectedTeamIds,
      onChange: setSelectedTeamIds,
      divisionOf: (id) => divisionByTeamId.get(id),
      league,
      presets: playoffZone ? [playoffZone] : [],
    }),
  ];
  const numberKind = conditionNumberKind(condition);
  const clearFilters = () => {
    setCondition({ kind: "all" });
    setSelectedTeamIds(null);
  };

  const rows: ConditionalRow[] = useMemo(() => {
    if (!gameLogsByTeam) return [];
    const built = teams.map((team): Omit<ConditionalRow, "rank"> => {
      const allLogs = (gameLogsByTeam.get(team.teamId) ?? []).filter((g) => g.gameType === "regular");
      const sorted = [...allLogs].sort(
        (a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey),
      );
      const filtered = applyConditionalCondition(sorted, condition, {
        teamId: team.teamId,
        season,
        league,
        opponentRecords,
        divisionHistory,
        backToBackStatus,
        opponentLatestWinRates,
      });
      const wins = filtered.filter((g) => g.win).length;
      const losses = filtered.length - wins;
      const pts = filtered.reduce((s, g) => s + g.teamScore, 0);
      const oppPts = filtered.reduce((s, g) => s + g.opponentScore, 0);
      const remaining = computeRemainingCount(team.teamName, condition, upcomingGames, teamIdByName, divisionHistory, season, league);
      return {
        team,
        gamesPlayed: filtered.length,
        wins,
        losses,
        winPct: safeDiv(wins, wins + losses),
        pts,
        oppPts,
        pointDiff: pts - oppPts,
        streakLabel: formatTeamStreak(currentStreak(filtered)),
        gameShare: safeDiv(filtered.length, sorted.length),
        remaining,
      };
    });
    const visible = built.filter((r) => !selectedTeamIds || selectedTeamIds.has(r.team.teamId));
    // 並び: 「条件なし」は順位表の全体順位と同じ並び（同率のタイブレークを順位表と揃える）。条件を付けたときは
    // 勝率→得失点差（同値は全体順位の順）。当てはまる試合が無いクラブは順位を付けず、末尾に全体順位の順でまとめる
    const played = visible.filter((r) => r.gamesPlayed > 0);
    const unplayed = visible.filter((r) => r.gamesPlayed === 0).sort((a, b) => a.team.rank - b.team.rank);
    played.sort(
      condition.kind === "all"
        ? (a, b) => a.team.rank - b.team.rank
        : (a, b) => b.winPct - a.winPct || b.pointDiff - a.pointDiff || a.team.rank - b.team.rank,
    );
    return [
      ...played.map((r, i) => ({ ...r, rank: i + 1 as number | null })),
      ...unplayed.map((r) => ({ ...r, rank: null as number | null })),
    ];
  }, [
    teams,
    gameLogsByTeam,
    condition,
    season,
    opponentRecords,
    divisionHistory,
    backToBackStatus,
    upcomingGames,
    teamIdByName,
    selectedTeamIds,
    league,
    opponentLatestWinRates,
  ]);

  // 「相手の勝率」の条件: 相手の消化試合数が下限に満たない時点の試合は数えない。対象の試合の数を表の上に出す
  // （クラブごとの試合を延べで数える。選んだクラブだけが対象）
  const opponentWinRateCoverage = useMemo(() => {
    if (condition.kind !== "opponentWinRate" || !gameLogsByTeam || !opponentRecords) return null;
    let total = 0;
    let counted = 0;
    for (const team of teams) {
      if (selectedTeamIds && !selectedTeamIds.has(team.teamId)) continue;
      for (const g of gameLogsByTeam.get(team.teamId) ?? []) {
        if (g.gameType !== "regular") continue;
        total += 1;
        const rec = opponentRecords.get(g.scheduleKey)?.get(g.opponentTeamId);
        if (rec && rec.wins + rec.losses >= MIN_GAMES_FOR_OPPONENT_WIN_RATE) counted += 1;
      }
    }
    return { total, counted };
  }, [condition, gameLogsByTeam, opponentRecords, teams, selectedTeamIds]);

  const columns: Column<ConditionalRow>[] = [
    {
      key: "rank",
      label: "順位",
      sortValue: (r) => r.rank ?? Number.MAX_SAFE_INTEGER,
      format: (r) => (r.rank === null ? "-" : String(r.rank)),
    },
    {
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
    },
    { key: "g", label: "試合数", sortValue: (r) => r.gamesPlayed, format: (r) => String(r.gamesPlayed) },
    { key: "wins", label: "勝", sortValue: (r) => r.wins, format: (r) => String(r.wins) },
    { key: "losses", label: "負", sortValue: (r) => r.losses, format: (r) => String(r.losses), higherIsBetter: false },
    {
      key: "winPct",
      label: "勝率",
      sortValue: (r) => (r.gamesPlayed === 0 ? -1 : r.winPct),
      format: (r) => (r.gamesPlayed === 0 ? "-" : formatWinPct(r.winPct)),
    },
    { key: "pts", label: "得点", sortValue: (r) => r.pts, format: (r) => String(r.pts) },
    { key: "oppPts", label: "失点", sortValue: (r) => r.oppPts, format: (r) => String(r.oppPts), higherIsBetter: false },
    { key: "pointDiff", label: "得失点差", sortValue: (r) => r.pointDiff, format: (r) => formatSigned(r.pointDiff, 0) },
    { key: "streak", label: "連勝/連敗", sortValue: (r) => r.wins - r.losses, format: (r) => r.streakLabel },
    {
      key: "gameShare",
      label: "試合割合",
      sortValue: (r) => (r.gamesPlayed === 0 ? -1 : r.gameShare),
      format: (r) => (r.gamesPlayed === 0 ? "-" : formatPct(r.gameShare)),
    },
    {
      key: "remaining",
      label: "残り試合数",
      sortValue: (r) => r.remaining ?? -1,
      format: (r) => (r.remaining === null ? "-" : String(r.remaining)),
    },
  ];

  if (gameLogsLoading) return <p className="loading">読み込み中...</p>;
  if (teams.length === 0) return <p className="empty-message">データがありません</p>;

  return (
    <div>
      <FilterBar axes={filterAxes} stateKey="standings:conditional" onClearAll={clearFilters} />
      {numberKind && (
        <p className="standings-number-condition">
          {numberKind === "count" ? "人数" : "点数"}：
          <NumberTextInput
            kind="count"
            aria-label={numberKind === "count" ? "外国籍の人数" : "点数"}
            value={String(numbers[numberKind])}
            onCommit={(t) => {
              const n = Math.floor(Number(t));
              if (!Number.isFinite(n) || n < 0) return;
              setNumbers((prev) => ({ ...prev, [numberKind]: n }));
              setCondition((c) => (conditionNumberKind(c) === numberKind ? ({ ...c, n } as ConditionalCondition) : c));
            }}
            size={4}
          />{" "}
          {numberKind === "count" ? "人" : "点"}
        </p>
      )}

      <h2>{describeCondition(condition)} 順位表</h2>
      {/* 見出しは条件（単一軸）のみ。シーズン・対象試合・チーム絞り込みは条件行で補う（Batch 5、DESIGN.md 99章） */}
      <ConditionLine
        conditions={composeLabels(
          `${season}シーズン`,
          gameTypeLabels("regular", null),
          selectedTeamIds === null
            ? multiSelectLabels("対象クラブ", [], "全クラブ")
            : selectedTeamIds.size === 0
              ? "対象クラブ: なし"
              : clubSelectionLabels(
                  "対象クラブ",
                  [...selectedTeamIds],
                  teamOptions.map((t) => ({ value: t.teamId, label: teamShortName(t.teamId, t.teamName) })),
                  divisionPresets(
                    teamOptions.map((t) => t.teamId),
                    (id) => divisionByTeamId.get(id),
                    league,
                  ).map((g) => ({ label: g.label, values: g.teamIds })),
                ),
        )}
      />
      {opponentWinRateCoverage && (
        <p className="standings-tab-note">
          相手が{MIN_GAMES_FOR_OPPONENT_WIN_RATE}試合以上を消化した時点の試合だけを数えます（対象 {opponentWinRateCoverage.counted}／
          {opponentWinRateCoverage.total}試合。クラブごとの試合を延べで数えています）。
        </p>
      )}
      {rows.length === 0 ? (
        <p className="empty-message">選択したチームがありません</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
            statScope="team"
            columns={columns}
            rows={rows}
            rowKey={(r) => r.team.teamId}
            defaultSortKey="rank"
            defaultSortDir="asc"
            linkTo={(r) => `/teams/${r.team.teamId}`}
            rowAccentColor={(r) => teamColors?.[r.team.teamId]?.primary}
          />
        </div>
      )}
      <GlossaryNote anchor={GLOSSARY_ANCHORS.conditionalStandings} label="条件別順位表" />
    </div>
  );
}
