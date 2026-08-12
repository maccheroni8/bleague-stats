// v2_genius_contexts API（DESIGN.md 2-2章で検証済み）を叩く共通クライアント。
// 有効ホストは b-league.s3.amazonaws.com のみ（dev-bleagueは403で無効）。

import { createThrottledFetch } from "./throttle.ts";
import type { GeniusContext } from "./types.ts";

const HOST = "http://b-league.s3.amazonaws.com";
const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";

// 個人利用の範囲を守るため、このモジュール経由の全リクエストを直列実行・最低2.5秒間隔にする
// （DESIGN.md 2章の制約）。並列に呼び出しても直列化される。
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

export class GeniusApiError extends Error {
  readonly status: number | null;

  constructor(message: string, status: number | null) {
    super(message);
    this.name = "GeniusApiError";
    this.status = status;
  }
}

/** その試合の最新リビジョンIDを取得する。試合データが存在しない場合はnullを返す */
export async function fetchLatestId(scheduleKey: string | number): Promise<number | null> {
  const url = `${HOST}/web_json/v2_genius_contexts/${scheduleKey}/latestid`;
  const res = await throttledFetch(url);
  if (!res.ok) return null;
  const text = (await res.text()).trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

/** 試合の全データ（Game/PlayByPlays/HomeBoxscores/AwayBoxscores/Summaries）を取得する */
export async function fetchGameContext(
  scheduleKey: string | number,
  latestId: number,
): Promise<GeniusContext> {
  const url = `${HOST}/web_json/v2_genius_contexts/${scheduleKey}/${latestId}.json`;
  const res = await throttledFetch(url);
  if (!res.ok) {
    throw new GeniusApiError(`GET ${url} failed: ${res.status}`, res.status);
  }
  return (await res.json()) as GeniusContext;
}

/** latestid取得→JSON本体取得をまとめて行う。試合データが存在しなければnullを返す */
export async function fetchLatestGameContext(
  scheduleKey: string | number,
): Promise<{ latestId: number; context: GeniusContext } | null> {
  const latestId = await fetchLatestId(scheduleKey);
  if (latestId === null) return null;
  const context = await fetchGameContext(scheduleKey, latestId);
  return { latestId, context };
}

/**
 * ASP.NET JSON Date形式（"/Date(1779789900000+0900)/"）をDateに変換する。
 * DESIGN.md 2-2章で確認済みのGameDateTimeの形式。
 */
export function parseAspNetDate(value: string): Date {
  const match = /\/Date\((\d+)([+-]\d{4})?\)\//.exec(value);
  if (!match) {
    throw new Error(`Unexpected ASP.NET date format: ${value}`);
  }
  return new Date(Number(match[1]));
}

/**
 * Home/AwayTeamScoreXX フィールドをQ順に抽出する。通常試合は4要素、OT試合は5要素以降になる
 * （MaxPeriodは4のまま変化しないため、フィールドの存在数で延長を判定する。DESIGN.md 2-2章）。
 */
export function getPeriodScores(game: Record<string, unknown>, side: "Home" | "Away"): number[] {
  const prefix = `${side}TeamScore`;
  const scores: { period: number; value: number }[] = [];
  for (const [key, value] of Object.entries(game)) {
    const m = new RegExp(`^${prefix}(\\d{2})$`).exec(key);
    if (m && typeof value === "number") {
      scores.push({ period: Number(m[1]), value });
    }
  }
  return scores.sort((a, b) => a.period - b.period).map((s) => s.value);
}
