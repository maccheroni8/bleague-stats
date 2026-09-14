import { useEffect, useMemo, useState } from "react";
import { SortableTable, type Column } from "./SortableTable";
import { TeamLogo } from "./TeamLogo";
import { TeamFilterBlock } from "./TeamFilterBlock";
import { formatSigned, formatWinPct } from "../lib/format";
import { safeDiv } from "../../shared/formulas";
import { currentStreak, formatTeamStreak } from "../../shared/teamRecords";
import { teamShortName } from "../../shared/teamNames";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import { isWeekdayGame } from "../lib/japaneseHolidays";
import { useLeagueSituationalContext } from "../lib/teamRankingData";
import {
  buildBackToBackStatus,
  buildBiweekStatus,
  matchesDivision,
  matchesMonth,
  matchesNewYearHalf,
  matchesOpponentWinRateTier,
  type BackToBackGame,
  type BiweekStatus,
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
 * buildBackToBackStatus・buildBiweekStatus）をそのまま再利用し、このファイルでは
 * 「どの条件が選ばれているか」の型と、それをTeamGameLog[]へ適用するロジックだけを持つ。
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
  | { kind: "biweek"; value: BiweekStatus }
  | { kind: "recent"; n: number }
  | { kind: "gamePhase"; value: "early" | "mid" | "late" }
  | { kind: "margin"; points: number };

/** 「序盤戦/中盤戦/終盤戦20試合」の窓の大きさ（固定） */
const GAME_PHASE_WINDOW = 20;

interface ConditionContext {
  teamId: string;
  season: string;
  opponentRecords?: Map<string, Map<string, RecordBeforeGame>>;
  divisionHistory?: DivisionHistoryFile | null;
  backToBackStatus?: Map<string, Map<string, BackToBackGame>>;
  biweekStatus?: Map<string, BiweekStatus>;
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
    case "biweek":
      return logs.filter((g) => ctx.biweekStatus?.get(g.scheduleKey) === condition.value);
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
    default:
      return null;
  }
}

/**
 * 「各地区上位3クラブ＋ワイルドカード上位2クラブ、計8クラブ」というDESIGN.md記載のルールは
 * 2025-26/2026-27シーズン（東西2地区制）限定で確認済み（マジックナンバー等プレーオフ進出条件は
 * 他シーズンの正式ルール未確認のためDESIGN.md上もスコープ外）。そのため東西2地区制の
 * シーズンのみ算出し、それ以外（3地区制の旧シーズン等）はnull（プレーオフ進出チームでの
 * 絞り込みボタン自体を出さない）を返す。ワイルドカード2枠は、地区上位3位以内に入れなかった
 * チームの中から、そのシーズンの全体順位（rank。公式タイブレークルール適用済み）が良い順に
 * 2チームを選ぶという素直な解釈で算出する（DESIGN.mdにワイルドカードの決定方法自体の明記は
 * 無いため、この解釈が誤っていれば要修正）
 */
function computePlayoffQualifiedTeamIds(teams: StandingsTeamSnapshot[]): Set<string> | null {
  const divisions = new Set(teams.map((t) => t.division).filter((d): d is Division => !!d));
  if (divisions.size !== 2 || !divisions.has("east") || !divisions.has("west")) return null;
  const top3 = teams.filter((t) => (t.divisionRank ?? 99) <= 3);
  const wildcard = teams
    .filter((t) => (t.divisionRank ?? 99) > 3)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 2);
  return new Set([...top3, ...wildcard].map((t) => t.teamId));
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
  const biweekStatus = useMemo(() => (summaries ? buildBiweekStatus(summaries) : undefined), [summaries]);

  const [condition, setCondition] = useState<ConditionalCondition>({ kind: "all" });
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string> | null>(null);
  const [filterExpanded, setFilterExpanded] = useState(false);

  // シーズンが変わったら条件・チーム絞り込みをリセットする（前シーズンの選択を引き継がない）
  useEffect(() => {
    setCondition({ kind: "all" });
    setSelectedTeamIds(null);
  }, [season]);

  const hasCentralDivision = teams.some((t) => t.division === "central");
  const playoffQualifiedIds = useMemo(() => computePlayoffQualifiedTeamIds(teams), [teams]);

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
      label: "バイウィーク（リーグ全体で10日以上試合が無い期間の前後）",
      options: [
        { key: "biweek-before", label: "バイウィーク前", condition: { kind: "biweek", value: "before" } },
        { key: "biweek-after", label: "バイウィーク明け", condition: { kind: "biweek", value: "after" } },
      ],
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

  const conditionKeyOf = (c: ConditionalCondition) => JSON.stringify(c);
  const isConditionActive = (c: ConditionalCondition) => conditionKeyOf(c) === conditionKeyOf(condition);
  const activateCondition = (c: ConditionalCondition) => setCondition(isConditionActive(c) ? { kind: "all" } : c);

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
        biweekStatus,
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
    biweekStatus,
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
      <div className="mode-toggle">
        <button className={condition.kind === "all" ? "active" : ""} onClick={() => setCondition({ kind: "all" })}>
          条件なし（シーズン全体）
        </button>
      </div>
      {conditionGroups.map((group) => (
        <div key={group.label}>
          <span className="condition-group-label">{group.label}</span>
          <div className="mode-toggle">
            {group.options.map((o) => (
              <button
                key={o.key}
                className={isConditionActive(o.condition) ? "active" : ""}
                onClick={() => activateCondition(o.condition)}
                type="button"
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <span className="condition-group-label">月別</span>
        <div className="mode-toggle">
          <select
            value={condition.kind === "month" ? String(condition.value) : ""}
            onChange={(e) => {
              const value = e.target.value;
              setCondition(value === "" ? { kind: "all" } : { kind: "month", value: Number(value) });
            }}
          >
            <option value="">選択してください</option>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
      </div>

      <span className="condition-group-label">チームの絞り込み</span>
      <div className="mode-toggle">
        <button className={selectedTeamIds === null ? "active" : ""} onClick={() => setSelectedTeamIds(null)}>
          全チーム
        </button>
        <button onClick={() => setSelectedTeamIds(new Set(teams.filter((t) => t.division === "east").map((t) => t.teamId)))}>
          東地区
        </button>
        {hasCentralDivision && (
          <button
            onClick={() => setSelectedTeamIds(new Set(teams.filter((t) => t.division === "central").map((t) => t.teamId)))}
          >
            中地区
          </button>
        )}
        <button onClick={() => setSelectedTeamIds(new Set(teams.filter((t) => t.division === "west").map((t) => t.teamId)))}>
          西地区
        </button>
        {playoffQualifiedIds && (
          <button onClick={() => setSelectedTeamIds(new Set(playoffQualifiedIds))}>プレーオフ進出圏（現時点）</button>
        )}
      </div>
      <TeamFilterBlock
        options={teamOptions}
        selected={selectedTeamIds}
        expanded={filterExpanded}
        onToggleExpanded={() => setFilterExpanded((v) => !v)}
        onToggle={(teamId) => {
          setSelectedTeamIds((prev) => {
            const base = prev ?? new Set(teamOptions.map((t) => t.teamId));
            const next = new Set(base);
            if (next.has(teamId)) next.delete(teamId);
            else next.add(teamId);
            return next;
          });
        }}
        onSelectAll={() => setSelectedTeamIds(null)}
        onSelectNone={() => setSelectedTeamIds(new Set())}
        heading="特定のチームで絞り込み"
      />

      {rows.length === 0 ? (
        <p className="empty-message">選択したチームがありません</p>
      ) : (
        <div className="table-scroll">
          <SortableTable
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
        {playoffQualifiedIds === null &&
          "「プレーオフ進出圏」ボタンは、東西2地区制（各地区上位3＋ワイルドカード上位2、計8チーム）が確認できているシーズンのみ表示されます。"}
      </p>
    </div>
  );
}
