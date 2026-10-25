// シーズンごとのポストシーズン（CS／プレーオフ）出場形式（DESIGN.md 131章）。サイト内の「CS進出圏」
// （条件別順位表）・ワイルドカード順位表・ワイルドカードの推移グラフは、すべてここから値を取る。
//
// 形式はどのシーズンも「各地区の上位 divisionTop クラブ＋それ以外のワイルドカード上位 wildcardSlots クラブ」
// の計8クラブ。ワイルドカードの母集団は「各地区の上位 divisionTop クラブを除いた全クラブ」で、その中の順位
// （プールのクラブだけで同率を判定した wildcardRank。無い古いデータは全体順位 rank）の良い順に選ぶ（DESIGN.md 229章）。
//
// 裏取り（2026-09-24）: 公式の発表・要項で確認したシーズンに加え、全シーズンで「最終順位にこの形式を当てはめた8クラブ」と
// 「実際にCS/プレーオフの試合をしたクラブ」が一致することを確認した（games-summary.json の gameType=playoff）。
import type { Category, ClinchType, StandingsTeamSnapshot } from "./types.ts";

export interface PostseasonFormat {
  /** 各地区から自動で出場するクラブ数（地区○位以内） */
  divisionTop: number;
  /** ワイルドカード枠数 */
  wildcardSlots: number;
  /** 形式の出典 */
  source: string;
  /**
   * 決勝の勝ち抜けに必要な勝ち数（B.PREMIER の 2026-27〜は3勝先取。B.ONE は2試合で1勝1敗なら3試合目＝2勝）。
   * 無いシーズンは年間優勝を判定しない
   */
  finalWinsNeeded?: number;
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
  "2026-27": { divisionTop: 3, wildcardSlots: 2, finalWinsNeeded: 3, source: "公式（B.LEAGUE PREMIERプレーオフ試合実施要項 第2条）" },
};

/**
 * B.ONE のプレーオフ出場形式（DESIGN.md 295章）。2026-27: 5地区の各1・2位（出場順位1〜10）＋残り15クラブの上位6（ワイルドカード、11〜16）の16クラブ。
 * 全ラウンド2試合で、1勝1敗なら別日に3試合目。すべて出場順位の上位のホーム。3位決定戦なし（りそなグループ B.LEAGUE ONE PLAYOFFS 2026-27、
 * bleague.jp/regulation/?tab=2 を2026-10-25に確認）。旧B2（2025-26 以前）の形式は登録していない（null）
 */
const ONE_FORMATS: Record<string, PostseasonFormat> = {
  "2026-27": { divisionTop: 2, wildcardSlots: 6, finalWinsNeeded: 2, source: "公式（B.LEAGUE フォーマット B.ONE、2026-27 PLAYOFFS）" },
};

/**
 * そのシーズン・リーグのポストシーズン出場形式。形式が無いシーズン（CS中止の2019-20、旧B2）はnull。
 * 2027-28以降は2026-27の形式が続く前提で2026-27の値を返す（変わったらFORMATSに追記する）
 */
export function postseasonFormat(season: string, category: Category = "premier"): PostseasonFormat | null {
  const table = category === "one" ? ONE_FORMATS : FORMATS;
  const format = table[season];
  if (format) return format;
  return Number(season.split("-")[0]) > 2026 ? table["2026-27"]! : null;
}

/** その日付の順位でワイルドカード争いの対象か（地区の自動出場圏＝上位 divisionTop に入っていないクラブ） */
export function isInWildcardPool(team: StandingsTeamSnapshot, format: PostseasonFormat): boolean {
  return !!team.division && (team.divisionRank ?? Number.POSITIVE_INFINITY) > format.divisionTop;
}

/**
 * ワイルドカード争いのプールの中の並び順に使う値。スナップショットの `wildcardRank`（プールのクラブだけで同率を
 * 判定した順位）を使い、無い古いデータは全体順位 `rank` で代える（保存済みの古いデータが読まれても動くように）
 */
export function wildcardOrderRank(team: Pick<StandingsTeamSnapshot, "rank" | "wildcardRank">): number {
  return team.wildcardRank ?? team.rank;
}

/** その日付の順位でのポストシーズン進出圏の8クラブ（各地区の上位＋ワイルドカード） */
export function postseasonQualifiedTeamIds(teams: StandingsTeamSnapshot[], format: PostseasonFormat): Set<string> {
  const divisionQualified = teams.filter((t) => !!t.division && !isInWildcardPool(t, format));
  const wildcard = teams
    .filter((t) => isInWildcardPool(t, format))
    .sort((a, b) => wildcardOrderRank(a) - wildcardOrderRank(b))
    .slice(0, format.wildcardSlots);
  return new Set([...divisionQualified, ...wildcard].map((t) => t.teamId));
}

/**
 * 勝敗表の確定マーク（DESIGN.md 132章）を判定する種類。
 * - 地区優勝（◎）: 全試合を消化したシーズン。2019-20（中止）と2020-21・2021-22（中止試合が多くクラブごとの試合数がばらつき、
 *   過去の日付の判定に「後で中止になる試合」の情報が混ざる）は対象外
 * - ポストシーズン進出（☆）: 出場形式を確認できていて、2地区制で判定を検証したシーズン（2025-26は各地区上位2＋WC4、2026-27〜は上位3＋WC2）
 * - 準々決勝のホームコート（★）: 2026-27〜（地区1・2位がホーム。2025-26以前は準々決勝のホームの決まり方を確認できていない）
 */
export function clinchTypesForSeason(season: string): ClinchType[] {
  const types: ClinchType[] = [];
  if (!["2019-20", "2020-21", "2021-22"].includes(season)) types.push("division");
  if (season >= "2026-27" || season === "2025-26") types.push("playoffs");
  if (season >= "2026-27") types.push("homeCourt");
  return types;
}
