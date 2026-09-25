import { useEffect, useMemo, useState, type ReactNode } from "react";
import { postseasonLabel } from "../../shared/gameType";
import { SeasonLink as Link } from "../components/SeasonLink";
import { TeamLogo } from "../components/TeamLogo";
import { usePageState, useSkipFirstEffectRun } from "../lib/pageStateCache";
import { ResponsiveTeamName } from "../components/ResponsiveTeamName";
import { FilterBar } from "../components/FilterBar";
import { simpleSelectAxis, teamMultiAxis, type FilterAxis } from "../lib/filterAxes";
import { ConditionTitle } from "../components/ConditionTitle";
import { composeLabels, multiSelectLabels } from "../lib/conditionLabels";
import { fetchDivisionHistory, fetchGameSummaries, fetchSchedule, fetchTeamColors, fetchTeamHistory, fetchTeams } from "../lib/data";
import { teamDivisionForSeason } from "../../scripts/lib/divisions";
import { useJsonData } from "../lib/useJsonData";
import { formatDateHeading } from "../lib/format";
import { teamShortName } from "../../shared/teamNames";
import type { GameSummary, GameType, TeamColors, UpcomingGameEntry } from "../../shared/types";

type ScheduleStatus = "final" | "live" | "upcoming";
type ScheduleView = "list" | "calendar";
type ScheduleStatusFilter = "all" | "upcoming" | "finished";

interface ScheduleRow {
  scheduleKey: string;
  date: string;
  homeTeamId?: string;
  homeTeamName: string;
  awayTeamId?: string;
  awayTeamName: string;
  status: ScheduleStatus;
  homeScore?: number;
  awayScore?: number;
  venue?: string;
  gameType?: GameType;
}

/**
 * games-summary.json（生データが揃っている試合）とschedule.jsonのupcomingGames（開催予定）を
 * 1つの日程一覧にまとめる。両方に載ることは無い前提（開催予定は生データが揃った時点で
 * scrape-schedule.tsのresolveUpcomingGamesが自然に除外する）だが、念のためscheduleKeyで重複除去する。
 * upcomingGamesはteamIdを持たないため、teamIdByNameで補う（チームカラー適用に使う）
 */
function toRows(summaries: GameSummary[], upcoming: UpcomingGameEntry[], teamIdByName: Map<string, string>): ScheduleRow[] {
  const summaryKeys = new Set(summaries.map((g) => g.scheduleKey));
  const finishedRows: ScheduleRow[] = summaries.map((g) => ({
    scheduleKey: g.scheduleKey,
    date: g.date,
    homeTeamId: g.homeTeamId,
    homeTeamName: g.homeTeamName,
    awayTeamId: g.awayTeamId,
    awayTeamName: g.awayTeamName,
    status: g.gameEndedFlg ? "final" : "live",
    homeScore: g.homeScore,
    awayScore: g.awayScore,
    venue: g.venue,
    gameType: g.gameType,
  }));
  const upcomingRows: ScheduleRow[] = upcoming
    .filter((g) => !summaryKeys.has(g.scheduleKey))
    .map((g) => ({
      scheduleKey: g.scheduleKey,
      date: g.date,
      homeTeamId: teamIdByName.get(g.homeTeamName),
      homeTeamName: g.homeTeamName,
      awayTeamId: teamIdByName.get(g.awayTeamName),
      awayTeamName: g.awayTeamName,
      status: "upcoming",
      venue: g.venue,
    }));
  return [...finishedRows, ...upcomingRows].sort(
    (a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey),
  );
}

function groupByDate(rows: ScheduleRow[]): [string, ScheduleRow[]][] {
  const map = new Map<string, ScheduleRow[]>();
  for (const row of rows) {
    const list = map.get(row.date) ?? [];
    list.push(row);
    map.set(row.date, list);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-");
  return `${y}年${Number(m)}月`;
}

function addMonthsToKey(monthKey: string, delta: number): string {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/** 開催予定日データが無いシーズンでも壊れないよう、フォールバックはJST基準の今日の月にする */
function defaultCalendarMonth(rows: ScheduleRow[]): string {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  if (rows.length === 0) return monthKeyOf(today);
  const dates = rows.map((r) => r.date).sort();
  const min = dates[0]!;
  const max = dates[dates.length - 1]!;
  if (today < min) return monthKeyOf(min);
  if (today > max) return monthKeyOf(max);
  return monthKeyOf(today);
}

interface CalendarCell {
  date: string;
  day: number;
  inMonth: boolean;
}

/** 月曜始まりのカレンダー格子（週数は月によって可変）をUTC基準の日付計算で組み立てる */
function buildMonthGrid(monthKey: string): CalendarCell[][] {
  const [y, m] = monthKey.split("-").map(Number) as [number, number];
  const firstOfMonth = new Date(Date.UTC(y, m - 1, 1));
  const firstWeekday = firstOfMonth.getUTCDay();
  const mondayOffset = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const totalDays = mondayOffset + daysInMonth;
  const weekCount = Math.ceil(totalDays / 7);

  const weeks: CalendarCell[][] = [];
  let cursor = new Date(Date.UTC(y, m - 1, 1 - mondayOffset));
  for (let w = 0; w < weekCount; w++) {
    const week: CalendarCell[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        date: cursor.toISOString().slice(0, 10),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCFullYear() === y && cursor.getUTCMonth() === m - 1,
      });
      cursor = new Date(cursor.getTime() + 86_400_000);
    }
    weeks.push(week);
  }
  return weeks;
}

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"];

export function SchedulePage({ season }: { season: string }) {
  const {
    data: summaries,
    loading: summariesLoading,
    error,
  } = useJsonData(() => fetchGameSummaries(season), [season]);
  // schedule.jsonの取得に失敗しても開催予定が出ないだけで日程ページ自体は表示できるようにする
  const { data: schedule, loading: scheduleLoading } = useJsonData(() => fetchSchedule(season), [season]);
  const { data: teams } = useJsonData(() => fetchTeams(season), [season]);
  const { data: teamColors } = useJsonData(() => fetchTeamColors(), []);
  const [jumpDate, setJumpDate] = useState("");
  // 表示切り替え・クラブ絞り込み・カレンダーの月・ステータス絞り込みは、試合詳細などへ移動してブラウザバックで戻ったときに
  // 直前の状態を復元する（usePageState。個人詳細・チーム詳細・ランキングと同じ仕組み。キーはシーズンごと）
  const pk = (field: string) => `schedule:${season}:${field}`;
  const [view, setView] = usePageState<ScheduleView>(pk("view"), "list");
  // null = 全チーム選択（絞り込みなし）。個別に外したチームだけをSetで管理する
  const [selectedTeamIds, setSelectedTeamIds] = usePageState<Set<string> | null>(pk("selectedTeamIds"), null);
  const [calendarMonth, setCalendarMonth] = usePageState<string | null>(pk("calendarMonth"), null);
  // リスト表示のみに適用する試合ステータスの絞り込み（カレンダー表示は月単位のため対象外）
  const [statusFilter, setStatusFilter] = usePageState<ScheduleStatusFilter>(pk("statusFilter"), "all");

  // シーズンが変わったらチームフィルタ・カレンダー月・ステータス絞り込みの選択状態をリセットする
  // （前シーズンのチーム構成・月範囲・絞り込み条件は引き継がない）。初回マウント時は、usePageStateで復元した値を
  // 上書きしないようスキップする（src/lib/pageStateCache.ts参照）
  const skipFirstSeasonReset = useSkipFirstEffectRun(season);
  useEffect(() => {
    if (skipFirstSeasonReset()) return;
    setSelectedTeamIds(null);
    setCalendarMonth(null);
    setStatusFilter("all");
  }, [season]);

  // 開催前のシーズンは teams.json に試合をしたクラブしか無いため、前シーズンのクラブ一覧と改称の履歴（team-history.json）で
  // 名前→TeamIDを補う（開催予定の試合にもロゴ・チームカラー・略称を出すため）
  const prevSeason = `${Number(season.slice(0, 4)) - 1}-${season.slice(2, 4)}`;
  const { data: prevTeams } = useJsonData(
    () => (season > "2016-17" ? fetchTeams(prevSeason).catch(() => []) : Promise.resolve([])),
    [season, prevSeason],
  );
  const { data: teamHistory } = useJsonData(() => fetchTeamHistory().catch(() => []), []);
  // クラブの複数選択の「◯地区を選択」ボタン用（そのシーズンの地区構成）
  const { data: divisionHistory } = useJsonData(() => fetchDivisionHistory().catch(() => null), []);
  const teamIdByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of prevTeams ?? []) map.set(t.teamName, t.teamId);
    for (const h of teamHistory ?? []) for (const n of h.names) map.set(n.name, h.teamId);
    for (const t of teams ?? []) map.set(t.teamName, t.teamId);
    return map;
  }, [teams, prevTeams, teamHistory]);
  const rows = useMemo(
    () => (summaries ? toRows(summaries, schedule?.upcomingGames ?? [], teamIdByName) : []),
    [summaries, schedule, teamIdByName],
  );

  const teamOptions = useMemo(
    () =>
      (teams ?? [])
        .map((t) => ({ teamId: t.teamId, teamName: t.teamName }))
        .sort((a, b) => teamShortName(a.teamId, a.teamName).localeCompare(teamShortName(b.teamId, b.teamName), "ja")),
    [teams],
  );

  const filteredRows = useMemo(() => {
    if (selectedTeamIds === null) return rows;
    return rows.filter(
      (r) => (r.homeTeamId && selectedTeamIds.has(r.homeTeamId)) || (r.awayTeamId && selectedTeamIds.has(r.awayTeamId)),
    );
  }, [rows, selectedTeamIds]);

  // ステータス絞り込みはリスト表示のみに適用する（カレンダー表示はfilteredRowsをそのまま使う）。
  // 進行中（live）の試合はまだ結果が確定していないため「今後の試合」側に含める
  const listRows = useMemo(() => {
    if (statusFilter === "all") return filteredRows;
    if (statusFilter === "upcoming") return filteredRows.filter((r) => r.status === "upcoming" || r.status === "live");
    return filteredRows.filter((r) => r.status === "final");
  }, [filteredRows, statusFilter]);

  const groups = useMemo(() => groupByDate(listRows), [listRows]);

  const months = useMemo(() => [...new Set(listRows.map((r) => monthKeyOf(r.date)))].sort(), [listRows]);
  const firstDateOfMonth = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of listRows) {
      const mk = monthKeyOf(row.date);
      if (!map.has(mk)) map.set(mk, row.date);
    }
    return map;
  }, [listRows]);

  const defaultMonth = useMemo(() => defaultCalendarMonth(rows), [rows]);
  const effectiveMonth = calendarMonth ?? defaultMonth;

  // 読み込み中・エラーの早期リターンも v2 の範囲に入れる
  const v2 = (node: ReactNode) => (
    <div className="schedule-page" data-design="v2">
      {node}
    </div>
  );
  if (summariesLoading || scheduleLoading) return v2(<p className="loading">読み込み中...</p>);
  if (error) return v2(<p className="error-message">{error}</p>);
  if (rows.length === 0) return v2(<p className="empty-message">日程データがありません</p>);

  const handleDateJump = (value: string) => {
    setJumpDate(value);
    document.getElementById(value)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  const handleMonthJump = (monthKey: string) => {
    const date = firstDateOfMonth.get(monthKey);
    if (date) document.getElementById(date)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  // 表示中の日程に効いている条件（Batch 5、DESIGN.md 99章）。ステータス絞り込みはリスト表示のみ、
  // 表示月はカレンダー表示のみに効く。日程には確定済み・予定・進行中の全試合（レギュラー+プレーオフ）が入る
  const scheduleClubLabels =
    selectedTeamIds === null
      ? multiSelectLabels("対象クラブ", [], "全クラブ")
      : selectedTeamIds.size === 0
        ? ["対象クラブ: なし"]
        : multiSelectLabels(
            "対象クラブ",
            teamOptions.filter((t) => selectedTeamIds.has(t.teamId)).map((t) => teamShortName(t.teamId, t.teamName)),
            "全クラブ",
          );
  const scheduleConditions = composeLabels(
    view === "list" ? "リスト表示" : "カレンダー表示",
    view === "list" ? { all: "全試合", upcoming: "今後の試合", finished: "終了した試合" }[statusFilter] : formatMonthLabel(effectiveMonth),
    `レギュラー+${postseasonLabel(season)}`,
    scheduleClubLabels,
  );

  // フィルタバー（DESIGN.md 105章 B6）。リスト/カレンダーの切替は表示切替のまま。ステータスはリスト表示のみに効く
  const filterAxes: FilterAxis[] = [
    ...(view === "list"
      ? [
          simpleSelectAxis({
            id: "status",
            label: "ステータス",
            options: [
              { value: "all", label: "すべて" },
              { value: "upcoming", label: "今後の試合" },
              { value: "finished", label: "終了した試合" },
            ],
            value: statusFilter,
            onChange: (v) => setStatusFilter(v as ScheduleStatusFilter),
          }),
        ]
      : []),
    teamMultiAxis({
      options: teamOptions,
      selected: selectedTeamIds,
      onChange: setSelectedTeamIds,
      divisionOf: (id) => teamDivisionForSeason(divisionHistory, id, season),
    }),
  ];
  const clearFilters = () => {
    setStatusFilter("all");
    setSelectedTeamIds(null);
  };

  return (
    <div className="schedule-page" data-design="v2">
      <h1>日程</h1>
      <p className="page-subtitle">{season}シーズン</p>

      <div className="schedule-toolbar">
        <div className="mode-toggle">
          <button type="button" className={view === "list" ? "active" : ""} onClick={() => setView("list")}>
            リスト表示
          </button>
          <button type="button" className={view === "calendar" ? "active" : ""} onClick={() => setView("calendar")}>
            カレンダー表示
          </button>
        </div>
      </div>

      <FilterBar axes={filterAxes} stateKey="schedule" onClearAll={clearFilters} />

      <ConditionTitle title={`${season}シーズン 日程`} conditions={scheduleConditions} />

      {view === "list" ? (
        listRows.length === 0 ? (
          <p className="empty-message">
            {filteredRows.length === 0 ? "選択したクラブの試合がありません" : "該当する試合がありません"}
          </p>
        ) : (
          <>
          <div className="schedule-jump-controls">
            <label>
              日付でジャンプ: <input type="date" value={jumpDate} onChange={(e) => handleDateJump(e.target.value)} />
            </label>
            <label>
              月でジャンプ:{" "}
              <select defaultValue="" onChange={(e) => e.target.value && handleMonthJump(e.target.value)}>
                <option value="" disabled>
                  選択してください
                </option>
                {months.map((mk) => (
                  <option key={mk} value={mk}>
                    {formatMonthLabel(mk)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {groups.map(([date, gamesOnDate]) => (
            <section key={date} id={date} className="schedule-date-group">
              <h2>{formatDateHeading(date)}</h2>
              <div className="table-scroll">
                <table className="sortable-table schedule-table">
                  <colgroup>
                    <col className="schedule-col-home" />
                    <col className="schedule-col-result" />
                    <col className="schedule-col-away" />
                    <col className="schedule-col-venue" />
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="align-left">ホーム</th>
                      <th className="align-center">結果</th>
                      <th className="align-right">アウェイ</th>
                      <th className="align-left">会場</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gamesOnDate.map((row) => (
                      <ScheduleRowView key={row.scheduleKey} row={row} teamColors={teamColors ?? undefined} />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))}
          </>
        )
      ) : filteredRows.length === 0 ? (
        <p className="empty-message">選択したチームの試合がありません</p>
      ) : (
        <CalendarView
          rows={filteredRows}
          month={effectiveMonth}
          onPrevMonth={() => setCalendarMonth(addMonthsToKey(effectiveMonth, -1))}
          onNextMonth={() => setCalendarMonth(addMonthsToKey(effectiveMonth, 1))}
        />
      )}
    </div>
  );
}

function MaybeLink({ to, children }: { to?: string; children: ReactNode }) {
  // 開催予定（リンクなし）でも、ロゴとチーム名の間隔などの並べ方はリンクと同じにする（schedule-cell-inner）
  return to ? (
    <Link to={to} className="cell-link">
      {children}
    </Link>
  ) : (
    <span className="schedule-cell-inner">{children}</span>
  );
}

function ScheduleRowView({ row, teamColors }: { row: ScheduleRow; teamColors?: Record<string, TeamColors> }) {
  // 開催予定はまだ生データ（試合詳細ページのソース）が無いのでリンクしない
  const linkTo = row.status === "upcoming" ? undefined : `/games/${row.scheduleKey}`;
  const homeColor = row.homeTeamId ? teamColors?.[row.homeTeamId]?.primary : undefined;
  const awayColor = row.awayTeamId ? teamColors?.[row.awayTeamId]?.primary : undefined;
  return (
    <tr className={`schedule-row status-${row.status}`}>
      <td className="align-left schedule-team-cell">
        <MaybeLink to={linkTo}>
          {row.homeTeamId && <TeamLogo teamId={row.homeTeamId} size={24} />}
          <span className="schedule-team-chip" style={homeColor ? { borderLeftColor: homeColor } : undefined}>
            <ResponsiveTeamName teamId={row.homeTeamId ?? ""} name={row.homeTeamName} />
          </span>
        </MaybeLink>
      </td>
      <td className="align-center">
        <MaybeLink to={linkTo}>
          {row.status === "final" && `${row.homeScore}-${row.awayScore}`}
          {row.status === "live" && <span className="live-badge">進行中</span>}
          {row.status === "upcoming" && <span className="upcoming-badge">予定</span>}
          {row.gameType === "playoff" && <span className="playoff-badge">PO</span>}
        </MaybeLink>
      </td>
      <td className="align-right schedule-team-cell">
        <MaybeLink to={linkTo}>
          <span className="schedule-team-chip" style={awayColor ? { borderLeftColor: awayColor } : undefined}>
            <ResponsiveTeamName teamId={row.awayTeamId ?? ""} name={row.awayTeamName} />
          </span>
          {row.awayTeamId && <TeamLogo teamId={row.awayTeamId} size={24} />}
        </MaybeLink>
      </td>
      <td className="align-left schedule-venue-cell">{row.venue ?? "-"}</td>
    </tr>
  );
}

function CalendarView({
  rows,
  month,
  onPrevMonth,
  onNextMonth,
}: {
  rows: ScheduleRow[];
  month: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const gamesByDate = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const row of rows) {
      if (monthKeyOf(row.date) !== month) continue;
      const list = map.get(row.date) ?? [];
      list.push(row);
      map.set(row.date, list);
    }
    return map;
  }, [rows, month]);

  const weeks = useMemo(() => buildMonthGrid(month), [month]);

  return (
    <div className="schedule-calendar">
      <div className="calendar-header">
        <button type="button" onClick={onPrevMonth} aria-label="前の月">
          ‹
        </button>
        <span className="calendar-month-label">{formatMonthLabel(month)}</span>
        <button type="button" onClick={onNextMonth} aria-label="次の月">
          ›
        </button>
      </div>
      <div className="table-scroll schedule-calendar-scroll">
        <div className="calendar-grid">
          {WEEKDAY_LABELS.map((w) => (
            <div key={w} className="calendar-weekday">
              {w}
            </div>
          ))}
          {weeks.flat().map((cell) => (
            <div key={cell.date} className={`calendar-cell${cell.inMonth ? "" : " calendar-cell-outside"}`}>
              <div className="calendar-cell-date">{cell.day}</div>
              <div className="calendar-cell-games">
                {(gamesByDate.get(cell.date) ?? []).map((row) => (
                  <CalendarGameChip key={row.scheduleKey} row={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CalendarGameChip({ row }: { row: ScheduleRow }) {
  const linkTo = row.status === "upcoming" ? undefined : `/games/${row.scheduleKey}`;
  const scoreLabel = row.status === "final" ? ` ${row.homeScore}-${row.awayScore}` : "";
  const title = `${row.homeTeamName}${scoreLabel} vs ${row.awayTeamName}`;
  const middle =
    row.status === "final" ? (
      <span className="calendar-game-chip-score">
        {row.homeScore}-{row.awayScore}
      </span>
    ) : (
      <span className="calendar-game-chip-vs">-</span>
    );
  const content = (
    <span className={`calendar-game-chip status-${row.status}`} title={title}>
      {row.homeTeamId ? <TeamLogo teamId={row.homeTeamId} size={32} /> : <span className="calendar-game-chip-noimg" />}
      {middle}
      {row.awayTeamId ? <TeamLogo teamId={row.awayTeamId} size={32} /> : <span className="calendar-game-chip-noimg" />}
    </span>
  );
  return linkTo ? (
    <Link to={linkTo} className="calendar-game-chip-link">
      {content}
    </Link>
  ) : (
    content
  );
}
