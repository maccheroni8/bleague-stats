import { useMemo } from "react";
import { FIRST_LEAGUE_SEASON, OPENING_REGISTRATION_MAX_GAME } from "../../shared/rookieEligibility";
import { fetchRookieEligibility } from "./data";
import { useJsonData } from "./useJsonData";

/**
 * ルーキー（ランキングのシーズン成績（個人）・全選手スタッツ。DESIGN.md 217章）。
 * 判定は導出データ（rookie-eligibility.json。215章。選手契約および登録に関する規程 第5条〔新人選手〕に準じた推定）を使い、画面ではシーズンごとの選手IDの集合を引くだけ。
 * 判定不能の選手は、導出データに入らないので、ルーキーとしては出ない。
 * 絞り込みは登録区分の4つ目の選択肢「ルーキー」（URLは cls=rookie）。
 */

/**
 * ルーキーを選べるシーズンか。B.LEAGUE発足の2016-17は、それ以前の経歴が載らず「初めての登録」を判定できないので選べない（ルーキーの表示も出ない）。
 * それ以外のシーズンで導出データに無いとき（開幕直後など）は、該当の選手がいないものとして扱う
 */
export function rookieSupportedSeason(season: string): boolean {
  return season > FIRST_LEAGUE_SEASON;
}

export const ROOKIE_UNSUPPORTED_REASON =
  "ルーキーは、2016-17では選べません。B.LEAGUE発足の最初のシーズンで、それ以前の登録の経歴が分からず、「初めての登録」かどうかを判定できないためです。";

/** 表の下に出す近似の注記（ルーキーで絞り込んだとき） */
export const ROOKIE_NOTE =
  "ルーキーは、Bリーグの「選手契約および登録に関する規程」の新人選手の定義に準じた推定です。" +
  "海外リーグ（NBAサマーリーグを含む）の在籍経験は判定できません。" +
  `「1シーズンのすべてにわたる登録」は、最初のベンチ入りが所属クラブの${OPENING_REGISTRATION_MAX_GAME}試合目以内かどうかで推定しています。` +
  "2025年1月より前は、インジュアリーリストの登録を判定できません。" +
  "現行の規程を全シーズンに当てはめています。" +
  "B2・B3で先に登録された選手は、延長を確かめられないため、ルーキーに含めていません。" +
  "判定できない選手（所属履歴や生年月日が不明など）も含みません。" +
  "最優秀新人賞の受賞者が含まれない場合があります（新人賞の対象要件は、規程の新人選手の定義とは別の基準です）。";

export interface SeasonRookies {
  /** そのシーズンのルーキーの選手ID。読み込み前・読み込めなかったときは null。選べないシーズンは空 */
  ids: ReadonlySet<string> | null;
  loading: boolean;
  error: string | null;
}

const NO_ROOKIES: ReadonlySet<string> = new Set();

/**
 * そのシーズンのルーキーの選手ID。enabled のときだけ導出データ（約6KB）を読む。
 * ランキングの個人は、ルーキーの選手の名前の下の行に「Rookie」を出すので、登録区分の選択によらず読む
 */
export function useSeasonRookies(season: string, enabled: boolean): SeasonRookies {
  const supported = rookieSupportedSeason(season);
  const fetching = enabled && supported;
  const { data, error } = useJsonData(() => (fetching ? fetchRookieEligibility() : Promise.resolve(null)), [fetching]);
  const ids = useMemo<ReadonlySet<string> | null>(() => {
    if (!supported) return NO_ROOKIES;
    return data ? new Set(data.seasons[season] ?? []) : null;
  }, [supported, data, season]);
  return { ids, loading: fetching && !data && !error, error: fetching ? error : null };
}
