// 見ているリーグ（B.PREMIER／B.ONE）。URL の `league=one`（書かなければ B.PREMIER）で持ち、ヘッダーの切り替えで変える。
// ページを移っても保つ（SeasonLink・SeasonNavLink が season と一緒に引き継ぐ）。DESIGN.md 297章。
//
// - 読み込み（data.ts の fetch〜・gameIndexLoad.ts の load〜 など）は、引数の league で置き場所を変える（B.ONE は data/{season}/one/）。
// - 読み込みの使い回し（キャッシュ）と、画面の状態を覚える鍵（usePageState）にもリーグを入れる（切り替えた直後に、もう一方のリーグの値を見せない）。
// - リーグを通し忘れていないかは `npm run validate:league-wiring` が調べる。
import { useSearchParams } from "react-router-dom";
import type { SeasonEntry } from "../../shared/types";
import type { League } from "./data";

export type { League };

export const LEAGUE_PARAM = "league";

export const LEAGUES: League[] = ["premier", "one"];

/** 画面・保存画像の見出し・ファイル名に出すリーグ名 */
export const LEAGUE_LABELS: Record<League, string> = {
  premier: "B.PREMIER",
  one: "B.ONE",
};

/**
 * B.ONE を選んだときに選べるシーズン（新しい順でなく古い順）。B.ONE の導出データは 2025-26（旧B2）からあるが、
 * 画面に出すのは 2026-27 から（旧B2 2025-26 は選手詳細の通算成績・キャリアハイの「B2」だけ）。シーズンを足すときはここに足す
 */
export const ONE_SEASONS: readonly string[] = ["2026-27"];

/** URL のクエリからリーグを読む（`league=one` だけが B.ONE。ほかの値・無しは B.PREMIER） */
export function leagueFromParams(params: URLSearchParams): League {
  return params.get(LEAGUE_PARAM) === "one" ? "one" : "premier";
}

/** クエリにリーグを書く（B.PREMIER は書かない＝今までの URL のまま） */
export function writeLeagueParam(params: URLSearchParams, league: League): void {
  if (league === "one") params.set(LEAGUE_PARAM, "one");
  else params.delete(LEAGUE_PARAM);
}

export function useLeague(): League {
  const [params] = useSearchParams();
  return leagueFromParams(params);
}

/** ヘッダーのシーズンの選択肢（古い順）。B.PREMIER は seasons.json のとおり、B.ONE は ONE_SEASONS */
export function leagueSeasonEntries(league: League, seasons: readonly SeasonEntry[] | null | undefined): { season: string; hasCompletedGames: boolean }[] {
  if (league === "premier") return [...(seasons ?? [])];
  return ONE_SEASONS.map((season) => ({ season, hasCompletedGames: true }));
}

/** そのリーグで選べるシーズンか（B.PREMIER は seasons.json が読めていないときは判定しない＝true） */
export function isLeagueSeason(league: League, season: string, seasons: readonly SeasonEntry[] | null | undefined): boolean {
  if (league === "one") return ONE_SEASONS.includes(season);
  return !seasons || seasons.some((s) => s.season === season);
}

/** そのリーグの初期のシーズン（試合のある一番新しいシーズン） */
export function latestLeagueSeason(league: League, seasons: readonly SeasonEntry[] | null | undefined): string | null {
  const list = leagueSeasonEntries(league, seasons);
  return [...list].reverse().find((s) => s.hasCompletedGames)?.season ?? null;
}

/**
 * 読み込みの使い回し（キャッシュ）の鍵。B.PREMIER は今までどおりシーズンだけ、B.ONE は「one/」を前に付ける
 * （同じシーズンの B.PREMIER と B.ONE を別の鍵にする）
 */
export function leagueCacheKey(season: string, league: League): string {
  return league === "one" ? `one/${season}` : season;
}

/** 画面の状態を覚える鍵（usePageState）。B.PREMIER は今までの鍵のまま、B.ONE は「one:」を前に付ける */
export function leaguePageStateKey(key: string, league: League): string {
  return league === "one" ? `one:${key}` : key;
}

/**
 * リンク先にリーグを付ける（SeasonLink・SeasonNavLink）。リンク先に league が書いてあればそれを使う（`league=premier` は
 * 書かない形に直す＝B.ONE の画面から B.PREMIER の画面へつなぐリンク）。書いていなければ今のリーグを引き継ぐ
 */
export function applyLeagueToParams(params: URLSearchParams, current: League): void {
  const explicit = params.get(LEAGUE_PARAM);
  if (explicit !== null) {
    writeLeagueParam(params, explicit === "one" ? "one" : "premier");
    return;
  }
  writeLeagueParam(params, current);
}

/**
 * ヘッダーでリーグを切り替えたときの行き先（パスとクエリ）。条件（地区・クラブ・対戦相手・タブなど）はそのリーグに無いことがあるので、
 * season とリーグだけを残す。シーズンがそのリーグに無ければ、そのリーグの初期のシーズンにする。
 * チーム詳細・試合詳細は、そのクラブ・試合がもう一方のリーグに無いので一覧・日程へ移る。選手詳細はそのまま（選手は両リーグで共通）
 */
export function leagueSwitchUrl(pathname: string, season: string, seasons: readonly SeasonEntry[] | null | undefined, next: League): string {
  const params = new URLSearchParams();
  const nextSeason = isLeagueSeason(next, season, seasons) ? season : (latestLeagueSeason(next, seasons) ?? season);
  params.set("season", nextSeason);
  writeLeagueParam(params, next);
  const path =
    pathname.startsWith("/teams/") && pathname !== "/teams/stats" ? "/teams" : pathname.startsWith("/games/") ? "/schedule" : pathname;
  return `${path}?${params.toString()}`;
}
