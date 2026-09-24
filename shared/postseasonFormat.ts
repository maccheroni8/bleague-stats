// シーズンごとのポストシーズン（CS／プレーオフ）出場形式（DESIGN.md 131章）。サイト内の「CS進出圏」
// （条件別順位表）・ワイルドカード順位表・ワイルドカードの推移グラフは、すべてここから値を取る。
//
// 形式はどのシーズンも「各地区の上位 divisionTop クラブ＋それ以外の全体順位上位 wildcardSlots クラブ（ワイルドカード）」
// の計8クラブ。ワイルドカードの母集団は「各地区の上位 divisionTop クラブを除いた全クラブ」で、全体順位（公式タイブレーク
// 適用済みの rank）の良い順に選ぶ。
//
// 裏取り（2026-09-24）: 公式の発表・要項で確認したシーズンに加え、全シーズンで「最終順位にこの形式を当てはめた8クラブ」と
// 「実際にCS/プレーオフの試合をしたクラブ」が一致することを確認した（games-summary.json の gameType=playoff）。
import type { StandingsTeamSnapshot } from "./types.ts";

export interface PostseasonFormat {
  /** 各地区から自動で出場するクラブ数（地区○位以内） */
  divisionTop: number;
  /** ワイルドカード枠数 */
  wildcardSlots: number;
  /** 形式の出典 */
  source: string;
}

const FORMATS: Record<string, PostseasonFormat> = {
  "2016-17": { divisionTop: 2, wildcardSlots: 2, source: "公式（B.LEAGUE CHAMPIONSHIP 2016-17 特設ページ）" },
  "2017-18": { divisionTop: 2, wildcardSlots: 2, source: "実際の出場8クラブとの照合（公式の文面は未確認）" },
  "2018-19": { divisionTop: 2, wildcardSlots: 2, source: "実際の出場8クラブとの照合（公式の文面は未確認）" },
  // 2019-20 はCS中止のため形式なし
  "2020-21": { divisionTop: 3, wildcardSlots: 2, source: "公式（B.LEAGUE 2020-21 POSTSEASON概要発表）" },
  "2021-22": { divisionTop: 3, wildcardSlots: 2, source: "公式（B.LEAGUE 2021-22 POSTSEASON概要発表）" },
  "2022-23": { divisionTop: 2, wildcardSlots: 2, source: "公式（B.LEAGUE 2022-23 POSTSEASON概要発表）" },
  "2023-24": { divisionTop: 2, wildcardSlots: 2, source: "公式（B.LEAGUE 2023-24 POSTSEASON概要発表）" },
  "2024-25": { divisionTop: 2, wildcardSlots: 2, source: "公式（りそなグループ B.LEAGUE 2024-25 POSTSEASON概要発表）" },
  "2025-26": { divisionTop: 2, wildcardSlots: 4, source: "公式（2025-26シーズンのレギュレーション発表）" },
  "2026-27": { divisionTop: 3, wildcardSlots: 2, source: "公式（B.LEAGUE PREMIERプレーオフ試合実施要項 第2条）" },
};

/**
 * そのシーズンのポストシーズン出場形式。形式が無いシーズン（CS中止の2019-20）はnull。
 * 2027-28以降はB.PREMIERの形式（2026-27と同じ）が続く前提で2026-27の値を返す（変わったらFORMATSに追記する）
 */
export function postseasonFormat(season: string): PostseasonFormat | null {
  const format = FORMATS[season];
  if (format) return format;
  return Number(season.split("-")[0]) > 2026 ? FORMATS["2026-27"]! : null;
}

/** その日付の順位でワイルドカード争いの対象か（地区の自動出場圏＝上位 divisionTop に入っていないクラブ） */
export function isInWildcardPool(team: StandingsTeamSnapshot, format: PostseasonFormat): boolean {
  return !!team.division && (team.divisionRank ?? Number.POSITIVE_INFINITY) > format.divisionTop;
}

/** その日付の順位でのポストシーズン進出圏の8クラブ（各地区の上位＋ワイルドカード） */
export function postseasonQualifiedTeamIds(teams: StandingsTeamSnapshot[], format: PostseasonFormat): Set<string> {
  const divisionQualified = teams.filter((t) => !!t.division && !isInWildcardPool(t, format));
  const wildcard = teams
    .filter((t) => isInWildcardPool(t, format))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, format.wildcardSlots);
  return new Set([...divisionQualified, ...wildcard].map((t) => t.teamId));
}
