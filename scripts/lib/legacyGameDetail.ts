// 2016-17〜2019-20シーズン向け: genius_contexts APIが403で使えないシーズンの代替データ源。
// game_detailページのHTMLソースには `_contexts_s3id.data = {...}` というJS変数として、
// genius_contexts APIと同一構造の完全なJSON（Game/PlayByPlays/HomeBoxscores/AwayBoxscores/
// Summaries）がそのまま埋め込まれている（DESIGN.md 2-7章で発見・検証済み）。
//
// このモジュールはHTMLからそのJSONを取り出し、genius_contexts API本体のレスポンスと
// 型的に区別が付かない GeniusContext 形式に正規化する（数値型のID→文字列化、
// StartingFlgのboolean→1|null化）。正規化後は他の全ロジック（aggregate.ts・shared/onCourt.ts等）
// を2020-21以降のデータと完全に共通で使い回せる。

import { createThrottledFetch } from "./throttle.ts";
import type { BoxscoreRow, GeniusContext, PlayByPlayEvent } from "../../shared/types.ts";

const MIN_REQUEST_INTERVAL_MS = 2500;
const USER_AGENT = "Mozilla/5.0 (bleague-stats personal scraper)";
const throttledFetch = createThrottledFetch(MIN_REQUEST_INTERVAL_MS, USER_AGENT);

const EMBEDDED_DATA_MARKER = "_contexts_s3id.data = ";

/**
 * HTML本文から`_contexts_s3id.data = {...}`のJSONオブジェクト部分を波括弧の対応を数えながら
 * 取り出す（文字列リテラル内の`{`/`}`・エスケープを考慮する簡易パーサ）。
 */
function extractEmbeddedJson(html: string): unknown | null {
  const markerIndex = html.indexOf(EMBEDDED_DATA_MARKER);
  if (markerIndex === -1) return null;

  let i = markerIndex + EMBEDDED_DATA_MARKER.length;
  while (i < html.length && html[i] !== "{") i++;
  if (i >= html.length) return null;

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  let end = i;
  for (; end < html.length; end++) {
    const ch = html[end];
    if (inString) {
      if (escapeNext) escapeNext = false;
      else if (ch === "\\") escapeNext = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }

  try {
    return JSON.parse(html.slice(i, end));
  } catch {
    return null;
  }
}

/** Genericな未知形状。埋め込みJSONの生の値を読むためだけに使う */
type RawRecord = Record<string, unknown>;

function toIdString(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return String(value);
}

function normalizePlayByPlay(raw: RawRecord): PlayByPlayEvent {
  return {
    ...(raw as unknown as PlayByPlayEvent),
    TeamID: toIdString(raw.TeamID),
    PlayerID1: toIdString(raw.PlayerID1),
    PlayerID2: toIdString(raw.PlayerID2),
  };
}

function normalizeBoxscoreRow(raw: RawRecord): BoxscoreRow {
  return {
    ...(raw as unknown as BoxscoreRow),
    TeamID: toIdString(raw.TeamID),
    PlayerID: toIdString(raw.PlayerID) ?? "",
    // legacy埋め込みJSONはStartingFlgがboolean（true/false）。modernスキーマの1|null|""に正規化する
    StartingFlg: raw.StartingFlg === true ? 1 : null,
  };
}

/**
 * 埋め込みJSON（生のRawRecord形状）をGeniusContext形式に正規化する。
 * 数値型のID・boolean型のStartingFlgをmodernスキーマに合わせて変換するのみで、
 * それ以外のフィールド構造・値はそのまま保持する。
 */
function normalizeContext(raw: RawRecord): GeniusContext {
  const game = raw.Game as RawRecord;
  return {
    Game: {
      ...(game as unknown as GeniusContext["Game"]),
      HomeTeamID: toIdString(game.HomeTeamID) ?? "",
      AwayTeamID: toIdString(game.AwayTeamID) ?? "",
    },
    PlayByPlays: (raw.PlayByPlays as RawRecord[]).map(normalizePlayByPlay),
    HomeBoxscores: (raw.HomeBoxscores as RawRecord[]).map(normalizeBoxscoreRow),
    AwayBoxscores: (raw.AwayBoxscores as RawRecord[]).map(normalizeBoxscoreRow),
    Summaries: ((raw.Summaries as RawRecord[]) ?? []) as unknown as GeniusContext["Summaries"],
  };
}

/**
 * legacy埋め込みJSONの`Game.GameDateTime`はASP.NET JSON Date形式（"/Date(...)/""）ではなく、
 * Unixエポック秒の数値文字列（例: "1480673400"）。modern APIの`parseAspNetDate`とは別実装が必要
 */
export function parseLegacyGameDateTime(value: string): Date {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) {
    throw new Error(`Unexpected legacy GameDateTime format: ${value}`);
  }
  return new Date(seconds * 1000);
}

/**
 * legacy埋め込みJSONはHomeTeamScore01〜14が常に全て存在する（modern APIのようにOT試合でのみ
 * 動的追加される訳ではない）ため、フィールド存在数ではなく`Game.MaxPeriod`を実際のピリオド数として使う。
 */
export function legacyPeriodScores(game: GeniusContext["Game"], side: "Home" | "Away"): number[] {
  const record = game as unknown as RawRecord;
  const maxPeriod = record.MaxPeriod as number;
  const scores: number[] = [];
  for (let period = 1; period <= maxPeriod; period += 1) {
    const key = `${side}TeamScore${String(period).padStart(2, "0")}`;
    scores.push(Number(record[key] ?? 0));
  }
  return scores;
}

/**
 * game_detailページの埋め込みJSONを取得・正規化する。ページ自体が無い/JSONが埋め込まれていない
 * 場合はnullを返す（scrape-boxscore.tsの"no-data"扱いに合流させる）。
 */
export async function fetchLegacyGameContext(scheduleKey: string | number): Promise<GeniusContext | null> {
  const url = `https://www.bleague.jp/game_detail/?ScheduleKey=${scheduleKey}`;
  const res = await throttledFetch(url);
  if (!res.ok) return null;
  const html = await res.text();
  const raw = extractEmbeddedJson(html);
  if (!raw || typeof raw !== "object" || !("Game" in raw) || !("PlayByPlays" in raw)) return null;
  return normalizeContext(raw as RawRecord);
}
