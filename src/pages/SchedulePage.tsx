import { useEffect, useMemo, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { TeamLogo } from "../components/TeamLogo";
import { fetchGameSummaries, fetchSchedule, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { formatDateHeading } from "../lib/format";
import { teamShortName } from "../../shared/teamNames";
import type { GameSummary, GameType, TeamColors, UpcomingGameEntry } from "../../shared/types";

type ScheduleStatus = "final" | "live" | "upcoming";
type ScheduleView = "list" | "calendar";

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
  const [view, setView] = useState<ScheduleView>("list");
  // null = 全チーム選択（絞り込みなし）。個別に外したチームだけをSetで管理する
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string> | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<string | null>(null);

  // シーズンが変わったらチームフィルタ・カレンダー月の選択状態をリセットする（前シーズンの
  // チーム構成・月範囲は引き継がない）
  useEffect(() => {
    setSelectedTeamIds(null);
    setCalendarMonth(null);
  }, [season]);

  const teamIdByName = useMemo(() => new Map((teams ?? []).map((t) => [t.teamName, t.teamId])), [teams]);
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
  const allTeamIds = useMemo(() => new Set(teamOptions.map((t) => t.teamId)), [teamOptions]);

  const filteredRows = useMemo(() => {
    if (selectedTeamIds === null) return rows;
    return rows.filter(
      (r) => (r.homeTeamId && selectedTeamIds.has(r.homeTeamId)) || (r.awayTeamId && selectedTeamIds.has(r.awayTeamId)),
    );
  }, [rows, selectedTeamIds]);

  const groups = useMemo(() => groupByDate(filteredRows), [filteredRows]);

  const months = useMemo(() => [...new Set(filteredRows.map((r) => monthKeyOf(r.date)))].sort(), [filteredRows]);
  const firstDateOfMonth = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of filteredRows) {
      const mk = monthKeyOf(row.date);
      if (!map.has(mk)) map.set(mk, row.date);
    }
    return map;
  }, [filteredRows]);

  const defaultMonth = useMemo(() => defaultCalendarMonth(rows), [rows]);
  const effectiveMonth = calendarMonth ?? defaultMonth;

  if (summariesLoading || scheduleLoading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (rows.length === 0) return <p className="empty-message">日程データがありません</p>;

  const handleDateJump = (value: string) => {
    setJumpDate(value);
    document.getElementById(value)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  const handleMonthJump = (monthKey: string) => {
    const date = firstDateOfMonth.get(monthKey);
    if (date) document.getElementById(date)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  const toggleTeam = (teamId: string) => {
    setSelectedTeamIds((prev) => {
      const base = prev ?? new Set(allTeamIds);
      const next = new Set(base);
      if (next.has(teamId)) next.delete(teamId);
      else next.add(teamId);
      return next;
    });
  };

  return (
    <div>
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

      <TeamFilterBlock
        options={teamOptions}
        selected={selectedTeamIds}
        onToggle={toggleTeam}
        onSelectAll={() => setSelectedTeamIds(null)}
        onSelectNone={() => setSelectedTeamIds(new Set())}
      />

      {filteredRows.length === 0 ? (
        <p className="empty-message">選択したチームの試合がありません</p>
      ) : view === "list" ? (
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

function TeamFilterBlock({
  options,
  selected,
  onToggle,
  onSelectAll,
  onSelectNone,
}: {
  options: { teamId: string; teamName: string }[];
  selected: Set<string> | null;
  onToggle: (teamId: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}) {
  if (options.length === 0) return null;
  return (
    <div className="filter-block schedule-team-filter">
      <h3>チームで絞り込み</h3>
      <div className="schedule-team-filter-actions">
        <button type="button" onClick={onSelectAll}>
          すべて選択
        </button>
        <button type="button" onClick={onSelectNone}>
          すべて解除
        </button>
      </div>
      <div className="schedule-team-filter-grid">
        {options.map((t) => {
          const checked = selected === null || selected.has(t.teamId);
          return (
            <label key={t.teamId} className="schedule-team-filter-item">
              <input type="checkbox" checked={checked} onChange={() => onToggle(t.teamId)} />
              <TeamLogo teamId={t.teamId} size={18} />
              {teamShortName(t.teamId, t.teamName)}
            </label>
          );
        })}
      </div>
    </div>
  );
}

function MaybeLink({ to, children }: { to?: string; children: ReactNode }) {
  return to ? (
    <Link to={to} className="cell-link">
      {children}
    </Link>
  ) : (
    <>{children}</>
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
            {row.homeTeamName}
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
            {row.awayTeamName}
          </span>
          {row.awayTeamId && <TeamLogo teamId={row.awayTeamId} size={24} />}
        </MaybeLink>
      </td>
      <td className="align-left">{row.venue ?? "-"}</td>
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
  const content = (
    <span className={`calendar-game-chip status-${row.status}`} title={title}>
      {row.homeTeamId ? <TeamLogo teamId={row.homeTeamId} size={16} /> : <span className="calendar-game-chip-noimg" />}
      <span className="calendar-game-chip-vs">-</span>
      {row.awayTeamId ? <TeamLogo teamId={row.awayTeamId} size={16} /> : <span className="calendar-game-chip-noimg" />}
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
