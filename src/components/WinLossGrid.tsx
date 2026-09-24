import { Link } from "react-router-dom";
import type { ClinchEvent, ClinchType, GameSummary, UpcomingGameEntry } from "../../shared/types";
import { teamShortName } from "../../shared/teamNames";
import { postseasonLabel } from "../../shared/gameType";
import { formatDateHeading } from "../lib/format";
import { TeamLogo } from "./TeamLogo";
import { ResponsiveTeamName } from "./ResponsiveTeamName";

/**
 * 勝敗表（順位表ページのタブ。DESIGN.md 132章）。クラブごとにレギュラーシーズンの全試合を第1試合から順に○（勝ち）●（負け）で並べ、
 * 未消化は空欄。マスにカーソルで試合の詳細、クリックで試合詳細へ。アウェイの試合はマスの地を薄い青にする（中立地開催も
 * 公式記録上のホーム／アウェイ＝games-summary の homeTeamId に従う）。終了した試合の後ろに、試合中（途中経過で保存された試合）と
 * 開催予定（schedule.json の upcomingGames。日付順）のマスを続け、ホーム／アウェイの地だけ付ける。連勝・観客数等の集計は終了した試合だけ。チーム名の左に地区順位（順位表と同じ公式タイブレーク適用済みの値）。
 * 確定した試合（playoff-race.json の clinchEvents）は赤枠＋隅の記号（◎地区優勝・★準々決勝ホームコート・☆ポストシーズン進出）。
 * 試合の無い日に確定した場合は直前の試合に点線の枠。右端にホーム平均観客数・最大連勝・最大連敗・現在の連勝/連敗。
 */

export interface WinLossGridTeam {
  teamId: string;
  teamName: string;
  /** 地区順位。null は未試合（「-」）。地区の無い表示では渡さない（undefined＝順位の列なし） */
  divisionRank?: number | null;
}

interface GameCell {
  n: number;
  scheduleKey: string;
  date: string;
  isHome: boolean;
  win: boolean;
  opponentId: string;
  opponentName: string;
  teamScore: number;
  opponentScore: number;
  venue?: string;
}

const CLINCH_MARKS: Record<ClinchType, string> = { division: "◎", homeCourt: "★", playoffs: "☆" };
const CLINCH_ORDER: ClinchType[] = ["division", "homeCourt", "playoffs"];

function clinchLabel(type: ClinchType, season: string): string {
  if (type === "division") return "地区優勝";
  if (type === "homeCourt") return "準々決勝のホームコート獲得（地区2位以上）";
  return `${postseasonLabel(season)}進出`;
}

function shortDate(date: string): string {
  // "2026年3月15日（日）" -> "3/15（日）"
  const m = /^\d+年(\d+)月(\d+)日(（.）)$/.exec(formatDateHeading(date));
  return m ? `${m[1]}/${m[2]}${m[3]}` : date;
}

/** 終了していない試合のマス（試合中＝games-summary の gameEndedFlg=false、開催予定＝schedule.json の upcomingGames） */
interface PendingCell {
  kind: "live" | "upcoming";
  scheduleKey: string;
  date: string;
  isHome: boolean;
  opponentId?: string;
  opponentName: string;
  teamScore?: number;
  opponentScore?: number;
  tipoffTime?: string;
  venue?: string;
}

function pendingGames(
  team: WinLossGridTeam,
  games: GameSummary[],
  upcoming: UpcomingGameEntry[],
  teamIdByName: Map<string, string> | undefined,
): PendingCell[] {
  const live: PendingCell[] = games
    .filter((g) => g.gameType === "regular" && !g.gameEndedFlg && (g.homeTeamId === team.teamId || g.awayTeamId === team.teamId))
    .map((g) => {
      const isHome = g.homeTeamId === team.teamId;
      return {
        kind: "live",
        scheduleKey: g.scheduleKey,
        date: g.date,
        isHome,
        opponentId: isHome ? g.awayTeamId : g.homeTeamId,
        opponentName: isHome ? g.awayTeamName : g.homeTeamName,
        teamScore: isHome ? g.homeScore : g.awayScore,
        opponentScore: isHome ? g.awayScore : g.homeScore,
        venue: g.venue,
      };
    });
  // 生データを取得済みの試合は upcomingGames から外れるが、日程の更新前に一時的に両方に載ることがあるので重複を除く
  const summaryKeys = new Set(games.map((g) => g.scheduleKey));
  const scheduled: PendingCell[] = upcoming
    .filter((g) => !summaryKeys.has(g.scheduleKey) && (g.homeTeamName === team.teamName || g.awayTeamName === team.teamName))
    .map((g) => {
      const isHome = g.homeTeamName === team.teamName;
      return {
        kind: "upcoming",
        scheduleKey: g.scheduleKey,
        date: g.date,
        isHome,
        opponentId: teamIdByName?.get(isHome ? g.awayTeamName : g.homeTeamName),
        opponentName: isHome ? g.awayTeamName : g.homeTeamName,
        tipoffTime: g.tipoffTime,
        venue: g.venue,
      };
    });
  const byDate = (a: PendingCell, b: PendingCell) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey);
  return [...live.sort(byDate), ...scheduled.sort(byDate)];
}

function teamGames(teamId: string, games: GameSummary[]): GameCell[] {
  return games
    .filter((g) => g.gameType === "regular" && g.gameEndedFlg && (g.homeTeamId === teamId || g.awayTeamId === teamId))
    .sort((a, b) => a.date.localeCompare(b.date) || a.scheduleKey.localeCompare(b.scheduleKey))
    .map((g, i) => {
      const isHome = g.homeTeamId === teamId;
      const teamScore = isHome ? g.homeScore : g.awayScore;
      const opponentScore = isHome ? g.awayScore : g.homeScore;
      return {
        n: i + 1,
        scheduleKey: g.scheduleKey,
        date: g.date,
        isHome,
        win: teamScore > opponentScore,
        opponentId: isHome ? g.awayTeamId : g.homeTeamId,
        opponentName: isHome ? g.awayTeamName : g.homeTeamName,
        teamScore,
        opponentScore,
        venue: g.venue,
      };
    });
}

function streaks(cells: GameCell[]): { maxWin: number; maxLoss: number; current: string } {
  let maxWin = 0;
  let maxLoss = 0;
  let run = 0;
  let prev: boolean | null = null;
  for (const c of cells) {
    run = c.win === prev ? run + 1 : 1;
    prev = c.win;
    if (c.win) maxWin = Math.max(maxWin, run);
    else maxLoss = Math.max(maxLoss, run);
  }
  const current = prev === null ? "-" : prev ? `${run}連勝` : `${run}連敗`;
  return { maxWin, maxLoss, current };
}

function homeAttendance(teamId: string, games: GameSummary[]): number | null {
  // 無観客（0）と記録なし（null）は除く
  const values = games
    .filter((g) => g.gameType === "regular" && g.gameEndedFlg && g.homeTeamId === teamId && (g.attendance ?? 0) > 0)
    .map((g) => g.attendance!);
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function WinLossGrid({
  season,
  teams,
  games,
  upcomingGames,
  clinchEvents,
  teamColors,
  teamIdByName,
}: {
  season: string;
  teams: WinLossGridTeam[];
  games: GameSummary[];
  /** 列数（シーズンの総試合数）を決めるための未消化の試合（schedule.json） */
  upcomingGames: UpcomingGameEntry[];
  clinchEvents: ClinchEvent[];
  teamColors?: Record<string, { primary?: string }>;
  /** 開催予定の試合（クラブ名しか持たない）の相手を略称で出すための、クラブ名→ID */
  teamIdByName?: Map<string, string>;
}) {
  const showRank = teams.some((t) => t.divisionRank !== undefined);
  const cellsByTeam = new Map(teams.map((t) => [t.teamId, teamGames(t.teamId, games)]));
  const pendingByTeam = new Map(teams.map((t) => [t.teamId, pendingGames(t, games, upcomingGames, teamIdByName)]));
  // 列数: シーズンの最大試合数（終了＋試合中＋開催予定）。2019-20（中止）等は実際に消化した最大数
  const slots = Math.max(
    1,
    ...teams.map((t) => (cellsByTeam.get(t.teamId)?.length ?? 0) + (pendingByTeam.get(t.teamId)?.length ?? 0)),
  );
  const eventsByKey = new Map<string, ClinchEvent[]>();
  for (const e of clinchEvents) {
    if (!e.scheduleKey) continue;
    const key = `${e.teamId}:${e.scheduleKey}`;
    eventsByKey.set(key, [...(eventsByKey.get(key) ?? []), e]);
  }

  return (
    <div className="table-scroll wl-grid-scroll">
      <table className="wl-grid">
        <thead>
          <tr>
            <th className="wl-team-col">
              {showRank && <span className="wl-rank">順位</span>}
              チーム
            </th>
            {Array.from({ length: slots }, (_, i) => (
              <th key={i} className={`wl-num${i > 0 && i % 10 === 0 ? " wl-sep" : ""}`}>
                {i + 1}
              </th>
            ))}
            <th className="wl-stat wl-stat-first">ホーム平均観客</th>
            <th className="wl-stat">最大連勝</th>
            <th className="wl-stat">最大連敗</th>
            <th className="wl-stat">現在</th>
          </tr>
        </thead>
        <tbody>
          {teams.map((t) => {
            const cells = cellsByTeam.get(t.teamId) ?? [];
            const pending = pendingByTeam.get(t.teamId) ?? [];
            const s = streaks(cells);
            const attendance = homeAttendance(t.teamId, games);
            const accent = teamColors?.[t.teamId]?.primary;
            return (
              <tr key={t.teamId}>
                <td className="wl-team-col" style={accent ? { borderLeftColor: accent } : undefined}>
                  {showRank && <span className="wl-rank">{t.divisionRank ?? "-"}</span>}
                  <Link to={`/teams/${t.teamId}`} className="wl-team-link">
                    <TeamLogo teamId={t.teamId} size={18} />
                    <span className="wl-team-name" title={t.teamName}>
                      <ResponsiveTeamName teamId={t.teamId} name={t.teamName} />
                    </span>
                  </Link>
                </td>
                {Array.from({ length: slots }, (_, i) => {
                  const c = cells[i];
                  const sep = i > 0 && i % 10 === 0 ? " wl-sep" : "";
                  if (!c) {
                    const p = pending[i - cells.length];
                    if (!p) return <td key={i} className={`wl-cell wl-empty${sep}`} />;
                    const opponent = teamShortName(p.opponentId ?? "", p.opponentName);
                    const head = `第${i + 1}試合 ${shortDate(p.date)} ${p.isHome ? "ホーム" : "アウェー"} vs ${opponent}`;
                    const cls = `wl-cell ${p.kind === "live" ? "wl-live" : "wl-upcoming"}${p.isHome ? "" : " wl-away"}${sep}`;
                    if (p.kind === "live") {
                      const title = `${head}\n試合中 ${p.teamScore}-${p.opponentScore}（途中経過）${p.venue ? `（${p.venue}）` : ""}`;
                      return (
                        <td key={i} className={cls}>
                          <Link to={`/games/${p.scheduleKey}`} className="wl-mark" title={title} aria-label={title}>
                            <span className="wl-live-dot" aria-hidden="true" />
                          </Link>
                        </td>
                      );
                    }
                    const title = `${head}\n開催予定${p.tipoffTime ? ` ${p.tipoffTime}` : ""}${p.venue ? `（${p.venue.replace(/^.+｜/, "")}）` : ""}`;
                    return <td key={i} className={cls} title={title} aria-label={title} />;
                  }
                  const events = (eventsByKey.get(`${t.teamId}:${c.scheduleKey}`) ?? []).sort(
                    (a, b) => CLINCH_ORDER.indexOf(a.type) - CLINCH_ORDER.indexOf(b.type),
                  );
                  const dashed = events.length > 0 && events.every((e) => !e.onGameDay);
                  const clinchLines = events.map((e) => {
                    const how = !e.onGameDay
                      ? `（${shortDate(e.date)}、試合の無い日に他クラブの結果で確定）`
                      : e.byTiebreak
                        ? "（レギュラーシーズン最終日に、同率を公式タイブレークで破って確定）"
                        : !c.win
                          ? "（敗れたが、他クラブの結果で確定）"
                          : "";
                    return `${CLINCH_MARKS[e.type]} ${clinchLabel(e.type, season)}決定${how}`;
                  });
                  const title = [
                    `第${c.n}試合 ${shortDate(c.date)} ${c.isHome ? "ホーム" : "アウェー"} vs ${teamShortName(c.opponentId, c.opponentName)}`,
                    `${c.teamScore}-${c.opponentScore} ${c.win ? "勝ち" : "負け"}${c.venue ? `（${c.venue}）` : ""}`,
                    ...clinchLines,
                  ].join("\n");
                  const className = [
                    "wl-cell",
                    c.isHome ? "" : "wl-away",
                    events.length > 0 ? (dashed ? "wl-clinch wl-clinch-dashed" : "wl-clinch") : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={i} className={`${className}${sep}`}>
                      <Link to={`/games/${c.scheduleKey}`} className="wl-mark" title={title} aria-label={title}>
                        {c.win ? "○" : "●"}
                      </Link>
                      {events.length > 0 && <span className="wl-clinch-mark">{CLINCH_MARKS[events[0]!.type]}</span>}
                    </td>
                  );
                })}
                <td className="wl-stat wl-stat-first">{attendance === null ? "-" : Math.round(attendance).toLocaleString()}</td>
                <td className="wl-stat">{cells.length === 0 ? "-" : s.maxWin}</td>
                <td className="wl-stat">{cells.length === 0 ? "-" : s.maxLoss}</td>
                <td className="wl-stat">{s.current}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 表の上に出す凡例（ポストシーズンの名称はシーズンで切り替え） */
export function WinLossLegend({ season, clinchTypes }: { season: string; clinchTypes: ClinchType[] }) {
  return (
    <div className="wl-legend">
      <span>○ 勝ち</span>
      <span>● 負け</span>
      <span>
        <span className="wl-legend-swatch" aria-hidden="true" />
        アウェイ（未開催の試合も表示）
      </span>
      <span>
        <span className="wl-live-dot" aria-hidden="true" />
        試合中
      </span>
      {clinchTypes.length > 0 && (
        <>
          <span>
            <span className="wl-legend-frame" aria-hidden="true" />
            確定した試合（
            {CLINCH_ORDER.filter((t) => clinchTypes.includes(t))
              .map((t) => `${CLINCH_MARKS[t]}${t === "homeCourt" ? "準々決勝ホームコート" : clinchLabel(t, season)}`)
              .join("・")}
            ）
          </span>
          <span>
            <span className="wl-legend-frame wl-legend-frame-dashed" aria-hidden="true" />
            試合の無い日に確定（直前の試合に表示）
          </span>
        </>
      )}
    </div>
  );
}
