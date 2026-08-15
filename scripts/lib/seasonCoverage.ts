// シーズン文字列から、data/seasons.jsonに書き出すデータ対応範囲を判定する。
// 境界の技術的根拠はdocs/DESIGN.md参照。2層構成（2026-08-15、ユーザー確定）:
// 2016-17〜2019-20はlegacyモデルでのPBP系データ復元（2026-08-13検証、警告0件・
// MIN一致率100%）を2020-21〜2021-22と同じ信頼度で扱い、ショットチャートのみが
// 2022-23以降に限定される。

import type { SeasonCoverage } from "../../shared/types.ts";

export function seasonCoverage(season: string): SeasonCoverage {
  const startYear = Number(season.split("-")[0]);
  return startYear >= 2022 ? "full" : "pbpNoShotChart";
}
