// ランキング > チーム > 観客動員（DESIGN.md 270章）: クラブごとのホーム試合の来場者数の平均・合計を求める部品。
// 試合の一覧（games-summary）だけで求める画面側の計算で、集計・保存キーの対象外。
import type { GameSummary } from "../../shared/types";

/** 来場者数の入場制限があったシーズン（人数が少なく、中止の試合もあって試合数がそろわない。注記に使う） */
export const ATTENDANCE_LIMITED_SEASONS: readonly string[] = ["2019-20", "2020-21", "2021-22"];

export type AttendanceDay = "all" | "wkday" | "wkend";
export type AttendanceGameType = "regular" | "playoff" | "both";

export interface AttendanceGame extends GameSummary {
  season: string;
}

export interface AttendanceFilter {
  gameType: AttendanceGameType;
  day: AttendanceDay;
  /** 会場名。空は絞り込みなし */
  venue: string;
  /** 平日開催（祝日を除く）か。日付から判定する関数を渡す（祝日の計算は画面側の japaneseHolidays） */
  isWeekday: (date: string) => boolean;
}

export interface AttendanceRow {
  teamId: string;
  teamName: string;
  /** 来場者数が入っているホーム試合の数 */
  games: number;
  total: number;
  average: number;
}

/**
 * 数える試合: 終了していて、来場者数が1人以上入っている試合（0人＝無観客と、記録の無い試合は平均・合計に入れない）。
 * 試合区分・曜日（平日開催〔祝日を除く〕／土日祝開催）・会場の絞り込みの前の段階
 */
export function isCountedAttendanceGame(g: GameSummary): boolean {
  return g.gameEndedFlg && (g.attendance ?? 0) > 0 && (g.gameType === "regular" || g.gameType === "playoff");
}

function matchesGameType(g: GameSummary, gameType: AttendanceGameType): boolean {
  return gameType === "both" || g.gameType === gameType;
}

function matchesDay(g: GameSummary, filter: AttendanceFilter): boolean {
  if (filter.day === "all") return true;
  return filter.day === "wkday" ? filter.isWeekday(g.date) : !filter.isWeekday(g.date);
}

/** 会場以外の絞り込みを通った試合（会場の選択肢を作るのにも使う） */
export function attendanceGamesBeforeVenue(games: readonly AttendanceGame[], filter: AttendanceFilter): AttendanceGame[] {
  return games.filter((g) => isCountedAttendanceGame(g) && matchesGameType(g, filter.gameType) && matchesDay(g, filter));
}

/** 会場の選択肢（試合数の多い順。同数は名前順） */
export function attendanceVenueOptions(games: readonly AttendanceGame[], filter: AttendanceFilter): { venue: string; games: number }[] {
  const counts = new Map<string, number>();
  for (const g of attendanceGamesBeforeVenue(games, filter)) {
    if (!g.venue) continue;
    counts.set(g.venue, (counts.get(g.venue) ?? 0) + 1);
  }
  return [...counts]
    .map(([venue, n]) => ({ venue, games: n }))
    .sort((a, b) => b.games - a.games || a.venue.localeCompare(b.venue, "ja"));
}

/**
 * クラブごと（ホームのチーム）の平均・合計。中立地で開いた試合も、ホーム側のクラブの試合として数える
 * （試合の一覧に中立地の印が無いため）。名前は teamName で決める（シーズンごとに変わりうるので、呼び出し側が最新を渡す）
 */
export function attendanceRows(
  games: readonly AttendanceGame[],
  filter: AttendanceFilter,
  teamName: (teamId: string, fallback: string) => string,
): AttendanceRow[] {
  const byTeam = new Map<string, { name: string; games: number; total: number }>();
  for (const g of attendanceGamesBeforeVenue(games, filter)) {
    if (filter.venue && g.venue !== filter.venue) continue;
    const e = byTeam.get(g.homeTeamId) ?? { name: g.homeTeamName, games: 0, total: 0 };
    e.games += 1;
    e.total += g.attendance!;
    byTeam.set(g.homeTeamId, e);
  }
  return [...byTeam].map(([teamId, e]) => ({
    teamId,
    teamName: teamName(teamId, e.name),
    games: e.games,
    total: e.total,
    average: e.total / e.games,
  }));
}
