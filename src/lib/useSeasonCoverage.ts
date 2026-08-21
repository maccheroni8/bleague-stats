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
 * Yahoo!スポーツplay-by-play由来の機能（シュートタイプ内訳・ターンオーバー種別）が
 * 対応範囲内か。data/seasons.jsonの`yahooPbp`フラグ（実際にスクレイピング済みのシーズンのみ
 * true）をそのまま使う
 */
export function useYahooPbpCoverage(season: string): { supported: boolean; loading: boolean } {
  const { data, loading } = useJsonData(() => fetchSeasons(), []);
  const supported = data?.find((s) => s.season === season)?.yahooPbp ?? false;
  return { supported, loading };
}
