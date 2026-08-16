import { useMemo, useState, type ReactNode } from "react";
import { SeasonLink as Link } from "../components/SeasonLink";
import { fetchGameSummaries, fetchSchedule, fetchTeamColors, fetchTeams } from "../lib/data";
import { useJsonData } from "../lib/useJsonData";
import { formatDateHeading } from "../lib/format";
import type { GameSummary, GameType, TeamColors, UpcomingGameEntry } from "../../shared/types";

type ScheduleStatus = "final" | "live" | "upcoming";

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

  const teamIdByName = useMemo(() => new Map((teams ?? []).map((t) => [t.teamName, t.teamId])), [teams]);
  const rows = useMemo(
    () => (summaries ? toRows(summaries, schedule?.upcomingGames ?? [], teamIdByName) : []),
    [summaries, schedule, teamIdByName],
  );
  const groups = useMemo(() => groupByDate(rows), [rows]);

  if (summariesLoading || scheduleLoading) return <p className="loading">読み込み中...</p>;
  if (error) return <p className="error-message">{error}</p>;
  if (groups.length === 0) return <p className="empty-message">日程データがありません</p>;

  const handleJump = (value: string) => {
    setJumpDate(value);
    document.getElementById(value)?.scrollIntoView({ behavior: "auto", block: "start" });
  };

  return (
    <div>
      <h1>日程</h1>
      <p className="page-subtitle">{season}シーズン</p>

      <div className="schedule-jump">
        <label>
          日付でジャンプ: <input type="date" value={jumpDate} onChange={(e) => handleJump(e.target.value)} />
        </label>
      </div>

      {groups.map(([date, gamesOnDate]) => (
        <section key={date} id={date} className="schedule-date-group">
          <h2>{formatDateHeading(date)}</h2>
          <div className="table-scroll">
            <table className="sortable-table schedule-table">
              <thead>
                <tr>
                  <th className="align-left">対戦カード</th>
                  <th className="align-right">結果</th>
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
      <td className="align-left">
        <MaybeLink to={linkTo}>
          <span className="schedule-team-chip" style={homeColor ? { borderLeftColor: homeColor } : undefined}>
            {row.homeTeamName}
          </span>{" "}
          vs{" "}
          <span className="schedule-team-chip" style={awayColor ? { borderLeftColor: awayColor } : undefined}>
            {row.awayTeamName}
          </span>
          {row.gameType === "playoff" && <span className="playoff-badge">PO</span>}
        </MaybeLink>
      </td>
      <td className="align-right">
        <MaybeLink to={linkTo}>
          {row.status === "final" && `${row.homeScore}-${row.awayScore}`}
          {row.status === "live" && <span className="live-badge">進行中</span>}
          {row.status === "upcoming" && <span className="upcoming-badge">予定</span>}
        </MaybeLink>
      </td>
      <td className="align-left">{row.venue ?? "-"}</td>
    </tr>
  );
}
