// game_detailページのHTMLから、まだ生データ（games/）が無い試合（開催予定）の
// 日付・対戦カード・会場を取得する（日程ページ用。2026-08-16導入）。
//
// GeniusAPI（v2_genius_contexts）は未開催の試合に対してAccessDeniedを返すため使えない
// （2026-08-15、B.PREMIER改称調査時に確認済み・DESIGN.md参照）。一方game_detailページの
// HTMLには開催予定の試合でも日付・対戦カード・会場が埋め込まれている（実機確認済み）:
//   <div class="date-wrap"><h1><span class="font-blg">2026.10.03</span>（土）...
//   <div class="team-wrap home">...<p class="for-pc">島根スサノオマジック</p>...
//   <div class="team-wrap away">...<p class="for-pc">名古屋ダイヤモンドドルフィンズ</p>...
//   <p class="place">島根県｜松江総体</p>
import { createThrottledFetch } from "./throttle.ts";
import type { UpcomingGameEntry } from "../../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

const DATE_PATTERN = /class="font-blg">(\d{4})\.(\d{2})\.(\d{2})<\/span>/;
const HOME_TEAM_PATTERN = /team-wrap home"[\s\S]*?class="for-pc">([^<]+)<\/p>/;
const AWAY_TEAM_PATTERN = /team-wrap away"[\s\S]*?class="for-pc">([^<]+)<\/p>/;
const VENUE_PATTERN = /<p class="place">([^<]+)<\/p>/;

/**
 * ScheduleKeyから開催予定情報を取得する。ページが無い/解析できない場合はnullを返す
 * （scrape-schedule.ts側で「今回は解決できなかった」として次回実行時に再試行する）
 */
export async function fetchUpcomingGameEntry(scheduleKey: string): Promise<UpcomingGameEntry | null> {
  const url = `https://www.bleague.jp/game_detail/?ScheduleKey=${scheduleKey}`;
  const res = await throttledFetch(url);
  if (!res.ok) return null;
  const html = await res.text();

  const dateMatch = html.match(DATE_PATTERN);
  const homeMatch = html.match(HOME_TEAM_PATTERN);
  const awayMatch = html.match(AWAY_TEAM_PATTERN);
  if (!dateMatch || !homeMatch || !awayMatch) return null;

  const venueMatch = html.match(VENUE_PATTERN);
  return {
    scheduleKey,
    date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
    homeTeamName: homeMatch[1]!.trim(),
    awayTeamName: awayMatch[1]!.trim(),
    venue: venueMatch?.[1]?.trim(),
  };
}
