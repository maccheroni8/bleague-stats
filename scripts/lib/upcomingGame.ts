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
// ティップオフ時刻（例: <p class="time">19:05 TIP OFF</p>）。試合終了後も同じ値が残るため、
// 開催予定・開催済みいずれのタイミングで取得しても正しい予定時刻が取れる（2026-09-23実機確認）
const TIME_PATTERN = /<p class="time">(\d{2}):(\d{2})\s*TIP OFF<\/p>/;

/** 試合ページの得点（<div class="team-point font-blg">67<div class="label home ...">）。未開催は「--」、中止は 0-0 */
const TEAM_POINT_PATTERN = /<div class="team-point[^"]*"[^>]*>\s*([^<]*?)\s*<div/g;
/** 大会名（例: 「2017-18 B1リーグ」「Bリーグ 2022-23 B1リーグ戦」）。レギュラー／ポストシーズン／オールスターの判定に使う */
const CONVENTION_PATTERN = /id="convention-name">([^<]*)</;
/** クラブ名のリンク（<a href=".../club_detail/?TeamID=698" class="text-link name"><span class="link-line">滋賀レイクス</span>）。名前→TeamID */
const CLUB_LINK_PATTERN = /club_detail\/\?TeamID=(\d+)"[^>]*class="text-link name"[^>]*><span class="link-line">([^<]+)<\/span>/g;

export interface GameDetailInfo {
  entry: UpcomingGameEntry;
  /** 試合ページの得点。「--」など数値でないときは null */
  homeScore: number | null;
  awayScore: number | null;
  conventionName: string | undefined;
  /** 試合ページのクラブ名のリンクから読んだ チーム名→TeamID（読めなければ空） */
  teamIdByName: Map<string, string>;
}

/** game_detail ページのHTMLを読む。日付・対戦が読めなければ null（純粋な関数。検証は validate-result-only-games.ts） */
export function parseGameDetailHtml(scheduleKey: string, html: string): GameDetailInfo | null {
  const dateMatch = html.match(DATE_PATTERN);
  const homeMatch = html.match(HOME_TEAM_PATTERN);
  const awayMatch = html.match(AWAY_TEAM_PATTERN);
  if (!dateMatch || !homeMatch || !awayMatch) return null;

  const venueMatch = html.match(VENUE_PATTERN);
  const timeMatch = html.match(TIME_PATTERN);
  const points = [...html.matchAll(TEAM_POINT_PATTERN)].map((m) => m[1]!.trim());
  const toScore = (v: string | undefined): number | null => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  const teamIdByName = new Map<string, string>();
  for (const m of html.matchAll(CLUB_LINK_PATTERN)) teamIdByName.set(m[2]!.trim(), m[1]!);
  return {
    entry: {
      scheduleKey,
      date: `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
      homeTeamName: homeMatch[1]!.trim(),
      awayTeamName: awayMatch[1]!.trim(),
      venue: venueMatch?.[1]?.trim(),
      tipoffTime: timeMatch ? `${timeMatch[1]}:${timeMatch[2]}` : undefined,
    },
    homeScore: toScore(points[0]),
    awayScore: toScore(points[1]),
    conventionName: html.match(CONVENTION_PATTERN)?.[1]?.trim(),
    teamIdByName,
  };
}

/** ScheduleKeyから試合ページを取得して読む。ページが無い/解析できない場合は null */
export async function fetchGameDetailInfo(scheduleKey: string): Promise<GameDetailInfo | null> {
  const url = `https://www.bleague.jp/game_detail/?ScheduleKey=${scheduleKey}`;
  const res = await throttledFetch(url);
  if (!res.ok) return null;
  return parseGameDetailHtml(scheduleKey, await res.text());
}

/**
 * ScheduleKeyから開催予定情報を取得する。ページが無い/解析できない場合はnullを返す
 * （scrape-schedule.ts側で「今回は解決できなかった」として次回実行時に再試行する）
 */
export async function fetchUpcomingGameEntry(scheduleKey: string): Promise<UpcomingGameEntry | null> {
  return (await fetchGameDetailInfo(scheduleKey))?.entry ?? null;
}
