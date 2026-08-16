import { fetchSeasons } from "./data";
import { useJsonData } from "./useJsonData";
import type { SeasonCoverage } from "../../shared/types";

/** data/seasons.jsonから対象シーズンの対応範囲フラグを取得する */
export function useSeasonCoverage(season: string): { coverage: SeasonCoverage | null; loading: boolean } {
  const { data, loading } = useJsonData(() => fetchSeasons(), []);
  const coverage = data?.find((s) => s.season === season)?.coverage ?? null;
  return { coverage, loading };
}

/**
 * PBP系機能（Lead Tracker・出場交代バー・ラインナップ・オンオフコートスタッツ）が対応範囲内か。
 * 2層構成（full/pbpNoShotChart）はどちらもPBP系対応なので、未取得（null）のみ非対応として扱う
 */
export function isPbpSupported(coverage: SeasonCoverage | null): boolean {
  return coverage !== null;
}

/** ショットチャート（X/Y/AreaCD付きのシュートイベント）が対応範囲内か。fullのみ対応 */
export function isShotChartSupported(coverage: SeasonCoverage | null): boolean {
  return coverage === "full";
}

/**
 * POSSフィールドを用いるアドバンスドレーティング系（PACE/ORtg/DRtg/NetRtg）が対応範囲内か。
 * POSSは生データ上fullティア（2022-23シーズン以降）にのみ存在し、pbpNoShotChartティアでは
 * 常に0になる（PLUSMINUS/Usage%等の他のPBP系項目はreconstructOnCourtによる自前復元があるため
 * この問題が無い）。ショットチャートと同じ判定基準（coverage==="full"）を流用する
 */
export function isPossessionStatsSupported(coverage: SeasonCoverage | null): boolean {
  return coverage === "full";
}
