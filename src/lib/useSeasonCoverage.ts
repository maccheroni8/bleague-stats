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
