import { useEffect, useMemo, useState } from "react";
import { postseasonLabel } from "../../shared/gameType";
import { postseasonFormat, postseasonQualifiedTeamIds } from "../../shared/postseasonFormat";
import { SortableTable, type Column } from "./SortableTable";
import { TeamLogo } from "./TeamLogo";
import { FilterBar } from "./FilterBar";
import { simpleSelectAxis, teamMultiAxis, type FilterAxis, type FilterAxisOption } from "../lib/filterAxes";
import { ConditionLine } from "./ConditionTitle";
import { composeLabels, gameTypeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { formatSigned, formatWinPct } from "../lib/format";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak } from "../../shared/teamRecords";
import { teamShortName } from "../../shared/teamNames";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import { DIVISION_LABELS } from "../lib/divisionGroups";
import { isWeekdayGame } from "../lib/japaneseHolidays";
import { useLeagueSituationalContext } from "../lib/teamRankingData";
import {
  buildBackToBackStatus,
  buildBiweekPeriods,
  matchesBiweekPeriod,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  type BackToBackGame,
  type BiweekPeriod,
  type RecordBeforeGame,
} from "../lib/situational";
import type {
  Division,
  DivisionHistoryFile,
  StandingsTeamSnapshot,
  TeamColors,
  TeamGameLog,
  UpcomingGameEntry,
} from "../../shared/types";

/**
 * 「条件別順位表」タブが扱う単一選択の条件。SituationalFilterPicker（AND合成の複数選択）とは
 * 異なり、こちらは「この条件だけで見た順位表」を1つずつ切り替えて見る用途のため、常に
 * どれか1つ（または条件なし="all"）だけがアクティブになる。既存のsituational.tsのマッチャー
 * （matchesDivision・matchesMonth・matchesNewYearHalf・matchesOpponentWinRateTier・
 * buildBackToBackStatus・buildBiweekPeriods/matchesBiweekPeriod）をそのまま再利用し、
 * このファイルでは「どの条件が選ばれているか」の型と、それをTeamGameLog[]へ適用する
 * ロジックだけを持つ。
 */
export type ConditionalCondition =
  | { kind: "all" }
  | { kind: "newYear"; half: "before" | "after" }
  | { kind: "homeAway"; value: "home" | "away" }
  | { kind: "division"; value: Division }
  | { kind: "weekday"; value: boolean }
  | { kind: "month"; value: number }
  | { kind: "opponentWinRate"; tier: "under50" | "atLeast50" | "atLeast60" }
  | { kind: "backToBack"; value: BackToBackGame }
  // シーズンをバイウィーク（10日以上の試合空白期間）で区切った区間の1つ。区間自体は
  // シーズン・カテゴリごとに動的に検出されるため、区間の内容（ラベル・日付範囲）を
  // 条件の値として直接持たせる（buildBiweekPeriods参照）
  | { kind: "biweekPeriod"; index: number; period: BiweekPeriod }
  | { kind: "recent"; n: number }
  | { kind: "gamePhase"; value: "early" | "mid" | "late" }
  | { kind: "margin"; points: number };

/** 「序盤戦/中盤戦/終盤戦20試合」の窓の大きさ（固定） */
const GAME_PHASE_WINDOW = 20;

/**
 * 現在選択中の条件を、表の上のタイトル（「{ラベル} 順位表」）用に1行で表す。各ボタンの
 * 表示文言（conditionGroupsのoption.label）と揃えている
 */
function describeCondition(condition: ConditionalCondition): string {
  switch (condition.kind) {
    case "all":
      return "シーズン全体";
    case "newYear":
      return condition.half === "before" ? "年明け前" : "年明け後";
    case "homeAway":
      return condition.value === "home" ? "ホーム" : "アウェイ";
    case "division":
      return `対${DIVISION_LABELS[condition.value]}`;
    case "weekday":
      return condition.value ? "平日開催" : "休日開催";
    case "month":
      return `${condition.value}月`;
    case "opponentWinRate":
      return condition.tier === "under50" ? "対5割未満" : condition.tier === "atLeast50" ? "対5割以上" : "対6割以上";
    case "backToBack":
      return condition.value === "GAME1" ? "連戦時GAME1" : "連戦時GAME2";
    case "biweekPeriod":
      return condition.period.label;
    case "recent":
      return `直近${condition.n}試合`;
    case "gamePhase":
      return condition.value === "early"
        ? `序盤戦${GAME_PHASE_WINDOW}試合`
        : condition.value === "late"
          ? `終盤戦${GAME_PHASE_WINDOW}試合`
          : `中盤戦${GAME_PHASE_WINDOW}試合`;
    case "margin":
      return condition.points === 3 ? "1POS差（3点差）決着試合" : "2POS差（6点差）決着試合";
  }
}

interface ConditionContext {
  teamId: string;
  season: string;
  opponentRecords?: Map<string, Map<string, RecordBeforeGame>>;
  divisionHistory?: DivisionHistoryFile | null;
  backToBackStatus?: Map<string, Map<string, BackToBackGame>>;
}

/** 日付昇順ソート済みのTeamGameLog[]に、選択中の条件を1つ適用する */
function applyConditionalCondition(
  logs: TeamGameLog[],
  condition: ConditionalCondition,
  ctx: ConditionContext,
): TeamGameLog[] {
  switch (condition.kind) {
    case "all":
      return logs;
    case "newYear":
      return logs.filter((g) => matchesNewYearHalf(g, condition.half));
    case "homeAway":
      return logs.filter((g) => (condition.value === "home" ? g.isHome : !g.isHome));
    case "division":
      return logs.filter((g) => matchesDivision(g, condition.value, ctx.divisionHistory, ctx.season));
    case "weekday":
      return logs.filter((g) => isWeekdayGame(g.date) === condition.value);
    case "month":
      return logs.filter((g) => matchesMonth(g, condition.value));
    case "opponentWinRate":
      return logs.filter((g) => matchesOpponentWinRateTier(g, condition.tier, ctx.opponentRecords));
    case "backToBack":
      return logs.filter((g) => ctx.backToBackStatus?.get(g.scheduleKey)?.get(ctx.teamId) === condition.value);
    case "biweekPeriod":
      return logs.filter((g) => matchesBiweekPeriod(g, condition.period));
    case "recent":
      return logs.slice(Math.max(0, logs.length - condition.n));
    case "gamePhase": {
      const n = GAME_PHASE_WINDOW;
      if (condition.value === "early") return logs.slice(0, n);
      if (condition.value === "late") return logs.slice(Math.max(0, logs.length - n));
      const start = Math.max(0, Math.floor((logs.length - n) / 2));
      return logs.slice(start, start + n);
    }
    case "margin":
      return logs.filter((g) => Math.abs(g.teamScore - g.opponentScore) <= condition.points);
  }
}

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
        return !!oppId && teamDivisionForSeason(divisionHistory, oppId, season) === condition.value;
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
  rank: number;
  gamesPlayed: number;
  wins: number;
  losses: number;
  winPct: number;
  pts: number;
  oppPts: number;
  pointDiff: number;
  streakLabel: string;
  remaining: number | null;
}

interface ConditionOption {
  key: string;
  label: string;
  condition: ConditionalCondition;
}

interface ConditionGroup {
  label: string;
  options: ConditionOption[];
}

export function ConditionalStandingsTable({
  season,
  teams,
  gameLogsByTeam,
  gameLogsLoading,
  upcomingGames,
  teamColors,
}: {
  season: string;
  teams: StandingsTeamSnapshot[];
  gameLogsByTeam: Map<string, TeamGameLog[]> | null;
  gameLogsLoading: boolean;
  upcomingGames: UpcomingGameEntry[];
  teamColors?: Record<string, TeamColors>;
}) {
  const { summaries, divisionHistory, opponentRecords } = useLeagueSituationalContext(season);
  const backToBackStatus = useMemo(() => (summaries ? buildBackToBackStatus(summaries) : undefined), [summaries]);
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

  const hasCentralDivision = teams.some((t) => t.division === "central");
  // シーズンごとの出場形式（各地区の上位○クラブ＋ワイルドカード○クラブ。shared/postseasonFormat.ts）で算出する。
  // 形式の無いシーズン（CS中止の2019-20）と地区データの無いシーズンは null（進出圏のボタン自体を出さない）
  const format = postseasonFormat(season);
  const playoffQualifiedIds = useMemo(
    () => (format && teams.some((t) => t.division) ? postseasonQualifiedTeamIds(teams, format) : null),
    [teams, format],
  );

  const teamIdByName = useMemo(() => new Map(teams.map((t) => [t.teamName, t.teamId])), [teams]);
  const teamOptions = useMemo(
    () =>
      teams
        .map((t) => ({ teamId: t.teamId, teamName: t.teamName }))
        .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja")),
    [teams],
  );

  const conditionGroups: ConditionGroup[] = [
    {
      label: "年明け前後",
      options: [
        { key: "newYear-before", label: "年明け前", condition: { kind: "newYear", half: "before" } },
        { key: "newYear-after", label: "年明け後", condition: { kind: "newYear", half: "after" } },
      ],
    },
    {
      label: "会場",
      options: [
        { key: "home", label: "ホーム", condition: { kind: "homeAway", value: "home" } },
        { key: "away", label: "アウェイ", condition: { kind: "homeAway", value: "away" } },
      ],
    },
    {
      label: "対戦相手の地区",
      options: [
        { key: "div-east", label: "対東地区", condition: { kind: "division", value: "east" } },
        ...(hasCentralDivision
          ? [{ key: "div-central", label: "対中地区", condition: { kind: "division", value: "central" } as ConditionalCondition }]
          : []),
        { key: "div-west", label: "対西地区", condition: { kind: "division", value: "west" } },
      ],
    },
    {
      label: "曜日",
      options: [
        { key: "weekday", label: "平日開催", condition: { kind: "weekday", value: true } },
        { key: "holiday", label: "休日開催", condition: { kind: "weekday", value: false } },
      ],
    },
    {
      label: "対戦相手の強さ（その時点までの勝率）",
      options: [
        { key: "oppwin-under50", label: "対5割未満", condition: { kind: "opponentWinRate", tier: "under50" } },
        { key: "oppwin-50", label: "対5割以上", condition: { kind: "opponentWinRate", tier: "atLeast50" } },
        { key: "oppwin-60", label: "対6割以上", condition: { kind: "opponentWinRate", tier: "atLeast60" } },
      ],
    },
    {
      label: "連戦（中1日以内の連戦）",
      options: [
        { key: "b2b-1", label: "連戦時GAME1", condition: { kind: "backToBack", value: "GAME1" } },
        { key: "b2b-2", label: "連戦時GAME2", condition: { kind: "backToBack", value: "GAME2" } },
      ],
    },
    {
      label: "バイウィーク（リーグ全体で10日以上試合が無い期間で区切った区間）",
      options: biweekPeriods.map((period, index) => ({
        key: `biweek-${index}`,
        label: period.label,
        condition: { kind: "biweekPeriod", index, period } as ConditionalCondition,
      })),
    },
    {
      label: "直近の試合数",
      options: [
        { key: "recent5", label: "直近5試合", condition: { kind: "recent", n: 5 } },
        { key: "recent10", label: "直近10試合", condition: { kind: "recent", n: 10 } },
      ],
    },
    {
      label: "シーズンの時期",
      options: [
        { key: "phase-early", label: "序盤戦20試合", condition: { kind: "gamePhase", value: "early" } },
        { key: "phase-mid", label: "中盤戦20試合", condition: { kind: "gamePhase", value: "mid" } },
        { key: "phase-late", label: "終盤戦20試合", condition: { kind: "gamePhase", value: "late" } },
      ],
    },
    {
      label: "点差決着",
      options: [
        { key: "margin-1pos", label: "1POS差（3点差）決着試合", condition: { kind: "margin", points: 3 } },
        { key: "margin-2pos", label: "2POS差（6点差）決着試合", condition: { kind: "margin", points: 6 } },
      ],
    },
  ];

  // フィルタバー（DESIGN.md 105章 B6）。条件は排他の単一選択なので、グループ付きの1つのドロップダウンにする
  // （選ぶと「条件」のチップが1つだけ出る）。月別も同じドロップダウンの1グループにまとめた
  const conditionKeyOf = (c: ConditionalCondition) => JSON.stringify(c);
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
        : (conditionGroups.flatMap((g) => g.options).find((o) => conditionKeyOf(o.condition) === conditionKeyOf(condition))?.key ?? "all");
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
      presets: [
        ...(playoffQualifiedIds ? [{ label: `${postseasonLabel(season)}進出圏（現時点）`, teamIds: [...playoffQualifiedIds] }] : []),
      ],
    }),
  ];
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
        opponentRecords,
        divisionHistory,
        backToBackStatus,
      });
      const wins = filtered.filter((g) => g.win).length;
      const losses = filtered.length - wins;
      const pts = filtered.reduce((s, g) => s + g.teamScore, 0);
      const oppPts = filtered.reduce((s, g) => s + g.opponentScore, 0);
      const remaining = computeRemainingCount(team.teamName, condition, upcomingGames, teamIdByName, divisionHistory, season);
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
        remaining,
      };
    });
    return built
      .filter((r) => !selectedTeamIds || selectedTeamIds.has(r.team.teamId))
      .sort((a, b) => b.winPct - a.winPct || b.pointDiff - a.pointDiff)
      .map((r, i) => ({ ...r, rank: i + 1 }));
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
  ]);

  const columns: Column<ConditionalRow>[] = [
    { key: "rank", label: "順位", sortValue: (r) => r.rank, format: (r) => String(r.rank) },
    {
      key: "team",
      label: "チーム",
      align: "left",
      sortValue: (r) => r.team.teamName,
      render: (r) => (
        <span className="team-name-cell">
          <TeamLogo teamId={r.team.teamId} size={20} />
          {r.team.teamName}
        </span>
      ),
    },
    { key: "g", label: "試合数", sortValue: (r) => r.gamesPlayed, format: (r) => String(r.gamesPlayed) },
    { key: "wins", label: "勝", sortValue: (r) => r.wins, format: (r) => String(r.wins) },
    { key: "losses", label: "負", sortValue: (r) => r.losses, format: (r) => String(r.losses), higherIsBetter: false },
    { key: "winPct", label: "勝率", sortValue: (r) => r.winPct, format: (r) => formatWinPct(r.winPct) },
    { key: "pts", label: "得点", sortValue: (r) => r.pts, format: (r) => String(r.pts) },
    { key: "oppPts", label: "失点", sortValue: (r) => r.oppPts, format: (r) => String(r.oppPts), higherIsBetter: false },
    { key: "pointDiff", label: "得失点差", sortValue: (r) => r.pointDiff, format: (r) => formatSigned(r.pointDiff, 0) },
    { key: "streak", label: "連勝/連敗", sortValue: (r) => r.wins - r.losses, format: (r) => r.streakLabel },
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
              : multiSelectLabels(
                  "対象クラブ",
                  teamOptions.filter((t) => selectedTeamIds.has(t.teamId)).map((t) => teamShortName(t.teamId, t.teamName)),
                  "全クラブ",
                ),
        )}
      />
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
      <p className="row-note">
        順位は勝率降順→得失点差降順の簡易タイブレークで算出（「順位表」タブの公式タイブレーク
        ルールとは異なります）。連勝/連敗は選択中の条件に該当する試合だけを対象に算出しています。
        残り試合数は、日程が既に確定していて未来の情報だけで判定できる条件（会場・地区・曜日・
        月別・年明け前後）でのみ表示され、それ以外の条件では「-」になります。
        {format
          ? `「${postseasonLabel(season)}進出圏」は、各地区の上位${format.divisionTop}クラブと、それ以外のクラブのうち全体順位上位${format.wildcardSlots}クラブ（ワイルドカード）の計8クラブです。`
          : `このシーズンは${postseasonLabel(season)}が開催されなかったため、「${postseasonLabel(season)}進出圏」ボタンは表示されません。`}
      </p>
    </div>
  );
}
