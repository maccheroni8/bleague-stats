import { useMemo } from "react";
import { FIRST_LEAGUE_SEASON, OPENING_REGISTRATION_MAX_GAME } from "../../shared/rookieEligibility";
import { fetchRookieEligibility } from "./data";
import { useJsonData } from "./useJsonData";

/**
 * ルーキーの絞り込み（ランキングのシーズン成績（個人）・全選手スタッツ。DESIGN.md 217章）。
 * 判定は導出データ（rookie-eligibility.json。215章）を使い、画面ではシーズンごとの選手IDの集合で絞るだけ。
 * 判定不能の選手は、導出データに入らないので、オンのときは出ない
 */
export type RookieFilter = "all" | "rookie";

/**
 * ルーキーを選べるシーズンか。B.LEAGUE発足の2016-17は、それ以前の経歴が載らず「初めての登録」を判定できないので選べない。
 * それ以外のシーズンで導出データに無いとき（開幕直後など）は、該当の選手がいないものとして扱う
 */
export function rookieSupportedSeason(season: string): boolean {
  return season > FIRST_LEAGUE_SEASON;
}

export const ROOKIE_UNSUPPORTED_REASON =
  "ルーキーは、2016-17では選べません。B.LEAGUE発足の最初のシーズンで、それ以前の登録の経歴が分からず、「初めての登録」かどうかを判定できないためです。";

/** 表の下に出す近似の注記（オンのときだけ） */
export const ROOKIE_NOTE =
  `新人賞の対象要件に準じた推定です。開幕時点の登録は「最初のベンチ入りが所属クラブの${OPENING_REGISTRATION_MAX_GAME}試合目以内」で、` +
  "2025年1月より前はインジュアリーリストを判定できません。判定できない選手（生年月日が不明など）は含みません。";

export interface RookieFilterState {
  /** 絞り込みが効いているか（オンで、選べるシーズン） */
  active: boolean;
  /** そのシーズンのルーキーの選手ID。オフのとき、読み込み中・読み込めなかったときは null */
  ids: ReadonlySet<string> | null;
  loading: boolean;
  error: string | null;
}

/** オンのときだけ導出データを読む。シーズンを変えても、読み込んだファイルはそのまま使う（中にシーズンごとの集合がある） */
export function useRookieFilter(season: string, value: RookieFilter): RookieFilterState {
  const active = value === "rookie" && rookieSupportedSeason(season);
  const { data, loading, error } = useJsonData(() => (active ? fetchRookieEligibility() : Promise.resolve(null)), [active]);
  const ids = useMemo(() => (active && data ? new Set(data.seasons[season] ?? []) : null), [active, data, season]);
  return { active, ids, loading: active && !ids && !error && loading, error: active ? error : null };
}

/** idsがnull（絞り込まない、または読み込み前）のときは true */
export function matchesRookie(playerId: string, ids: ReadonlySet<string> | null): boolean {
  return ids === null || ids.has(playerId);
}
